'use strict';

// Deterministic sample dataset shaped exactly like the five warehouse views, so the
// app runs and demos locally with no BigQuery access. Numbers roughly mirror the
// July 2026 state of the original dashboard (23 shipments, ~£62k spend, GEMINI ~87%).

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VESSELS = ['MSC AMELIA', 'EVER LUCENT', 'OOCL SPAIN', 'CMA CGM LYRA', 'MAERSK CANTON', 'ONE HARMONY'];

// dep, dom, count, forwarder overrides by index, base freight £, base port-to-port weeks
const ROUTE_PLAN = [
  { dep: 'Ningbo (China)', dom: 'London Gateway', n: 5, freight: 2850, weeks: 4.9, country: 'China', supplier: 'Ningbo Hardware Co' },
  { dep: 'Zhapu then feeder to Ningbo (China)', dom: 'London Gateway', n: 4, freight: 1750, weeks: 4.7, country: 'China', supplier: 'Jiaxing Fixings Ltd' },
  { dep: 'Qingdao (China)', dom: 'London Gateway', n: 3, freight: 2050, weeks: 4.6, country: 'China', supplier: 'Qingdao Tooling Group' },
  { dep: 'Tianjin', dom: 'London Gateway', n: 3, freight: 1450, weeks: 5.1, country: 'China', supplier: 'Tianjin Metalworks' },
  { dep: 'Xingang', dom: 'London Gateway', n: 2, freight: 1300, weeks: 5.0, country: 'China', supplier: 'Hebei Wire Products' },
  { dep: 'Mundra (India)', dom: 'London Gateway', n: 1, freight: 1350, weeks: 3.4, country: 'India', supplier: 'Mundra Fastenings' },
  { dep: 'Mundra (India)', dom: '', n: 1, freight: 1350, weeks: 3.4, country: 'India', supplier: 'Mundra Fastenings' },
  { dep: 'Zhapu then feeder to Ningbo (China)', dom: 'Felixstowe', n: 1, freight: 1750, weeks: 4.8, country: 'China', supplier: 'Jiaxing Fixings Ltd' },
];

// Stand-in for the Orderwise supply_detail master. Forwarders are suppliers too,
// which is how a freight cost line resolves to a forwarder name.
const SUPPLIERS = [
  { sd_id: 501, sd_name: 'Ningbo Hardware Co', sd_country_code: 'CN', sd_import_supplier: true },
  { sd_id: 502, sd_name: 'Jiaxing Fixings Ltd', sd_country_code: 'CN', sd_import_supplier: true },
  { sd_id: 503, sd_name: 'Qingdao Tooling Group', sd_country_code: 'CN', sd_import_supplier: true },
  { sd_id: 504, sd_name: 'Tianjin Metalworks', sd_country_code: 'CN', sd_import_supplier: true },
  { sd_id: 505, sd_name: 'Hebei Wire Products', sd_country_code: 'CN', sd_import_supplier: true },
  { sd_id: 506, sd_name: 'Mundra Fastenings', sd_country_code: 'IN', sd_import_supplier: true },
  { sd_id: 507, sd_name: 'Various', sd_country_code: 'CN', sd_import_supplier: true },
  { sd_id: 901, sd_name: 'Transglobal Freight Services Ltd', sd_country_code: 'GB', sd_import_supplier: false },
  { sd_id: 902, sd_name: 'DSV Air & Sea Ltd', sd_country_code: 'GB', sd_import_supplier: false },
  { sd_id: 903, sd_name: 'Beckchoice Logistics Ltd', sd_country_code: 'GB', sd_import_supplier: false },
  { sd_id: 950, sd_name: 'Portside Handling Ltd', sd_country_code: 'GB', sd_import_supplier: false },
];

const SUPPLIER_SD = {
  'Ningbo Hardware Co': 501,
  'Jiaxing Fixings Ltd': 502,
  'Qingdao Tooling Group': 503,
  'Tianjin Metalworks': 504,
  'Hebei Wire Products': 505,
  'Mundra Fastenings': 506,
  Various: 507,
};

const FORWARDER_SD = {
  'GEMINI (TRANSGLOBAL)': 901,
  'DSV (Via UBT)': 902,
  BECKCHOICE: 903,
};

