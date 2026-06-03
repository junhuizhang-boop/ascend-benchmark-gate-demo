# Real vLLM Ascend Two-Stage Benchmark Gate Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Move the working mock demo into a real vLLM Ascend PR performance gate that blocks regressing PRs and publishes only merged PASS results.

**Architecture:** Keep the same two-stage topology proven by the demo: benchmark M1 and B1, locally rebase B1 onto latest main M2 to produce B1', then benchmark M2 and B1'. PR workflows only gate and upload artifacts; main workflows publish accepted merged results. The only demo-specific component to replace is the mock benchmark reader.

**Tech Stack:** GitHub Actions, self-hosted Ascend runner, Bash, Python, vLLM `vllm bench serve`, JSON artifacts, GitHub Pages or existing leaderboard publication.

---

## Current Demo Contract

The demo already proves the product behavior:

- PASS PRs show green checks and can merge.
- Stage 1 FAIL PRs fail before rebase when B1 regresses against M1.
- Stage 2 FAIL PRs can pass M1 but fail after rebasing onto M2.
- Request failures (`failed > 0`) block the PR.
- GitHub Pages reads only merged accepted records; failed PR artifacts are visible only in Actions/Checks.

The real implementation should preserve this contract and swap the metric source from `benchmark-metrics.json` to actual vLLM benchmark output.

## Ownership and Boundaries

| Layer | Owns | Must not do |
|---|---|---|
| PR workflow | Checkout, commit topology, runner selection, artifact upload | Publish failed PRs as accepted results |
| Benchmark runner script | Start/verify server, run benchmark, normalize metrics JSON | Decide PR merge/publication semantics |
| Compare script | Apply threshold policy and write PASS/FAIL summaries | Hide failed metrics or silently ignore missing fields |
| Main publish workflow | Publish merged PASS result after `main` push | Re-run untrusted PR code or ingest failed PR artifacts |
| Frontend/leaderboard | Render accepted records and explanatory rejected examples | Treat PR preview artifacts as official accepted records |

## Production Metric Schema

Normalize raw vLLM output into this stable gate JSON:

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

Required fields for the existing comparison script are:

- `request_throughput`
- `output_throughput`
- `mean_ttft_ms`
- `failed`

Optional fields (`completed`, p50/p95 latency, tokens/sec variants) can be kept in raw artifacts and added to the frontend later.

## Recommended Default Gate Policy

Start conservative because self-hosted Ascend runners can be noisy:

| Metric | Initial rule | Reason |
|---|---|---|
| `output_throughput` | candidate >= baseline * `0.97` | Allows small jitter but blocks meaningful throughput loss. |
| `request_throughput` | candidate >= baseline * `0.97` | Catches serving-level throughput regressions. |
| `mean_ttft_ms` | candidate <= baseline * `1.05` | Allows minor latency jitter. |
| `failed` | candidate <= `0` | Any failed request makes the smoke result untrustworthy. |

Make these values configurable by repository variables or workflow env:

- `ASCEND_GATE_OUTPUT_TPS_MIN_RATIO`
- `ASCEND_GATE_REQUEST_TPS_MIN_RATIO`
- `ASCEND_GATE_MEAN_TTFT_MAX_RATIO`
- `ASCEND_GATE_FAILED_MAX`

## Runner and Safety Requirements

- Use a trusted self-hosted runner label such as `[self-hosted, linux, ascend]`.
- Do not run untrusted fork PR code on the Ascend hardware with secrets.
- For public repos, add a fork guard:

```yaml
if: >-
  github.event_name != 'pull_request' ||
  github.event.pull_request.head.repo.full_name == github.repository
```

- Avoid `pull_request_target` for executing benchmark code.
- Use `concurrency` to avoid multiple PRs fighting over one Ascend machine.
- Clean up vLLM server processes after each benchmark.
- Upload raw logs and metrics even on failure.

---

## Task 1: Add Production Benchmark Runner Script

**Objective:** Replace the demo's mock metric reader with a production runner that can execute `vllm bench serve` and write normalized gate JSON.

**Files:**

- Create: `scripts/run_vllm_ascend_benchmark.py`
- Keep: `scripts/read_mock_benchmark.py` for demo/local fallback only

**Step 1: Create CLI skeleton**

The script should accept:

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

**Step 2: Add environment-driven benchmark defaults**

Use conservative smoke defaults first:

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

**Step 3: Run benchmark command**

Use the project's real serving command if already standardized. Otherwise use this shape:

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

**Step 4: Normalize raw JSON**

Map vLLM fields into the production metric schema. If vLLM emits different names on the target version, adapt only here, not in `compare_gate.py`.

Common mappings:

- `request_throughput` -> `request_throughput`
- `output_throughput` -> `output_throughput`
- `mean_ttft_ms` or `mean_ttft` -> `mean_ttft_ms`
- failures/errors -> `failed`

