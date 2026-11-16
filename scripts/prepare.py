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

def age_group(value):
    try:
        age = float(value)
    except (TypeError, ValueError):
        return "Unknown"
    if not math.isfinite(age) or age < 0:
        return "Unknown"
    return "Under 65" if age < 65 else "65 and older"

def box_summary(values):
    if not values:
        return None
    ordered = sorted(values)
    def quantile(q):
        offset = (len(ordered) - 1) * q
        index = int(offset)
        fraction = offset - index
        return round(ordered[index] * (1 - fraction) +
                     ordered[min(index + 1, len(ordered) - 1)] * fraction, 3)
    return [round(ordered[0], 3), quantile(.25), quantile(.5), quantile(.75),
            round(ordered[-1], 3), len(ordered)]

def survival_record(fields):
    status = fields.get("OS_STATUS", "")
    try:
        months = float(fields.get("OS_MONTHS", ""))
    except (TypeError, ValueError):
        return None
    if status not in ("0:LIVING", "1:DECEASED") or not math.isfinite(months) or months < 0:
        return None
    return months, status == "1:DECEASED"

def kaplan_meier(records):
    times = {}
    for time, event in records:
        counts = times.setdefault(time, [0, 0])
        counts[0 if event else 1] += 1
    at_risk = len(records)
    probability = 1.0
    steps = []
    for time, (events, censored) in sorted(times.items()):
        probability *= 1 - events / at_risk
        steps.append([round(time, 5), round(probability, 6), censored, at_risk, events])
        at_risk -= events + censored
    return {"n": len(records), "events": sum(event for _, event in records), "steps": steps}

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
    clinical = {}
    for row in records:
        clinical.setdefault(row["patientId"], {})[row["clinicalAttributeId"]] = row["value"]
    patients = {patient: stage_group(fields.get("AJCC_PATHOLOGIC_TUMOR_STAGE", ""))
                for patient, fields in clinical.items()}
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

    fields_by_sample = {sample: clinical[patient] for sample, patient in pairs}
    age_by_sample = {sample: age_group(fields.get("AGE")) for sample, fields in fields_by_sample.items()}
    sex_by_sample = {sample: fields.get("SEX") for sample, fields in fields_by_sample.items()}
    survival = {sample: record for sample, fields in fields_by_sample.items()
                if (record := survival_record(fields)) is not None}
    mutations_by_gene = {}
    log_expression = {}
    for gene in GENES:
        mutations = json.loads(files[f"{gene}.json"].read_text())
        if not isinstance(mutations, list):
            raise ValueError(f"Unexpected mutation response for {gene}")
        mutations_by_gene[gene] = {row["sampleId"] for row in mutations} & sequenced
        log_expression[gene] = {sample: math.log2(value + 1)
                                for sample, value in expression[gene].items()
                                if math.isfinite(value) and value >= 0}
    filters = {
        "stage": ("All", *STAGES),
        "sex": ("All", "Female", "Male"),
        "age": ("All", "Under 65", "65 and older", "Unknown"),
    }
    cohorts = {}
    for stage in filters["stage"]:
        for sex in filters["sex"]:
            for age in filters["age"]:
                ids = sorted(sample for sample in sample_stage
                             if (stage == "All" or sample_stage[sample] == stage)
                             and (sex == "All" or sex_by_sample[sample] == sex)
                             and (age == "All" or age_by_sample[sample] == age))
                cases = set(ids)
                profiled = sequenced & cases
                rna = matrix_samples & cases
                counts = Counter(sample_stage[sample] for sample in ids)
                genes = {}
                for gene in GENES:
                    mutated = mutations_by_gene[gene] & profiled
                    values = log_expression[gene]
                    matched = [sample for sample in ids if sample in values]
                    stage_boxes = {group: box_summary([values[sample] for sample in matched
                                                       if sample_stage[sample] == group])
                                   for group in STAGES}
                    status_boxes = {
                        "Mutated": box_summary([values[s] for s in matched if s in mutated]),
                        "No mutation detected": box_summary([values[s] for s in matched
                                                              if s in profiled and s not in mutated]),
                    }
                    genes[gene] = {"mutated": len(mutated), "stage_boxes": stage_boxes,
                                   "status_boxes": status_boxes,
                                   "mean": round(sum(values[s] for s in matched) / len(matched), 3)
                                   if matched else None}
                cohorts["|".join((stage, sex, age))] = {
                    "primary": len(ids), "mutation": len(profiled), "expression": len(rna),
                    "overlap": len(profiled & rna), "stages": dict(counts), "genes": genes,
                    "survival": kaplan_meier([survival[sample] for sample in ids if sample in survival]),
                }
    stage_counts = {}
    for stage in filters["stage"]:
        cohort = cohorts[f"{stage}|All|All"]
        stage_counts["All stages" if stage == "All" else stage] = {
            key: cohort[key] for key in ("primary", "mutation", "expression", "overlap")
        }
    audit = {"clinical_patients": len(patients), "stage_counts": stage_counts,
             "overall_survival_usable": len(survival)}
    data = {"filters": filters, "cohorts": cohorts}
    (ROOT / "data" / "join_audit.json").write_text(json.dumps(audit, indent=2) + "\n")
    template = (ROOT / "src" / "dashboard.template.html").read_text()
    javascript = (ROOT / "src" / "dashboard.js").read_text()
    html = template.replace("__DASHBOARD_CODE__", javascript)
    (ROOT / "docs" / "index.html").write_text(
        html.replace("__DASHBOARD_DATA__", json.dumps(data, separators=(",", ":"))))
    print(json.dumps(audit, indent=2))

if __name__ == "__main__":
    prepare()