// Stand-in for the Orderwise memo column the import team uses as a running log
// (mapped as `notes` in config/field-map.json). Shaped like the real thing:
// newest entry first, one entry per line, hand-typed, inconsistent date formats,
// initials, named contacts at suppliers and forwarders. Deliberately messy, and
// deliberately not present on every container, so the empty state gets exercised.
const NOTE_LOGS = [
  `23.07.26 Given DSV\n20.07.26 - BA - packing spec finally sent over, with Sienna now\n10.07.26 Latest is next week again GC\n02.07.26 chased Bhawna, no reply`,
  `21.07.26 GC - ETA revised to 14.08, vessel rolled at transhipment\n14.07.26 PAID IN FULL BY ACCOUNTS\n30.06.26 Booking confirmed with Harry`,
  `18.07.26 BA - short shipped, 4 pallets to follow on next container\n05.07.26 Given to Gemini, cheaper than the beckchoice quote\n28.06.26 goods ready date confirmed by Abby`,
  `19.07.26 LCL this one, not enough volume to fill\n11.07.26 GC waiting on commercial invoice from WuJian`,
  `22.07.26 delivered to Northfleet, devan booked Thursday\n16.07.26 customs query on the fixings line, resolved\n09.07.26 according to beckchoice it sails Friday`,
  `07.28.25 GOODS READY DATE U.S FORMAT\n15.07.26 Ross confirmed collection`,
  `17.07.26 - Keeley chasing demurrage credit, £480 disputed\n03.07.26 arrived port, held for inspection 2 days`,
  `12.07.26 GC - supplier says 3 weeks late, factory shutdown`,
];

const ADD_ONS = [
  { desc: 'Devan & restack', base: 260 },
  { desc: 'Port & terminal fees', base: 185 },
  { desc: 'Haulage to NDC', base: 420 },
  { desc: 'Customs clearance', base: 95 },
  { desc: 'Demurrage', base: 150 },
];

