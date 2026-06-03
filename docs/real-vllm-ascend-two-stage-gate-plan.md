# 真实 vLLM Ascend 两阶段性能门禁落地方案

> **给 Hermes：** 如需按本文实施，使用 subagent-driven-development skill 按任务逐项执行。

**目标：** 将当前已经跑通的 mock demo 迁移为真实 vLLM Ascend PR 性能门禁：阻止性能退化 PR 合并，并且只发布已合并 PASS 结果。

**架构：** 保留 demo 已验证的两阶段拓扑：先 benchmark `M1` 与 `B1`，再把 `B1` 本地 rebase 到最新 `main` 的 `M2` 上生成 `B1'`，然后 benchmark `M2` 与 `B1'`。PR workflow 只负责门禁与 artifact 上传；main workflow 只负责发布已合并 accepted results。需要替换的 demo 组件只有 mock benchmark reader。

**技术栈：** GitHub Actions、自托管 Ascend runner、Bash、Python、vLLM `vllm bench serve`、JSON artifacts、GitHub Pages 或现有 leaderboard 发布链路。

---

## 当前 Demo 已验证的契约

当前 demo 已经证明这些产品行为：

- PASS PR 显示绿色 checks，可以合并。
- Stage 1 FAIL PR 在 rebase 前失败：`B1` 相对 `M1` 已经退化。
- Stage 2 FAIL PR 可以相对 `M1` 通过，但 rebase 到 `M2` 后失败。
- 请求失败数不为 0（`failed > 0`）会阻止 PR。
- GitHub Pages 只读取已合并 accepted records；失败 PR 的 artifacts 只在 Actions/Checks 里可见。

真实实现应该保持这个契约，只把指标来源从 `benchmark-metrics.json` 换成真实 vLLM benchmark 输出。

## 责任边界

| 层级 | 负责 | 禁止 |
|---|---|---|
| PR workflow | checkout、commit 拓扑、runner 选择、artifact 上传 | 把失败 PR 发布为 accepted result |
| benchmark runner 脚本 | 启动/检查服务、运行 benchmark、归一化 metrics JSON | 决定 PR 是否合并或是否公开发布 |
| compare 脚本 | 应用阈值策略、输出 PASS/FAIL summary | 隐藏失败指标或静默忽略缺失字段 |
| main 发布 workflow | `main` push 后发布 merged PASS result | 重新执行不可信 PR 代码，或读取失败 PR artifacts 当正式结果 |
| 前端/leaderboard | 渲染 accepted records 和 rejected examples 说明 | 把 PR preview artifacts 当成官方 accepted records |

## 生产指标 Schema

将原始 vLLM 输出归一化为稳定的 gate JSON：

```json
{
  "label": "B1",
  "sha": "<commit sha>",
  "model": "Qwen/Qwen2.5-7B-Instruct",
  "scenario": "random-online-smoke",
  "hardware": "Ascend 910B3",
  "request_throughput": 0.0,
  "output_throughput": 0.0,
  "mean_ttft_ms": 0.0,
  "failed": 0,
  "completed": 0,
  "raw_result_path": ".gate-results/raw/B1.json"
}
```

现有 compare 脚本必须读取这些字段：

- `request_throughput`
- `output_throughput`
- `mean_ttft_ms`
- `failed`

可选字段（`completed`、p50/p95 latency、tokens/sec 变体等）先保留在 raw artifacts 中，后续需要时再加到前端。

## 推荐默认门禁策略

Ascend 自托管 runner 可能存在性能抖动，初始阈值建议保守：

| 指标 | 初始规则 | 原因 |
|---|---|---|
| `output_throughput` | candidate >= baseline * `0.97` | 允许小幅抖动，但阻止明显吞吐下降。 |
| `request_throughput` | candidate >= baseline * `0.97` | 捕获 serving 层吞吐退化。 |
| `mean_ttft_ms` | candidate <= baseline * `1.05` | 允许小幅延迟抖动。 |
| `failed` | candidate <= `0` | 任意失败请求都会让 smoke 结果不可信。 |

