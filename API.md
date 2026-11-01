# Experiment results API · v1

Base: `https://johnnylee-master250.github.io/experiment-results/api/v1/`

- `index.json`: schema version, source update timestamp, publication timestamp, refresh interval, dataset endpoints and source metadata.
- `index.json.running_runs`: current running groups only, with `dataset`, `id`, `model`, `effort`, `method`, `reported_attempts`, `budget`, `phase`, and `source_captured_at`. Counts are saved workflow counters, including records still awaiting review, not independent completion counts. Paused, blocked and completed groups are excluded.
- Links of the form `?dataset=MQA&run=sol6-mqa-b2#curves` open the dataset and enable/highlight that curve. Ordinary clicks in the running bar preserve other selected curves in the current dataset.
- `{dataset}.json`: `cuda-l2`, `sonny`, `gqa`, `fa3`, `gdn`, `based`, `mega`, `mqa`, `topk`.
- All times are ISO 8601 with timezone. The page displays Asia/Singapore.
- `index.json.task_events`: newest-first lifecycle records (`id`, `at`, `kind`, `runs`, `reason`, `time_basis`). Types are `started`, `paused`, `resumed`, `completed`; each run has `id`, `dataset`, `model`, `effort`, and `method`. The initial scope is the six current Sol6 / medium GQA and MQA B1/B2/B3 groups. Older campaigns are not backfilled. Stable event IDs prevent duplicates on refresh.
- Event timestamps come from retained launch, pause, release and independent-completion records. `time_basis: recorded` is an event/evidence timestamp; `observed` explicitly labels the time completion was first observed if no precise closure timestamp was retained. Recorded completion requires both a complete workflow and independent acceptance; a saved 30th round alone is insufficient. Reasons are sanitized summaries, not raw logs.
- Each model block has a three-state group visibility checkbox: all, mixed, or off. It affects available performance curves for that model in the current dataset; individual controls and curve links stay synchronized. Empty groups are disabled.
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

## KL Apply API

`index.json.categories` selects `bv` (B0–B3 / V0) or `kl`. `index.json.kl.url` points to `api/v1/kl.json` relative to this API directory. KL has its own grain: run → Apply (1–10) → candidate evaluation, rather than B/V valid rounds. `?category=kl&dataset=GQA&apply=2` selects the dataset and internal Apply detail.

Each run includes model/effort, budget, per-Apply timeout, evaluation timeout, actual workspace_path (null until created), start time, independent completion time, status and applies. Each Apply records timing, status, candidate evaluations, infrastructure error count, reuse snapshot count and last delivered validation. Candidate sequence is the saved evaluation-event order; it is not a B/V round. Reuse is not a new device evaluation. Missing values stay null, never zero. Delivery requires completed native Apply and its last version; it does not choose an earlier fastest version. Acceptance requires every native validation gate, a bound original Job without job-level error, and a valid positive latency. Independent completion requires separate operation-bound audit evidence.

KL latency uses the median of three group medians (10 warmups, 50 samples per group), distinct from the existing B/V measurement contract. These values are not merged into B/V curves. `kl.json.task_events` records actual task start, executed pause/recovery and independent completion; preparation creates no fictitious start. `index.json.kl.running_runs` lists only currently running KL tasks. Source capture time and publication time remain separate.
