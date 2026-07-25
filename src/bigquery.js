'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

// View name -> logical dataset key. File names in /sql match the view names.
const VIEWS = {
  containers: 'shipping_container_latest',
  analysis: 'shipping_container_analysis_latest',
  costLines: 'shipping_container_shipping_method_latest',
  statuses: 'shipping_container_status_latest',
  distMethods: 'shipping_cost_distribution_method_latest',
};

let bqClient = null;
function client() {
  if (!bqClient) {
    // Lazy require so sample mode never needs the dependency's credentials chain.
    const { BigQuery } = require('@google-cloud/bigquery');
    bqClient = new BigQuery({ projectId: config.bqProject });
  }
  return bqClient;
}

// The committed SQL hardcodes the original `project.dataset.JSON_STAGE` path.
// Rewrite it from config so the same files work if the project or dataset moves.
function inlineSql(viewName) {
  const file = path.join(config.ROOT, 'sql', `${viewName}.sql`);
  const raw = fs.readFileSync(file, 'utf8');
  return raw
    .replace(/`[^`]+\.JSON_STAGE`/g, `\`${config.bqProject}.${config.bqDataset}.JSON_STAGE\``)
    .replace(/;\s*$/, '');
}

async function runQuery(sql) {
  const [rows] = await client().query({ query: sql });
  return rows;
}

async function fetchView(viewName) {
  if (config.bqSource !== 'inline') {
    try {
      return await runQuery(
        `SELECT * FROM \`${config.bqProject}.${config.bqDataset}.${viewName}\``
      );
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (!/not found/i.test(msg)) throw err;
      console.warn(`View ${viewName} not found; falling back to inline SQL from /sql.`);
    }
  }
  return runQuery(inlineSql(viewName));
}

async function fetchDataAsOf() {
  try {
    const rows = await runQuery(
      `SELECT FORMAT_TIMESTAMP('%FT%TZ', MAX(uploaded_at)) AS as_of\n         FROM \`${config.bqProject}.${config.bqDataset}.JSON_STAGE\`\n        WHERE source_table IN ('shipping_container','shipping_container_analysis','shipping_container_shipping_method')`
    );
    return rows.length ? rows[0].as_of : null;
  } catch (err) {
    // Permission may be limited to the views only; the freshness stamp is optional.
    console.warn('Could not read MAX(uploaded_at) from JSON_STAGE:', err.message);
    return null;
  }
}

async function fetchAll() {
  const [containers, analysis, costLines, statuses, distMethods, dataAsOf] = await Promise.all([
    fetchView(VIEWS.containers),
    fetchView(VIEWS.analysis),
    fetchView(VIEWS.costLines),
    fetchView(VIEWS.statuses),
    fetchView(VIEWS.distMethods),
    fetchDataAsOf(),
  ]);
  return { containers, analysis, costLines, statuses, distMethods, dataAsOf };
}

module.exports = { fetchAll, runQuery, VIEWS };