function sampleData() {
  const rnd = mulberry32(20260724);
  const jitter = (base, pct) => Math.round(base * (1 + (rnd() * 2 - 1) * pct));

  const containers = [];
  const analysis = [];
  const costLines = [];

  const statuses = [
    { scs_id: 1, scs_status: 'Confirmed' },
    { scs_id: 2, scs_status: 'On the water' },
    { scs_id: 3, scs_status: 'Arrived at port' },
    { scs_id: 4, scs_status: 'Delivered' },
  ];
  const distMethods = [
    { scdm_id: 1, scdm_description: 'By value' },
    { scdm_id: 2, scdm_description: 'By weight' },
    { scdm_id: 3, scdm_description: 'By volume' },
  ];

  let id = 0;
  let lineId = 0;
  const DAY = 86400000;
  const firstSailing = Date.UTC(2026, 2, 10); // 10 Mar 2026
  const spacingDays = 5.4;

  const addContainer = (plan, forwarder, routed) => {
    id += 1;
    const shipped = new Date(firstSailing + Math.round((id - 1) * spacingDays * DAY) + jitter(0, 0) * DAY);
    const weeks = plan ? plan.weeks + (rnd() * 1.0 - 0.5) : 4.9 + (rnd() * 1.0 - 0.5);
    const eta = new Date(shipped.getTime() + Math.round(weeks * 7 * DAY));

    containers.push({
      shpc_id: id,
      shpc_number: `CONT-${String(id).padStart(3, '0')}`,
      shpc_description: plan ? `${plan.supplier} consignment` : 'Mixed consignment',
      shpc_fully_received: false,
      shpc_date_promised: new Date(eta.getTime() + 7 * DAY).toISOString(),
      shpc_shipped_datetime: shipped.toISOString(),
      shpc_port_eta_datetime: eta.toISOString(),
      shpc_actual_delivery_datetime: null,
      shpc_vessel: VESSELS[id % VESSELS.length],
      shpc_box_number: `MSKU${String(4400000 + id * 137)}`,
      shpc_sd_id: SUPPLIER_SD[plan ? plan.supplier : 'Various'] || 507,
      shpc_scs_id: 2,
      shpc_active: true,
      shpc_all_invoices_received: true,
    });

    analysis.push({
      shpca_id: 9000 + id,
      shpca_shpc_id: id,
      shpca_c_1: routed ? plan.dom : '',
      shpca_c_2: forwarder,
      shpca_c_3: routed ? plan.dep : '',
      shpca_c_4: forwarder === 'GEMINI (TRANSGLOBAL)' ? `GT-51${String(id).padStart(2, '0')}` : forwarder === 'DSV (Via UBT)' ? `UBT-88${id}` : `BC-19${id}`,
      shpca_c_5: rnd() < 0.75 ? '40 foot' : '20 foot',
      shpca_c_6: rnd() < 0.8 ? 'DA11 8HJ <Northfleet>' : 'RH15 9TL <Burgess Hill>',
      shpca_c_7: plan ? plan.supplier : 'Various',
      shpca_c_8: plan ? plan.country : 'China',
      // Roughly 2 in 3 carry a log, matching the live picture where the memo column
      // is populated on most but not all containers.
      shpca_m_1: id % 3 === 0 ? '' : NOTE_LOGS[id % NOTE_LOGS.length],
    });

    return id;
  };

  const addCosts = (containerId, freightBase, forwarder) => {
    lineId += 1;
    costLines.push({
      shpcsm_id: lineId,
      shpcsm_shpc_id: containerId,
      shpcsm_description: 'Ocean freight',
      shpcsm_net: jitter(freightBase, 0.12),
      shpcsm_cost: 0,
      shpcsm_sd_id: FORWARDER_SD[forwarder] || null,
      shpcsm_distribute: true,
      shpcsm_distribution_method: 1,
      shpcsm_include_in_duty_costs: true,
    });
    const nAddOns = 2 + (rnd() < 0.5 ? 1 : 0);
    const picks = [...ADD_ONS].sort(() => rnd() - 0.5).slice(0, nAddOns);
    for (const a of picks) {
      lineId += 1;
      costLines.push({
        shpcsm_id: lineId,
        shpcsm_shpc_id: containerId,
        shpcsm_description: a.desc,
        shpcsm_net: jitter(a.base * 1.6, 0.25),
        shpcsm_cost: 0,
        shpcsm_sd_id: 950,
        shpcsm_distribute: true,
        shpcsm_distribution_method: 2,
        shpcsm_include_in_duty_costs: false,
      });
    }
  };

  // 20 routed containers
  for (const plan of ROUTE_PLAN) {
    for (let k = 0; k < plan.n; k += 1) {
      let forwarder = 'GEMINI (TRANSGLOBAL)';
      if (plan.dep.startsWith('Ningbo') && k >= 3) forwarder = 'DSV (Via UBT)';
      if (plan.dep.startsWith('Qingdao') && k === 2) forwarder = 'BECKCHOICE';
      const cid = addContainer(plan, forwarder, true);
      addCosts(cid, plan.freight, forwarder);
    }
  }

  // 3 containers with no route captured yet; one still awaiting invoices
  for (let k = 0; k < 3; k += 1) {
    const cid = addContainer(null, 'GEMINI (TRANSGLOBAL)', false);
    if (k < 2) {
      addCosts(cid, 2500, 'GEMINI (TRANSGLOBAL)');
    } else {
      const c = containers[containers.length - 1];
      c.shpc_all_invoices_received = false;
    }
  }

  // Mark the three earliest sailings as delivered; the remaining 20 are on the water.
  const byShipped = [...containers].sort(
    (a, b) => new Date(a.shpc_shipped_datetime) - new Date(b.shpc_shipped_datetime)
  );
  for (const c of byShipped.slice(0, 3)) {
    const eta = new Date(c.shpc_port_eta_datetime);
    c.shpc_actual_delivery_datetime = new Date(eta.getTime() + 4 * DAY).toISOString();
    c.shpc_scs_id = 4;
    c.shpc_fully_received = true;
  }

  return {
    containers,
    analysis,
    costLines,
    statuses,
    distMethods,
    suppliers: SUPPLIERS,
    dataAsOf: new Date().toISOString(),
  };
}

module.exports = { sampleData };
