const get = id => document.getElementById(id);
const data = JSON.parse(get('dashboard-data').textContent);
const stages = data.filters.stage.slice(1);
const all = data.cohorts['All|All|All'];
const genes = Object.keys(all.genes).sort((a,b) => all.genes[b].mutated - all.genes[a].mutated);
const names = ['A', 'B'];
get('case-total').textContent = all.primary;
get('stage-target').value = 'A';
const colors = ['#13746a', '#9d4c22'];
const defaults = [{stage:'I',sex:'All',age:'All'}, {stage:'II',sex:'All',age:'All'}];
const filters = defaults.map(item => ({...item}));
const stageLabel = stage => ['All','Unknown'].includes(stage) ? stage : 'Stage ' + stage;

function selectOptions(options, label = x => x) {
  return options.map(value => new Option(label(value),value));
}

get('gene').replaceChildren(...selectOptions(genes));
for (const [index, name] of names.entries()) {
  const panel = document.createElement('section');
  panel.className = 'panel cohort ' + name.toLowerCase();
  panel.innerHTML = `<h2>Cohort ${name}</h2><div class="filters">
    <label>Stage<select id="stage${name}"></select></label>
    <label>Sex<select id="sex${name}"></select></label>
    <label>Age at diagnosis<select id="age${name}"></select></label>
    </div><p id="coverage${name}"></p>
    <h3 id="gene-title${name}"></h3><div id="boxes${name}"></div>
    <h3>Mutation percentage</h3><p><small>Percent of mutation-profiled patients</small></p>
    <div id="ranking${name}"></div>`;
  get('cohorts').append(panel);
  for (const field of Object.keys(data.filters)) {
    const control = get(field + name);
    control.replaceChildren(...selectOptions(data.filters[field], field === 'stage' ? stageLabel : undefined));
    control.value = filters[index][field];
    control.onchange = () => {
      filters[index][field] = control.value;
      render();
    };
  }
}

