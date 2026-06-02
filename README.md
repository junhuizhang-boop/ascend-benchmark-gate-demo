# Ascend Benchmark Gate Demo

A static frontend demo for the proposed two-stage Ascend PR benchmark gate.

The page references the visual style of `vllm-hust-website` and simulates:

1. **Stage 1:** compare `B1` against its branch baseline `M1`.
2. **Stage 2:** locally rebase `B1` onto current main `M2` as `B1'`, then compare `B1'` against `M2`.
3. Final result passes only when both stages pass and rebase is clean.

## Local preview

```bash
python3 -m http.server 5173
# open http://127.0.0.1:5173
```

No build step is required.