这些值应该支持通过 repo variables 或 workflow env 配置：

- `ASCEND_GATE_OUTPUT_TPS_MIN_RATIO`
- `ASCEND_GATE_REQUEST_TPS_MIN_RATIO`
- `ASCEND_GATE_MEAN_TTFT_MAX_RATIO`
- `ASCEND_GATE_FAILED_MAX`

## Runner 与安全要求

- 使用可信自托管 runner label，例如 `[self-hosted, linux, ascend]`。
- 不要在带 secrets/硬件权限的 Ascend runner 上执行不可信 fork PR 代码。
- 如果仓库是 public，需要加 fork guard：

```yaml
if: >-
  github.event_name != 'pull_request' ||
  github.event.pull_request.head.repo.full_name == github.repository
```

- 避免用 `pull_request_target` 执行 benchmark 代码。
- 使用 `concurrency`，避免多个 PR 同时抢一台 Ascend 机器。
- 每次 benchmark 后清理 vLLM server 进程。
- 即使失败，也要上传 raw logs 和 metrics artifacts。

---

## 任务 1：新增生产 benchmark runner 脚本

**目标：** 用生产 runner 替换 demo 的 mock metric reader，能够执行 `vllm bench serve` 并写出归一化 gate JSON。

**文件：**

- 新增：`scripts/run_vllm_ascend_benchmark.py`
- 保留：`scripts/read_mock_benchmark.py`，仅作为 demo/本地 fallback

**步骤 1：创建 CLI 骨架**

脚本应支持：

```bash
python3 scripts/run_vllm_ascend_benchmark.py \
  --label B1 \
  --sha "$B1_SHA" \
  --output .gate-results/b1.json \
  --raw-output .gate-results/raw/b1-vllm.json \
  --model "$ASCEND_GATE_MODEL" \
  --host 127.0.0.1 \
  --port 8000
```

**步骤 2：增加环境变量默认值**

先用保守 smoke 配置：

```text
ASCEND_GATE_MODEL=Qwen/Qwen2.5-7B-Instruct
ASCEND_GATE_SCENARIO=random-online-smoke
ASCEND_GATE_NUM_PROMPTS=32
ASCEND_GATE_RANDOM_INPUT_LEN=128
ASCEND_GATE_RANDOM_OUTPUT_LEN=32
ASCEND_GATE_MAX_CONCURRENCY=4
ASCEND_GATE_REQUEST_RATE=inf
ASCEND_GATE_TIMEOUT_SECONDS=900
```

**步骤 3：运行 benchmark 命令**

如果真实项目已有标准 serving/benchmark 命令，优先复用。否则使用这个形态：

```bash
vllm bench serve \
  --backend openai \
  --base-url "http://127.0.0.1:8000" \
  --model "$ASCEND_GATE_MODEL" \
  --dataset-name random \
  --num-prompts "$ASCEND_GATE_NUM_PROMPTS" \
  --random-input-len "$ASCEND_GATE_RANDOM_INPUT_LEN" \
  --random-output-len "$ASCEND_GATE_RANDOM_OUTPUT_LEN" \
  --max-concurrency "$ASCEND_GATE_MAX_CONCURRENCY" \
  --save-result \
  --result-filename "$RAW_OUTPUT"
```

**步骤 4：归一化 raw JSON**

把 vLLM 输出字段映射到生产 metric schema。如果目标 vLLM 版本字段名不同，只在这里适配，不要污染 `compare_gate.py`。

常见映射：

- `request_throughput` -> `request_throughput`
- `output_throughput` -> `output_throughput`
- `mean_ttft_ms` 或 `mean_ttft` -> `mean_ttft_ms`
- failures/errors -> `failed`

**步骤 5：用 fixture 本地验证**

上硬件前先用保存的 raw JSON fixture 验证：

```bash
python3 scripts/run_vllm_ascend_benchmark.py \
  --label fixture \
  --sha test \
  --output /tmp/gate-fixture.json \
  --raw-output tests/fixtures/vllm-bench-serve.json \
  --fixture-only
python3 -m json.tool /tmp/gate-fixture.json
```

