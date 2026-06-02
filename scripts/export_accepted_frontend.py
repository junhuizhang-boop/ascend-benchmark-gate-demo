#!/usr/bin/env python3
"""Publish merged benchmark records for the static frontend.

This runs on main after a PR has already passed the gate and merged. Failed PRs
never reach main, so they never enter data/accepted-runs.json.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def load_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def metric_block(metrics: dict[str, Any]) -> dict[str, Any]:
    return {
        "requestThroughput": float(metrics["request_throughput"]),
        "outputThroughput": float(metrics["output_throughput"]),
        "meanTtftMs": float(metrics["mean_ttft_ms"]),
        "failed": int(metrics["failed"]),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--metrics", type=Path, default=Path("benchmark-metrics.json"))
    parser.add_argument("--output", type=Path, default=Path("data/accepted-runs.json"))
    parser.add_argument("--sha", required=True)
    parser.add_argument("--run-url", default="")
    parser.add_argument("--branch", default="main")
    args = parser.parse_args()

    metrics = load_json(args.metrics, {})
    if not metrics:
        raise SystemExit(f"missing metrics file: {args.metrics}")

    payload = load_json(args.output, {
        "schemaVersion": "ascend-merged-benchmark/v1",
        "updatedAt": "",
        "records": [],
        "rejectedExamples": [
            {
                "branch": "demo/fail-stage-1",
                "reason": "阶段一性能退化，PR Checks 失败，未合并到 main，因此不会出现在页面数据中。"
            },
            {
                "branch": "demo/fail-stage-2",
                "reason": "rebase 到最新 main 后阶段二性能退化，PR Checks 失败，未合并到 main，因此不会出现在页面数据中。"
            }
        ]
    })

    short_sha = args.sha[:8]
    record = {
        "id": f"merged-{short_sha}",
        "label": f"已合并 · {short_sha} · PASS",
        "finalStatus": "PASS",
        "rebaseStatus": "merged",
        "mergedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "branch": args.branch,
            "sha": args.sha,
            "runUrl": args.run_url,
        },
        "commits": {
            "m1": "已通过PR门控",
            "b1": short_sha,
            "m2": "main",
            "b1p": short_sha,
        },
        "stages": [
            {
                "id": "merged",
                "title": "已合并性能记录",
                "baselineLabel": "main accepted",
                "candidateLabel": short_sha,
                "result": "PASS",
                "baselineSha": "main",
                "candidateSha": short_sha,
                "baseline": metric_block(metrics),
                "candidate": metric_block(metrics),
            }
        ],
        "metrics": {
            "model": metrics.get("model", ""),
            "scenario": metrics.get("scenario", ""),
            "hardware": metrics.get("hardware", ""),
            **metric_block(metrics),
        },
    }

    records = [item for item in payload.get("records", []) if item.get("source", {}).get("sha") != args.sha]
    records.insert(0, record)
    payload["records"] = records[:20]
    payload["updatedAt"] = datetime.now(timezone.utc).isoformat()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {args.output} with {len(payload['records'])} accepted records")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
