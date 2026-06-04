# 真实 vLLM Ascend 两阶段性能门禁落地方案

> 本文描述把已验证的 mock demo 落地到真实 `vllm-hust` / `vllm-hust-benchmark` 仓库的实施方案。当前生产路线是**集成现有 leaderboard workflow**，不是新建独立 gate workflow。

**目标：** 在真实 Ascend self-hosted runner 上为 PR 提供两阶段性能门禁，阻止性能退化 PR 合并；`main` 只发布或存储已合并提交的 PASS baseline / accepted result。

**当前主线：**

- `vllm-hust` 负责 GitHub Actions workflow、目标仓 checkout、Stage 1/2 拓扑、baseline fetch/store、PR comment、artifact 上传。
- `vllm-hust-benchmark` 负责 same-spec、`run_leaderboard.json`、`perfgate compare/compare2`、指标解析和 markdown report。
- 主数据接口是 `run_leaderboard.json`，不是独立 `.gate-results/*.json` schema。
- 主门禁指标是 `metrics.throughput_tps`、`metrics.ttft_ms`、`metrics.tbt_ms`，并要求 `same_spec.spec_id` / `same_spec.resolved_spec_hash` 与 gate spec 匹配。

---

## 当前 Demo 已验证的契约

真实实现必须保持 demo 已证明的产品行为：

- PASS PR 显示绿色 checks，可以合并。
- Stage 1 FAIL PR 在 rebase 前失败：`B1` 相对 `M1` 已经退化。
- Stage 2 FAIL PR 可以相对 `M1` 通过，但 rebase 到 `M2` 后失败。
- 请求失败或非可比 artifact 会阻止 PR。
- 失败 PR 的 artifacts 只在 Actions/Checks 里可见，不会成为官方 accepted result。
- `main` push 才能写入 baseline 或发布合并结果。

## 生产拓扑

两阶段门禁仍沿用 demo 拓扑：

1. `M1`：PR fork point / branch divergence baseline。
2. `B1`：PR head。
3. Stage 1：比较 `B1` vs `M1`，证明 PR 自身没有引入退化。
4. 如果 Stage 1 在 `enforce` 模式下 FAIL，则跳过 Stage 2 benchmark，但 final compare/report 仍必须运行并输出 `Stage 2: NOT RUN`。
5. `M2`：当前最新 `main`。
6. `B1'`：把 `B1` 在 CI 本地 rebase 到 `M2` 后得到的临时提交，不 force-push 用户分支。
7. Stage 2：比较 `B1'` vs `M2`，证明 PR 在最新 main 上仍不退化。
8. Final compare：统一生成 markdown report、PR comment、job exit code。

Stage 2 只有在 `fork_point == M2` 时可以标记为 `SKIPPED`；Stage 1 FAIL、rebase conflict、安装失败、Ascend runtime 异常、artifact 缺失等都不能伪装成 skipped，应显示为 `FAIL` 或 `NOT RUN` 并 fail-closed。

## 与现有 workflow 的集成方式

不要新建 `.github/workflows/ascend-two-stage-gate.yml`。应继续扩展现有：

- `.github/workflows/ascend-benchmark-leaderboard.yml`
- `.github/workflows/scripts/run_ascend_benchmark_ci.sh`
- `.github/workflows/scripts/perfgate_fetch_baseline.sh`
- `.github/workflows/scripts/perfgate_stage1_compare.sh`
- `.github/workflows/scripts/perfgate_stage2_rebase_and_benchmark.sh`
- `.github/workflows/scripts/perfgate_compare.sh`
- `.github/workflows/scripts/perfgate_store_baseline.sh`

PR workflow 只做 gate、artifact、comment。`push: main` 路径负责生成并写入 baseline。`workflow_dispatch` 可用于手动 benchmark / report，默认不写 baseline，除非后续明确新增受保护输入并限制权限。

## 指标与 artifact 契约

主 artifact：

```text
.benchmarks/ci/<run_id>/submissions/<run_id>/run_leaderboard.json
```

`perfgate` 必须从 `run_leaderboard.json` 读取并验证：

- `metrics.throughput_tps`：越高越好。
- `metrics.ttft_ms`：越低越好。
- `metrics.tbt_ms`：越低越好。
- `same_spec.spec_id`：必须等于 gate spec，例如 `perfgate-ascend-qwen25-05b-910b3`。
- `same_spec.resolved_spec_hash`：必须存在且 current/baseline 一致。

旧草案中的独立 schema，例如 `request_throughput`、`output_throughput`、`mean_ttft_ms`、`failed`，只能作为 raw summary 或兼容展示字段，不作为两阶段 perfgate 的主判定接口。

