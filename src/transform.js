'use strict';

// Turns raw view rows into the payload the dashboard renders. All aggregation for
// charts happens client-side from the derived per-shipment records, so the route
// filter is instant; only the KPI block is computed here (always unfiltered).

const WEEK_MS = 7 * 24 * 3600 * 1000;

// BigQuery timestamps arrive as { value: '2026-...' }; sample data as ISO strings.
function toIso(v) {
  if (v == null) return null;
  if (typeof v === 'object' && v.value) return String(v.value);
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  return s || null;
}

function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanText(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function containsAny(haystack, needles) {
  if (!haystack) return false;
  const h = haystack.toLowerCase();
  return (needles || []).some((n) => h.includes(String(n).toLowerCase()));
}

// The Orderwise memo column mapped to `notes` is the import team's free-text log:
// one entry per line, newest first, written by hand. Dates inside it are
// inconsistent (dd.mm.yy, dd/mm/yy, and at least one line self-labelled US format),
// so this splits into lines and does NOTHING else. No date parsing, no re-sorting,
// no deriving forwarder names or ETAs from the text. Display and search only:
// anything computed from prose here would be a confident-looking guess.
function parseNotes(v) {
  const raw = cleanText(v);
  if (!raw) return [];
  return raw
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildShipments(raw, fieldMap) {
  const analysisByContainer = new Map();
  for (const row of raw.analysis || []) {
    const cid = toNum(row.shpca_shpc_id);
    if (cid != null) analysisByContainer.set(cid, row);
  }

  const statusById = new Map();
  for (const s of raw.statuses || []) {
    const sid = toNum(s.scs_id);
    if (sid != null) statusById.set(sid, cleanText(s.scs_status));
  }

  const costsByContainer = new Map();
  for (const line of raw.costLines || []) {
    const cid = toNum(line.shpcsm_shpc_id);
    if (cid == null) continue;
    if (!costsByContainer.has(cid)) costsByContainer.set(cid, []);
    costsByContainer.get(cid).push(line);
  }

  // Supplier master (Orderwise supply_detail). Freight forwarders are suppliers too,
  // so one lookup resolves both the container's supplier and whoever invoiced freight.
  const supplierById = new Map();
  for (const s of raw.suppliers || []) {
    const sid = toNum(s.sd_id);
    if (sid == null) continue;
    supplierById.set(sid, {
      name: cleanText(s.sd_name),
      country: cleanText(s.sd_country_code),
      isImport: s.sd_import_supplier === true || String(s.sd_import_supplier).toLowerCase() === 'true',
    });
  }
  const supplierName = (sdId) => {
    const rec = sdId == null ? null : supplierById.get(sdId);
    return rec ? rec.name : null;
  };

  const a = fieldMap.analysis || {};
  const getA = (row, key) => (row && a[key] ? cleanText(row[a[key]]) : null);
  const getNotes = (row) => (row && a.notes ? parseNotes(row[a.notes]) : []);
  // Which source wins when both a master record and an analysis column are present.
  // 'master' = the Orderwise supplier record, 'analysis' = the shpca_c_* column.
  const sources = fieldMap.sources || {};
  const pick = (key, masterValue, analysisValue) =>
    (sources[key] === 'analysis' ? analysisValue || masterValue : masterValue || analysisValue);
  const freightKeywords = (fieldMap.costs || {}).freightKeywords || ['freight'];
  const onWaterStatuses = ((fieldMap.status || {}).onWater || []).map((s) => s.toLowerCase());
  const routesCfg = fieldMap.routes || {};

  const shipments = [];
  for (const c of raw.containers || []) {
    if (c.shpc_active === false) continue;
    const id = toNum(c.shpc_id);
    const an = analysisByContainer.get(id);

    const departurePort = getA(an, 'departurePort');
    const domesticPort = getA(an, 'domesticPort');
    const route = departurePort ? `${departurePort} → ${domesticPort || '?'}` : null;

    const shipped = toIso(c.shpc_shipped_datetime);
    const eta = toIso(c.shpc_port_eta_datetime);
    const delivered = toIso(c.shpc_actual_delivery_datetime);
    const statusText = statusById.get(toNum(c.shpc_scs_id)) || null;

    let freightCost = 0;
    let addOnCost = 0;
    let hasCosts = false;
    // The forwarder is the supplier on the biggest freight line. If nothing is
    // classified as freight, fall back to the biggest cost line of any kind.
    let freightSdId = null;
    let freightSdAmount = -1;
    let anySdId = null;
    let anySdAmount = -1;
    for (const line of costsByContainer.get(id) || []) {
      const net = toNum(line.shpcsm_net);
      const cost = toNum(line.shpcsm_cost);
      const amount = net != null && net !== 0 ? net : cost;
      if (amount == null || amount === 0) continue;
      hasCosts = true;
      const sdId = toNum(line.shpcsm_sd_id) || null;
      const isFreight = containsAny(cleanText(line.shpcsm_description), freightKeywords);
      if (isFreight) {
        freightCost += amount;
        if (sdId && amount > freightSdAmount) {
          freightSdId = sdId;
          freightSdAmount = amount;
        }
      } else {
        addOnCost += amount;
      }
      if (sdId && amount > anySdAmount) {
        anySdId = sdId;
        anySdAmount = amount;
      }
    }

    let transitWeeks = null;
    let surchargeWeeks = 0;
    if (shipped && eta) {
      const ms = new Date(eta) - new Date(shipped);
      if (Number.isFinite(ms) && ms > 0) {
        transitWeeks = ms / WEEK_MS;
        if (containsAny(departurePort, routesCfg.railOrigins)) {
          surchargeWeeks += toNum(routesCfg.railSurchargeWeeks) || 0;
        }
        if (containsAny(departurePort, routesCfg.feederOrigins)) {
          surchargeWeeks += toNum(routesCfg.feederSurchargeWeeks) || 0;
        }
      }
    }

    const onWater =
      (statusText && onWaterStatuses.includes(statusText.toLowerCase())) ||
      (!!shipped && !delivered);

    const supplierRec = supplierById.get(toNum(c.shpc_sd_id)) || null;
    const forwarderAccount = supplierName(freightSdId) || supplierName(anySdId);
    const notes = getNotes(an);

    shipments.push({
      id,
      containerNumber: cleanText(c.shpc_number),
      description: cleanText(c.shpc_description),
      boxNumber: cleanText(c.shpc_box_number),
      vessel: cleanText(c.shpc_vessel),
      status: statusText,
      onWater,
      fullyReceived: c.shpc_fully_received === true,
      allInvoicesReceived: c.shpc_all_invoices_received !== false,
      shipped,
      eta,
      promised: toIso(c.shpc_date_promised),
      delivered,
      forwarder: pick('forwarder', forwarderAccount, getA(an, 'freightForwarder')),
      forwarderAccount,
      forwarderRef: getA(an, 'forwarderRef'),
      po: getA(an, 'po'),
      notes,
      notesLatest: notes[0] || null,
      notesCount: notes.length,
      supplier: pick('supplier', supplierRec && supplierRec.name, getA(an, 'supplier')),
      supplierAccount: supplierRec ? supplierRec.name : null,
      supplierIsImport: supplierRec ? supplierRec.isImport : null,
      containerType: getA(an, 'containerType'),
      deliveryAddress: getA(an, 'deliveryAddress'),
      country: pick('country', supplierRec && supplierRec.country, getA(an, 'country')),
      departurePort,
      domesticPort,
      route,
      freightCost: hasCosts ? Math.round(freightCost * 100) / 100 : null,
      addOnCost: hasCosts ? Math.round(addOnCost * 100) / 100 : null,
      totalCost: hasCosts ? Math.round((freightCost + addOnCost) * 100) / 100 : null,
      transitWeeksPortToPort: transitWeeks != null ? Math.round(transitWeeks * 10) / 10 : null,
      transitSurchargeWeeks: transitWeeks != null ? surchargeWeeks : 0,
      transitWeeks: transitWeeks != null ? Math.round((transitWeeks + surchargeWeeks) * 10) / 10 : null,
    });
  }

  shipments.sort((x, y) => String(x.shipped || '').localeCompare(String(y.shipped || '')));
  return shipments;
}

function buildKpis(shipments) {
  const forwarders = new Set(shipments.map((s) => s.forwarder).filter(Boolean));
  const withCost = shipments.filter((s) => s.totalCost != null);
  const totalSpend = withCost.reduce((sum, s) => sum + s.totalCost, 0);
  const withTransit = shipments.filter((s) => s.transitWeeks != null);
  const avgTransit = withTransit.length
    ? withTransit.reduce((sum, s) => sum + s.transitWeeks, 0) / withTransit.length
    : null;

  return {
    forwardersOnFile: forwarders.size,
    shipmentsOnFile: shipments.length,
    containersOnWater: shipments.filter((s) => s.onWater).length,
    totalSpend: Math.round(totalSpend),
    avgCostPerShipment: withCost.length ? Math.round(totalSpend / withCost.length) : null,
    avgTransitWeeks: avgTransit != null ? Math.round(avgTransit * 10) / 10 : null,
    costedShipments: withCost.length,
  };
}

// Monthly aggregates for the Trends tab. Uses ALL shipments (not the live-book
// scope): trends are about the past. Windowed to the most recent `windowMonths`.
function buildTrends(all, windowMonths) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (windowMonths - 1), 1));
  const buckets = new Map();
  for (const s of all) {
    if (!s.shipped) continue;
    const d = new Date(s.shipped);
    if (Number.isNaN(d.getTime()) || d < start) continue;
    const key = d.toISOString().slice(0, 7);
    if (!buckets.has(key)) {
      buckets.set(key, { n: 0, costedN: 0, freight: 0, addOn: 0, total: 0, transitN: 0, transit: 0 });
    }
    const b = buckets.get(key);
    b.n += 1;
    if (s.totalCost != null) {
      b.costedN += 1;
      b.freight += s.freightCost || 0;
      b.addOn += s.addOnCost || 0;
      b.total += s.totalCost;
    }
    if (s.transitWeeks != null) {
      b.transitN += 1;
      b.transit += s.transitWeeks;
    }
  }
  if (!buckets.size) return { windowMonths, months: [] };

  // continuous month axis from the first month with data to the current month
  const keys = [...buckets.keys()].sort();
  const months = [];
  const cur = new Date(keys[0] + '-01T00:00:00Z');
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  while (cur <= end) {
    const key = cur.toISOString().slice(0, 7);
    const b = buckets.get(key) || { n: 0, costedN: 0, freight: 0, addOn: 0, total: 0, transitN: 0, transit: 0 };
    months.push({
      month: key,
      n: b.n,
      costedN: b.costedN,
      avgFreight: b.costedN ? Math.round(b.freight / b.costedN) : null,
      avgAddOn: b.costedN ? Math.round(b.addOn / b.costedN) : null,
      avgTotal: b.costedN ? Math.round(b.total / b.costedN) : null,
      totalSpend: b.costedN ? Math.round(b.total) : null,
      avgTransit: b.transitN ? Math.round((b.transit / b.transitN) * 10) / 10 : null,
      transitN: b.transitN,
    });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return { windowMonths, months };
}

