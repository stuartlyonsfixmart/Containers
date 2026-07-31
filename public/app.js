'use strict';

/* ---------- state & utilities ---------- */

const state = { data: null, route: 'all', search: '', tab: 'overview', views: {}, cal: { month: null, basis: 'eta', selected: null } };

const NAVY = getComputedStyle(document.documentElement).getPropertyValue('--navy').trim() || '#373431';
const GREY = getComputedStyle(document.documentElement).getPropertyValue('--bar-grey').trim() || '#CFC9BF';
const INK2 = '#5E5953', INK3 = '#837D75', HAIR = '#E2DDD5';
// Fixmart secondary + product category colours (brand guidelines p.19/22).
const OLIVE = '#887F4A';
const CAT = ['#373431', '#238857', '#824098', '#DE7E2E', '#392A71', '#DF2790'];
// Colour follows the entity: fixed assignment from the whole dataset, stable under filters.
function forwarderColor(name) {
  if (!state._fwColors) {
    const names = [...new Set((state.data.shipments || []).map((s) => s.forwarder).filter(Boolean))].sort();
    state._fwColors = new Map(names.map((n, i) => [n, CAT[i % CAT.length]]));
  }
  return state._fwColors.get(name) || GREY;
}

const fmtGBP = (v) => v == null ? '–' : '£' + Math.round(v).toLocaleString('en-GB');
const fmtNum = (v) => v == null ? '–' : Number(v).toLocaleString('en-GB');
const fmtWeeks = (v) => v == null ? '–' : (Math.round(v * 10) / 10).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtDate = (iso) => {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const fmtDateTime = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' +
         d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

function el(tag, attrs, parent) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'text') node.textContent = v;
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  if (parent) parent.appendChild(node);
  return node;
}
function svgEl(tag, attrs, parent) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  if (parent) parent.appendChild(node);
  return node;
}
// Horizontal bar with a 4px rounded data-end, square at the baseline.
function barPath(x, y, w, h, r) {
  const rr = Math.min(r, w, h / 2);
  return `M${x},${y} h${w - rr} a${rr},${rr} 0 0 1 ${rr},${rr} v${h - 2 * rr} a${rr},${rr} 0 0 1 ${-rr},${rr} h${-(w - rr)} Z`;
}
function niceCeil(v) {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 4, 5, 10]) if (v <= m * pow) return m * pow;
  return 10 * pow;
}

/* ---------- tooltip (textContent only; labels are untrusted data) ---------- */

