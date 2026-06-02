#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

DEFAULT_POLICY = {
    "request_throughput_min_ratio": 0.97,
    "output_throughput_min_ratio": 0.97,
    "mean_ttft_max_ratio": 1.05,
    "failed_max": 0,
}


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def fmt(value: float | int) -> str:
    if isinstance(value, int):
        return str(value)
    return f"{value:.3f}".rstrip("0").rstrip(".")


def check(stage: str, baseline_label: str, candidate_label: str, baseline: dict[str, Any], candidate: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    checks = []

    def add(metric: str, base: float | int, cand: float | int, rule: str, ok: bool) -> None:
        checks.append({
            "metric": metric,
            "baseline": base,
            "candidate": cand,
            "rule": rule,
            "status": "PASS" if ok else "FAIL",
        })

    baseline_output = float(baseline["output_throughput"])
    candidate_output = float(candidate["output_throughput"])
    add(
        "output_throughput",
        baseline_output,
        candidate_output,
        f"{candidate_label} >= {baseline_label} * {policy['output_throughput_min_ratio']}",
        candidate_output >= baseline_output * float(policy["output_throughput_min_ratio"]),
    )

    baseline_request = float(baseline["request_throughput"])
    candidate_request = float(candidate["request_throughput"])
    add(
        "request_throughput",
        baseline_request,
        candidate_request,
        f"{candidate_label} >= {baseline_label} * {policy['request_throughput_min_ratio']}",
        candidate_request >= baseline_request * float(policy["request_throughput_min_ratio"]),
    )

    baseline_ttft = float(baseline["mean_ttft_ms"])
    candidate_ttft = float(candidate["mean_ttft_ms"])
    add(
        "mean_ttft_ms",
        baseline_ttft,
        candidate_ttft,
        f"{candidate_label} <= {baseline_label} * {policy['mean_ttft_max_ratio']}",
        candidate_ttft <= baseline_ttft * float(policy["mean_ttft_max_ratio"]),
    )

    baseline_failed = int(baseline["failed"])
    candidate_failed = int(candidate["failed"])
    add(
        "failed",
        baseline_failed,
        candidate_failed,
        f"{candidate_label}.failed <= {policy['failed_max']}",
        candidate_failed <= int(policy["failed_max"]),
    )

    status = "PASS" if all(item["status"] == "PASS" for item in checks) else "FAIL"
    return {
        "stage": stage,
        "status": status,
        "policy": policy,
        "baseline": {"label": baseline_label, "sha": baseline.get("sha"), "metrics": baseline},
        "candidate": {"label": candidate_label, "sha": candidate.get("sha"), "metrics": candidate},
        "checks": checks,
    }


def markdown(result: dict[str, Any]) -> str:
    lines = [
        f"### {result['stage']} · {result['baseline']['label']} vs {result['candidate']['label']}",
        f"- Result: **{result['status']}**",
        f"- Baseline `{result['baseline']['label']}`: `{str(result['baseline']['sha'])[:8]}`",
        f"- Candidate `{result['candidate']['label']}`: `{str(result['candidate']['sha'])[:8]}`",
        "",
        "| Metric | Baseline | Candidate | Rule | Status |",
        "|---|---:|---:|---|---|",
    ]
    for item in result["checks"]:
        lines.append(
            f"| {item['metric']} | `{fmt(item['baseline'])}` | `{fmt(item['candidate'])}` | `{item['rule']}` | **{item['status']}** |"
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", required=True)
    parser.add_argument("--baseline-label", required=True)
    parser.add_argument("--candidate-label", required=True)
    parser.add_argument("--baseline-result", type=Path, required=True)
    parser.add_argument("--candidate-result", type=Path, required=True)
    parser.add_argument("--output-json", type=Path, required=True)
    parser.add_argument("--output-md", type=Path, required=True)
    args = parser.parse_args()

    result = check(
        args.stage,
        args.baseline_label,
        args.candidate_label,
        load(args.baseline_result),
        load(args.candidate_result),
        DEFAULT_POLICY,
    )
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    args.output_md.write_text(markdown(result), encoding="utf-8")
    print(json.dumps({"stage": args.stage, "status": result["status"]}))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