预期：归一化 JSON 包含所有必需字段。

**步骤 6：提交**

```bash
git add scripts/run_vllm_ascend_benchmark.py tests/fixtures/vllm-bench-serve.json
git commit -m "feat: add vllm ascend benchmark normalizer"
```

---

## 任务 2：参数化门禁阈值

**目标：** 让 `scripts/compare_gate.py` 从环境变量读取阈值，同时保留当前默认值。

**文件：**

- 修改：`scripts/compare_gate.py`

**步骤 1：增加 env 解析函数**

```python
import os

def env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    return default if value in (None, "") else float(value)

def env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    return default if value in (None, "") else int(value)
```

**步骤 2：从 env 构造 policy**

```python
DEFAULT_POLICY = {
    "request_throughput_min_ratio": env_float("ASCEND_GATE_REQUEST_TPS_MIN_RATIO", 0.97),
    "output_throughput_min_ratio": env_float("ASCEND_GATE_OUTPUT_TPS_MIN_RATIO", 0.97),
    "mean_ttft_max_ratio": env_float("ASCEND_GATE_MEAN_TTFT_MAX_RATIO", 1.05),
    "failed_max": env_int("ASCEND_GATE_FAILED_MAX", 0),
}
```

**步骤 3：测试默认值与覆盖值**

```bash
python3 scripts/compare_gate.py --help
ASCEND_GATE_OUTPUT_TPS_MIN_RATIO=0.99 python3 scripts/compare_gate.py ...
```

预期：输出 JSON 中 `policy.output_throughput_min_ratio` 反映 override 值。

**步骤 4：提交**

```bash
git add scripts/compare_gate.py
git commit -m "feat: parameterize benchmark gate thresholds"
```

---

## 任务 3：新增真实 Ascend PR Workflow

**目标：** 新增生产 workflow，在 Ascend self-hosted runner 上运行，并保留 demo 的两阶段门禁行为。

**文件：**

- 新增：`.github/workflows/ascend-two-stage-gate.yml`
- 参考或复制：`.github/workflows/two-stage-gate.yml`

**步骤 1：创建 workflow 触发与权限**

```yaml
name: Ascend two-stage benchmark gate

on:
  pull_request:
    types: [opened, synchronize, reopened]
  workflow_dispatch:

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: ascend-gate-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

**步骤 2：使用自托管 runner 与 fork guard**

```yaml
jobs:
  two-stage-gate:
    if: >-
      github.event_name != 'pull_request' ||
      github.event.pull_request.head.repo.full_name == github.repository
    runs-on: [self-hosted, linux, ascend]
```

**步骤 3：checkout 完整历史**

与 demo 保持一致：

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
    ref: ${{ github.event.pull_request.head.sha || github.sha }}
```

**步骤 4：运行生产 gate 脚本**

可以改造 `scripts/run_two_stage_gate.sh`，当 `ASCEND_GATE_MODE=real` 时选择生产 runner；也可以新增 `scripts/run_two_stage_gate_real.sh`。

推荐 env：

```yaml
- name: Run Ascend two-stage gate
  env:
    PR_BASE_REF: ${{ github.event.pull_request.base.ref || 'main' }}
    PR_HEAD_SHA: ${{ github.event.pull_request.head.sha || github.sha }}
    GATE_ROOT: ${{ github.workspace }}/.gate-results
    ASCEND_GATE_MODE: real
    ASCEND_GATE_MODEL: ${{ vars.ASCEND_GATE_MODEL || 'Qwen/Qwen2.5-7B-Instruct' }}
    ASCEND_GATE_OUTPUT_TPS_MIN_RATIO: ${{ vars.ASCEND_GATE_OUTPUT_TPS_MIN_RATIO || '0.97' }}
    ASCEND_GATE_REQUEST_TPS_MIN_RATIO: ${{ vars.ASCEND_GATE_REQUEST_TPS_MIN_RATIO || '0.97' }}
    ASCEND_GATE_MEAN_TTFT_MAX_RATIO: ${{ vars.ASCEND_GATE_MEAN_TTFT_MAX_RATIO || '1.05' }}
  run: bash scripts/run_two_stage_gate_real.sh
```