## 默认 smoke 配置

PR 门禁默认使用小模型和短 benchmark，避免占用 Ascend runner 太久：

```yaml
MODEL_NAME: Qwen/Qwen2.5-0.5B-Instruct
MODEL_PARAMETERS: 0.5B
MODEL_PRECISION: BF16
DTYPE: bfloat16
MAX_MODEL_LEN: "256"
MAX_NUM_SEQS: "1"
BENCH_NUM_PROMPTS: "8"
BENCH_RANDOM_INPUT_LEN: "64"
BENCH_RANDOM_OUTPUT_LEN: "16"
BENCH_MAX_CONCURRENCY: "4"
```

更大模型 benchmark 保留给 nightly、leaderboard、或手动 `workflow_dispatch`。

## 门禁策略

初期可以先用严格比较并保持 `PERFGATE_MODE=report` 收集 runner 抖动数据：

- throughput：candidate >= baseline。
- TTFT：candidate <= baseline。
- TBT：candidate <= baseline。

切换到 `enforce` 前，建议支持 ratio 阈值以降低 self-hosted runner 抖动误杀：

- `PERFGATE_THROUGHPUT_TPS_MIN_RATIO`，例如 `0.97`。
- `PERFGATE_TTFT_MS_MAX_RATIO`，例如 `1.05`。
- `PERFGATE_TBT_MS_MAX_RATIO`，例如 `1.05`。

如果短期仍坚持零容差，应在 PR report 中明确当前策略是严格比较，而不是缺少 `tbt_ms` 阈值。

## Baseline Store 流程

baseline 分支：`benchmark-baselines`。

推荐结构：

```text
benchmark-baselines
├── baselines/<commit>/run_leaderboard.json
├── latest-main.json
└── latest-main-pointer.json
```

### PR 读取

- PR 只读 baseline，不 push baseline。
- Stage 1 默认读取 `baselines/<fork_point>/run_leaderboard.json`。
- Stage 2 读取 `baselines/<M2>/run_leaderboard.json`。
- fork-point baseline 默认 fail-closed；如允许 fallback 到 `latest-main`，必须由 `PERFGATE_ALLOW_BASELINE_FALLBACK` 显式控制，并在 report/comment 中显示 baseline source。
- Stage 2 的 M2 baseline source 使用独立 env，例如 `PERFGATE_STAGE2_M2_BASELINE_SOURCE`，不要覆盖 Stage 1 baseline env。

### main 写入

- 只有 `push` 到 `refs/heads/main` 后可以写 `benchmark-baselines`。
- baseline store 必须先校验 `run_leaderboard.json`：JSON 可解析、`metrics` 完整、`throughput_tps/ttft_ms/tbt_ms` 是 finite number、same-spec 与 gate spec 匹配。
- baseline push 权限必须在代码侧闭环，不能只靠文档假设。
- 推荐把 baseline store 拆成独立 job：benchmark job 只需要 `contents: read`，baseline store job 使用 `needs: ascend-benchmark`、`permissions.contents: write`、`actions: read`，下载 benchmark artifact 后用 `GITHUB_TOKEN` push `benchmark-baselines`。
- 如果使用 SSH/PAT 代替 `GITHUB_TOKEN`，必须使用单独写权限 secret，且不能在日志打印带 token 的 remote URL。

## Fork PR 策略

不要在带 secrets 或硬件权限的 Ascend runner 上执行不可信 fork PR 代码，也不要依赖 skipped job 语义作为安全边界。

推荐策略：

1. same-repo PR：运行完整 Ascend benchmark gate。
2. fork PR：不运行 trusted hardware gate；必须由维护者把改动转成同仓可信分支后重跑，或配置一个单独 required blocker check 明确提示不可直接合并。
3. branch protection / ruleset 中 required check 名称应使用实际 workflow/job 名称，不写死旧独立 workflow 名称。

## vLLM server 安全与生命周期

- 默认不要在 trusted runner 示例中加入 `--trust-remote-code`。
- 如果确实需要 `--trust-remote-code`，必须限定 allowlisted model、pinned revision 或预热 cache，并把模型供应链风险与 PR 代码信任边界分开说明。
- ready check 必须在 timeout 后显式失败，不能循环结束后继续执行。
- cleanup 应尽量处理进程组、子进程和端口残留。
- 失败时上传 server log、benchmark log、raw artifact、perfgate report。

ready check 示例：

