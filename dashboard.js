'use strict';
const root = new URL(document.body.dataset.root, location.href);
const el = id => document.getElementById(id);
const node = (tag, text, cls) => {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (cls) item.className = cls;
  return item;
};
async function json(name) {
  const response = await fetch(new URL('api/v1/' + name, root), {cache: 'no-cache'});
  if (!response.ok) throw Error('HTTP ' + response.status);
  return response.json();
}
async function start() {
  const [catalog, windows] = await Promise.all([json('index.json'), json('cannbot-windows.json')]);
  const {datasets, models, categories} = catalog;
  const labels = new Map(categories.map(group => [group.id, group.label]));
  const params = new URL(location.href).searchParams;
  let filter = params.get('view') === 'cannbot' ? 'cannbot' : params.get('category');
  if (!labels.has(filter)) filter = 'all';
  const opened = new Set();
  const records = catalog.records.concat(windows.tasks.filter(t => t.rounds > 0).map(t => ({
    dataset:t.dataset, model:'Astra 6.2', group:'cannbot', count:t.rounds
  })));
  el('dataset-count').textContent = datasets.length;
  el('model-count').textContent = models.length;
  const total = records.reduce((n, r) => n + r.count, 0);
  el('result-count').textContent = total;
  el('result-status').textContent = total ? '已有结果' : '尚无实验结果';
  for (const [i, model] of models.entries()) {
    const heading = node('th');
    heading.scope = 'col';
    const dot = node('span', undefined, 'dot m' + i);
    dot.setAttribute('aria-hidden','true');
    heading.append(dot, document.createTextNode(model));
    el('columns').append(heading);
  }
  for (const group of [{id:'all', label:'全部'}, ...categories]) {
    const button = node('button', group.label);
    button.type = 'button';
    button.dataset.id = group.id;
    button.append(node('small', datasets.filter(d => group.id === 'all' || d.groups.includes(group.id)).length));
    button.onclick = () => {
      filter = group.id;
      const url = new URL(location.href);
      url.searchParams.delete('view');
      if (filter === 'all') url.searchParams.delete('category');
      else url.searchParams.set('category', filter);
      history.replaceState(null, '', url);
      draw();
    };
    el('filters').append(button);
  }
  function draw() {
    for (const button of el('filters').children)
      button.setAttribute('aria-pressed', String(button.dataset.id === filter));
    const query = el('query').value.trim().toLowerCase();
    const visible = datasets.filter(d => (filter === 'all' || d.groups.includes(filter)) &&
      [d.id, d.title, d.suite].filter(Boolean).some(s => s.toLowerCase().includes(query)));
    const rows = document.createDocumentFragment();
    for (const dataset of visible) {
      const tr = node('tr');
      const heading = node('th');
      heading.scope = 'row';
      const toggle = node('button', undefined, 'dataset');
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', String(opened.has(dataset.id)));
      const detailsId = 'detail-' + dataset.id;
      toggle.setAttribute('aria-controls', detailsId);
      const arrow = node('i', undefined, 'arrow');
      arrow.setAttribute('aria-hidden','true');
      toggle.append(arrow, document.createTextNode(dataset.id));
      heading.append(toggle);
      const groups = node('td');
      const tags = node('div', undefined, 'tags');
      for (const key of dataset.groups) tags.append(node('span', labels.get(key), 'tag'));
      groups.append(tags);
      tr.append(heading, groups);
      for (const model of models) {
        const count = records.filter(r => r.dataset === dataset.id && r.model === model &&
          (filter === 'all' || r.group === filter)).reduce((sum, r) => sum + r.count, 0);
        const cell = node('td', count ? String(count) : '—','value');
        cell.setAttribute('aria-label', model + (count ? '，结果记录 ' + count : '，尚无结果'));
        tr.append(cell);
      }
      const detail = node('tr', undefined, 'detail');
      detail.id = detailsId;
      detail.hidden = !opened.has(dataset.id);
      const content = node('td');
      content.colSpan = models.length + 2;
      if (dataset.suite) content.append(node('p', dataset.suite));
      if (dataset.workload) content.append(node('p', dataset.workload));
      for (const group of categories.filter(g => dataset.groups.includes(g.id) && (filter === 'all' || filter === g.id))) {
        const line = node('p');
        const methods = group.methods.flatMap(method => group.versions?.[method] || [method]);
        line.append(node('strong', group.label), document.createTextNode(methods.join(' · ')));
        content.append(line);
      }
      toggle.onclick = () => {
        if (opened.has(dataset.id)) opened.delete(dataset.id); else opened.add(dataset.id);
        detail.hidden = !opened.has(dataset.id);
        toggle.setAttribute('aria-expanded', String(!detail.hidden));
      };
      detail.append(content);
      rows.append(tr, detail);
    }
    el('rows').replaceChildren(rows);
    el('empty').hidden = visible.length !== 0;
    el('visible-count').textContent = '显示 ' + visible.length + ' / ' + datasets.length + ' 个测试集';
  }
  el('query').oninput = draw;
  draw();
}
start().catch(() => {
  el('result-status').textContent = '数据读取失败，请刷新重试';
});
