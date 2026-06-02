(function(){
  const scenarios = window.GATE_SCENARIOS;
  const policy = window.GATE_POLICY;
  const select = document.getElementById('scenarioSelect');
  const overview = document.getElementById('overview');
  const stageResults = document.getElementById('stageResults');
  const graph = document.getElementById('commitGraph');
  const rebaseBadge = document.getElementById('rebaseBadge');
  const meta = document.getElementById('gateMeta');

  function fmt(n, unit='') { return typeof n === 'number' ? `${n.toFixed(n >= 10 ? 1 : 2)}${unit}` : String(n); }
  function badge(status){ const s=(status||'neutral').toLowerCase(); return `<span class="gate-status ${s==='pass'?'pass':s==='fail'?'fail':'neutral'}">${status}</span>`; }
  function checkRows(stage){
    const b=stage.baseline, c=stage.candidate;
    const rows = [
      ['Output throughput', b.outputThroughput, c.outputThroughput, `${stage.candidateLabel} ≥ ${stage.baselineLabel} × ${policy.outputThroughputMinRatio}`, c.outputThroughput >= b.outputThroughput * policy.outputThroughputMinRatio, ' tok/s'],
      ['Request throughput', b.requestThroughput, c.requestThroughput, `${stage.candidateLabel} ≥ ${stage.baselineLabel} × ${policy.requestThroughputMinRatio}`, c.requestThroughput >= b.requestThroughput * policy.requestThroughputMinRatio, ' req/s'],
      ['Mean TTFT', b.meanTtftMs, c.meanTtftMs, `${stage.candidateLabel} ≤ ${stage.baselineLabel} × ${policy.meanTtftMaxRatio}`, c.meanTtftMs <= b.meanTtftMs * policy.meanTtftMaxRatio, ' ms'],
      ['Failed requests', b.failed, c.failed, `failed ≤ ${policy.failedMax}`, c.failed <= policy.failedMax, '']
    ];
    return rows.map(([name, bv, cv, rule, pass, unit])=>`<tr><td>${name}</td><td>${fmt(bv, unit)}</td><td>${fmt(cv, unit)}</td><td class="gate-rule-text">${rule}</td><td>${badge(pass?'PASS':'FAIL')}</td></tr>`).join('');
  }
  function renderStage(stage){
    return `<article class="gate-card">
      <div class="gate-card-head"><div><div class="gate-card-title">${stage.title}</div><div class="gate-card-subtitle">${stage.candidateLabel} compared with ${stage.baselineLabel}</div></div>${badge(stage.result)}</div>
      <div class="gate-sha-row"><div class="gate-sha-box"><span>Baseline ${stage.baselineLabel}</span><code>${stage.baselineSha}</code></div><div class="gate-sha-box"><span>Candidate ${stage.candidateLabel}</span><code>${stage.candidateSha}</code></div></div>
      <table class="leaderboard-table"><thead><tr><th>Metric</th><th>${stage.baselineLabel}</th><th>${stage.candidateLabel}</th><th>Rule</th><th>Status</th></tr></thead><tbody>${checkRows(stage)}</tbody></table>
    </article>`;
  }
  function renderGraph(s){
    const c=s.commits;
    graph.innerHTML = `<svg viewBox="0 0 980 310" role="img">
      <defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#94a3b8"/></marker><marker id="arrowGreen" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#22c55e"/></marker><marker id="arrowBlue" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#0ea5e9"/></marker></defs>
      <text x="24" y="72" class="gate-lane-label">main</text><text x="24" y="154" class="gate-lane-label">B1 branch</text><text x="24" y="246" class="gate-lane-label">after rebase</text>
      <path d="M120 70 L260 70 L400 70 L540 70 L680 70" class="gate-commit-line" marker-end="url(#arrow)"/>
      <path d="M260 70 C300 112,330 132,380 150 L560 150" class="gate-branch-line" marker-end="url(#arrowGreen)"/>
      <path d="M680 70 C720 118,750 214,805 240 L925 240" class="gate-rebase-line" marker-end="url(#arrowBlue)"/>
      ${[[120,70,'M0'],[260,70,'M1 '+c.m1],[400,70,'main+'],[540,70,'main+'],[680,70,'M2 '+c.m2],[380,150,'C1'],[470,150,'C2'],[560,150,'B1 '+c.b1],[805,240,"C1′"],[875,240,"C2′"],[925,240,"B1′ "+c.b1p]].map(([x,y,t])=>`<circle cx="${x}" cy="${y}" r="12" class="gate-commit-dot"/><text x="${x-34}" y="${y-24}" class="gate-commit-label">${t}</text>`).join('')}
    </svg>`;
  }
  function render(id){
    const s = scenarios.find(x=>x.id===id) || scenarios[0];
    overview.innerHTML = `
      <div class="gate-tile"><div class="gate-tile-label">Final Result</div><div class="gate-tile-value">${badge(s.finalStatus)}</div><div class="gate-tile-sub">Both stages must pass</div></div>
      <div class="gate-tile"><div class="gate-tile-label">Model</div><div class="gate-tile-value">7B</div><div class="gate-tile-sub">Qwen/Qwen2.5-7B-Instruct</div></div>
      <div class="gate-tile"><div class="gate-tile-label">Baseline route</div><div class="gate-tile-value">M1 → M2</div><div class="gate-tile-sub">dynamic commit benchmarks</div></div>
      <div class="gate-tile"><div class="gate-tile-label">Publish mode</div><div class="gate-tile-value">${s.id === 'latest-ci' ? 'CI updated' : 'Gate only'}</div><div class="gate-tile-sub">${s.id === 'latest-ci' ? 'published by GitHub Actions' : 'no same-spec / leaderboard'}</div></div>`;
    rebaseBadge.textContent = `rebase: ${s.rebaseStatus}`;
    rebaseBadge.className = `gate-status ${s.rebaseStatus === 'conflict' ? 'fail' : s.rebaseStatus === 'clean' ? 'pass' : 'neutral'}`;
    renderGraph(s);
    let html = s.stages.map(renderStage).join('');
    if (s.rebaseStatus === 'conflict') {
      html += `<article class="gate-card"><div class="gate-card-head"><div><div class="gate-card-title">Stage 2 · Rebase check</div><div class="gate-card-subtitle">B1 cannot be replayed on M2 automatically.</div></div>${badge('FAIL')}</div><div class="gate-sha-row"><div class="gate-sha-box"><span>Required manual action</span><code>git rebase origin/main</code></div><div class="gate-sha-box"><span>Push safely</span><code>git push --force-with-lease</code></div></div></article>`;
    }
    stageResults.innerHTML = html;
  }
  function updateMeta(source){
    if (!meta) return;
    const latest = scenarios.find(s=>s.id==='latest-ci');
    if (!latest) {
      meta.textContent = `Loaded ${scenarios.length} mock gate scenarios • Showing one PR check simulation`;
      return;
    }
    const pieces = [`Loaded latest CI result + ${scenarios.length - 1} mock scenarios`];
    if (source?.branch) pieces.push(`branch ${source.branch}`);
    if (source?.prNumber) pieces.push(`PR #${source.prNumber}`);
    meta.textContent = pieces.join(' • ');
  }
  async function loadLatestGateResult(){
    try {
      const response = await fetch('./data/gate-latest.json', { cache: 'no-cache' });
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.warn('[gate] latest CI result unavailable, using mock scenarios only', error);
      return null;
    }
  }
  async function init(){
    const latest = await loadLatestGateResult();
    if (latest?.scenario?.stages?.length) {
      scenarios.unshift(latest.scenario);
    }
    scenarios.forEach(s=>{ const option=document.createElement('option'); option.value=s.id; option.textContent=s.label; select.appendChild(option); });
    updateMeta(latest?.source);
    select.addEventListener('change', e=>render(e.target.value));
    render(scenarios[0].id);
  }
  init();
})();
