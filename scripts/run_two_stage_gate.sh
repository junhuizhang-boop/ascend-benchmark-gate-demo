#!/usr/bin/env bash
set -euo pipefail

BASE_REF=${PR_BASE_REF:-${GITHUB_BASE_REF:-main}}
B1_SHA=${PR_HEAD_SHA:-${GITHUB_SHA:-}}
if [[ -z "$B1_SHA" ]]; then
  echo "PR_HEAD_SHA/GITHUB_SHA is required" >&2
  exit 2
fi

WORKSPACE=${GITHUB_WORKSPACE:-$(pwd)}
GATE_ROOT=${GATE_ROOT:-$WORKSPACE/.gate-results}
SCRIPT_ROOT=${RUNNER_TEMP:-/tmp}/ascend-gate-scripts
mkdir -p "$GATE_ROOT" "$SCRIPT_ROOT"
rm -rf "$SCRIPT_ROOT/scripts"
cp -R "$WORKSPACE/scripts" "$SCRIPT_ROOT/"

run_mock_benchmark() {
  local label=$1
  local sha=$2
  local output=$3
  echo "[gate] checkout $label $sha"
  git checkout --force "$sha" >/dev/null
  python3 "$SCRIPT_ROOT/scripts/read_mock_benchmark.py" --label "$label" --sha "$sha" --output "$output"
}

compare_stage() {
  local stage=$1
  local baseline_label=$2
  local candidate_label=$3
  local baseline_result=$4
  local candidate_result=$5
  python3 "$SCRIPT_ROOT/scripts/compare_gate.py" \
    --stage "$stage" \
    --baseline-label "$baseline_label" \
    --candidate-label "$candidate_label" \
    --baseline-result "$baseline_result" \
    --candidate-result "$candidate_result" \
    --output-json "$GATE_ROOT/${stage}.json" \
    --output-md "$GATE_ROOT/${stage}.md"
}

write_summary_header() {
  echo "## Ascend Benchmark Gate Result"
  echo
  echo "- M1 (merge-base): \`${M1_SHA:0:8}\`"
  echo "- B1 (PR head): \`${B1_SHA:0:8}\`"
  echo "- M2 (current ${BASE_REF}): \`${M2_SHA:0:8}\`"
  echo
}

# Fetch enough history to compute true merge-base and to rebase locally.
git fetch origin "$BASE_REF" --prune
M2_SHA=$(git rev-parse "origin/$BASE_REF")
M1_SHA=$(git merge-base "$M2_SHA" "$B1_SHA")

{
  echo "M1_SHA=$M1_SHA"
  echo "B1_SHA=$B1_SHA"
  echo "M2_SHA=$M2_SHA"
} | tee "$GATE_ROOT/commits.env"

run_mock_benchmark M1 "$M1_SHA" "$GATE_ROOT/m1.json"
run_mock_benchmark B1 "$B1_SHA" "$GATE_ROOT/b1.json"

if ! compare_stage "Stage 1" M1 B1 "$GATE_ROOT/m1.json" "$GATE_ROOT/b1.json"; then
  {
    write_summary_header
    cat "$GATE_ROOT/Stage 1.md"
    echo
    echo "Final result: **FAIL** — Stage 1 regression."
  } > "$GATE_ROOT/summary.md"
  cat "$GATE_ROOT/summary.md"
  exit 1
fi

# Local-only rebase. Do not push the rebased branch.
git checkout --force -B ci/rebased-pr "$B1_SHA" >/dev/null
if ! git rebase "$M2_SHA"; then
  git rebase --abort || true
  {
    write_summary_header
    cat "$GATE_ROOT/Stage 1.md"
    echo
    echo "### Stage 2 · Rebase check"
    echo "- Result: **FAIL**"
    echo "- Reason: B1 cannot be rebased onto current main M2 cleanly."
    echo
    echo '```bash'
    echo "git fetch origin"
    echo "git rebase origin/$BASE_REF"
    echo "git push --force-with-lease"
    echo '```'
    echo
    echo "Final result: **FAIL** — manual rebase required."
  } > "$GATE_ROOT/summary.md"
  cat "$GATE_ROOT/summary.md"
  exit 1
fi
B1_REBASED_SHA=$(git rev-parse HEAD)
echo "B1_REBASED_SHA=$B1_REBASED_SHA" | tee -a "$GATE_ROOT/commits.env"

run_mock_benchmark M2 "$M2_SHA" "$GATE_ROOT/m2.json"
run_mock_benchmark "B1-prime" "$B1_REBASED_SHA" "$GATE_ROOT/b1-prime.json"

if ! compare_stage "Stage 2" M2 "B1-prime" "$GATE_ROOT/m2.json" "$GATE_ROOT/b1-prime.json"; then
  {
    write_summary_header
    cat "$GATE_ROOT/Stage 1.md"
    echo
    cat "$GATE_ROOT/Stage 2.md"
    echo
    echo "Final result: **FAIL** — Stage 2 regression after rebase."
  } > "$GATE_ROOT/summary.md"
  cat "$GATE_ROOT/summary.md"
  exit 1
fi

{
  write_summary_header
  cat "$GATE_ROOT/Stage 1.md"
  echo
  cat "$GATE_ROOT/Stage 2.md"
  echo
  echo "Final result: **PASS**"
} > "$GATE_ROOT/summary.md"
cat "$GATE_ROOT/summary.md"
