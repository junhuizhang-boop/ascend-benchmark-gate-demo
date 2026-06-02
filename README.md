# Ascend Benchmark Gate Demo

A static frontend demo plus a runnable GitHub Actions demo for the proposed two-stage Ascend PR benchmark gate.

The page references the visual style of `vllm-hust-website` and the workflow exercises a real PR-like git flow:

1. **Stage 1:** compare `B1` against its branch baseline `M1`.
2. **Stage 2:** locally rebase `B1` onto current main `M2` as `B1'`, then compare `B1'` against `M2`.
3. Final result passes only when both stages pass and the local rebase is clean.

No `vllm-*` project code is required for this demo. The workflow reads a commit-local `benchmark-metrics.json` as a controllable mock result so the real checkout / merge-base / rebase / compare flow can run on GitHub-hosted runners without Ascend hardware.

## Local preview

```bash
python3 -m http.server 5173
# open http://127.0.0.1:5173
```

No build step is required.

## Benchmark gate policy

`benchmark-metrics.json` contains the mock benchmark result of the currently checked-out commit:

```json
{
  "model": "Qwen/Qwen2.5-7B-Instruct",
  "scenario": "random-online",
  "hardware": "Ascend 910B3 mock",
  "request_throughput": 0.90,
  "output_throughput": 230.0,
  "mean_ttft_ms": 380.0,
  "failed": 0
}
```

The gate currently checks:

| Metric | Rule |
|---|---|
| `output_throughput` | candidate >= baseline * `0.97` |
| `request_throughput` | candidate >= baseline * `0.97` |
| `mean_ttft_ms` | candidate <= baseline * `1.05` |
| `failed` | candidate <= `0` |

The threshold is intentionally simple for the demo. In the real vLLM Ascend workflow, `scripts/read_mock_benchmark.py` is where the mock read would be replaced by a hardware benchmark command such as `vllm bench serve`.

## GitHub Actions workflow

`.github/workflows/two-stage-gate.yml` runs on PRs and manual dispatch:

```text
M1 = merge-base(origin/main, B1)
B1 = PR head
M2 = current origin/main
B1' = local-only rebase of B1 onto M2

Stage 1: compare M1 vs B1
Stage 2: compare M2 vs B1'
```

Results are written to:

- GitHub Step Summary
- workflow artifact `two-stage-gate-results`
- `.gate-results/summary.md` inside the runner workspace

## Local smoke test

From this repository:

```bash
chmod +x scripts/*.sh scripts/*.py
GATE_ROOT=.gate-results-local PR_BASE_REF=main PR_HEAD_SHA=$(git rev-parse HEAD) \
  bash scripts/run_two_stage_gate.sh
cat .gate-results-local/summary.md
```

The script fetches `origin/main`, calculates the true merge-base, checks out each commit, and performs the local-only rebase. It may leave the worktree on `ci/rebased-pr`; switch back with `git checkout main` or your feature branch afterwards.

## Real PR scenario tests

Use normal GitHub PRs against `main`. Each commit controls its own benchmark result by editing `benchmark-metrics.json`.

### 1. PASS scenario: B1 is close enough to M1 and M2

```bash
git checkout main
git pull origin main
git checkout -b demo/pass-gate

python3 - <<'PY'
import json
p = json.load(open('benchmark-metrics.json'))
p['output_throughput'] = 228.0
p['request_throughput'] = 0.89
p['mean_ttft_ms'] = 385.0
p['failed'] = 0
open('benchmark-metrics.json', 'w').write(json.dumps(p, indent=2) + '\n')
PY

git add benchmark-metrics.json
git commit -m "demo: pass benchmark gate"
git push -u origin demo/pass-gate
```

Open a PR. Both stages should pass if `main` has similar metrics.

### 2. Stage 1 FAIL: B1 regresses versus M1

```bash
git checkout main
git pull origin main
git checkout -b demo/fail-stage-1

python3 - <<'PY'
import json
p = json.load(open('benchmark-metrics.json'))
p['output_throughput'] = 180.0
p['request_throughput'] = 0.70
p['mean_ttft_ms'] = 520.0
p['failed'] = 0
open('benchmark-metrics.json', 'w').write(json.dumps(p, indent=2) + '\n')
PY

git add benchmark-metrics.json
git commit -m "demo: fail stage 1 benchmark gate"
git push -u origin demo/fail-stage-1
```

Open a PR. Stage 1 should fail before the rebase comparison.

### 3. Stage 2 FAIL: B1 passes old M1 but fails against newer M2

This simulates `main` improving while the PR is open.

```bash
# Create PR branch from current main; keep B1 similar to M1.
git checkout main
git pull origin main
git checkout -b demo/fail-stage-2

python3 - <<'PY'
import json
p = json.load(open('benchmark-metrics.json'))
p['output_throughput'] = 228.0
p['request_throughput'] = 0.89
p['mean_ttft_ms'] = 385.0
p['failed'] = 0
open('benchmark-metrics.json', 'w').write(json.dumps(p, indent=2) + '\n')
PY

git add benchmark-metrics.json
git commit -m "demo: candidate passes original baseline"
git push -u origin demo/fail-stage-2

# Then update main to a much better M2, for example through another merged PR
# or directly in this demo repository if branch protection allows it.
git checkout main
git pull origin main
python3 - <<'PY'
import json
p = json.load(open('benchmark-metrics.json'))
p['output_throughput'] = 270.0
p['request_throughput'] = 1.05
p['mean_ttft_ms'] = 330.0
p['failed'] = 0
open('benchmark-metrics.json', 'w').write(json.dumps(p, indent=2) + '\n')
PY

git add benchmark-metrics.json
git commit -m "demo: improve main benchmark baseline"
git push origin main
```

Re-run the PR workflow on `demo/fail-stage-2`. Stage 1 compares B1 with M1 and should pass; Stage 2 compares rebased B1 with improved M2 and should fail.

### 4. Rebase conflict FAIL

Create a PR that changes the same line in `benchmark-metrics.json`, then update `main` with a conflicting change to that line.

```bash
git checkout main
git pull origin main
git checkout -b demo/rebase-conflict
python3 - <<'PY'
import json
p = json.load(open('benchmark-metrics.json'))
p['scenario'] = 'pr-conflict-scenario'
open('benchmark-metrics.json', 'w').write(json.dumps(p, indent=2) + '\n')
PY
git add benchmark-metrics.json
git commit -m "demo: change scenario on pr branch"
git push -u origin demo/rebase-conflict

# Separately update main's same field before rerunning the PR workflow.
git checkout main
git pull origin main
python3 - <<'PY'
import json
p = json.load(open('benchmark-metrics.json'))
p['scenario'] = 'main-conflict-scenario'
open('benchmark-metrics.json', 'w').write(json.dumps(p, indent=2) + '\n')
PY
git add benchmark-metrics.json
git commit -m "demo: change scenario on main"
git push origin main
```

Re-run the PR workflow. Stage 1 should complete, then Stage 2 should fail at the local rebase step and print the manual rebase command.