**步骤 5：上传 summary 与 artifacts**

保留现有 artifact 模式：

```yaml
- name: Publish gate summary
  if: always()
  run: |
    if [[ -f .gate-results/summary.md ]]; then
      cat .gate-results/summary.md >> "$GITHUB_STEP_SUMMARY"
    fi

- name: Upload gate artifacts
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: ascend-two-stage-gate-results
    path: .gate-results/
    include-hidden-files: true
    if-no-files-found: warn
```

**步骤 6：提交**

```bash
git add .github/workflows/ascend-two-stage-gate.yml scripts/run_two_stage_gate_real.sh
git commit -m "ci: add ascend two-stage benchmark gate workflow"
```

---

## 任务 4：增加 vLLM Server 生命周期管理

**目标：** 确保每个被 benchmark 的 commit 都能启动可用 vLLM server，并在结束后清理。

**文件：**

- 新增：`scripts/start_vllm_ascend_server.sh`
- 修改：`scripts/run_two_stage_gate_real.sh`

**步骤 1：每个 checked-out commit 启动 server**

如果 vLLM Ascend 需要额外 env，使用项目真实命令。示例形态：

```bash
VLLM_USE_MODELSCOPE=${VLLM_USE_MODELSCOPE:-False}
python3 -m vllm.entrypoints.openai.api_server \
  --model "$ASCEND_GATE_MODEL" \
  --host 127.0.0.1 \
  --port "${ASCEND_GATE_PORT:-8000}" \
  --trust-remote-code
```

**步骤 2：ready check**

轮询 `/v1/models`：

```bash
for i in $(seq 1 120); do
  curl -fsS "http://127.0.0.1:${ASCEND_GATE_PORT:-8000}/v1/models" && break
  sleep 5
done
```

超过 timeout 仍未 ready，则失败退出。

**步骤 3：cleanup trap**

```bash
cleanup() {
  if [[ -n "${VLLM_PID:-}" ]]; then
    kill "$VLLM_PID" || true
    wait "$VLLM_PID" || true
  fi
}
trap cleanup EXIT
```

**步骤 4：在 runner 上验证**

对一个已知 commit 手动触发 workflow。预期 artifacts：

- `.gate-results/m1.json`
- `.gate-results/b1.json`
- `.gate-results/m2.json`
- `.gate-results/b1-prime.json`
- `.gate-results/raw/` 下的原始 vLLM logs
- `summary.md`

**步骤 5：提交**

```bash
git add scripts/start_vllm_ascend_server.sh scripts/run_two_stage_gate_real.sh
git commit -m "ci: manage vllm server lifecycle for ascend gate"
```

---

## 任务 5：只发布已合并 Accepted Results

**目标：** 保证官方 leaderboard/Page 数据只包含 merged PASS results。

**文件：**

- 修改或新增：`.github/workflows/ascend-pages-publish.yml`
- 修改：`scripts/export_accepted_frontend.py` 或生产等价脚本

