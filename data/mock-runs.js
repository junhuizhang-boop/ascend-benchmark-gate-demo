window.GATE_SCENARIOS = [
  {
    id: 'pass',
    label: 'PASS · both stages pass',
    finalStatus: 'PASS',
    rebaseStatus: 'clean',
    commits: { m1: 'a31eac56', b1: 'b7f4c2d1', m2: 'd92ab014', b1p: 'e08fa9c3' },
    stages: [
      { id: 'stage1', title: 'Stage 1 · Original branch baseline', baselineLabel: 'M1', candidateLabel: 'B1', result: 'PASS', baselineSha: 'a31eac56', candidateSha: 'b7f4c2d1', baseline: { requestThroughput: 0.88, outputThroughput: 224.5, meanTtftMs: 378.6, failed: 0 }, candidate: { requestThroughput: 0.96, outputThroughput: 251.8, meanTtftMs: 351.2, failed: 0 } },
      { id: 'stage2', title: 'Stage 2 · Current main baseline', baselineLabel: 'M2', candidateLabel: "B1'", result: 'PASS', baselineSha: 'd92ab014', candidateSha: 'e08fa9c3', baseline: { requestThroughput: 0.94, outputThroughput: 242.2, meanTtftMs: 365.4, failed: 0 }, candidate: { requestThroughput: 1.01, outputThroughput: 259.7, meanTtftMs: 347.9, failed: 0 } }
    ]
  },
  {
    id: 'stage1-fail',
    label: 'FAIL · Stage 1 regression',
    finalStatus: 'FAIL',
    rebaseStatus: 'not-run',
    commits: { m1: 'a31eac56', b1: 'c41d08aa', m2: 'd92ab014', b1p: '-' },
    stages: [
      { id: 'stage1', title: 'Stage 1 · Original branch baseline', baselineLabel: 'M1', candidateLabel: 'B1', result: 'FAIL', baselineSha: 'a31eac56', candidateSha: 'c41d08aa', baseline: { requestThroughput: 0.88, outputThroughput: 224.5, meanTtftMs: 378.6, failed: 0 }, candidate: { requestThroughput: 0.79, outputThroughput: 203.1, meanTtftMs: 421.3, failed: 0 } }
    ]
  },
  {
    id: 'rebase-conflict',
    label: 'FAIL · rebase conflict before Stage 2',
    finalStatus: 'FAIL',
    rebaseStatus: 'conflict',
    commits: { m1: 'a31eac56', b1: 'f19cd331', m2: 'd92ab014', b1p: 'conflict' },
    stages: [
      { id: 'stage1', title: 'Stage 1 · Original branch baseline', baselineLabel: 'M1', candidateLabel: 'B1', result: 'PASS', baselineSha: 'a31eac56', candidateSha: 'f19cd331', baseline: { requestThroughput: 0.88, outputThroughput: 224.5, meanTtftMs: 378.6, failed: 0 }, candidate: { requestThroughput: 0.93, outputThroughput: 240.0, meanTtftMs: 360.8, failed: 0 } }
    ]
  },
  {
    id: 'stage2-fail',
    label: 'FAIL · Stage 2 regression after rebase',
    finalStatus: 'FAIL',
    rebaseStatus: 'clean',
    commits: { m1: 'a31eac56', b1: 'b7f4c2d1', m2: 'd92ab014', b1p: 'e91cbb71' },
    stages: [
      { id: 'stage1', title: 'Stage 1 · Original branch baseline', baselineLabel: 'M1', candidateLabel: 'B1', result: 'PASS', baselineSha: 'a31eac56', candidateSha: 'b7f4c2d1', baseline: { requestThroughput: 0.88, outputThroughput: 224.5, meanTtftMs: 378.6, failed: 0 }, candidate: { requestThroughput: 0.96, outputThroughput: 251.8, meanTtftMs: 351.2, failed: 0 } },
      { id: 'stage2', title: 'Stage 2 · Current main baseline', baselineLabel: 'M2', candidateLabel: "B1'", result: 'FAIL', baselineSha: 'd92ab014', candidateSha: 'e91cbb71', baseline: { requestThroughput: 0.94, outputThroughput: 242.2, meanTtftMs: 365.4, failed: 0 }, candidate: { requestThroughput: 0.82, outputThroughput: 211.6, meanTtftMs: 410.7, failed: 0 } }
    ]
  }
];
window.GATE_POLICY = { outputThroughputMinRatio: 0.97, requestThroughputMinRatio: 0.97, meanTtftMaxRatio: 1.05, failedMax: 0 };
