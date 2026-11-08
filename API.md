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

## Aligned KL（2026-11-02）
分类顺序为 B0–B3 / V0、Aligned KL、KL；KL 页内复用相同 Aligned 对比组件。固定 update_web.py --publish 自动生成 kl.json 每组的 aligned 字段（schema_version/count/excluded_count/points），无需手工展开或改前端。按原 Apply 顺序、内部记录时间排列；没有时间时保留原记录序号，不使用文件 mtime 伪造。每个非复用 passed/failed 评测占一个累计 rN，基础设施异常/未知归因保留在展开表但不计轮次；同 Job 复用不增加。失败不填0，最优曲线只使用通过完整评测的计时。Apply 交付和正式独立验收不混作新候选。
index.json.kl.running_runs 新增 current_apply、internal_round；运行栏显示当前 Apply/10 · rN，rN 与展开曲线一致。KL 中位数与 B/V 均值、环境/effort/预算差异在视图中标明；B0不画性能曲线。这是评测序号对齐，不宣称等时间或等预算。
定点验证：node qa/check_aligned_kl.mjs；原 check_kl_reference.mjs、check_kl_accounting.py 和 validate_data.py 保持。常规不运行前端回归。


## KL 横轴与按轮次匹配参考线（2026-11-03）

KL Apply 图的完成刻度显示 `2(r16 133min)`：r 来自同一 `aligned.points` 有效评测计数，分钟为截至该 Apply 的 `elapsed_seconds` 总和四舍五入，沿用已对账扣除暂停的累计用时，绝不以结束减开始的墙钟时间代替、也不重复累加恢复 segments。未完成 Apply 不显示完成总时间，缺失时间标未知。内部候选刻度显示 `序号(rN)`，不显示时间；复用及基础设施/未知归因不增加 r。

KL 两张速度图各新增两个可独立开关的 V0 Astra/high 参考线：以整个 KL 实验最新 `aligned.count=N` 计算，取 V0 搜索记录 `round <= min(N,30)` 与 `round <= min(floor(2*N/3),30)` 的有效通过均值最小值，不看截止轮之后的结果，不混正式结果。例如 N=24 对应 r24/r16，N=70 对应 r30/r30；无该范围内有效记录则不画线。选择旧 Apply 不改变最新轮次基准。原全程最快参考开关保留。KL 中位数与 V0 均值、环境与预算差异仍明确说明。

B/V、Aligned KL 及 KL 内的对比图默认仅开启 Astra；Sol 与 DeepSeek 默认关闭，用户可手动切换。运行栏/任务记录的指定曲线链接仍会主动开启目标曲线。数据刷新保留当前选择；固定更新仍只用 `update_web.py --publish`，标签与参考线自动从数值接口计算，不新增采集、实验任务或人工维护步骤。

## Cost coordinates

The chart query parameter `axis` accepts `round`, `time`, or `tokens`. Time and token coordinates cover the 15 completed Sol B/V runs and nine KL runs. Each eligible record carries an `axes` object. B/V formal measurements carry `formal_axes`. Unsupported series have no cost coordinates.

`elapsed_s` is wall time from the workspace clock origin to the original evaluation finish or Apply delivery. It includes pauses and queue waits. KL's per-Apply active budget remains separately available in `elapsed_seconds`. All cumulative values use the whole task's origin even inside a selected Apply.

`tokens` counts reported input plus output up to that finish time. Sol includes the original MAIN and its FULL reviewers, using timestamped cumulative counters from each distinct thread once. KL counts finished responses in the original request journals once, including resumed generations. Cached input and reasoning are subsets. KL `missing_responses` is the cumulative number of finished requests without totals. `disputed` remains true from the start of an Apply whose journal and final native counters disagree. Either condition makes `tokens_complete` false. In token mode these points use hollow triangles; the tooltip provides the gap count and reconciliation status. Formal results are marked separately and B0 uses correctness.


## Versioned B/V cohorts

The 2026-11-08 cohort is separate from historical B/V records. Each new run carries `edition` (`v0-r3` or `bn-r2`), `method_version` (`V0-r3`, `B0-r2` … `B3-r2`), an independent ID and source ID. The base `method` remains V0/B0/B1/B2/B3 for measurement semantics. `budget` is 50; B0 is correctness-only. Root links use `?category=bv&edition=v0-r3&dataset=FA3` or `edition=bn-r2`; omitted edition selects historical records. Aligned KL and matched Astra V0 references retain historical B/V.

`index.json.bv_revisions.queue` is the authoritative task order. It contains nine V0-r3 Astra/high tasks, 27 B0-r2 tasks and 81 B1–B3-r2 tasks. `queue_position` is the original task position, not a renumbered visible rank. Card1 allows at most four active model sessions; awaiting admission is `waiting`, unresolved faults are `blocked`, and pending independent acceptance is `awaiting_audit`. `index.json.running_runs` includes only running B/V tasks; KL remains in `index.json.kl.running_runs`. `index.json.waiting_cards` / `waiting_runs` combine both campaigns in per-card order; the older KL-scoped fields retain only KL tasks.

New B/V `axes` values come only from resource_usage evaluation checkpoints. `elapsed_s` uses the recorded workspace wall-clock origin; `time_basis` is `resource_usage_recorded_wall` and `pause_queue_adjusted` is false. No queue/pause subtraction is inferred. `tokens` is reported input plus output; unknown or inconsistent totals are null, not zero. `tokens_complete`, `time_complete`, `recording_issue` and `recorded_at` expose quality. Unknown coordinates are not plotted at zero. A pending or missing completion record does not produce formal results or a completion timestamp.
