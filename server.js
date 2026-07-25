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
    overview: buildOverview(raw, config.fieldMap),
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

app.get('/healthz', (req, res) => res.json({ ok: true, dataMode: config.dataMode }));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API route' }));

app.listen(config.port, () => {
  console.log(`Containers dashboard listening on :${config.port} (data mode: ${config.dataMode})`);
});