**Step 5: Verify locally with a fixture**

Run with a saved raw JSON fixture before using hardware:

```bash
python3 scripts/run_vllm_ascend_benchmark.py \
  --label fixture \
  --sha test \
  --output /tmp/gate-fixture.json \
  --raw-output tests/fixtures/vllm-bench-serve.json \
  --fixture-only
python3 -m json.tool /tmp/gate-fixture.json
```

Expected: normalized JSON includes all required fields.

**Step 6: Commit**

```bash
git add scripts/run_vllm_ascend_benchmark.py tests/fixtures/vllm-bench-serve.json
git commit -m "feat: add vllm ascend benchmark normalizer"
```

---

## Task 2: Parameterize Gate Policy

**Objective:** Make `scripts/compare_gate.py` read thresholds from environment variables while preserving current defaults.

**Files:**

- Modify: `scripts/compare_gate.py`

**Step 1: Add env parsing**

Introduce a helper:

```python
import os

def env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    return default if value in (None, "") else float(value)

def env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    return default if value in (None, "") else int(value)
```

**Step 2: Build policy from env**

```python
DEFAULT_POLICY = {
    "request_throughput_min_ratio": env_float("ASCEND_GATE_REQUEST_TPS_MIN_RATIO", 0.97),
    "output_throughput_min_ratio": env_float("ASCEND_GATE_OUTPUT_TPS_MIN_RATIO", 0.97),
    "mean_ttft_max_ratio": env_float("ASCEND_GATE_MEAN_TTFT_MAX_RATIO", 1.05),
    "failed_max": env_int("ASCEND_GATE_FAILED_MAX", 0),
}
```

**Step 3: Test defaults and overrides**

Run:

```bash
python3 scripts/compare_gate.py --help
ASCEND_GATE_OUTPUT_TPS_MIN_RATIO=0.99 python3 scripts/compare_gate.py ...
```

Expected: output JSON `policy.output_throughput_min_ratio` reflects the override.

**Step 4: Commit**

```bash
git add scripts/compare_gate.py
git commit -m "feat: parameterize benchmark gate thresholds"
```

---

## Task 3: Add Real Ascend PR Workflow

**Objective:** Add a production workflow that runs on Ascend self-hosted runners and preserves the demo's two-stage gate behavior.

**Files:**

- Create: `.github/workflows/ascend-two-stage-gate.yml`
- Modify or copy from: `.github/workflows/two-stage-gate.yml`

**Step 1: Create workflow trigger and permissions**

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

**Step 2: Use self-hosted runner and fork guard**

```yaml
jobs:
  two-stage-gate:
    if: >-
      github.event_name != 'pull_request' ||
      github.event.pull_request.head.repo.full_name == github.repository
    runs-on: [self-hosted, linux, ascend]
```

**Step 3: Checkout full history**

Same as demo:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
    ref: ${{ github.event.pull_request.head.sha || github.sha }}
```

**Step 4: Run production gate script**

Either update `scripts/run_two_stage_gate.sh` to choose production runner when `ASCEND_GATE_MODE=real`, or create `scripts/run_two_stage_gate_real.sh`.

Recommended env:

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

**Step 5: Upload artifacts and summary**

Keep the existing artifact pattern:

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

**Step 6: Commit**

```bash
git add .github/workflows/ascend-two-stage-gate.yml scripts/run_two_stage_gate_real.sh
git commit -m "ci: add ascend two-stage benchmark gate workflow"
```

---

## Task 4: Add Server Lifecycle Handling

**Objective:** Ensure every benchmarked commit starts a usable vLLM server and cleans it up.

**Files:**

- Create: `scripts/start_vllm_ascend_server.sh`
- Modify: `scripts/run_two_stage_gate_real.sh`

**Step 1: Start server per checked-out commit**

Use a project-specific command if vLLM Ascend requires extra env. Example shape:

```bash
VLLM_USE_MODELSCOPE=${VLLM_USE_MODELSCOPE:-False}
python3 -m vllm.entrypoints.openai.api_server \
  --model "$ASCEND_GATE_MODEL" \
  --host 127.0.0.1 \
  --port "${ASCEND_GATE_PORT:-8000}" \
  --trust-remote-code
```

**Step 2: Readiness check**

Poll `/v1/models`:

```bash
for i in $(seq 1 120); do
  curl -fsS "http://127.0.0.1:${ASCEND_GATE_PORT:-8000}/v1/models" && break
  sleep 5
