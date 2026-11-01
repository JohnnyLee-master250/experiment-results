# Experiment results API · v1

Base: `https://johnnylee-master250.github.io/experiment-results/api/v1/`

- `index.json`: schema version, source update timestamp, publication timestamp, refresh interval, dataset endpoints and source metadata.
- `index.json.running_runs`: current running groups only, with `dataset`, `id`, `model`, `effort`, `method`, `reported_attempts`, `budget`, `phase`, and `source_captured_at`. Counts are saved workflow counters, including records still awaiting review, not independent completion counts. Paused, blocked and completed groups are excluded.
- Links of the form `?dataset=MQA&run=sol6-mqa-b2#curves` open the dataset and enable/highlight that curve. Ordinary clicks in the running bar preserve other selected curves in the current dataset.
- `{dataset}.json`: `cuda-l2`, `sonny`, `gqa`, `fa3`, `gdn`, `based`, `mega`, `mqa`, `topk`.
- All times are ISO 8601 with timezone. The page displays Asia/Singapore.
- Latency units are milliseconds. Numeric values retain original sample precision.

## Run

Stable fields: `id`, `model`, `model_id`, `effort`, `method`, `status`, `reported_attempts`, `budget`, `started_at`, `finished_at`, `verified_at`, `source_id`, `source_captured_at`, `independently_complete`, `search`, `formal`, `formal_pytorch`, `formal_b0`.

Statuses: `not_run`, `no_data`, `running`, `paused`, `blocked`, `complete`, `ended`.
`no_data` means the historical inventory has no retained record; it does not assert that an experiment never ran. `finished_at` is recorded experiment closure, not the date the webpage was generated. Unfinished groups retain null.

`workspace_path` is the experiment workspace directory from retained evidence, published at the user's explicit request. It is a server filesystem path, not a browser download URL or a claim of current access to historical folders. Missing paths are null. Only this exact field permits approved workspace directory names; logs, credentials, kernel implementations and operator evidence remain excluded.

DeepSeek high and max are separate series. Historical and current execution environments are identified separately. Effort and environment differences preclude attributing cross-run differences solely to model choice.

## Search point

`round` preserves the saved attempt number. `status` is passed, failed, or excluded. `role: b0` on B1 round 1 marks intake. `review` distinguishes saved analysis, pending, not required, and historical records; saved analysis alone is not independent campaign completion.

`timing`, `pytorch`, and `b0` contain `mean_ms`, `p10_ms`, `p90_ms`, `sample_count`, `samples_ms` when valid. Missing timing is null, never zero. Infrastructure-interrupted records remain visible with excluded status and no plotted timing. `reported_attempts` is the saved workflow counter; it is not the count of successful timing measurements. `excluded_records` exposes non-timing infrastructure records.

`search_best_ms` excludes B1 intake. The best-so-far plot can include the intake starting point, clearly identified in the detail table. `formal` is a separate final measurement and is never synthesized from the search best. B0 is correctness-only and has no performance curve.

## Updates

The browser checks `index.json` every 60 seconds and refreshes the selected dataset only when `updated_at` changes. Data advances when a new validated source snapshot is published, not on each browser poll. Each release atomically commits all dataset files and the manifest, followed by the existing GitHub Pages deployment.

`update_cadence_minutes` comes from the active monitoring schedule. `next_update_estimated_at` is the source snapshot timestamp plus that interval, an estimate rather than a guaranteed measurement or deployment time. The page shows “等待更新” after the estimate passes without a new snapshot. Both fields are null when that schedule is inactive or unavailable.

Consumers should load the manifest, then the chosen endpoint with `?v=<updated_at>`, keep last-known-good data on errors, and show its timestamp. This is a read-only public API. No credentials or experiment source code are included. The publishing adapter is operated outside the experimental MAIN workspaces.
