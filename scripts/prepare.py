"""Build a self-contained dashboard from open TCGA-LUSC PanCancer Atlas files."""
import csv
import json
import math
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from subprocess import run

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache"
STUDY = "lusc_tcga_pan_can_atlas_2018"
API = "https://www.cbioportal.org/api"
DATAHUB = f"https://media.githubusercontent.com/media/cBioPortal/datahub/master/public/{STUDY}"
GENES = {"TP53": 7157, "PIK3CA": 5290, "KEAP1": 9817, "NFE2L2": 4780,
         "CDKN2A": 1029, "PTEN": 5728, "NOTCH1": 4851, "RB1": 5925}
STAGES = ("I", "II", "III", "IV", "Unknown")

def download(filename, url):
    path = CACHE / filename
    if not path.exists():
        temporary = path.with_suffix(path.suffix + ".tmp")
        run(["curl", "--fail", "--silent", "--show-error", "--location", "--retry", "2",
             "--max-time", "90", "--output", str(temporary), url], check=True)
        temporary.replace(path)
    return path

def tsv(path):
    with path.open(newline="") as stream:
        yield from csv.DictReader((line for line in stream if not line.startswith("#")), delimiter="\t")

def stage_group(value):
    match = re.fullmatch(r"STAGE (IV|III|II|I)[ABC]?", value.upper().strip())
    return match[1] if match else "Unknown"

def prepare():
    CACHE.mkdir(exist_ok=True)
    jobs = {
        "clinical.json": f"{API}/studies/{STUDY}/clinical-data?clinicalDataType=PATIENT&pageSize=25000",
        "data_clinical_sample.txt": f"{DATAHUB}/data_clinical_sample.txt",
        "data_mrna_seq_v2_rsem.txt": f"{DATAHUB}/data_mrna_seq_v2_rsem.txt",
        "cases_sequenced.txt": f"https://raw.githubusercontent.com/cBioPortal/datahub/master/public/{STUDY}/case_lists/cases_sequenced.txt",
    }
    for gene, entrez in GENES.items():
        jobs[f"{gene}.json"] = (f"{API}/molecular-profiles/{STUDY}_mutations/mutations"
                                f"?sampleListId={STUDY}_sequenced&entrezGeneId={entrez}")
    with ThreadPoolExecutor(max_workers=5) as pool:
        files = dict(zip(jobs, pool.map(lambda job: download(*job), jobs.items())))

    records = json.loads(files["clinical.json"].read_text())
    if len(records) >= 25000:
        raise ValueError("Clinical response may be incomplete; request paginated records.")
    patients = {row["patientId"]: "Unknown" for row in records}
    patients.update({row["patientId"]: stage_group(row["value"]) for row in records
                     if row["clinicalAttributeId"] == "AJCC_PATHOLOGIC_TUMOR_STAGE"})
    pairs = [(row["SAMPLE_ID"], row["PATIENT_ID"]) for row in tsv(files["data_clinical_sample.txt"])
             if row["SAMPLE_TYPE"] == "Primary" and row["PATIENT_ID"] in patients]
    multiplicity = Counter(patient for _, patient in pairs)
    if any(count > 1 for count in multiplicity.values()):
        raise ValueError("Define a rule for patients with multiple primary samples before proceeding.")
    sample_stage = {sample: patients[patient] for sample, patient in pairs}
    sequenced_line = next(line for line in files["cases_sequenced.txt"].read_text().splitlines()
                          if line.startswith("case_list_ids:"))
    sequenced = set(sequenced_line.split(":", 1)[1].split()) & sample_stage.keys()
    by_id = {str(entrez): gene for gene, entrez in GENES.items()}
    expression = {}
    with files["data_mrna_seq_v2_rsem.txt"].open(newline="") as stream:
        reader = csv.DictReader(stream, delimiter="\t")
        matrix_samples = set(reader.fieldnames or ()) & sample_stage.keys()
        for row in reader:
            gene = by_id.get(row["Entrez_Gene_Id"])
            if gene:
                if gene in expression:
                    raise ValueError(f"Duplicate expression row for {gene}")
                expression[gene] = {sample: float(row[sample]) for sample in matrix_samples
                                    if row[sample] not in ("", "NA", "NaN", "null")}
    if set(expression) != set(GENES) or not sequenced:
        raise ValueError("Missing gene expression rows or mutation-profiled cases.")

    data = {}
    for stage in ("All stages", *STAGES):
        sample_ids = {sample for sample, value in sample_stage.items()
                      if stage == "All stages" or stage == value}
        profiled = sequenced & sample_ids
        rna = matrix_samples & sample_ids
        data[stage] = {
            "primary": len(sample_ids),
            "mutation": len(profiled),
            "expression": len(rna),
            "overlap": len(profiled & rna),
            "genes": {}
        }
        for gene in GENES:
            mutations = json.loads(files[f"{gene}.json"].read_text())
            if not isinstance(mutations, list):
                raise ValueError(f"Unexpected mutation response for {gene}")
            mutated = {row["sampleId"] for row in mutations}
            values = sorted(round(math.log2(value + 1), 5) for sample, value in expression[gene].items()
                            if sample in sample_ids and math.isfinite(value) and value >= 0)
            data[stage]["genes"][gene] = {"mutated": len(mutated & profiled), "values": values}
    # Publish histogram counts only. Keep the same x-axis bins across stages for each gene.
    for gene in GENES:
        all_values = data["All stages"]["genes"][gene]["values"]
        limit = max(1, math.ceil(max(all_values, default=0)))
        for cohort in data.values():
            record = cohort["genes"][gene]
            values = record.pop("values")
            bins = [0] * 12
            for value in values:
                bins[min(11, int(12 * value / limit))] += 1
            record.update(n=len(values), bins=bins, limit=limit)

    audit = {"clinical_patients": len(patients),
             "stage_counts": {stage: {key: value for key, value in counts.items() if key != "genes"}
                              for stage, counts in data.items()}}
    (ROOT / "data" / "join_audit.json").write_text(json.dumps(audit, indent=2) + "\n")
    template = (ROOT / "src" / "dashboard.template.html").read_text()
    (ROOT / "docs" / "index.html").write_text(template.replace("__DASHBOARD_DATA__", json.dumps(data)))
    print(json.dumps(audit, indent=2))

if __name__ == "__main__":
    prepare()
