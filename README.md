# Containers: Freight Forwarding Import Dashboard

Team-accessible web version of the Fixmart freight forwarding dashboard. Version 1 covers the Overview page only: KPI tiles, forwarder share, most used routes, freight cost over time, freight vs add-on costs, and average transit time per route. It is read-only and pulls shipment data from the `fixmart_bi` BigQuery dataset, which is fed from Orderwise. No more manual CSV uploads and no per-browser localStorage copies.

## How it fits together

```
GitHub (main) --push--> GitHub Actions --deploy--> Cloud Run (this app)
                                                       |
                                                       v
                                          BigQuery: fixmart_bi views
                                          (JSON_STAGE fed by Orderwise)
```

One Cloud Run service serves both the static page (`public/index.html`) and a small JSON API (`server.js`). The API reads the five `*_latest` views (SQL kept verbatim in `/sql`), derives one record per container, and the browser does all chart aggregation client-side, so the route filter is instant. Results are cached in memory for 10 minutes; the Refresh button forces a re-query.

Quotes and forwarder record-keeping are deliberately out of scope for v1. They are not in the warehouse, so they stay in the old HTML file until a phase 2 adds a small writable store (Firestore) per Sienna's spec.

## Run it locally

```
npm install
npm run dev
```

Open http://localhost:8080. `npm run dev` forces `DATA_MODE=sample`, a deterministic demo dataset shaped exactly like the warehouse views, so you can develop with no GCP credentials. To run against real data locally: `gcloud auth application-default login`, then `DATA_MODE=bigquery npm start`.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `DATA_MODE` | auto | `sample` or `bigquery`. Auto-detects `bigquery` on Cloud Run. |
| `BQ_PROJECT` | `project-aa7ee149-5e29-4eb4-8bc` | GCP project holding the dataset. |
| `BQ_DATASET` | `fixmart_bi` | BigQuery dataset. |
| `BQ_SOURCE` | `views` | `views` queries the saved `*_latest` views and falls back to inlining `/sql` against `JSON_STAGE` if a view is missing; `inline` skips views entirely. |
| `CACHE_TTL_SECONDS` | `600` | Server-side cache for warehouse reads. |
| `PORT` | `8080` | Set by Cloud Run automatically. |

## Confirm the field mapping (do this once, first deploy)

Orderwise stores container analysis fields as generic columns (`shpca_c_1..10`, `shpca_n_1..10`, `shpca_d_1..10`), and nothing in the SQL says which column is Departure Port, Forwarder, or PO. The app ships with a best-guess mapping in `config/field-map.json`.

1. Deploy in BigQuery mode and open `/api/inspect`.
2. It profiles every analysis column with sample values, next to the current mapping.
3. Edit `config/field-map.json` so each dashboard field points at the right column, push, done.

The same file also holds the freight-vs-add-on keyword rules, the on-the-water status list, and the transit surcharges (Mundra +2 weeks rail, Zhapu +2 weeks feeder).

### Supplier and forwarder names

Two of those names do not have to be guessed. Every container carries `shpc_sd_id` and every cost line carries `shpcsm_sd_id`, both pointing at the Orderwise supplier master in `fixmart_bi.supply_detail`. Freight forwarders are set up as suppliers in Orderwise, so one lookup resolves the container's supplier and whoever invoiced the freight.

The `sources` block in `config/field-map.json` decides which wins when both a master record and an analysis column exist. Supplier defaults to `master` because the `c_7` mapping was only ever a guess. Forwarder defaults to `analysis` because `c_2` is confirmed correct and carries the short names the team recognises, with the master name exposed separately as `forwarderAccount` for cross-checking. Whichever source you prefer, the other is the fallback when the preferred one is blank.

`/api/overview` returns a `fieldSources` block counting how many containers resolved through the master, so a join that silently returns nothing shows up as a number rather than as quietly missing names. The CSV export carries both `supplier`/`supplierAccount` and `forwarder`/`forwarderAccount` side by side, which is the quickest way to check the analysis columns against the master in Excel.

If the service account cannot read `supply_detail`, the query fails soft: a warning is logged and every name falls back to the analysis columns.

### Import team notes

`shpca_m_1` is the import team's running log, mapped as `notes`. It is populated on 227 of 256 containers, written newest entry first, one entry per line, by hand. It carries the things no structured column holds: why a vessel rolled, which forwarder won the job and why, who at the supplier is being chased, whether accounts have paid.

The rule for this field is display and search only. `parseNotes` in `src/transform.js` splits on newlines and stops there. Nothing reads a date, a name, a forwarder or a reference number out of the prose, because the text is inconsistent enough to make any of that a confident-looking guess. One live entry is literally self-labelled `07.28.25 GOODS READY DATE U.S FORMAT`, which is the whole argument in a single line. No chart may ever be fed from this field.

In the app, the Landing soon table and the Calendar detail both carry a Latest update column showing the newest line with a `+n` badge for the rest. Hovering a row puts the latest note in the tooltip; clicking expands the full log underneath. The search box matches note text as well as container, box and supplier, which matters because a handful of long numbers (six-digit and `201301…` series) appear inside the notes and are currently the only place a document reference is written down anywhere in the feed.

