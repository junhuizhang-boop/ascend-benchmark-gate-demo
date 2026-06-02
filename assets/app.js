(function(){
  const scenarios = window.GATE_SCENARIOS;
  const policy = window.GATE_POLICY;
  const select = document.getElementById('scenarioSelect');
  const overview = document.getElementById('overview');
  const stageResults = document.getElementById('stageResults');
  const graph = document.getElementById('commitGraph');
  const rebaseBadge = document.getElementById('rebaseBadge');
  const meta = document.getElementById('gateMeta');

  const metricDefs = [
    { key: 'outputThroughput', name: '输出吞吐', unit: ' tok/s', direction: 'higher', policyKey: 'outputThroughputMinRatio' },
    { key: 'requestThroughput', name: '请求吞吐', unit: ' req/s', direction: 'higher', policyKey: 'requestThroughputMinRatio' },
    { key: 'meanTtftMs', name: '平均 TTFT', unit: ' ms', direction: 'lower', policyKey: 'meanTtftMaxRatio' },
    { key: 'failed', name: '失败请求数', unit: '', direction: 'max', policyKey: 'failedMax' }
  ];

  function fmt(n, unit='', integer=false) {
    if (typeof n !== 'number') return String(n);
    if (integer) return `${Math.trunc(n)}${unit}`;
    return `${n.toFixed(n >= 10 ? 1 : 2).replace(/\.0$/, '')}${unit}`;
  }
  function badge(status){ const s=(status||'neutral').toLowerCase(); return `<span class="gate-status ${s==='pass'?'pass':s==='fail'?'fail':'neutral'}">${status}</span>`; }
  function stageCnTitle(stage){
    if (stage.id === 'stage1') return '阶段一：PR 分支基线对比';
    if (stage.id === 'stage2') return '阶段二：基于最新 main 的 rebase 后对比';
    return stage.title || '门控阶段';
  }
  function stagePurpose(stage){
    if (stage.id === 'stage1') {
      return `验证 PR 当前提交 ${stage.candidateLabel} 是否相对分支起点 ${stage.baselineLabel} 发生性能退化。`;
    }
    return `验证 CI 将 PR 本地 rebase 到最新 main 后得到的 ${stage.candidateLabel}，是否相对最新 main ${stage.baselineLabel} 发生性能退化。`;
  }
  function metricVerdict(def, base, cand){
    if (def.direction === 'higher') {
      const threshold = base * policy[def.policyKey];
      return {
        pass: cand >= threshold,
        threshold,
        rule: `${def.name} 不低于基线 × ${policy[def.policyKey]}，即 ≥ ${fmt(threshold, def.unit)}`,
        delta: `${cand >= base ? '+' : ''}${fmt(cand - base, def.unit)}`
      };
    }
    if (def.direction === 'lower') {
      const threshold = base * policy[def.policyKey];
      return {
        pass: cand <= threshold,
        threshold,
        rule: `${def.name} 不高于基线 × ${policy[def.policyKey]}，即 ≤ ${fmt(threshold, def.unit)}`,
        delta: `${cand >= base ? '+' : ''}${fmt(cand - base, def.unit)}`
      };
    }
    return {
      pass: cand <= policy.failedMax,
      threshold: policy.failedMax,
      rule: `${def.name} ≤ ${policy.failedMax}`,
      delta: `${cand >= base ? '+' : ''}${cand - base}`
    };
  }
  function checkRows(stage){
    const b=stage.baseline, c=stage.candidate;
    return metricDefs.map(def => {
      const base = b[def.key];
      const cand = c[def.key];
      const verdict = metricVerdict(def, base, cand);
      return `<tr>
        <td>${def.name}</td>
        <td>${fmt(base, def.unit, def.key === 'failed')}</td>
        <td>${fmt(cand, def.unit, def.key === 'failed')}</td>
        <td>${verdict.delta}</td>
        <td class="gate-rule-text">${verdict.rule}</td>
        <td>${badge(verdict.pass?'PASS':'FAIL')}</td>
      </tr>`;
    }).join('');
  }
  function renderStage(stage){
    const failedMetrics = metricDefs.filter(def => !metricVerdict(def, stage.baseline[def.key], stage.candidate[def.key]).pass).map(def => def.name);
    const reason = failedMetrics.length
      ? `未通过指标：${failedMetrics.join('、')}。`
      : '所有性能指标均满足门控阈值。';
    return `<article class="gate-card">
      <div class="gate-card-head">
        <div>
          <div class="gate-card-title">${stageCnTitle(stage)}</div>
          <div class="gate-card-subtitle">${stagePurpose(stage)}</div>
        </div>
        ${badge(stage.result)}
      </div>
      <div class="gate-explain">
        <strong>门控数据来源：</strong>读取 <code>${stage.baselineLabel}</code> 与 <code>${stage.candidateLabel}</code> 两个 commit 各自的 <code>benchmark-metrics.json</code>，再按下方规则逐项比较。<br />
        <strong>判定结论：</strong>${reason}
      </div>
      <div class="gate-sha-row"><div class="gate-sha-box"><span>基线 ${stage.baselineLabel}</span><code>${stage.baselineSha}</code></div><div class="gate-sha-box"><span>候选 ${stage.candidateLabel}</span><code>${stage.candidateSha}</code></div></div>
      <table class="leaderboard-table"><thead><tr><th>指标</th><th>基线值</th><th>候选值</th><th>变化量</th><th>门控规则</th><th>结果</th></tr></thead><tbody>${checkRows(stage)}</tbody></table>
    </article>`;
  }
  function renderGraph(s){
    const c=s.commits;
    graph.innerHTML = `<svg viewBox="0 0 980 310" role="img">
      <defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#94a3b8"/></marker><marker id="arrowGreen" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#22c55e"/></marker><marker id="arrowBlue" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#0ea5e9"/></marker></defs>
      <text x="24" y="72" class="gate-lane-label">main 主线</text><text x="24" y="154" class="gate-lane-label">PR 分支</text><text x="24" y="246" class="gate-lane-label">rebase 后</text>
      <path d="M120 70 L260 70 L400 70 L540 70 L680 70" class="gate-commit-line" marker-end="url(#arrow)"/>
      <path d="M260 70 C300 112,330 132,380 150 L560 150" class="gate-branch-line" marker-end="url(#arrowGreen)"/>
      <path d="M680 70 C720 118,750 214,805 240 L925 240" class="gate-rebase-line" marker-end="url(#arrowBlue)"/>
      ${[[120,70,'M0'],[260,70,'M1 '+c.m1],[400,70,'main+'],[540,70,'main+'],[680,70,'M2 '+c.m2],[380,150,'C1'],[470,150,'C2'],[560,150,'B1 '+c.b1],[805,240,"C1′"],[875,240,"C2′"],[925,240,"B1′ "+c.b1p]].map(([x,y,t])=>`<circle cx="${x}" cy="${y}" r="12" class="gate-commit-dot"/><text x="${x-34}" y="${y-24}" class="gate-commit-label">${t}</text>`).join('')}
    </svg>`;
  }
  function render(id){
    const s = scenarios.find(x=>x.id===id) || scenarios[0];
    overview.innerHTML = `
      <div class="gate-tile"><div class="gate-tile-label">最终结论</div><div class="gate-tile-value">${badge(s.finalStatus)}</div><div class="gate-tile-sub">阶段一和阶段二都通过才算通过</div></div>
      <div class="gate-tile"><div class="gate-tile-label">模型/场景</div><div class="gate-tile-value">7B</div><div class="gate-tile-sub">Qwen2.5-7B · random-online</div></div>
      <div class="gate-tile"><div class="gate-tile-label">比较路径</div><div class="gate-tile-value">M1 → M2</div><div class="gate-tile-sub">先比旧基线，再比最新 main</div></div>
      <div class="gate-tile"><div class="gate-tile-label">页面数据</div><div class="gate-tile-value">${s.id === 'latest-ci' ? 'CI 更新' : '示例数据'}</div><div class="gate-tile-sub">${s.id === 'latest-ci' ? '来自 GitHub Actions 真实门控结果' : '用于演示 PASS/FAIL 场景'}</div></div>`;
    rebaseBadge.textContent = `rebase：${s.rebaseStatus === 'clean' ? '成功' : s.rebaseStatus === 'conflict' ? '冲突' : '未执行'}`;
    rebaseBadge.className = `gate-status ${s.rebaseStatus === 'conflict' ? 'fail' : s.rebaseStatus === 'clean' ? 'pass' : 'neutral'}`;
    renderGraph(s);
    let html = `<div class="gate-linkage-panel">
      <h3>页面数据如何对应性能门控？</h3>
      <p>下方每个阶段的表格都直接使用该阶段两个 commit 的 benchmark 指标：左列是基线 commit，右列是候选 commit。门控规则列展示阈值计算，结果列就是 Actions 中 Stage 1 / Stage 2 的 PASS 或 FAIL。</p>
      <ul>
        <li><strong>阶段一：</strong><code>B1</code> 对比 <code>M1</code>，判断 PR 是否相对分支起点退化。</li>
        <li><strong>阶段二：</strong><code>B1′</code> 对比 <code>M2</code>，判断 PR rebase 到最新 main 后是否退化。</li>
      </ul>
    </div>`;
    html += s.stages.map(renderStage).join('');
    if (s.rebaseStatus === 'conflict') {
      html += `<article class="gate-card"><div class="gate-card-head"><div><div class="gate-card-title">阶段二：rebase 检查</div><div class="gate-card-subtitle">B1 无法自动应用到 M2，不能生成 B1′ 进行性能复测。</div></div>${badge('FAIL')}</div><div class="gate-sha-row"><div class="gate-sha-box"><span>需要手动处理</span><code>git rebase origin/main</code></div><div class="gate-sha-box"><span>安全推送</span><code>git push --force-with-lease</code></div></div></article>`;
    }
    stageResults.innerHTML = html;
  }
  function updateMeta(source){
    if (!meta) return;
    const latest = scenarios.find(s=>s.id==='latest-ci');
    if (!latest) {
      meta.textContent = `已加载 ${scenarios.length} 个示例门控场景 · 当前展示 PR 检查模拟`;
      return;
    }
    const pieces = [`已加载最新 CI 结果 + ${scenarios.length - 1} 个示例场景`];
    if (source?.branch) pieces.push(`分支 ${source.branch}`);
    if (source?.prNumber) pieces.push(`PR #${source.prNumber}`);
    meta.textContent = pieces.join(' · ');
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
