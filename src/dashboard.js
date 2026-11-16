const get = id => document.getElementById(id);
const data = JSON.parse(get('dashboard-data').textContent);
const stages = data.filters.stage.slice(1);
const all = data.cohorts['All|All|All'];
const genes = Object.keys(all.genes).sort((a,b) => all.genes[b].mutated - all.genes[a].mutated);
const names = ['A', 'B'];
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
}

get('gene').onchange = render;
get('group').onchange = render;
get('reset').onclick = () => {
  for (const [index,name] of names.entries()) {
    filters[index] = {...defaults[index]};
    for (const [field,value] of Object.entries(filters[index])) get(field+name).value = value;
  }
  get('gene').value = genes[0];
  get('group').value = 'stage_boxes';
  render();
};
render();