const tip = document.getElementById('tooltip');
function showTip(evt, lines) {
  tip.textContent = '';
  lines.forEach((line, i) => {
    const row = el('div', { class: i === 0 ? 't-value' : 't-row' }, tip);
    row.textContent = line;
  });
  tip.style.display = 'block';
  moveTip(evt);
}
function moveTip(evt) {
  const pad = 14;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
  if (y + h > window.innerHeight - 8) y = evt.clientY - h - pad;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function hideTip() { tip.style.display = 'none'; }
function hover(node, linesFn) {
  node.addEventListener('pointerenter', (e) => showTip(e, linesFn()));
  node.addEventListener('pointermove', moveTip);
  node.addEventListener('pointerleave', hideTip);
}

/* ---------- card scaffolding with chart/table twin toggle ---------- */

function cardShell(rootId, title, hint, legendItems) {
  const root = document.getElementById(rootId);
  root.textContent = '';
  const head = el('div', { class: 'card-head' }, root);
  const left = el('div', {}, head);
  const h2 = el('h2', { text: title }, left);
  if (hint) el('span', { class: 'hint', text: hint }, h2);
  const tools = el('div', { class: 'card-tools' }, head);
  if (legendItems && legendItems.length) {
    const lg = el('div', { class: 'legend' }, tools);
    for (const item of legendItems) {
      const key = el('span', { class: 'key' }, lg);
      el('span', { class: 'dot', style: `background:${item.color}` }, key);
      el('span', { text: item.label }, key);
    }
  }
  const toggle = el('div', { class: 'toggle' }, tools);
  const btnChart = el('button', { type: 'button', text: 'Chart' }, toggle);
  const btnTable = el('button', { type: 'button', text: 'Table' }, toggle);
  const body = el('div', { class: 'chart-body' }, root);

  const mode = state.views[rootId] || 'chart';
  const setMode = (m) => {
    state.views[rootId] = m;
    btnChart.classList.toggle('active', m === 'chart');
    btnTable.classList.toggle('active', m === 'table');
    render();
  };
  btnChart.addEventListener('click', () => setMode('chart'));
  btnTable.addEventListener('click', () => setMode('table'));
  btnChart.classList.toggle('active', mode === 'chart');
  btnTable.classList.toggle('active', mode === 'table');
  return { root, body, mode };
}

function renderTwinTable(body, columns, rows) {
  const t = el('table', { class: 'twin' }, body);
  const trh = el('tr', {}, el('thead', {}, t));
  for (const c of columns) el('th', { class: c.num ? 'num' : '', text: c.label }, trh);
  const tbody = el('tbody', {}, t);
  for (const r of rows) {
    const tr = el('tr', {}, tbody);
    columns.forEach((c, i) => el('td', { class: c.num ? 'num' : '', text: r[i] == null ? '–' : String(r[i]) }, tr));
  }
}

function emptyState(body, msg) { el('div', { class: 'empty', text: msg }, body); }

/* ---------- import team notes ----------
   The warehouse memo column holds a hand-typed log, newest entry first, one entry
   per line. Dates inside it are written every which way, so nothing here reads a
   date, a name or a forwarder out of the text. It is displayed and searched, and
   that is all: a chart fed by guessed-at prose would look authoritative and be wrong. */

function noteCell(tr, s) {
  const has = s.notesCount > 0;
  const td = el('td', { class: 'notes-cell' + (has ? '' : ' none') }, tr);
  if (!has) { td.textContent = 'No notes'; return td; }
  td.appendChild(document.createTextNode(s.notesLatest));
  if (s.notesCount > 1) el('span', { class: 'note-count', text: '+' + (s.notesCount - 1) }, td);
  td.title = s.notesLatest;
  return td;
}

// Click a row to reveal the whole log underneath it. Rows with no notes stay inert
// rather than expanding into an empty panel.
function attachNoteExpander(tbody, tr, s, colspan) {
  if (!s.notesCount) return;
  tr.className = (tr.className ? tr.className + ' ' : '') + 'has-notes';
  tr.setAttribute('tabindex', '0');
  tr.setAttribute('role', 'button');
  tr.setAttribute('aria-expanded', 'false');
  let panel = null;
  const toggle = () => {
    if (panel) {
      panel.remove();
      panel = null;
      tr.setAttribute('aria-expanded', 'false');
      return;
    }
    panel = el('tr', { class: 'notes-row' });
    const td = el('td', { colspan: String(colspan) }, panel);
    el('div', { class: 'note-head', text: (s.containerNumber || 'Container') + ' · ' + s.notesCount + ' update' + (s.notesCount === 1 ? '' : 's') + ', newest first' }, td);
    const log = el('div', { class: 'note-log' }, td);
    s.notes.forEach((line, i) => el('div', { class: 'note-entry' + (i === 0 ? ' latest' : ''), text: line }, log));
    tr.after(panel);
    tr.setAttribute('aria-expanded', 'true');
  };
  tr.addEventListener('click', toggle);
  tr.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
}

/* ---------- aggregation from per-shipment records ---------- */

function filteredShipments(routeOverride) {
  // Optional override so a single card (the freight cost trend chart) can filter
  // by its own route selection without touching the page-wide Route filter that
  // every other caller of this function still uses by default.
  const activeRoute = routeOverride == null ? state.route : routeOverride;
  let ships = state.data.shipments;
  if (activeRoute === '__none__') ships = ships.filter((s) => !s.route);
  else if (activeRoute !== 'all') ships = ships.filter((s) => s.route === activeRoute);
  const q = state.search.trim().toLowerCase();
  if (q) {
    ships = ships.filter((s) =>
      [s.po, s.containerNumber, s.boxNumber, s.supplier, s.forwarder, s.forwarderRef, s.vessel]
        .some((v) => v && String(v).toLowerCase().includes(q)) ||
      // Search the notes text too. Until a PO reaches the warehouse this is the
      // only place a reference someone quotes is likely to be written down.
      (s.notes || []).some((line) => line.toLowerCase().includes(q))
    );
  }
  return ships;
}
function groupCount(items, keyFn) {
  const m = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/* ---------- charts ---------- */

function renderBarList(body, rows, opts) {
  // rows: [{ name, value, valueLabel, tipLines }]
  const width = Math.max(340, body.clientWidth || 480);
  const labelW = Math.min(300, Math.max(150, width * 0.42));
  const rowH = 32, barH = 16, gutter = 8, valueW = 86;
  const height = rows.length * rowH + 4;
  const svg = svgEl('svg', { width: '100%', viewBox: `0 0 ${width} ${height}` }, body);
  const maxV = Math.max(...rows.map((r) => r.value), 1);
  const plotW = width - labelW - gutter - valueW;

  rows.forEach((r, i) => {
    const y = i * rowH + (rowH - barH) / 2;
    const w = Math.max(2, (r.value / maxV) * plotW);
    const color = opts.colorFn ? opts.colorFn(r, i) : (i === (opts.accentIndex ?? 0) ? NAVY : GREY);

    const lbl = svgEl('text', {
      x: labelW, y: y + barH / 2 + 4, 'text-anchor': 'end',
      'font-size': 12, fill: INK2, text: r.name
    }, svg);
    lbl.style.pointerEvents = 'none';
    // truncate long labels to fit the label column
    let name = r.name;
    while (lbl.getComputedTextLength && lbl.getComputedTextLength() > labelW - 8 && name.length > 6) {
      name = name.slice(0, -2);
      lbl.textContent = name.trimEnd() + '…';
    }

    svgEl('path', { d: barPath(labelW + gutter, y, w, barH, 4), fill: color }, svg);
    svgEl('text', {
      x: labelW + gutter + w + 7, y: y + barH / 2 + 4,
      'font-size': 12, fill: '#373431', 'font-weight': 600, text: r.valueLabel
    }, svg);

    const hit = svgEl('rect', { x: 0, y: i * rowH, width, height: rowH, fill: 'transparent' }, svg);
    hover(hit, () => r.tipLines);
  });
}

function renderForwarders() {
  const { body, mode } = cardShell('card-forwarders', 'Forwarder share of business', 'by shipment count', null);
  const ships = filteredShipments();
  const counts = groupCount(ships, (s) => s.forwarder);
  if (!counts.length) return emptyState(body, 'No forwarder recorded on shipments in this view yet.');
  const total = counts.reduce((a, [, n]) => a + n, 0);
  const rows = counts.map(([name, n]) => ({
    name, value: n,
    valueLabel: `${n} · ${Math.round((n / total) * 1000) / 10}%`,
    tipLines: [ `${n} shipments (${Math.round((n / total) * 1000) / 10}%)`, name ],
  }));
  if (mode === 'table') {
    renderTwinTable(body, [{ label: 'Forwarder' }, { label: 'Shipments', num: true }, { label: 'Share', num: true }],
      rows.map((r) => [r.name, fmtNum(r.value), Math.round((r.value / total) * 1000) / 10 + '%']));
    return;
  }
  renderBarList(body, rows, { colorFn: (r) => forwarderColor(r.name) });
}

function renderRoutes() {
  const { body, mode } = cardShell('card-routes', 'Most used routes', 'by shipment count · coloured by main forwarder', null);
  const ships = filteredShipments();
  const counts = groupCount(ships, (s) => s.route);
  const noRoute = ships.filter((s) => !s.route).length;
  if (!counts.length) return emptyState(body, 'No routes captured yet. Departure and domestic port come from the Orderwise analysis fields.');
  const routeFw = new Map(counts.map(([route]) => {
    const top = groupCount(ships.filter((s) => s.route === route), (s) => s.forwarder)[0];
    return [route, top ? top[0] : null];
  }));
  const rows = counts.map(([name, n]) => ({
    name, value: n, valueLabel: String(n),
    tipLines: [ `${n} shipment${n === 1 ? '' : 's'}`, name, routeFw.get(name) ? 'Mainly ' + routeFw.get(name) : '' ].filter(Boolean),
  }));
  if (mode === 'table') {
    renderTwinTable(body, [{ label: 'Route' }, { label: 'Shipments', num: true }, { label: 'Main forwarder' }],
      rows.map((r) => [r.name, fmtNum(r.value), routeFw.get(r.name) || '–']));
  } else {
    renderBarList(body, rows, { colorFn: (r) => forwarderColor(routeFw.get(r.name)) });
  }
  if (noRoute) el('div', { class: 'footnote', text: `${noRoute} shipment${noRoute === 1 ? '' : 's'} with no route captured yet.` }, body);
}

function renderLanding() {
  const { body, mode } = cardShell('card-landing', 'Landing soon', 'next arrivals by port ETA', null);
  const ships = filteredShipments();
  const now = Date.now();

  // stage counts across the current selection
  const stages = { confirmed: 0, onWater: 0, atPort: 0, delivered: 0 };
  for (const s of ships) {
    if (s.delivered) stages.delivered += 1;
    else if (s.eta && new Date(s.eta).getTime() <= now) stages.atPort += 1;
    else if (s.shipped) stages.onWater += 1;
    else stages.confirmed += 1;
  }
  const chips = el('div', { class: 'stage-chips' }, body);
  for (const [label, n, c] of [['Awaiting sailing', stages.confirmed, '#9A9486'], ['On the water', stages.onWater, '#238857'], ['Arrived at port', stages.atPort, '#DE7E2E'], ['Delivered', stages.delivered, '#373431']]) {
    const chip = el('span', { class: 'chip' }, chips);
    el('b', { text: fmtNum(n) }, chip);
    el('span', { class: 'cdot', style: `background:${c}` }, chip);
    chip.appendChild(document.createTextNode(label));
  }

  const upcoming = ships
    .filter((s) => !s.delivered && s.eta)
    .sort((a, b) => new Date(a.eta) - new Date(b.eta));
  if (!upcoming.length) {
    emptyState(body, 'Nothing currently expected: no undelivered shipments with a port ETA in this view.');
    return;
  }
  const LIMIT = 10;
  const shown = mode === 'table' ? upcoming : upcoming.slice(0, LIMIT);
  const t = el('table', { class: 'twin' }, body);
  const trh = el('tr', {}, el('thead', {}, t));
  const headers = ['Port ETA', 'Type', 'Deliver to', 'Route', 'Forwarder', 'Status', 'Latest update'];
  for (const h of headers) {
    el('th', { text: h }, trh);
  }
  const tbody = el('tbody', {}, t);
  for (const s of shown) {
    const tr = el('tr', {}, tbody);
    const overdue = new Date(s.eta).getTime() < now;
    const etaTd = el('td', {}, tr);
    if (overdue) el('span', { class: 'dot-ovd' }, etaTd);
    etaTd.appendChild(document.createTextNode(fmtDate(s.eta) + (overdue ? ' · overdue' : '')));
    el('td', { text: s.containerType || '–' }, tr);
    el('td', { text: s.deliveryAddress || '–' }, tr);
    el('td', { text: s.route || 'No route captured' }, tr);
    el('td', { text: s.forwarder || '–' }, tr);
    el('td', { text: s.status || (s.shipped ? 'On the water' : 'Awaiting sailing') }, tr);
    noteCell(tr, s);
    hover(tr, () => [
      (s.po ? 'PO ' + s.po + ' · ' : '') + (s.containerNumber || 'Shipment') + ' · ETA ' + fmtDate(s.eta),
      [(s.supplier ? 'Supplier ' + s.supplier : null), (s.vessel ? 'Vessel ' + s.vessel : null), s.boxNumber].filter(Boolean).join(' · '),
      'Sailed ' + fmtDate(s.shipped) + (s.totalCost != null ? ' · total cost ' + fmtGBP(s.totalCost) : ''),
      s.notesLatest ? 'Latest note: ' + s.notesLatest : null,
      s.notesCount > 1 ? 'Click the row for all ' + s.notesCount + ' updates' : null,
    ].filter(Boolean));
    attachNoteExpander(tbody, tr, s, headers.length);
  }
  const withNotes = shown.filter((s) => s.notesCount > 0).length;
  if (mode !== 'table' && upcoming.length > LIMIT) {
    el('div', { class: 'footnote', text: `Showing the next ${LIMIT} of ${upcoming.length}; use the Table view for all.` }, body);
  }
  if (withNotes) {
    el('div', { class: 'footnote', text: `Click any row with an update to read its full log, newest first. Notes are typed by the import team in Orderwise; nothing on this page is calculated from them.` }, body);
  }
}

function renderTrend() {
  if (state.trendRoute == null) state.trendRoute = 'all';
  const shipsAll = filteredShipments(state.trendRoute).filter((s) => s.shipped && s.freightCost != null);
  const fwLegend = groupCount(shipsAll, (s) => s.forwarder).slice(0, 4)
    .map(([name]) => ({ label: name, color: forwarderColor(name) }));
  const { body, mode } = cardShell(
    'card-trend',
    'Freight cost per shipment over time',
    'landed ocean freight by sailing date · coloured by forwarder',
    fwLegend
  );

  // Route selector for this card only. Deliberately separate from the page-wide
  // Route filter above the card grid, which drives several other cards at once:
  // this one only narrows this chart, so a single route's freight cost trend can
  // be read on its own without affecting anything else on the page.
  const routeBar = el('div', { style: 'display:flex;align-items:center;gap:8px;margin:2px 0 14px;flex-wrap:wrap;' }, body);
  el('label', { text: 'Route (this chart only)', style: 'font-size:12.5px;color:var(--ink-2);font-weight:600;' }, routeBar);
  const routeSel = el('select', {
    style: 'font:inherit;font-size:13px;color:var(--ink);background:var(--surface);border:1px solid var(--hairline);border-radius:7px;padding:6px 9px;min-width:240px;'
  }, routeBar);
  const costedShipments = state.data.shipments.filter((s) => s.shipped && s.freightCost != null);
  el('option', { value: 'all', text: `All routes  (${costedShipments.length})` }, routeSel);
  const routeCounts = groupCount(costedShipments, (s) => s.route);
  for (const [route, n] of routeCounts) el('option', { value: route, text: `${route}  (${n})` }, routeSel);
  const noRouteN = costedShipments.filter((s) => !s.route).length;
  if (noRouteN) el('option', { value: '__none__', text: `No route captured  (${noRouteN})` }, routeSel);
  routeSel.value = [...routeSel.options].some((o) => o.value === state.trendRoute) ? state.trendRoute : 'all';
  state.trendRoute = routeSel.value;
  routeSel.addEventListener('change', (e) => {
    state.trendRoute = e.target.value;
    render();
  });

  const ships = shipsAll;
  if (!ships.length) return emptyState(body, 'No costed, dated shipments for this route yet.');

  if (mode === 'table') {
    renderTwinTable(body,
      [{ label: 'Sailed' }, { label: 'PO' }, { label: 'Route' }, { label: 'Forwarder' }, { label: 'Freight', num: true }, { label: 'Add-ons', num: true }],
      ships.map((s) => [fmtDate(s.shipped), s.po, s.route || 'No route captured', s.forwarder, fmtGBP(s.freightCost), fmtGBP(s.addOnCost)]));
    return;
  }

  const width = Math.max(640, body.clientWidth || 900);
  const height = 240, padL = 46, padR = 70, padT = 14, padB = 30;
  const svg = svgEl('svg', { width: '100%', viewBox: `0 0 ${width} ${height}` }, body);

  const times = ships.map((s) => new Date(s.shipped).getTime());
  const t0 = Math.min(...times), t1 = Math.max(...times);
  const span = Math.max(t1 - t0, 86400000);
  const maxY = niceCeil(Math.max(...ships.map((s) => s.freightCost)) * 1.08);
  const x = (t) => padL + ((t - t0) / span) * (width - padL - padR);
  const y = (v) => padT + (1 - v / maxY) * (height - padT - padB);

  // baseline + y tick labels (no gridlines)
  svgEl('line', { x1: padL, y1: y(0), x2: width - padR, y2: y(0), stroke: HAIR, 'stroke-width': 1 }, svg);
  const step = maxY / 4;
  for (let i = 0; i <= 4; i += 1) {
    svgEl('text', { x: padL - 8, y: y(i * step) + 4, 'text-anchor': 'end', 'font-size': 11, fill: INK3, text: fmtGBP(i * step) }, svg);
  }
  // month labels along the x axis; day-level endpoints when the range is short
  let monthLabels = 0;
  const start = new Date(t0); start.setUTCDate(1);
  for (let d = new Date(start); d.getTime() <= t1; d.setUTCMonth(d.getUTCMonth() + 1)) {
    if (d.getTime() < t0 - 86400000 * 15) continue;
    svgEl('text', { x: x(Math.max(d.getTime(), t0)), y: height - 8, 'font-size': 11, fill: INK3, text: d.toLocaleDateString('en-GB', { month: 'short' }) }, svg);
    monthLabels += 1;
  }
  if (monthLabels < 2) {
    const short = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    svgEl('text', { x: padL, y: height - 8, 'font-size': 11, fill: INK3, text: short(t0) }, svg);
    if (t1 > t0) svgEl('text', { x: width - padR, y: height - 8, 'text-anchor': 'end', 'font-size': 11, fill: INK3, text: short(t1) }, svg);
  }

  // Straight best-fit trend line (simple linear regression, cost by sailing date)
  // across whatever shipments are currently shown, i.e. respecting the Route
  // filter above. Drawn behind the dots so individual points stay on top.
  let trendDrawn = false;
  if (ships.length >= 2) {
    const n = ships.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (const s of ships) {
      const tx = new Date(s.shipped).getTime();
      const ty = s.freightCost;
      sumX += tx; sumY += ty; sumXY += tx * ty; sumXX += tx * tx;
    }
    const denom = n * sumXX - sumX * sumX;
    if (denom !== 0) {
      const slope = (n * sumXY - sumX * sumY) / denom;
      const intercept = (sumY - slope * sumX) / n;
      const clamp = (v) => Math.min(Math.max(v, 0), maxY);
      svgEl('line', {
        x1: x(t0), y1: y(clamp(intercept + slope * t0)),
        x2: x(t1), y2: y(clamp(intercept + slope * t1)),
        stroke: '#373431', 'stroke-width': 2, 'stroke-dasharray': '6,4',
        'stroke-linecap': 'round', opacity: 0.55,
      }, svg);
      trendDrawn = true;
    }
  }

  const maxShip = ships.reduce((a, b) => (b.freightCost > a.freightCost ? b : a));
  const lastShip = ships.reduce((a, b) => (new Date(b.shipped) > new Date(a.shipped) ? b : a));

  for (const s of ships) {
    const cx = x(new Date(s.shipped).getTime()), cy = y(s.freightCost);
    svgEl('circle', { cx, cy, r: 5, fill: forwarderColor(s.forwarder), stroke: '#fff', 'stroke-width': 2 }, svg);
    const hit = svgEl('circle', { cx, cy, r: 13, fill: 'transparent' }, svg);
    hover(hit, () => [
      fmtGBP(s.freightCost) + ' freight',
      (s.po || s.containerNumber || 'Shipment') + ' · ' + (s.forwarder || 'No forwarder'),
      s.route || 'No route captured',
      'Sailed ' + fmtDate(s.shipped) + (s.addOnCost != null ? ' · add-ons ' + fmtGBP(s.addOnCost) : ''),
      s.onWater ? 'On the water' : (s.status || ''),
    ].filter(Boolean));
  }
  // selective direct labels: the extreme and the latest point only
  const labelPts = [...new Set([maxShip, lastShip])];
  for (const s of labelPts) {
    const cx = x(new Date(s.shipped).getTime()), cy = y(s.freightCost);
    svgEl('text', { x: cx + 10, y: cy + 4, 'font-size': 11.5, 'font-weight': 600, fill: '#373431', text: fmtGBP(s.freightCost) }, svg);
  }
  if (trendDrawn) {
    el('div', { class: 'footnote', text: 'Dashed line: straight best-fit trend across the shipments shown above.' }, body);
  }
}

function renderSplit() {
  const { body, mode } = cardShell('card-split', 'Freight vs add-on costs', 'avg per shipment by route',
    [{ label: 'Freight', color: NAVY }, { label: 'Add-ons', color: OLIVE }]);
  const ships = filteredShipments().filter((s) => s.route && s.totalCost != null);
  if (!ships.length) return emptyState(body, 'No costed shipments with routes in this view yet.');

  const byRoute = new Map();
  for (const s of ships) {
    if (!byRoute.has(s.route)) byRoute.set(s.route, { n: 0, freight: 0, addOn: 0 });
    const r = byRoute.get(s.route);
    r.n += 1; r.freight += s.freightCost || 0; r.addOn += s.addOnCost || 0;
  }
  const rows = [...byRoute.entries()]
    .map(([route, r]) => ({ route, n: r.n, freight: r.freight / r.n, addOn: r.addOn / r.n }))
    .sort((a, b) => (b.freight + b.addOn) - (a.freight + a.addOn))
    .slice(0, 8);

  if (mode === 'table') {
    renderTwinTable(body,
      [{ label: 'Route' }, { label: 'Shipments', num: true }, { label: 'Avg freight', num: true }, { label: 'Avg add-ons', num: true }, { label: 'Avg total', num: true }],
      rows.map((r) => [r.route, fmtNum(r.n), fmtGBP(r.freight), fmtGBP(r.addOn), fmtGBP(r.freight + r.addOn)]));
    return;
  }

  const width = Math.max(340, body.clientWidth || 480);
  const labelW = Math.min(280, Math.max(150, width * 0.44));
  const rowH = 34, padB = 24;
  const height = rows.length * rowH + padB;
  const svg = svgEl('svg', { width: '100%', viewBox: `0 0 ${width} ${height}` }, body);
  const maxV = niceCeil(Math.max(...rows.map((r) => Math.max(r.freight, r.addOn))) * 1.1);
  const plotW = width - labelW - 20;
  const x = (v) => labelW + 10 + (v / maxV) * plotW;

  // x tick labels only, at 0 / half / max
  for (const v of [0, maxV / 2, maxV]) {
    svgEl('text', { x: x(v), y: height - 4, 'text-anchor': 'middle', 'font-size': 10.5, fill: INK3, text: fmtGBP(v) }, svg);
  }

  rows.forEach((r, i) => {
    const cy = i * rowH + rowH / 2;
    const lbl = svgEl('text', { x: labelW, y: cy + 4, 'text-anchor': 'end', 'font-size': 12, fill: INK2, text: r.route }, svg);
    let name = r.route;
    while (lbl.getComputedTextLength && lbl.getComputedTextLength() > labelW - 8 && name.length > 6) {
      name = name.slice(0, -2);
      lbl.textContent = name.trimEnd() + '…';
    }
    svgEl('line', { x1: x(Math.min(r.freight, r.addOn)), y1: cy, x2: x(Math.max(r.freight, r.addOn)), y2: cy, stroke: HAIR, 'stroke-width': 1 }, svg);
    svgEl('circle', { cx: x(r.addOn), cy, r: 5, fill: OLIVE, stroke: '#fff', 'stroke-width': 2 }, svg);
    svgEl('circle', { cx: x(r.freight), cy, r: 5, fill: NAVY, stroke: '#fff', 'stroke-width': 2 }, svg);
    if (i === 0) {
      svgEl('text', { x: x(r.freight) + 9, y: cy - 7, 'font-size': 11, 'font-weight': 600, fill: '#373431', text: fmtGBP(r.freight) }, svg);
      svgEl('text', { x: x(r.addOn) + 9, y: cy + 15, 'font-size': 11, fill: INK2, text: fmtGBP(r.addOn) }, svg);
    }
    const hit = svgEl('rect', { x: 0, y: i * rowH, width, height: rowH, fill: 'transparent' }, svg);
    hover(hit, () => [
      `Freight ${fmtGBP(r.freight)} · add-ons ${fmtGBP(r.addOn)} avg`,
      r.route,
      `${r.n} costed shipment${r.n === 1 ? '' : 's'} · avg total ${fmtGBP(r.freight + r.addOn)}`,
    ]);
  });
}

function renderTransit() {
  const { body } = cardShell('card-transit', 'Average transit time per route', 'weeks, sailing date to port ETA · hover a row for details', null);
  const ships = filteredShipments().filter((s) => s.route && s.transitWeeks != null);
  if (!ships.length) {
    emptyState(body, 'No transit times yet: needs both a sailing date (BOL) and a port ETA on at least one shipment. They populate automatically from the Orderwise feed.');
    return;
  }
  const byRoute = new Map();
  for (const s of ships) {
    if (!byRoute.has(s.route)) byRoute.set(s.route, { n: 0, sum: 0, surcharge: false });
    const r = byRoute.get(s.route);
    r.n += 1; r.sum += s.transitWeeks;
    if (s.transitSurchargeWeeks > 0) r.surcharge = true;
  }
  const rows = [...byRoute.entries()]
    .map(([route, r]) => ({ route, n: r.n, avg: r.sum / r.n, surcharge: r.surcharge }))
    .sort((a, b) => b.avg - a.avg);
  const maxAvg = Math.max(...rows.map((r) => r.avg));

  const t = el('table', { class: 'twin' }, body);
  const trh = el('tr', {}, el('thead', {}, t));
  el('th', { text: 'Route' }, trh);
  el('th', { class: 'num', text: 'Avg transit (wks)' }, trh);
  el('th', { text: '' }, trh);
  el('th', { class: 'num', text: 'Shipments' }, trh);
  const tbody = el('tbody', {}, t);
  for (const r of rows) {
    const tr = el('tr', {}, tbody);
    el('td', { text: r.route + (r.surcharge ? ' *' : '') }, tr);
    el('td', { class: 'num', text: fmtWeeks(r.avg) }, tr);
    const barCell = el('td', { style: 'width:34%' }, tr);
    const svg = svgEl('svg', { width: '100%', height: 14, viewBox: '0 0 100 14', preserveAspectRatio: 'none' }, barCell);
    svgEl('path', { d: barPath(0, 2, Math.max(2, (r.avg / maxAvg) * 100), 10, 3), fill: r.surcharge ? OLIVE : (r.avg === maxAvg ? NAVY : GREY) }, svg);
    el('td', { class: 'num', text: fmtNum(r.n) }, tr);
    hover(tr, () => [
      fmtWeeks(r.avg) + ' weeks average',
      r.route,
      `${r.n} shipment${r.n === 1 ? '' : 's'} with sailing date and port ETA`,
    ]);
  }
  const notes = state.data.transitNotes || {};
  const noteBits = [notes.rail, notes.feeder].filter(Boolean).join('; ');
  if (noteBits) el('div', { class: 'footnote', text: '* ' + noteBits + '.' }, body);
}

/* ---------- Trends tab: monthly aggregates over the trend window ---------- */

const fmtMonth = (key) => {
  const d = new Date(key + '-01T00:00:00Z');
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
};

// Shared monthly chart: type 'line' (multi-series) or 'column' (single series).
function renderMonthly(body, monthsData, series, opts) {
  const months = monthsData || [];
  const hasVals = series.some((s) => s.values.some((v) => v != null && v !== 0));
  if (!months.length || !hasVals) {
    emptyState(body, 'Not enough history yet: this fills in as sailings accumulate in the warehouse.');
    return;
  }
  const width = Math.max(640, body.clientWidth || 900);
  const height = 220, padL = 58, padR = 92, padT = 14, padB = 28;
  const svg = svgEl('svg', { width: '100%', viewBox: `0 0 ${width} ${height}` }, body);
  const allVals = series.flatMap((s) => s.values.filter((v) => v != null));
  let maxV = niceCeil(Math.max(...allVals, 1) * 1.1);
  if (opts.intTicks) {
    const tickStep = Math.max(1, Math.ceil((Math.max(...allVals, 1) * 1.1) / 4));
    maxV = tickStep * 4;
  }
  const plotW = width - padL - padR;
  const x = (i) => months.length === 1 ? padL + plotW / 2 : padL + (i / (months.length - 1)) * plotW;
  const y = (v) => padT + (1 - v / maxV) * (height - padT - padB);

  svgEl('line', { x1: padL, y1: y(0), x2: width - padR, y2: y(0), stroke: HAIR, 'stroke-width': 1 }, svg);
  for (let i = 0; i <= 4; i += 1) {
    svgEl('text', { x: padL - 8, y: y((maxV / 4) * i) + 4, 'text-anchor': 'end', 'font-size': 11, fill: INK3, text: opts.fmt((maxV / 4) * i) }, svg);
  }
  const step = Math.max(1, Math.ceil(months.length / 8));
  months.forEach((m, i) => {
    if (i % step === 0 || i === months.length - 1) {
      svgEl('text', { x: x(i), y: height - 8, 'text-anchor': 'middle', 'font-size': 11, fill: INK3, text: fmtMonth(m.month) }, svg);
    }
  });

  if (opts.type === 'column') {
    const vals = series[0].values;
    const colColor = series[0].color || NAVY;
    const lastIdx = vals.reduce((acc, v, i) => (v != null && v !== 0 ? i : acc), -1);
    const maxIdx = vals.reduce((acc, v, i) => (v != null && (acc < 0 || v > vals[acc]) ? i : acc), -1);
    const bw = Math.max(6, Math.min(24, (plotW / months.length) * 0.55));
    vals.forEach((v, i) => {
      if (v == null || v === 0) return;
      const cx = x(i) - bw / 2, yTop = y(v), yBase = y(0);
      const rr = Math.min(4, bw / 2, (yBase - yTop) / 2);
      svgEl('path', {
        d: `M${cx},${yBase} L${cx},${yTop + rr} Q${cx},${yTop} ${cx + rr},${yTop} L${cx + bw - rr},${yTop} Q${cx + bw},${yTop} ${cx + bw},${yTop + rr} L${cx + bw},${yBase} Z`,
        fill: colColor, 'fill-opacity': i === lastIdx ? 1 : 0.5,
      }, svg);
      if (i === lastIdx || i === maxIdx) {
        svgEl('text', { x: x(i), y: yTop - 6, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 600, fill: '#373431', text: opts.fmt(v) }, svg);
      }
    });
  } else {
    const endLabelYs = [];
    for (const s of series) {
      let d = '', lastPt = null;
      s.values.forEach((v, i) => {
        if (v == null) { d += ''; lastPt = lastPt; return; }
        const px = x(i), py = y(v);
        d += (d && s.values[i - 1] != null ? ` L${px},${py}` : ` M${px},${py}`);
        lastPt = { px, py, v };
      });
      if (d) svgEl('path', { d: d.trim(), fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
      if (lastPt) {
        svgEl('circle', { cx: lastPt.px, cy: lastPt.py, r: 4.5, fill: s.color, stroke: '#fff', 'stroke-width': 2 }, svg);
        let ly = lastPt.py + 4;
        while (endLabelYs.some((prev) => Math.abs(prev - ly) < 14)) ly += 14;
        endLabelYs.push(ly);
        svgEl('text', { x: lastPt.px + 10, y: ly, 'font-size': 11, 'font-weight': 600, fill: '#373431', text: opts.fmt(lastPt.v) }, svg);
      }
    }
  }

  const stripW = months.length === 1 ? plotW : plotW / (months.length - 1);
  months.forEach((m, i) => {
    const hit = svgEl('rect', { x: x(i) - stripW / 2, y: 0, width: stripW, height: height - padB, fill: 'transparent' }, svg);
    hover(hit, () => [
      fmtMonth(m.month) + ' · ' + fmtNum(m.n) + ' container' + (m.n === 1 ? '' : 's') + ' sailed',
      ...series.map((s) => s.name + ': ' + (s.values[i] != null ? opts.fmt(s.values[i]) : 'no data')),
    ]);
  });
}

function trendMonths() { return ((state.data || {}).trends || {}).months || []; }

function renderTrCost() {
  const { body, mode } = cardShell('card-tr-cost', 'Average cost per shipment', 'by sailing month, whole warehouse history (24-month window)',
    [{ label: 'Freight', color: NAVY }, { label: 'Add-ons', color: OLIVE }]);
  const months = trendMonths();
  if (mode === 'table') {
    renderTwinTable(body,
      [{ label: 'Month' }, { label: 'Sailed', num: true }, { label: 'Costed', num: true }, { label: 'Avg freight', num: true }, { label: 'Avg add-ons', num: true }, { label: 'Avg total', num: true }],
      months.map((m) => [fmtMonth(m.month), fmtNum(m.n), fmtNum(m.costedN), fmtGBP(m.avgFreight), fmtGBP(m.avgAddOn), fmtGBP(m.avgTotal)]));
    return;
  }
  renderMonthly(body, months, [
    { name: 'Avg freight', color: NAVY, values: months.map((m) => m.avgFreight) },
    { name: 'Avg add-ons', color: OLIVE, values: months.map((m) => m.avgAddOn) },
  ], { fmt: fmtGBP, type: 'line' });
}

function renderTrVolume() {
  const { body, mode } = cardShell('card-tr-volume', 'Containers shipped per month', 'by sailing month', null);
  const months = trendMonths();
  if (mode === 'table') {
    renderTwinTable(body, [{ label: 'Month' }, { label: 'Containers', num: true }],
      months.map((m) => [fmtMonth(m.month), fmtNum(m.n)]));
    return;
  }
  renderMonthly(body, months, [{ name: 'Containers', color: '#238857', values: months.map((m) => m.n) }], { fmt: fmtNum, type: 'column', intTicks: true });
}

function renderTrTransit() {
  const { body, mode } = cardShell('card-tr-transit', 'Average transit time', 'weeks, sailing to port ETA, by sailing month', null);
  const months = trendMonths();
  if (mode === 'table') {
    renderTwinTable(body, [{ label: 'Month' }, { label: 'With dates', num: true }, { label: 'Avg transit (wks)', num: true }],
      months.map((m) => [fmtMonth(m.month), fmtNum(m.transitN), fmtWeeks(m.avgTransit)]));
    return;
  }
  renderMonthly(body, months, [{ name: 'Avg transit (wks)', color: '#824098', values: months.map((m) => m.avgTransit) }], { fmt: fmtWeeks, type: 'line' });
}

function renderTrSpend() {
  const { body, mode } = cardShell('card-tr-spend', 'Freight spend per month', 'total of costed shipments, by sailing month', null);
  const months = trendMonths();
  if (mode === 'table') {
    renderTwinTable(body, [{ label: 'Month' }, { label: 'Costed', num: true }, { label: 'Total spend', num: true }],
      months.map((m) => [fmtMonth(m.month), fmtNum(m.costedN), fmtGBP(m.totalSpend)]));
    return;
  }
  renderMonthly(body, months, [{ name: 'Spend', color: '#392A71', values: months.map((m) => m.totalSpend) }], { fmt: fmtGBP, type: 'column' });
}

/* ---------- Calendar tab: arrivals per day for goods-in ---------- */

const fmtTime = (iso) => {
  if (!iso) return '–';
  const d = new Date(iso);
  const hh = d.getUTCHours(), mm = d.getUTCMinutes();
  return (hh || mm) ? String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') : '–';
};
function shiftMonth(mkey, delta) {
  const d = new Date(mkey + '-01T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
}

function renderCalendar() {
  const { body, mode } = cardShell('card-cal', 'Arrivals calendar', 'containers per day · click a day for the detail', null);
  if (!state.cal.month) state.cal.month = new Date().toISOString().slice(0, 7);
  const basis = state.cal.basis;
  const dateOf = (s) => {
    const iso = basis === 'promised' ? s.promised : s.eta;
    return iso ? iso.slice(0, 10) : null;
  };
  const ships = state.data.shipments;
  const inMonth = ships.filter((s) => {
    const d = dateOf(s);
    return d && d.slice(0, 7) === state.cal.month;
  });

  // controls
  const bar = el('div', { class: 'cal-bar' }, body);
  const prev = el('button', { class: 'nav', type: 'button', text: '‹' }, bar);
  const monthLabel = new Date(state.cal.month + '-01T00:00:00Z')
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  el('span', { class: 'cal-month', text: monthLabel }, bar);
  const next = el('button', { class: 'nav', type: 'button', text: '›' }, bar);
  const basisSel = el('select', {}, bar);
  el('option', { value: 'eta', text: 'By port ETA' }, basisSel);
  el('option', { value: 'promised', text: 'By promised delivery date' }, basisSel);
  basisSel.value = basis;
  el('span', { class: 'scope-note', text: `${inMonth.length} container${inMonth.length === 1 ? '' : 's'} this month` }, bar);
  prev.addEventListener('click', () => { state.cal.month = shiftMonth(state.cal.month, -1); state.cal.selected = null; render(); });
  next.addEventListener('click', () => { state.cal.month = shiftMonth(state.cal.month, 1); state.cal.selected = null; render(); });
  basisSel.addEventListener('change', (e) => { state.cal.basis = e.target.value; state.cal.selected = null; render(); });

  const detailCols = ['Time', 'Type', 'Deliver to', 'Route', 'Forwarder', 'Vessel', 'Status'];
  const detailRow = (s) => {
    const iso = basis === 'promised' ? s.promised : s.eta;
    return [fmtTime(iso), s.containerType || '–', s.deliveryAddress || '–', s.route || 'No route captured',
      s.forwarder || '–', s.vessel || '–', s.status || (s.delivered ? 'Delivered' : s.shipped ? 'On the water' : 'Awaiting sailing')];
  };
  // Same table as renderTwinTable, plus the notes column and its expander. Built by
  // hand rather than extending renderTwinTable, which several plain tables share.
  const renderShipTable = (parent, labels, ships, rowFn) => {
    const cols = [...labels, 'Latest update'];
    const t = el('table', { class: 'twin' }, parent);
    const trh = el('tr', {}, el('thead', {}, t));
    for (const label of cols) el('th', { text: label }, trh);
    const tbody = el('tbody', {}, t);
    for (const s of ships) {
      const tr = el('tr', {}, tbody);
      for (const v of rowFn(s)) el('td', { text: v == null ? '–' : String(v) }, tr);
      noteCell(tr, s);
      attachNoteExpander(tbody, tr, s, cols.length);
    }
  };

  if (mode === 'table') {
    const sorted = [...inMonth].sort((a, b) => String(dateOf(a)).localeCompare(String(dateOf(b))));
    renderShipTable(body, ['Date', ...detailCols.slice(1)], sorted,
      (s) => [fmtDate(basis === 'promised' ? s.promised : s.eta), ...detailRow(s).slice(1)]);
    return;
  }

  // month grid, weeks starting Monday
  const byDay = new Map();
  for (const s of inMonth) {
    const k = dateOf(s);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  }
  const grid = el('div', { class: 'cal-grid' }, body);
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) el('div', { class: 'cal-dow', text: d }, grid);
  const first = new Date(state.cal.month + '-01T00:00:00Z');
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const firstDow = (first.getUTCDay() + 6) % 7;
  const todayKey = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < firstDow; i += 1) el('div', { class: 'cal-cell blank' }, grid);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = state.cal.month + '-' + String(day).padStart(2, '0');
    const list = byDay.get(key) || [];
    const dow = (firstDow + day - 1) % 7;
    let cls = 'cal-cell';
    if (list.length) cls += ' has';
    if (dow >= 5) cls += ' we';
    if (key === todayKey) cls += ' today';
    if (state.cal.selected === key) cls += ' sel';
    const heat = list.length ? (list.length >= 4 ? 0.24 : list.length >= 2 ? 0.15 : 0.08) : 0;
    const cell = el('div', heat ? { class: cls, style: `background:rgba(35,136,87,${heat})` } : { class: cls }, grid);
    el('div', { class: 'cal-daynum', text: String(day) }, cell);
    if (list.length) {
      el('div', { class: 'cal-count', text: fmtNum(list.length) }, cell);
      const types = groupCount(list, (s) => s.containerType || 'size?');
      el('div', { class: 'cal-sub', text: types.map(([t, n]) => `${n} × ${t}`).join(' · ') }, cell);
      const dots = el('div', { class: 'cal-dots' }, cell);
      for (const [fw] of groupCount(list, (s) => s.forwarder).slice(0, 5)) {
        el('i', { style: `background:${forwarderColor(fw)}`, title: fw }, dots);
      }
      cell.addEventListener('click', () => {
        state.cal.selected = state.cal.selected === key ? null : key;
        render();
      });
      hover(cell, () => [
        `${list.length} container${list.length === 1 ? '' : 's'} · ` + fmtDate(key),
        ...groupCount(list, (s) => s.forwarder).map(([fw, n]) => `${fw}: ${n}`),
      ]);
    }
  }

  if (state.cal.selected && byDay.has(state.cal.selected)) {
    el('div', { class: 'footnote', text: 'Arrivals on ' + fmtDate(state.cal.selected) + ':' }, body);
    renderShipTable(body, detailCols, byDay.get(state.cal.selected), detailRow);
  } else {
    el('div', { class: 'footnote', text: 'Click a day to see its containers, then click a container to read the import team’s log. Weight, volume and exact arrival times can join this view once those fields are confirmed in the warehouse feed.' }, body);
  }
}

/* ---------- KPI row & meta ---------- */

function renderKpis() {
  const k = state.data.kpis;
  const wrap = document.getElementById('kpis');
  wrap.textContent = '';
  const tiles = [
    { label: 'Forwarders on file', value: fmtNum(k.forwardersOnFile), c: '#373431' },
    { label: 'Shipments on file', value: fmtNum(k.shipmentsOnFile), c: '#238857' },
    { label: 'Containers on the water', value: fmtNum(k.containersOnWater), c: '#824098' },
    { label: 'Total spend on file', value: fmtGBP(k.totalSpend), sub: `${fmtNum(k.costedShipments)} costed shipments`, c: '#DE7E2E' },
    { label: 'Avg cost / shipment', value: fmtGBP(k.avgCostPerShipment), c: '#392A71' },
    { label: 'Avg transit', value: k.avgTransitWeeks == null ? '–' : fmtWeeks(k.avgTransitWeeks) + ' wks', sub: 'sailing to port ETA, adjusted', c: '#887F4A' },
  ];
  for (const tdef of tiles) {
    const tile = el('div', { class: 'tile', style: `border-top:3px solid ${tdef.c}` }, wrap);
    el('div', { class: 'label', text: tdef.label }, tile);
    el('div', { class: 'value', text: tdef.value }, tile);
    if (tdef.sub) el('div', { class: 'subnote', text: tdef.sub }, tile);
  }
}

function renderMeta() {
  const m = state.data.meta;
  const bits = [];
  // Lead with the honest freshness figure: when Orderwise last fed the warehouse.
  const asOf = fmtDateTime(m.dataAsOf);
  if (asOf) {
    let feedBit = 'Orderwise data as of ' + asOf;
    const ageH = (Date.now() - new Date(m.dataAsOf).getTime()) / 3600000;
    if (ageH > 26) feedBit += ' (feed may be behind, last ran ' + Math.round(ageH) + 'h ago)';
    bits.push(feedBit);
  } else if (m.dataMode === 'bigquery') {
    bits.push('Live from Orderwise via BigQuery');
  }
  bits.push('checked ' + fmtDateTime(m.fetchedAt));
  if (m.scope === 'live') {
    let scopeBit = 'live book · sailings in the last ' + m.scopeMonths + ' months';
    const ex = (state.data.scopeInfo || {}).excluded;
    if (ex) scopeBit += ' (' + ex + ' older excluded)';
    bits.push(scopeBit);
  }
  document.getElementById('meta-line').textContent = bits.join(' · ');
  document.getElementById('sample-badge').style.display = m.dataMode === 'sample' ? '' : 'none';
}

function renderRouteFilter() {
  const sel = document.getElementById('route-filter');
  const current = state.route;
  sel.textContent = '';
  el('option', { value: 'all', text: 'All routes' }, sel);
  const counts = groupCount(state.data.shipments, (s) => s.route);
  for (const [route, n] of counts) el('option', { value: route, text: `${route}  (${n})` }, sel);
  const noRoute = state.data.shipments.filter((s) => !s.route).length;
  if (noRoute) el('option', { value: '__none__', text: `No route captured  (${noRoute})` }, sel);
  sel.value = [...sel.options].some((o) => o.value === current) ? current : 'all';
  state.route = sel.value;
}

/* ---------- orchestration ---------- */

function render() {
  if (!state.data) return;
  renderMeta();
  renderKpis();
  renderRouteFilter();
  renderLanding();
  renderForwarders();
  renderRoutes();
  renderTrend();
  renderSplit();
  renderTransit();
  renderTrCost();
  renderTrVolume();
  renderTrTransit();
  renderTrSpend();
  renderCalendar();
  const note = document.getElementById('filter-note');
  const q = state.search.trim();
  if (q) {
    const n = filteredShipments().length;
    note.textContent = `${n} shipment${n === 1 ? '' : 's'} match "${q}" · headline figures above stay whole-book`;
  } else {
    note.textContent = 'Filters the sections below · headline figures above stay whole-book';
  }
}

let refreshNoteTimer = null;
function setRefreshNote(text) {
  const el2 = document.getElementById('refresh-note');
  el2.textContent = text;
  clearTimeout(refreshNoteTimer);
  if (text) refreshNoteTimer = setTimeout(() => { el2.textContent = ''; }, 12000);
}

async function load(refresh) {
  const bodies = document.querySelectorAll('.chart-body');
  bodies.forEach((b) => b.classList.add('loading'));
  const errBox = document.getElementById('error');
  const prevAsOf = state.data && state.data.meta ? state.data.meta.dataAsOf : null;
  try {
    const res = await fetch('/api/overview' + (refresh ? '?refresh=1' : ''));
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.error || res.statusText || 'Request failed');
    }
    state.data = await res.json();
    state._fwColors = null;
    errBox.style.display = 'none';
    render();
    if (refresh) {
      const newAsOf = state.data.meta.dataAsOf;
      if (newAsOf && prevAsOf && newAsOf === prevAsOf) {
        setRefreshNote('Checked the warehouse: nothing new from Orderwise since ' + fmtDateTime(newAsOf) + '. New entries appear after the next feed run.');
      } else if (newAsOf) {
        setRefreshNote('Updated: Orderwise feed data as of ' + fmtDateTime(newAsOf) + '.');
      } else {
        setRefreshNote('Re-checked the warehouse.');
      }
    }
  } catch (err) {
    errBox.style.display = 'block';
    errBox.textContent = 'Could not load data: ' + err.message +
      '. If this is a fresh deploy, check the service account has BigQuery access (see README).';
  } finally {
    document.querySelectorAll('.chart-body').forEach((b) => b.classList.remove('loading'));
  }
}

const TABS = ['overview', 'trends', 'calendar'];
function setTab(t) {
  state.tab = t;
  for (const name of TABS) {
    document.getElementById('tab-' + name).style.display = t === name ? '' : 'none';
    document.getElementById('tab-btn-' + name).classList.toggle('active', t === name);
  }
  render();
}
for (const name of TABS) {
  document.getElementById('tab-btn-' + name).addEventListener('click', () => setTab(name));
}

document.getElementById('route-filter').addEventListener('change', (e) => {
  state.route = e.target.value;
  render();
});
document.getElementById('refresh-btn').addEventListener('click', () => load(true));
let searchTimer = null;
document.getElementById('ship-search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = e.target.value;
    render();
  }, 150);
});
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 150);
});

load(false);
