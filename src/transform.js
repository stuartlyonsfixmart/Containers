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

  const a = fieldMap.analysis || {};
  const getA = (row, key) => (row && a[key] ? cleanText(row[a[key]]) : null);
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
    for (const line of costsByContainer.get(id) || []) {
      const net = toNum(line.shpcsm_net);
      const cost = toNum(line.shpcsm_cost);
      const amount = net != null && net !== 0 ? net : cost;
      if (amount == null || amount === 0) continue;
      hasCosts = true;
      if (containsAny(cleanText(line.shpcsm_description), freightKeywords)) freightCost += amount;
      else addOnCost += amount;
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
      delivered,
      forwarder: getA(an, 'freightForwarder'),
      forwarderRef: getA(an, 'forwarderRef'),
      po: getA(an, 'po'),
      supplier: getA(an, 'supplier'),
      containerType: getA(an, 'containerType'),
      country: getA(an, 'country'),
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

function buildOverview(raw, fieldMap) {
  const shipments = buildShipments(raw, fieldMap);
  return {
    kpis: buildKpis(shipments),
    shipments,
    transitNotes: {
      rail: `${(fieldMap.routes || {}).railOrigins?.join(', ') || ''}-origin routes include +${(fieldMap.routes || {}).railSurchargeWeeks ?? 2} weeks for rail transit to port`,
      feeder: `${(fieldMap.routes || {}).feederOrigins?.join(', ') || ''}-origin routes include +${(fieldMap.routes || {}).feederSurchargeWeeks ?? 2} weeks for feeder transhipment to the main port`,
    },
  };
}

module.exports = { buildOverview, buildShipments, buildKpis };
