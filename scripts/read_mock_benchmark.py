#!/usr/bin/env python3
"""Read the benchmark metrics of the currently checked-out commit.

This is intentionally a mock benchmark runner for the demo repository. The real
vllm-hust CI would start vLLM and run `vllm bench serve`; this demo reads a
commit-local `benchmark-metrics.json` so GitHub Actions can exercise the real
M1/B1/M2/B1' checkout and rebase flow without Ascend hardware.

If an old baseline commit does not have `benchmark-metrics.json` yet, the demo
uses DEFAULT_METRICS so the first PR that introduces the gate can still run.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

REQUIRED = ("request_throughput", "output_throughput", "mean_ttft_ms", "failed")
DEFAULT_METRICS: dict[str, Any] = {
    "model": "Qwen/Qwen2.5-7B-Instruct",
    "scenario": "random-online",
    "hardware": "Ascend 910B3 mock",
    "request_throughput": 0.90,
    "output_throughput": 230.0,
    "mean_ttft_ms": 380.0,
    "failed": 0,
}


def read_payload(path: Path) -> dict[str, Any]:
    if not path.is_file():
        print(f"mock benchmark file not found in checked-out commit: {path}; using DEFAULT_METRICS")
        return dict(DEFAULT_METRICS)
    payload = json.loads(path.read_text(encoding="utf-8"))
    missing = [key for key in REQUIRED if key not in payload]
    if missing:
        raise SystemExit(f"mock benchmark file missing required keys: {', '.join(missing)}")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path("benchmark-metrics.json"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--sha", required=True)
    args = parser.parse_args()

    payload = read_payload(args.source)
    result = {
        "label": args.label,
        "sha": args.sha,
        "model": payload.get("model", DEFAULT_METRICS["model"]),
        "scenario": payload.get("scenario", DEFAULT_METRICS["scenario"]),
        "hardware": payload.get("hardware", DEFAULT_METRICS["hardware"]),
        "request_throughput": float(payload["request_throughput"]),
        "output_throughput": float(payload["output_throughput"]),
        "mean_ttft_ms": float(payload["mean_ttft_ms"]),
        "failed": int(payload["failed"]),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