**步骤 1：只在 main 触发**

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:
```

**步骤 2：复用或重跑合并提交 metrics**

方案 A：main 上再跑一次短 benchmark 作为 accepted benchmark。

方案 B：如果生产仓库持久化了合并结果，则导出 merged commit 对应的已保存结果。

除非 benchmark 成本太高，建议先用方案 A：更简单，也避免信任过期 PR artifact。

**步骤 3：写 accepted record**

输出 schema 与 demo 前端保持兼容：

```json
{
  "schemaVersion": "ascend-merged-benchmark/v1",
  "records": [
    {
      "id": "merged-<sha>",
      "finalStatus": "PASS",
      "rebaseStatus": "merged",
      "source": { "branch": "main", "sha": "<sha>", "runUrl": "<actions run>" },
      "metrics": { "outputThroughput": 0, "requestThroughput": 0, "meanTtftMs": 0, "failed": 0 }
    }
  ]
}
```

**步骤 4：提交**

```bash
git add .github/workflows/ascend-pages-publish.yml scripts/export_accepted_frontend.py
git commit -m "ci: publish only merged ascend benchmark results"
```

---

## 任务 6：配置 Branch Protection / Required Checks

**目标：** 让 Ascend gate 成为强制门禁，而不只是信息提示。

**文件：**

- GitHub 仓库设置，不是代码文件。
- 可选文档：`docs/branch-protection.md`

**步骤 1：添加 required status check**

在 GitHub Settings -> Branches -> main protection 中：

- 开启 Require status checks to pass before merging。
- 添加 `Ascend two-stage benchmark gate / two-stage-gate`。
- 视情况开启 Require branches to be up to date。

**步骤 2：明确 admin bypass 策略**

文档中说明 runner 故障时维护者是否可以绕过 benchmark。

**步骤 3：提交文档**

```bash
git add docs/branch-protection.md
git commit -m "docs: document ascend gate branch protection"
```

---

## 任务 7：生产验证矩阵

**目标：** 在真实仓库里用真实 benchmark 复现 demo 证明链路。

**文件：**

- 新增：`docs/ascend-gate-verification.md`

**验证 PR：**

| 场景 | 预期 | 说明 |
|---|---|---|
| PASS smoke PR | 绿色 | 小的不退化改动，或阈值安全 fixture。 |
| Stage 1 regression | 红色 | 人为降低吞吐，或增加已知慢路径。 |
| Stage 2 regression | 红色 | PR 相对旧基线通过，但 latest main 提升后失败。 |
| Request failure | 红色 | 强制 benchmark 请求失败或错误 serving 配置。 |
| Rebase conflict | 红色 | 冲突改动确认 manual rebase 提示。 |

**命令/检查：**

```bash
bash -n scripts/*.sh
python3 -m py_compile scripts/*.py
python3 -m json.tool .gate-results/*.json
```

**预期证明：**

- 失败 PR 在 Pull requests 和 Actions 中可见。
- PASS PR 可以 merge。
- merge 后 main publish workflow 运行。
- 公开 leaderboard/Page 只包含 merged PASS records。

---

## 任务 8：运维 Runbook

**目标：** 给维护者一份简短排障指南。

**文件：**

- 新增：`docs/ascend-gate-runbook.md`

**包含：**

- Runner offline / busy。
- vLLM server 启动失败。
- 模型下载/cache miss。
- Hugging Face 或 ModelScope 网络问题。
- benchmark JSON 缺字段。
- rebase 冲突。
- Stage 1 fail 和 Stage 2 fail 如何解读。
- 如何 rerun failed jobs。
- 如何临时用 repo variables 放宽阈值。
- 如何查看 `.gate-results` artifacts。

---

## 实施顺序

1. 新增生产 benchmark normalizer，并用 fixture 测试。
2. 参数化门禁阈值。
3. 新增真实 self-hosted Ascend workflow。
4. 增加 server 生命周期管理与清理。
5. 新增 merged-only 发布 workflow。
6. 配置 required checks。
7. 跑生产验证矩阵。
8. 发布 runbook。

## 验收标准

- 真实 PR 能生成 `.gate-results/summary.md`，包含 M1/B1/M2/B1' commits 和指标表。
- Stage 1 失败会在 rebase 前失败。
- Stage 2 失败会显示 Stage 1 PASS、Stage 2 FAIL。
- 请求失败时，即使吞吐指标看起来正常，也会 FAIL。
- workflow 使用可信 self-hosted Ascend runner，不在带 secrets/硬件权限的 runner 上执行不可信 fork PR 代码。
- main 分支发布内容只包含 merged PASS records。
- branch protection 要求真实 gate check 通过后才能合并。

## 编码前需要确认的输入

正式实现前需要确认：

1. 真实仓库路径和默认分支。
2. self-hosted runner labels。
3. vLLM Ascend 启动命令和必需环境变量。
4. 模型 cache 位置和模型下载策略。
5. 首选 smoke model 和 prompt size。
6. main publish 是重跑 benchmark，还是复用已持久化 merged result。
7. runner 故障时的 branch protection/bypass 策略。
