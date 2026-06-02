#!/usr/bin/env python3
"""Export two-stage gate results into a frontend-readable JSON file."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def load_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_env(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    if not path.is_file():
        return result
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or "=" not in line:
            continue
        key, value = line.split("=", 1)
        result[key.strip()] = value.strip()
    return result


def metric_block(metrics: dict[str, Any]) -> dict[str, Any]:
    return {
        "requestThroughput": float(metrics["request_throughput"]),
        "outputThroughput": float(metrics["output_throughput"]),
        "meanTtftMs": float(metrics["mean_ttft_ms"]),
        "failed": int(metrics["failed"]),
    }


def convert_stage(result: dict[str, Any]) -> dict[str, Any]:
    stage_name = str(result["stage"])
    baseline = result["baseline"]
    candidate = result["candidate"]
    baseline_label = baseline["label"]
    candidate_label = candidate["label"]
    title_suffix = "Original branch baseline" if "1" in stage_name else "Current main baseline"
    return {
        "id": "stage1" if "1" in stage_name else "stage2",
        "title": f"{stage_name} · {title_suffix}",
        "baselineLabel": baseline_label,
        "candidateLabel": "B1'" if candidate_label == "B1-prime" else candidate_label,
        "result": result["status"],
        "baselineSha": str(baseline.get("sha") or "")[:8],
        "candidateSha": str(candidate.get("sha") or "")[:8],
        "baseline": metric_block(baseline["metrics"]),
        "candidate": metric_block(candidate["metrics"]),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gate-root", type=Path, default=Path(".gate-results"))
    parser.add_argument("--output", type=Path, default=Path("data/gate-latest.json"))
    parser.add_argument("--run-url", default="")
    parser.add_argument("--pr-number", default="")
    parser.add_argument("--branch", default="")
    args = parser.parse_args()

    stage1 = load_json(args.gate_root / "Stage 1.json")
    stage2 = load_json(args.gate_root / "Stage 2.json")
    commits = load_env(args.gate_root / "commits.env")
    summary = (args.gate_root / "summary.md").read_text(encoding="utf-8") if (args.gate_root / "summary.md").is_file() else ""

    stages = [convert_stage(item) for item in (stage1, stage2) if item]
    final_status = "PASS" if stages and all(stage["result"] == "PASS" for stage in stages) else "FAIL"
    if "Final result: **PASS**" in summary:
        final_status = "PASS"
    elif "Final result: **FAIL**" in summary:
        final_status = "FAIL"

    payload = {
        "schemaVersion": "ascend-pr-two-stage/v1",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "runUrl": args.run_url,
            "prNumber": args.pr_number,
            "branch": args.branch,
        },
        "scenario": {
            "id": "latest-ci",
            "label": f"LATEST CI · {final_status}",
            "finalStatus": final_status,
            "rebaseStatus": "clean" if commits.get("B1_REBASED_SHA") else "not-run",
            "commits": {
                "m1": commits.get("M1_SHA", "")[:8],
                "b1": commits.get("B1_SHA", "")[:8],
                "m2": commits.get("M2_SHA", "")[:8],
                "b1p": commits.get("B1_REBASED_SHA", "")[:8] or "-",
            },
            "stages": stages,
        },
        "summaryMarkdown": summary,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