`notes` is deliberately excluded from `/api/shipments.csv`. The commentary is candid and names individuals at named suppliers, and a spreadsheet gets forwarded. Add `?notes=1` to include `notesCount`, `notesLatest` and `notes` (entries joined with ` | ` so a multi-line log stays on one CSV row). `/api/overview` returns `fieldSources.withNotes` so notes coverage is a number on the page rather than an assumption.

## First deploy to Cloud Run (manual, one time)

```
gcloud config set project project-aa7ee149-5e29-4eb4-8bc
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

gcloud iam service-accounts create containers-dashboard --display-name "Containers dashboard runtime"
gcloud projects add-iam-policy-binding project-aa7ee149-5e29-4eb4-8bc \
  --member "serviceAccount:containers-dashboard@project-aa7ee149-5e29-4eb4-8bc.iam.gserviceaccount.com" \
  --role roles/bigquery.jobUser
gcloud projects add-iam-policy-binding project-aa7ee149-5e29-4eb4-8bc \
  --member "serviceAccount:containers-dashboard@project-aa7ee149-5e29-4eb4-8bc.iam.gserviceaccount.com" \
  --role roles/bigquery.dataViewer

gcloud run deploy containers-dashboard \
  --source . \
  --region europe-west2 \
  --service-account containers-dashboard@project-aa7ee149-5e29-4eb4-8bc.iam.gserviceaccount.com \
  --set-env-vars DATA_MODE=bigquery,BQ_PROJECT=project-aa7ee149-5e29-4eb4-8bc,BQ_DATASET=fixmart_bi \
  --allow-unauthenticated
```

`--allow-unauthenticated` gives you a quick shareable URL for the first look. The page shows real freight spend, so lock it down before circulating it widely (next two sections). `roles/bigquery.dataViewer` at project level is the simple route; scope it to the `fixmart_bi` dataset in the console if you prefer least privilege.

## Push-to-deploy from GitHub

The workflow in `.github/workflows/deploy.yml` deploys `main` on every push, authenticating with Workload Identity Federation so no service account keys are stored in GitHub. One-time setup:

```
gcloud iam service-accounts create gh-deployer --display-name "GitHub Actions deployer"
for role in roles/run.admin roles/cloudbuild.builds.editor roles/artifactregistry.writer roles/storage.admin roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding project-aa7ee149-5e29-4eb4-8bc \
    --member "serviceAccount:gh-deployer@project-aa7ee149-5e29-4eb4-8bc.iam.gserviceaccount.com" --role "$role"
done

gcloud iam workload-identity-pools create github --location global --display-name "GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location global --workload-identity-pool github \
  --issuer-uri "https://token.actions.githubusercontent.com" \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition "assertion.repository == 'stuartlyonsfixmart/Containers'"

gcloud iam service-accounts add-iam-policy-binding \
  gh-deployer@project-aa7ee149-5e29-4eb4-8bc.iam.gserviceaccount.com \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/stuartlyonsfixmart/Containers"
```

Replace `PROJECT_NUMBER` with the numeric project number (`gcloud projects describe project-aa7ee149-5e29-4eb4-8bc --format 'value(projectNumber)'`). Then in the GitHub repo settings add secret `GCP_WIF_PROVIDER` (the provider resource name: `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github-provider`), secret `GCP_DEPLOY_SA` (`gh-deployer@project-aa7ee149-5e29-4eb4-8bc.iam.gserviceaccount.com`), and variable `GCP_PROJECT_ID` (`project-aa7ee149-5e29-4eb4-8bc`). Until those exist, the workflow fails fast with a pointer to this section, which is expected.

## Restrict access to the team

Recommended end state: remove public access and put Identity-Aware Proxy in front, allowing only company Google accounts.

```
gcloud run services update containers-dashboard --region europe-west2 --no-allow-unauthenticated
gcloud beta run services update containers-dashboard --region europe-west2 --iap
gcloud projects add-iam-policy-binding project-aa7ee149-5e29-4eb4-8bc \
  --member "domain:YOUR_WORKSPACE_DOMAIN" --role roles/iap.httpsResourceAccessor
```

IAP for Cloud Run needs the IAP API enabled and an OAuth consent screen configured once per project; follow the current GCP docs if the `--iap` flag prompts for either. Swap `domain:` for individual `user:` members if only a few people should see it.

## Costs and caching

The dataset is small (tens of containers), but every warehouse read scans `JSON_STAGE` because the views dedupe with `ROW_NUMBER()` at query time. The 10-minute server cache keeps that to at most ~6 scans an hour across the whole team. If `JSON_STAGE` grows large, materialise the views or partition the stage table by `uploaded_at`; the app needs no changes either way.

## Repo notes

- This repo is currently public and the README plus SQL reference the GCP project ID. Nothing here is a credential, but flipping the repo to private is sensible for a business tool.
- `/sql` is the reference copy of the warehouse views, kept verbatim; the app can run from them directly (`BQ_SOURCE=inline`) if the saved views are ever renamed.
- No `package-lock.json` is committed yet. Builds work without it; for pinned dependency versions, run `npm install` locally once and commit the generated lockfile.
