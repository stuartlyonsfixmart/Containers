'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadFieldMap() {
  const p = process.env.FIELD_MAP_PATH || path.join(ROOT, 'config', 'field-map.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// DATA_MODE=sample serves deterministic demo data (local dev, no credentials needed).
// DATA_MODE=bigquery queries the warehouse. If unset, we assume BigQuery when the
// process looks like it is running on GCP (Cloud Run sets K_SERVICE) or has
// credentials configured, and fall back to sample data otherwise.
function resolveDataMode() {
  const explicit = String(process.env.DATA_MODE || '').toLowerCase();
  if (explicit === 'sample' || explicit === 'bigquery') return explicit;
  if (
    process.env.K_SERVICE ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.GOOGLE_CLOUD_PROJECT
  ) {
    return 'bigquery';
  }
  return 'sample';
}

module.exports = {
  ROOT,
  port: parseInt(process.env.PORT || '8080', 10),
  dataMode: resolveDataMode(),
  bqProject: process.env.BQ_PROJECT || 'project-aa7ee149-5e29-4eb4-8bc',
  bqDataset: process.env.BQ_DATASET || 'fixmart_bi',
  // 'views' queries the saved views (shipping_container_latest etc.) and falls back
  // to inlining the SQL from /sql against JSON_STAGE if a view is missing.
  // 'inline' skips views entirely.
  bqSource: String(process.env.BQ_SOURCE || 'views').toLowerCase(),
  cacheTtlMs: parseInt(process.env.CACHE_TTL_SECONDS || '600', 10) * 1000,
  // 'live' shows the current book: containers on the water or not yet fully
  // received, plus anything sailed in the last SCOPE_MONTHS. 'all' shows history.
  dataScope: String(process.env.DATA_SCOPE || 'live').toLowerCase(),
  scopeMonths: parseInt(process.env.SCOPE_MONTHS || '12', 10),
  // Trends tab window: monthly aggregates over full history, capped to this many months.
  trendMonths: parseInt(process.env.TREND_MONTHS || '24', 10),
  fieldMap: loadFieldMap(),
};