done
```

Fail if not ready before timeout.

**Step 3: Cleanup trap**

```bash
cleanup() {
  if [[ -n "${VLLM_PID:-}" ]]; then
    kill "$VLLM_PID" || true
    wait "$VLLM_PID" || true
  fi
}
trap cleanup EXIT
```

**Step 4: Verify on runner**

Manual workflow dispatch on one known commit. Expected artifacts:

- `.gate-results/m1.json`
- `.gate-results/b1.json`
- `.gate-results/m2.json`
- `.gate-results/b1-prime.json`
- raw vLLM logs under `.gate-results/raw/`
- `summary.md`

**Step 5: Commit**

```bash
git add scripts/start_vllm_ascend_server.sh scripts/run_two_stage_gate_real.sh
git commit -m "ci: manage vllm server lifecycle for ascend gate"
```

---

## Task 5: Publish Only Merged Accepted Results

**Objective:** Keep official leaderboard/Page data limited to merged PASS results.

**Files:**

- Modify or create: `.github/workflows/ascend-pages-publish.yml`
- Modify: `scripts/export_accepted_frontend.py` or production equivalent

**Step 1: Trigger only on main**

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:
```

**Step 2: Reuse merged commit metrics**

Option A: run a short accepted benchmark again on main.

Option B: export the merged commit's stored benchmark result if the production repository persists it.

Prefer Option A first unless benchmark cost is too high; it is simpler and avoids trusting stale PR artifacts.

**Step 3: Write accepted record**

Output schema should remain compatible with the demo frontend:

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

**Step 4: Commit**

```bash
git add .github/workflows/ascend-pages-publish.yml scripts/export_accepted_frontend.py
git commit -m "ci: publish only merged ascend benchmark results"
```

---

## Task 6: Add Branch Protection / Required Checks

**Objective:** Make the Ascend gate enforceable instead of informational.

**Files:**

- GitHub repository settings, not code.
- Optional docs: `docs/branch-protection.md`

**Step 1: Add required status check**

In GitHub Settings -> Branches -> main protection:

- Require status checks to pass before merging.
- Add `Ascend two-stage benchmark gate / two-stage-gate`.
- Require branches to be up to date if desired.

**Step 2: Keep admin bypass policy explicit**

Document whether maintainers may bypass the benchmark during runner outage.

**Step 3: Commit docs**

```bash
git add docs/branch-protection.md
git commit -m "docs: document ascend gate branch protection"
```

---

## Task 7: Production Verification Matrix

**Objective:** Reproduce the demo proof in the real repository with real benchmarks.

**Files:**

- Create: `docs/ascend-gate-verification.md`

**Verification PRs:**

| Scenario | Expected | Notes |
|---|---|---|
| PASS smoke PR | Green | Small non-regressing change or threshold-safe fixture. |
| Stage 1 regression | Red | Artificially lower throughput or add a known slow path. |
| Stage 2 regression | Red | PR passes old baseline but fails after latest main improves. |
| Request failure | Red | Force benchmark request failure or invalid serving config. |
| Rebase conflict | Red | Conflicting change confirms manual rebase message. |

**Commands/checks:**

```bash
bash -n scripts/*.sh
python3 -m py_compile scripts/*.py
python3 -m json.tool .gate-results/*.json
```

**Expected proof:**

- Failed PRs visible in Pull requests and Actions.
- PASS PR can merge.
- Main publish workflow runs after merge.
- Public leaderboard/Page contains only merged PASS records.

---

## Task 8: Operational Runbook

**Objective:** Give maintainers a short troubleshooting guide.

**Files:**

- Create: `docs/ascend-gate-runbook.md`

**Include:**

- Runner offline / busy.
- vLLM server fails to start.
- Model download/cache miss.
- Hugging Face or ModelScope network issue.
- Benchmark JSON missing fields.
- Rebase conflict.
- Stage 1 fail vs Stage 2 fail interpretation.
- How to rerun failed jobs.
- How to temporarily relax thresholds with repo variables.
- How to inspect `.gate-results` artifacts.

---

## Implementation Order

1. Add production benchmark normalizer with fixture tests.
2. Parameterize threshold policy.
3. Add real self-hosted Ascend workflow.
4. Add server lifecycle and cleanup.
5. Add merged-only publish workflow.
6. Configure required checks.
7. Run verification matrix.
8. Publish runbook.

## Acceptance Criteria

- A real PR produces `.gate-results/summary.md` with M1/B1/M2/B1' commits and metric tables.
- Stage 1 failures fail before rebase.
- Stage 2 failures show Stage 1 PASS and Stage 2 FAIL.
- Request failures fail even when throughput metrics look acceptable.
- The workflow uses trusted self-hosted Ascend runners and does not run untrusted fork code with secrets/hardware.
- Main branch publication contains only merged PASS records.
- Branch protection requires the real gate check before merging.

## Open Inputs Before Coding

Confirm these before implementing in the real repository:

1. Exact repository path and default branch.
2. Self-hosted runner labels.
3. vLLM Ascend startup command and required environment variables.
4. Model cache location and model download policy.
5. Preferred smoke model and prompt sizes.
6. Whether main publish should re-run benchmark or reuse persisted merged result.
7. Branch protection/bypass policy during runner outages.
