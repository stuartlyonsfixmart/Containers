'use strict';

const path = require('path');
const express = require('express');
const config = require('./src/config');
const { buildOverview } = require('./src/transform');
const { sampleData } = require('./src/sample-data');

const app = express();
app.disable('x-powered-by');

let cache = { raw: null, overview: null, fetchedAt: 0 };

async function loadRaw() {
  if (config.dataMode === 'bigquery') {
    const bigquery = require('./src/bigquery');
    return bigquery.fetchAll();
  }
  return sampleData();
}

async function getData(forceRefresh) {
  const fresh = Date.now() - cache.fetchedAt < config.cacheTtlMs;
  if (!forceRefresh && fresh && cache.overview) return cache;
  const raw = await loadRaw();
  cache = {
    raw,
    overview: buildOverview(raw, config.fieldMap, {
      scope: config.dataScope,
      scopeMonths: config.scopeMonths,
      trendMonths: config.trendMonths,
    }),
    fetchedAt: Date.now(),
  };
  return cache;
}

app.get('/api/overview', async (req, res) => {
  try {
    const { raw, overview, fetchedAt } = await getData(req.query.refresh === '1');
    res.json({
      meta: {
        dataMode: config.dataMode,
        scope: config.dataScope,
        scopeMonths: config.scopeMonths,
        fetchedAt: new Date(fetchedAt).toISOString(),
        dataAsOf: raw.dataAsOf || null,
        cacheTtlSeconds: Math.round(config.cacheTtlMs / 1000),
      },
      ...overview,
    });
  } catch (err) {
    console.error('overview failed:', err);
    res.status(500).json({ error: err.message || 'Failed to load data' });
  }
});

// Field-mapping helper: profiles the generic Orderwise analysis columns with sample
// values so config/field-map.json can be confirmed against real data in minutes.
app.get('/api/inspect', async (req, res) => {
  try {
    const { raw } = await getData(req.query.refresh === '1');
    const profile = {};
    const rows = (raw.analysis || []).slice(0, 500);
    if (rows.length) {
      for (const col of Object.keys(rows[0])) {
        const values = rows
          .map((r) => r[col])
          .map((v) => (v && typeof v === 'object' && v.value ? v.value : v))
          .filter((v) => v !== null && v !== '' && v !== undefined && v !== false);
        const distinct = [...new Set(values.map(String))];
        profile[col] = {
          populated: values.length,
          of: rows.length,
          examples: distinct.slice(0, 5),
        };
      }
    }
    res.json({
      dataMode: config.dataMode,
      currentFieldMap: config.fieldMap.analysis,
      hint: 'Match each dashboard field to the shpca_ column whose examples look right, edit config/field-map.json, redeploy.',
      analysisColumnProfile: profile,
      sampleRows: {
        container: (raw.containers || [])[0] || null,
        costLine: (raw.costLines || [])[0] || null,
        statuses: raw.statuses || [],
      },
    });
  } catch (err) {
    console.error('inspect failed:', err);
    res.status(500).json({ error: err.message || 'Failed to inspect data' });
  }
});

// Warehouse explorer: lists every Orderwise table in JSON_STAGE (not just the five
// the dashboard reads) and profiles any table's fields with sample values.
// Use it to hunt for PO numbers, supplier names, weights and volumes.
app.get('/api/explore', async (req, res) => {
  try {
    if (config.dataMode !== 'bigquery') {
      return res.json({ note: 'Explore runs against BigQuery only; this instance is serving sample data.' });
    }
    const { runQuery } = require('./src/bigquery');
    const stage = `\`${config.bqProject}.${config.bqDataset}.JSON_STAGE\``;
    const table = String(req.query.table || '');
    if (!table) {
      const tables = await runQuery(
        `SELECT source_table, COUNT(*) AS row_count,
                FORMAT_TIMESTAMP('%F %H:%M', MAX(uploaded_at)) AS last_updated
           FROM ${stage}
          GROUP BY source_table
          ORDER BY row_count DESC`
      );
      return res.json({
        hint: 'Every Orderwise table in the warehouse. Add ?table=NAME to see a table’s fields with sample values.',
        tables,
      });
    }
    if (!/^[A-Za-z0-9_]{1,64}$/.test(table)) {
      return res.status(400).json({ error: 'Invalid table name' });
    }
    const rows = await runQuery(
      `SELECT json_payload FROM ${stage}
        WHERE source_table = '${table}'
        ORDER BY uploaded_at DESC
        LIMIT 8`
    );
    const fields = {};
    for (const r of rows) {
      let obj = r.json_payload;
      if (typeof obj === 'string') {
        try { obj = JSON.parse(obj); } catch { continue; }
      }
      if (!obj || typeof obj !== 'object') continue;
      for (const [k, v] of Object.entries(obj)) {
        if (!fields[k]) fields[k] = [];
        const s = v == null || v === '' ? null : String(v).slice(0, 80);
        if (s && !fields[k].includes(s) && fields[k].length < 3) fields[k].push(s);
      }
    }
    res.json({ table, sampledRows: rows.length, fields });
  } catch (err) {
    console.error('explore failed:', err);
    res.status(500).json({ error: err.message || 'Failed to explore warehouse' });
  }
});

// Raw shipment records as CSV for Excel; respects the live-book scope.
app.get('/api/shipments.csv', async (req, res) => {
  try {
    const { overview } = await getData(req.query.refresh === '1');
    const cols = ['po', 'containerNumber', 'boxNumber', 'containerType', 'supplier', 'supplierAccount',
      'deliveryAddress', 'forwarder', 'forwarderAccount', 'forwarderRef', 'route', 'departurePort',
      'domesticPort', 'vessel', 'status', 'shipped', 'eta', 'promised', 'delivered',
      'freightCost', 'addOnCost', 'totalCost', 'transitWeeks'];
    // The notes column is the import team's candid internal log: it names individuals
    // at suppliers and forwarders and records disputes. Visible in the app, kept out
    // of the default export so it is not forwarded by accident in a spreadsheet.
    // Opt in with ?notes=1.
    const wantNotes = req.query.notes === '1';
    if (wantNotes) cols.push('notesCount', 'notesLatest', 'notes');
    const esc = (v) => {
      if (v == null) return '';
      const s = Array.isArray(v) ? v.join(' | ') : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.join(',')];
    for (const s of overview.shipments) lines.push(cols.map((c) => esc(s[c])).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="containers-shipments.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('csv failed:', err);
    res.status(500).json({ error: err.message || 'Failed to export CSV' });
  }
});

app.get('/healthz', (req, res) => res.json({ ok: true, dataMode: config.dataMode }));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API route' }));

app.listen(config.port, () => {
  console.log(`Containers dashboard listening on :${config.port} (data mode: ${config.dataMode})`);
});