function line(x1,y1,x2,y2,attrs = 'class="axis"') {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${attrs}/>`;
}

function boxes(record, maximum, color) {
  const labels = Object.keys(record);
  const plotLeft = 38, plotRight = 386, top = 6, bottom = 125;
  const y = value => bottom - (bottom - top) * value / maximum;
  const div = (plotRight - plotLeft) / labels.length;
  let marks = line(plotLeft,top,plotLeft,bottom) + line(plotLeft,bottom,plotRight,bottom);
  for (const value of [0, maximum / 2, maximum]) {
    marks += line(plotLeft,y(value),plotRight,y(value),'class="gridline"');
    marks += `<text x="32" y="${y(value)+4}" text-anchor="end">${value.toFixed(1)}</text>`;
  }
  labels.forEach((label,index) => {
    const x = plotLeft + (index + .5) * div;
    const stats = record[label];
    marks += `<text x="${x}" y="143" text-anchor="middle">${label}</text>
      <text x="${x}" y="159" text-anchor="middle">n = ${stats?.[5] ?? 0}</text>`;
    if (!stats) return;
    const [min,q1,median,q3,max,n] = stats;
    marks += `<g><title>${label}. n=${n}, median=${median}, Q1=${q1}, Q3=${q3}, range=${min}–${max}</title>
      ${line(x,y(min),x,y(max))}
      ${line(x-9,y(min),x+9,y(min))}
      ${line(x-9,y(max),x+9,y(max))}
      <rect x="${x-14}" y="${y(q3)}" width="28" height="${Math.max(1,y(q1)-y(q3))}" fill="${color}" fill-opacity=".2" stroke="${color}"/>
      ${line(x-14,y(median),x+14,y(median),`stroke="${color}" stroke-width="2"`)}
      </g>`;
  });
  return `<p><small>log₂(RSEM + 1) · whiskers show the full range</small></p>
    <svg viewBox="0 0 395 165" role="img" aria-label="Expression box plot by selected grouping">${marks}</svg>`;
}

function pairedBars(groups, cohorts, count, denominator) {
  return groups.map(([key,label]) => `<div class="metric"><strong>${label}</strong>${
    cohorts.map((cohort,index) => {
      const value = count(cohort,key);
      const total = denominator(cohort);
      const ratio = total ? 100 * value / total : 0;
      const displayed = total ? (key.startsWith('stage:') ? ratio.toFixed(0) + '%' : value) : '—';
      return `<div class="barline" title="Cohort ${names[index]}: ${value} of ${total}">
        <span>${names[index]}</span><span class="track"><span class="fill" style="width:${ratio}%;background:${colors[index]}"></span></span>
        <span>${displayed}</span></div>`;
    }).join('')}</div>`).join('');
}

function survivalPlot(cohorts) {
  const max = Math.max(1,...cohorts.map(c => c.survival.steps.at(-1)?.[0] ?? 0));
  const times = [0, .25, .5, .75, 1].map(fraction => Math.floor(max * fraction));
  const x = time => 53 + 685 * time / max;
  const y = probability => 210 - 188 * probability;
  let plot = '';
  for (const probability of [0,.25,.5,.75,1]) {
    plot += line(53,y(probability),738,y(probability),'class="gridline"');
    plot += `<text x="46" y="${y(probability)+4}" text-anchor="end">${probability * 100}%</text>`;
  }
  plot += line(53,22,53,210) + line(53,210,738,210);
  for (const time of times) plot += `<text x="${x(time)}" y="229" text-anchor="middle">${time}</text>`;
  plot += '<text x="395" y="248" text-anchor="middle">Overall survival time (months)</text>';
  cohorts.forEach(({survival},index) => {
    if (!survival.n) return;
    const color = colors[index];
    let path = `M ${x(0)} ${y(1)}`;
    let ticks = '';
    for (const [time,probability,censored] of survival.steps) {
      path += ` H ${x(time)} V ${y(probability)}`;
      if (censored) ticks += line(x(time),y(probability)-4,x(time),y(probability)+4,`stroke="${color}"`);
    }
    plot += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.4" ${index ? 'stroke-dasharray="6 4"' : ''}/>${ticks}`;
  });
  get('survival').innerHTML = cohorts.some(c => c.survival.n)
    ? `<svg viewBox="0 0 755 256" role="img" aria-label="Kaplan–Meier overall survival curves by cohort">${plot}</svg>`
    : '<p>No usable survival records for these filters.</p>';
  get('risk').innerHTML = `<table class="risk"><caption>Number at risk</caption><thead><tr><th>Months</th>${times.map(t => `<th>${t}</th>`).join('')}</tr></thead>
    <tbody>${cohorts.map(({survival},index) => `<tr><th>Cohort ${names[index]} · events ${survival.events}</th>${
    times.map(t => `<td>${survival.steps.find(step => step[0] >= t)?.[3] ?? 0}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

const coverageRows = [
  ['Clinical records', c => c.primary],
  ['RNA expression', c => c.expression],
  ['Somatic mutation', c => c.mutation],
  ['Both molecular assays', c => c.overlap],
  ['Usable overall survival', c => c.survival.n],
];
const percent = (n, total) => total ? (100 * n / total).toFixed(1) + '%' : '—';

function distribution(cohorts, key, labels, donut = false) {
  const palette = ['#366780', '#bb652a', '#a1a9a6'];
  return cohorts.map((cohort, index) => {
    let start = 0;
    const segments = [];
    const rows = labels.map((label, j) => {
      const count = cohort[key][label] ?? 0;
      const width = cohort.primary ? 100 * count / cohort.primary : 0;
      if (width) segments.push(`${palette[j]} ${start}% ${start + width}%`);
      start += width;
      const bar = donut ? '' : `<span class="track"><span class="fill" style="width:${width}%;background:${palette[j]}"></span></span>`;
      return `<li><span><span class="dot" aria-hidden="true" style="background:${palette[j]}"></span>${label}</span>
        <span>${count} · ${percent(count, cohort.primary)}</span>${bar}</li>`;
    }).join('');
    const ring = donut && segments.length
      ? `<div class="donut" aria-hidden="true" style="--segments:conic-gradient(${segments.join(',')})"></div>` : '';
    return `<section><h3>Cohort ${names[index]} · n = ${cohort.primary}</h3>${ring}<ul class="composition">${rows}</ul></section>`;
  }).join('');
}

function cohortTable(rows, cohorts, heading) {
  return `<table class="risk"><thead><tr><th scope="col">${heading}</th>
    <th scope="col">Cohort A</th><th scope="col">Cohort B</th></tr></thead><tbody>${
    rows.map(([label, value]) => `<tr><th scope="row">${label}</th>${
      cohorts.map(cohort => `<td>${value(cohort)}</td>`).join('')}</tr>`).join('')
  }</tbody></table>`;
}

function setStage(stage) {
  const name = get('stage-target').value;
  const index = names.indexOf(name);
  filters[index].stage = stage;
  get('stage' + name).value = stage;
  render();
  if (stage !== 'All') get('stage-jump').querySelector('[aria-pressed="true"]')?.focus();
}

function renderStageNavigation() {
  const index = names.indexOf(get('stage-target').value);
  const {stage, sex, age} = filters[index];
  const base = data.cohorts[['All', sex, age].join('|')];
  get('stage-jump').replaceChildren(...stages.map(value => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stage-button';
    button.setAttribute('aria-pressed', value === stage);
    const count = base.stages[value] ?? 0;
    button.innerHTML = `<span>${stageLabel(value)}</span><span>${count} · ${percent(count,base.primary)}</span>`;
    button.onclick = () => setStage(value);
    return button;
  }));
}

function renderOverview(cohorts, gene) {
  get('age-overview').innerHTML = distribution(cohorts, 'ages', ['Under 65', '65 and older', 'Unknown']);
  get('ethnicity-overview').innerHTML = distribution(cohorts, 'ethnicities',
    ['Not Hispanic or Latino', 'Hispanic or Latino', 'Not recorded'], true);
  get('treatment').innerHTML = distribution(cohorts, 'radiation', ['Yes', 'No', 'Not recorded']);
  get('assays').innerHTML = cohortTable(coverageRows.map(([label, count]) => [
    label, cohort => `${count(cohort)} / ${cohort.primary} · ${percent(count(cohort), cohort.primary)}`,
  ]), cohorts, 'Data type');
  get('summary-table').innerHTML = cohortTable([
    ...coverageRows,
    [gene + ' mutation detected', cohort => `${cohort.genes[gene].mutated} / ${cohort.mutation}`],
    ['Observed deaths', cohort => cohort.survival.events],
  ], cohorts, 'Measure');
  renderStageNavigation();
}

function render() {
  const cohorts = filters.map(({stage,sex,age}) => data.cohorts[[stage,sex,age].join('|')]);
  const gene = get('gene').value;
  const group = get('group').value;
  const max = Math.max(1,Math.ceil(Math.max(...Object.values(all.genes[gene].stage_boxes).map(s=>s?.[4] ?? 0))));
  get('selection').textContent = `${gene} selected`;
  cohorts.forEach((cohort,index) => {
    const name = names[index];
    get('coverage'+name).textContent = `${cohort.primary} patients · ${cohort.mutation} mutation-profiled · ${cohort.expression} RNA-profiled`;
    get('gene-title'+name).textContent = gene + ' expression';
    get('boxes'+name).innerHTML = boxes(cohort.genes[gene][group],max,colors[index]);
    const ranking = get('ranking'+name);
    ranking.replaceChildren(...genes.map(symbol => {
      const count = cohort.genes[symbol].mutated;
      const rate = cohort.mutation ? 100 * count / cohort.mutation : 0;
      const button = document.createElement('button');
      button.className = 'gene';
      button.setAttribute('aria-pressed',symbol === gene);
      button.title = `${count} of ${cohort.mutation} profiled patients`;
      button.innerHTML = `<span>${symbol}</span><span class="track"><span class="fill" style="width:${rate}%"></span></span>
        <span class="value">${cohort.mutation ? rate.toFixed(1)+'%' : '—'}</span>`;
      button.onclick = () => {
        get('gene').value = symbol;
        render();
        get('ranking'+name).querySelector('[aria-pressed="true"]').focus();
      };
      return button;
    }));
  });
  get('stages').innerHTML = pairedBars(stages.map(s=>['stage:'+s,stageLabel(s)]),cohorts,
    (c,key)=>c.stages[key.slice(6)] ?? 0,c=>c.primary);
  const cap = Math.max(1,...cohorts.map(c=>c.primary));
  get('availability').innerHTML = pairedBars([['primary','Clinical'],['expression','RNA expression'],
    ['mutation','Mutation'],['overlap','Both assays'],['survival','Usable survival']],cohorts,
    (c,key)=>key==='survival'? c.survival.n : c[key],()=>cap);
  const maxMean = Math.max(1,...cohorts.flatMap(c => genes.map(g => c.genes[g].mean ?? 0)));
  get('heatmap').innerHTML = `<table class="heat"><thead><tr><th>Gene</th><th>Cohort A</th><th>Cohort B</th></tr></thead>
    <tbody>${genes.map(g=>`<tr><th scope="row">${g === gene ? '● ' : ''}${g}</th>${cohorts.map(c=>{
      const mean = c.genes[g].mean;
      return mean === null ? '<td>—</td>' : `<td style="background:rgba(19,116,106,${0.08+0.42*mean/maxMean})">${mean.toFixed(2)}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table>`;
  survivalPlot(cohorts);
  renderOverview(cohorts, gene);
}

get('stage-target').onchange = renderStageNavigation;
get('clear-stage').onclick = () => setStage('All');
get('gene').onchange = render;
get('group').onchange = render;
get('reset').onclick = () => {
  for (const [index,name] of names.entries()) {
    filters[index] = {...defaults[index]};
    for (const [field,value] of Object.entries(filters[index])) get(field+name).value = value;
  }
  get('stage-target').value = 'A';
  get('gene').value = genes[0];
  get('group').value = 'stage_boxes';
  render();
};
render();

// ---------- Shared helpers for the patient-level views ----------
const patients = data.patients;
const escapeHtml = value => String(value).replace(/[&<>"']/g, ch =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
const mutationColors = {Truncating:'#1d1d1d', Splice:'#e69f00', Missense:'#2f8a3b', 'In-frame':'#8a5a9e', Other:'#6b7d77'};
const mutationOrder = Object.keys(mutationColors);
const mainClass = list => mutationOrder.find(type => list.some(([kind]) => kind === type));
const matchesFilter = (p, f) => (f.stage === 'All' || p.stage === f.stage)
  && (f.sex === 'All' || p.sex === f.sex) && (f.age === 'All' || p.age_group === f.age);
const scopePatients = scope => scope === 'All' ? patients
  : patients.filter(p => matchesFilter(p, filters[names.indexOf(scope)]));
const describeFilter = f => [f.stage === 'All' ? 'All stages' : f.stage === 'Unknown' ? 'Unknown stage' : stageLabel(f.stage),
  f.sex === 'All' ? 'All sexes' : f.sex, f.age === 'All' ? 'All ages' : 'Age ' + f.age.toLowerCase()].join(' · ');
const scopeLabel = scope => scope === 'All' ? 'all patients' : `Cohort ${scope}`;

function refreshScopes() {
  for (const select of document.querySelectorAll('select.scope')) {
    const value = select.value || 'All';
    select.replaceChildren(new Option('All patients', 'All'),
      ...names.map((name, index) => new Option(`Cohort ${name} (${describeFilter(filters[index])})`, name)));
    select.value = value;
  }
}

function setSharedGene(gene) {
  get('gene').value = gene;
  render();
  renderActiveTab();
}

// ---------- Tabs ----------
const tabs = ['overview', 'matrix', 'patients'];
let activeTab = 'overview';

function showTab(name, focus = false) {
  if (!tabs.includes(name)) name = 'overview';
  activeTab = name;
  for (const tab of tabs) {
    const button = get('tab-' + tab);
    button.setAttribute('aria-selected', tab === name);
    button.tabIndex = tab === name ? 0 : -1;
    get('view-' + tab).hidden = tab !== name;
  }
  if (focus) get('tab-' + name).focus();
  try { history.replaceState(null, '', '#' + name); } catch { /* some browsers block this on file:// */ }
  renderActiveTab();
}

function renderActiveTab() {
  if (activeTab === 'matrix') renderMatrix();
  if (activeTab === 'patients') renderTable();
}

for (const [index, tab] of tabs.entries()) {
  const button = get('tab-' + tab);
  button.onclick = () => showTab(tab);
  button.onkeydown = event => {
    const step = {ArrowRight: 1, ArrowLeft: -1}[event.key];
    if (event.key === 'Home') showTab(tabs[0], true);
    else if (event.key === 'End') showTab(tabs.at(-1), true);
    else if (step) showTab(tabs[(index + step + tabs.length) % tabs.length], true);
    else return;
    event.preventDefault();
  };
}

// ---------- Mutation matrix ----------
const grey = '#c9cfcc';
const tracks = [
  ['Stage', p => p.stage, {I:'#cfe1ea', II:'#8fb8cc', III:'#4f8aa8', IV:'#1f4e66', Unknown:grey}, stageLabel],
  ['Sex', p => p.sex, {Female:'#c06c94', Male:'#4c7fb0'}],
  ['Age', p => p.age_group, {'Under 65':'#a8d0b0', '65 and older':'#3f7f55', Unknown:grey}],
  ['Vital status', p => p.vital, {Living:'#d6cfb4', Deceased:'#3b3b3b', 'Not recorded':grey}],
];
let matrixColumns = [];

function sortColumns(list, rowGenes, mode) {
  const pattern = p => rowGenes.map(g => p.mutations[g] ? '1' : '0').join('');
  const byPattern = (a, b) => pattern(b).localeCompare(pattern(a)) || a.id.localeCompare(b.id);
  const stageRank = p => stages.indexOf(p.stage);
  const sorters = {
    pattern: byPattern,
    stage: (a, b) => stageRank(a) - stageRank(b) || byPattern(a, b),
    survival: (a, b) => (a.os_months ?? Infinity) - (b.os_months ?? Infinity) || byPattern(a, b),
  };
  return [...list].sort(sorters[mode]);
}

function renderMatrix() {
  refreshScopes();
  const scope = get('matrix-scope').value;
  const shared = get('gene').value;
  const pool = scopePatients(scope);
  const profiled = pool.filter(p => p.mutation_profiled);
  const counts = Object.fromEntries(genes.map(g => [g, profiled.filter(p => p.mutations[g]).length]));
  const rowGenes = [...genes].sort((a, b) => counts[b] - counts[a]);
  let columns = profiled;
  if (get('matrix-hide').checked) columns = columns.filter(p => rowGenes.some(g => p.mutations[g]));
  columns = sortColumns(columns, rowGenes, get('matrix-sort').value);
  matrixColumns = columns;

  const missing = pool.length - profiled.length;
  get('matrix-summary').textContent = `Showing ${columns.length} of ${profiled.length} mutation-profiled patients in ${scopeLabel(scope)}`
    + (missing ? `. ${missing} patient${missing === 1 ? ' has' : 's have'} no mutation profile and ${missing === 1 ? 'is' : 'are'} not shown.` : '.');

  const width = 1180, left = 112, right = 52, top = 4;
  const colW = Math.min(16, (width - left - right) / Math.max(columns.length, 1));
  const gap = colW >= 4 ? Math.min(1, colW * .15) : 0;
  const trackH = 11, geneH = 20, rowGap = 3, sectionGap = 12;
  const geneTop = top + tracks.length * (trackH + rowGap) + sectionGap;
  const height = geneTop + rowGenes.length * (geneH + rowGap);
  const plotRight = left + colW * columns.length;
  const x = i => left + i * colW;
  let svg = '';

  tracks.forEach(([label, value, palette], t) => {
    const y = top + t * (trackH + rowGap);
    svg += `<text x="${left - 8}" y="${y + trackH - 2}" text-anchor="end">${label}</text>`;
    columns.forEach((p, i) => {
      svg += `<rect x="${x(i)}" y="${y}" width="${colW - gap}" height="${trackH}" fill="${palette[value(p)] ?? grey}"/>`;
    });
  });

  rowGenes.forEach((gene, r) => {
    const y = geneTop + r * (geneH + rowGap);
    const selected = gene === shared;
    const rate = profiled.length ? (100 * counts[gene] / profiled.length).toFixed(0) + '%' : '—';
    svg += `<g class="gene-label" data-gene="${gene}" tabindex="0" role="button" aria-label="Make ${gene} the shared gene" aria-pressed="${selected}">
      <rect x="0" y="${y}" width="${left - 4}" height="${geneH}" rx="4" fill="${selected ? '#e7f0ed' : 'transparent'}" stroke="${selected ? '#628f82' : 'none'}"/>
      <text x="${left - 8}" y="${y + geneH / 2 + 4}" text-anchor="end" font-weight="${selected ? 700 : 400}" font-style="italic">${gene}</text></g>`;
    svg += `<rect x="${left}" y="${y}" width="${Math.max(0, plotRight - left)}" height="${geneH}" fill="#e4ebe8"/>`;
    columns.forEach((p, i) => {
      const found = p.mutations[gene];
      if (found) svg += `<rect x="${x(i)}" y="${y + 2}" width="${colW - gap}" height="${geneH - 4}" fill="${mutationColors[mainClass(found)]}"/>`;
    });
    svg += `<text x="${plotRight + 6}" y="${y + geneH / 2 + 4}">${rate}</text>`;
  });

  svg += `<rect id="matrix-highlight" x="0" y="${top - 2}" width="${colW}" height="${height - top + 2}" fill="none" stroke="#876721" stroke-width="1.5" visibility="hidden"/>`;
  svg += `<rect class="matrix-hit" x="${left}" y="${top}" width="${Math.max(0, plotRight - left)}" height="${height - top}" fill="transparent"/>`;
  get('matrix').innerHTML = columns.length
    ? `<svg viewBox="0 0 ${width} ${height + 4}" role="img" aria-label="Mutation matrix of ${columns.length} patients by ${rowGenes.length} genes. The patient table tab lists the same data." shape-rendering="crispEdges">${svg}</svg>`
    : '<p>No patients match these settings.</p>';
  get('matrix-tip').hidden = true;

  get('matrix-legend').innerHTML = [
    ['Mutation', mutationColors, v => v],
    ...tracks.map(([label, , palette, format]) => [label, palette, format ?? (v => v)]),
  ].map(([label, palette, format]) => `<div><strong>${label}</strong>${Object.entries(palette).map(([key, color]) =>
    `<span><span class="swatch" style="background:${color}"></span>${format(key)}</span>`).join('')}</div>`).join('');
}

function matrixColumnAt(event) {
  const svg = get('matrix').querySelector('svg');
  const hit = svg?.querySelector('.matrix-hit');
  if (!hit || !matrixColumns.length) return -1;
  const point = svg.createSVGPoint();
  point.x = event.clientX; point.y = event.clientY;
  const local = point.matrixTransform(svg.getScreenCTM().inverse());
  const left = +hit.getAttribute('x');
  const colW = +hit.getAttribute('width') / matrixColumns.length;
  const top = +hit.getAttribute('y');
  if (local.y < top || local.y > top + +hit.getAttribute('height')) return -1;
  const index = Math.floor((local.x - left) / colW);
  return index >= 0 && index < matrixColumns.length ? index : -1;
}

function patientSummary(p) {
  const mutated = genes.filter(g => p.mutations[g]);
  return `<strong>${escapeHtml(p.id)}</strong><br>${stageLabel(p.stage)} · ${p.sex} · ${p.age ?? 'age unknown'}<br>
    ${p.vital}${p.os_months !== null ? ` · ${p.os_months} months` : ''}
    ${mutated.length ? `<ul>${mutated.map(g => `<li><em>${g}</em>: ${p.mutations[g].map(([kind, change]) =>
      `${escapeHtml(change || 'unknown change')} (${kind.toLowerCase()})`).join(', ')}</li>`).join('')}</ul>`
      : '<br>No mutations in the selected genes'}<br><small>Click to open in the patient table</small>`;
}

get('matrix').addEventListener('mousemove', event => {
  const index = matrixColumnAt(event);
  const highlight = get('matrix-highlight');
  const tip = get('matrix-tip');
  if (index < 0) { tip.hidden = true; highlight?.setAttribute('visibility', 'hidden'); return; }
  const hit = get('matrix').querySelector('.matrix-hit');
  const colW = +hit.getAttribute('width') / matrixColumns.length;
  highlight.setAttribute('x', +hit.getAttribute('x') + index * colW);
  highlight.setAttribute('width', colW);
  highlight.setAttribute('visibility', 'visible');
  tip.innerHTML = patientSummary(matrixColumns[index]);
  tip.hidden = false;
  const wrap = get('matrix-wrap');
  const box = wrap.getBoundingClientRect();
  const px = event.clientX - box.left + wrap.scrollLeft;
  const flip = event.clientX - box.left > box.width - tip.offsetWidth - 20;
  tip.style.left = (flip ? px - tip.offsetWidth - 14 : px + 14) + 'px';
  tip.style.top = (event.clientY - box.top + 14) + 'px';
});
get('matrix').addEventListener('mouseleave', () => {
  get('matrix-tip').hidden = true;
  get('matrix-highlight')?.setAttribute('visibility', 'hidden');
});
get('matrix').addEventListener('click', event => {
  const label = event.target.closest('.gene-label');
  if (label) return setSharedGene(label.dataset.gene);
  const index = matrixColumnAt(event);
  if (index >= 0) openPatient(matrixColumns[index].id, get('matrix-scope').value);
});
get('matrix').addEventListener('keydown', event => {
  const label = event.target.closest('.gene-label');
  if (!label || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  setSharedGene(label.dataset.gene);
  get('matrix').querySelector(`.gene-label[data-gene="${label.dataset.gene}"]`)?.focus();
});
for (const id of ['matrix-scope', 'matrix-sort', 'matrix-hide']) get(id).onchange = renderMatrix;

// ---------- Patient table ----------
const tableSort = {key: 'id', dir: 1};
let focusedPatient = null;
const mutatedGenes = p => genes.filter(g => p.mutations[g]);
const expressionGene = () => get('table-gene').value;
const tableColumns = [
  {key: 'id', label: 'Patient ID', sort: p => p.id, csv: p => p.id,
    html: p => `<a href="https://www.cbioportal.org/patient?studyId=lusc_tcga_pan_can_atlas_2018&amp;caseId=${encodeURIComponent(p.id)}" target="_blank" rel="noopener">${escapeHtml(p.id)}</a>`},
  {key: 'stage', label: 'Stage', sort: p => stages.indexOf(p.stage), csv: p => p.stage, html: p => stageLabel(p.stage)},
  {key: 'sex', label: 'Sex', sort: p => p.sex, csv: p => p.sex},
  {key: 'age', label: 'Age', num: true, sort: p => p.age, csv: p => p.age},
  {key: 'ethnicity', label: 'Ethnicity', sort: p => p.ethnicity, csv: p => p.ethnicity},
  {key: 'radiation', label: 'Radiation', sort: p => p.radiation, csv: p => p.radiation},
  {key: 'vital', label: 'Vital status', sort: p => p.vital, csv: p => p.vital},
  {key: 'os', label: 'OS (months)', num: true, sort: p => p.os_months, csv: p => p.os_months},
  {key: 'mutations', label: 'Mutations (selected genes)', sort: p => p.mutation_profiled ? mutatedGenes(p).length : null,
    csv: p => p.mutation_profiled ? genes.flatMap(g => (p.mutations[g] ?? []).map(([k, c]) => `${g} ${c} (${k})`)).join('; ') : 'Not profiled',
    html: p => !p.mutation_profiled ? '<small>Not profiled</small>'
      : mutatedGenes(p).map(g => `<span class="chip" style="--c:${mutationColors[mainClass(p.mutations[g])]}" title="${
        escapeHtml(p.mutations[g].map(([k, c]) => `${c} (${k})`).join(', '))}"><em>${g}</em> ${
        escapeHtml(p.mutations[g].map(([, c]) => c.replace(/^p\./, '')).join(', '))}</span>`).join('') || '<small>None detected</small>'},
  {key: 'expression', label: 'expression', num: true, sort: p => p.expression[expressionGene()] ?? null,
    csv: p => p.expression[expressionGene()], html: p => p.expression[expressionGene()]?.toFixed(2)},
];
const missingValue = value => value === null || value === undefined;

function tableRows() {
  const terms = get('table-search').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const column = tableColumns.find(c => c.key === tableSort.key);
  return scopePatients(get('table-scope').value)
    .filter(p => {
      if (!terms.length) return true;
      const hay = [p.id, ...mutatedGenes(p), ...Object.values(p.mutations).flat(2)].join(' ').toLowerCase();
      return terms.every(term => hay.includes(term));
    })
    .sort((a, b) => {
      const va = column.sort(a), vb = column.sort(b);
      if (missingValue(va) || missingValue(vb)) return missingValue(va) - missingValue(vb) || a.id.localeCompare(b.id);
      return (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb))) * tableSort.dir || a.id.localeCompare(b.id);
    });
}

function renderTable() {
  refreshScopes();
  const select = get('table-gene');
  if (!select.options.length) select.replaceChildren(...selectOptions(genes));
  select.value = get('gene').value;
  const rows = tableRows();
  const scope = get('table-scope').value;
  get('table-count').textContent = `${rows.length} of ${scopePatients(scope).length} patients in ${scopeLabel(scope)}`;
  const head = tableColumns.map(c => {
    const label = c.key === 'expression' ? `<em>${select.value}</em> expression` : c.label;
    const sorted = c.key === tableSort.key ? ` aria-sort="${tableSort.dir > 0 ? 'ascending' : 'descending'}"` : '';
    return `<th scope="col"${sorted}${c.num ? ' class="num"' : ''}><button type="button" data-sort="${c.key}">${label}</button></th>`;
  }).join('');
  const body = rows.map(p => `<tr${p.id === focusedPatient ? ' class="focus"' : ''}>${tableColumns.map(c => {
    const value = c.html ? c.html(p) : missingValue(c.csv(p)) ? undefined : escapeHtml(c.csv(p));
    return `<td${c.num ? ' class="num"' : ''}>${value ?? '—'}</td>`;
  }).join('')}</tr>`).join('');
  get('patient-table').innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body ||
    `<tr><td colspan="${tableColumns.length}">No patients match.</td></tr>`}</tbody>`;
}

function openPatient(id, scope) {
  focusedPatient = id;
  refreshScopes();
  get('table-scope').value = scope;
  get('table-search').value = id;
  showTab('patients');
  get('table-search').focus();
}

get('patient-table').addEventListener('click', event => {
  const key = event.target.closest('button[data-sort]')?.dataset.sort;
  if (!key) return;
  tableSort.dir = tableSort.key === key ? -tableSort.dir : 1;
  tableSort.key = key;
  renderTable();
  get('patient-table').querySelector(`button[data-sort="${key}"]`).focus();
});
get('table-search').oninput = () => { focusedPatient = null; renderTable(); };
get('table-scope').onchange = renderTable;
get('table-gene').onchange = () => setSharedGene(get('table-gene').value);
get('table-download').onclick = () => {
  const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [tableColumns.map(c => quote(c.key === 'expression' ? `${expressionGene()} expression log2(RSEM+1)` : c.label)).join(','),
    ...tableRows().map(p => tableColumns.map(c => quote(c.csv(p))).join(','))];
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([lines.join('\r\n')], {type: 'text/csv'}));
  link.download = `tcga-lusc-patients-${get('table-scope').value.toLowerCase()}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};

showTab(location.hash.slice(1));