function buildOverview(raw, fieldMap, opts = {}) {
  const all = buildShipments(raw, fieldMap);
  const scope = opts.scope || 'all';
  let shipments = all;
  if (scope === 'live') {
    const months = opts.scopeMonths || 12;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutIso = cutoff.toISOString();
    shipments = all.filter(
      (s) =>
        (s.shipped && s.shipped >= cutIso) ||
        (!s.shipped && !s.delivered && !s.fullyReceived)
    );
  }
  // How much of the naming came from the Orderwise supplier master rather than the
  // free-text analysis columns. Surfaces silently-empty joins instead of hiding them.
  const count = (fn) => all.filter(fn).length;
  return {
    kpis: buildKpis(shipments),
    shipments,
    trends: buildTrends(all, opts.trendMonths || 24),
    scopeInfo: { scope, months: opts.scopeMonths || 12, excluded: all.length - shipments.length },
    fieldSources: {
      containers: all.length,
      supplierFromMaster: count((s) => !!s.supplierAccount),
      forwarderFromMaster: count((s) => !!s.forwarderAccount),
      supplierNamed: count((s) => !!s.supplier),
      forwarderNamed: count((s) => !!s.forwarder),
      // Notes coverage, so "how many containers actually carry a log" is a number
      // on the page rather than an assumption. If this is a small fraction of
      // containers, the Latest update column will be mostly blank by nature.
      withNotes: count((s) => s.notesCount > 0),
    },
    transitNotes: {
      rail: `${(fieldMap.routes || {}).railOrigins?.join(', ') || ''}-origin routes include +${(fieldMap.routes || {}).railSurchargeWeeks ?? 2} weeks for rail transit to port`,
      feeder: `${(fieldMap.routes || {}).feederOrigins?.join(', ') || ''}-origin routes include +${(fieldMap.routes || {}).feederSurchargeWeeks ?? 2} weeks for feeder transhipment to the main port`,
    },
  };
}

module.exports = { buildOverview, buildShipments, buildKpis };