```bash
ready=0
for i in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:${ASCEND_GATE_PORT:-8000}/v1/models" >/dev/null; then
    ready=1
    break
  fi
  sleep 5
done
if [[ "$ready" != "1" ]]; then
  echo "vLLM server did not become ready before timeout" >&2
  exit 1
fi
```

cleanup 示例：

```bash
cleanup() {
  if [[ -n "${VLLM_PID:-}" ]]; then
    kill -- -"$VLLM_PID" 2>/dev/null || kill "$VLLM_PID" 2>/dev/null || true
    wait "$VLLM_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT
```

## 实施任务

### 任务 1：确认 small same-spec 与 benchmark artifact

- 在 `vllm-hust-benchmark` 中维护 gate spec，例如 `docs/official-baselines/perfgate-ascend-qwen25-05b-910b3.json`。
- 确保 `run_leaderboard.json` 输出包含 gate 需要的 `metrics` 与 `same_spec` 字段。
- 用 synthetic pass/fail fixture 覆盖：PASS、throughput fail、TTFT fail、TBT fail、missing metric、spec mismatch、hash mismatch。

### 任务 2：集成现有 leaderboard workflow

- 修改 `.github/workflows/ascend-benchmark-leaderboard.yml`，不要新增 parallel gate workflow。
- same-repo PR 跑 Stage 1/2 gate 并评论。
- fork PR 走显式安全提示/阻塞策略。
- `push: main` 跑 benchmark 后写 baseline。
- `workflow_dispatch` 默认只跑 benchmark/report，不写 baseline。

### 任务 3：Stage 1 / Stage 2 控制流

- Stage 1 compare 用 enforce 语义得出 `pass|fail|unknown`，但脚本自身始终 exit 0，让 final compare/report 总能运行。
- `PERFGATE_MODE=enforce` 且 Stage 1 FAIL 时跳过 Stage 2 benchmark，节省硬件。
- final compare 必须处理：normal Stage 2、`SKIPPED`、rebase conflict、`NOT RUN`。
- `NOT RUN` 在 enforce 下 fail-closed。

### 任务 4：Baseline fetch/store

- PR read-only fetch baseline。
- main-only store baseline。
- baseline 缺失策略显式化。
- baseline store 使用独立 write-permission job 或受控写权限 secret。
- store 前校验 artifact 与 gate identity。

### 任务 5：PR comment 与 artifacts

- PR comment 显示 Stage 1/2 状态、baseline source、same-spec ID/hash、关键指标、失败原因。
- 即使 benchmark/gate 失败，也上传 raw logs、`run_leaderboard.json`、perfgate markdown report、rebase conflict details。

### 任务 6：Branch protection / required checks

- 使用实际 workflow/job 名作为 required check。
- 明确 fork PR 不可通过 skipped hardware job 放行。
- 在 `PERFGATE_MODE=report` 期间不要把性能 check 设为强制阻塞；切到 `enforce` 后再启用 required check。

### 任务 7：生产验证矩阵

| 场景 | 预期 |
|---|---|
| PASS smoke PR | Stage 1 PASS，Stage 2 PASS，job green |
| Stage 1 regression | Stage 1 FAIL，Stage 2 NOT RUN，job red |
| Stage 2 regression | Stage 1 PASS，Stage 2 FAIL，job red |
| Request/runtime failure | report 可见，job red |
| Rebase conflict | Stage 2 rebase conflict，job red |
| Missing baseline | fail-closed 或显式 fallback，report 显示 source |
| Fork PR | 不跑 trusted hardware，不能静默满足合并门禁 |
| main push | 生成并 push `benchmark-baselines` |

## 验收标准

- PR report 清楚显示 M1/B1/M2/B1' commits、baseline source、same-spec、Stage 1/2 结果。
- Stage 1 FAIL 不会吞掉 final report。
- Stage 2 未运行不会被误标为 SKIPPED，除非 `fork_point == M2`。
- main baseline store 可以真实 push 到 `benchmark-baselines`，权限模型在 workflow 代码中闭环。
- `run_leaderboard.json` 是唯一主判定 artifact；不存在并行独立 gate schema。
- fork PR 不会因为 skipped hardware job 被静默放行。
- trusted runner 示例默认不启用 `--trust-remote-code`。

## 编码前需要确认的输入

1. self-hosted runner labels。
2. Ascend runtime / vLLM 启动命令和必需环境变量。
3. 模型 cache 位置和下载策略。
4. 是否允许 baseline fallback，以及 fallback 在 `enforce` 模式下是否仍 fail-closed。
5. branch protection required check 的实际 workflow/job 名称。
6. baseline store 使用 `GITHUB_TOKEN contents: write` 独立 job，还是受控 SSH/PAT secret。
