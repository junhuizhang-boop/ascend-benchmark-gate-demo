(function(){
  const mockScenarios = window.GATE_SCENARIOS || [];
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

  let acceptedPayload = null;
  let scenarios = [];

  function fmt(n, unit='', integer=false) {
    if (typeof n !== 'number') return String(n);
    if (integer) return `${Math.trunc(n)}${unit}`;
    return `${n.toFixed(n >= 10 ? 1 : 2).replace(/\.0$/, '')}${unit}`;
  }
  function badge(status){ const s=(status||'neutral').toLowerCase(); return `<span class="gate-status ${s==='pass'?'pass':s==='fail'?'fail':'neutral'}">${status}</span>`; }
  function isMergedRecord(s){ return s.id?.startsWith('merged-') || s.rebaseStatus === 'merged'; }
  function stageCnTitle(stage, s){
    if (isMergedRecord(s)) return '已合并成功的性能记录';
    if (stage.id === 'stage1') return '阶段一：PR 分支基线对比';
    if (stage.id === 'stage2') return '阶段二：基于最新 main 的 rebase 后对比';
    return stage.title || '门控阶段';
  }
  function stagePurpose(stage, s){
    if (isMergedRecord(s)) return '该记录只会在 PR 门控通过并合并到 main 后由 Pages workflow 发布；失败 PR 不会出现在这里。';
    if (stage.id === 'stage1') return `验证 PR 当前提交 ${stage.candidateLabel} 是否相对分支起点 ${stage.baselineLabel} 发生性能退化。`;
    return `验证 CI 将 PR 本地 rebase 到最新 main 后得到的 ${stage.candidateLabel}，是否相对最新 main ${stage.baselineLabel} 发生性能退化。`;
  }
  function metricVerdict(def, base, cand){
    if (def.direction === 'higher') {
      const threshold = base * policy[def.policyKey];
      return { pass: cand >= threshold, rule: `${def.name} 不低于基线 × ${policy[def.policyKey]}，即 ≥ ${fmt(threshold, def.unit)}`, delta: `${cand >= base ? '+' : ''}${fmt(cand - base, def.unit)}` };
    }
    if (def.direction === 'lower') {
      const threshold = base * policy[def.policyKey];
      return { pass: cand <= threshold, rule: `${def.name} 不高于基线 × ${policy[def.policyKey]}，即 ≤ ${fmt(threshold, def.unit)}`, delta: `${cand >= base ? '+' : ''}${fmt(cand - base, def.unit)}` };
    }
    return { pass: cand <= policy.failedMax, rule: `${def.name} ≤ ${policy.failedMax}`, delta: `${cand >= base ? '+' : ''}${cand - base}` };
  }
  function metricRows(metrics){
    return metricDefs.map(def => `<tr><td>${def.name}</td><td>${fmt(metrics[def.key], def.unit, def.key === 'failed')}</td></tr>`).join('');
  }
  function checkRows(stage, s){
    const b=stage.baseline, c=stage.candidate;
    return metricDefs.map(def => {
      const base = b[def.key];
      const cand = c[def.key];
      const verdict = metricVerdict(def, base, cand);
      return `<tr>
        <td>${def.name}</td>
        <td>${fmt(base, def.unit, def.key === 'failed')}</td>
        <td>${fmt(cand, def.unit, def.key === 'failed')}</td>
        <td>${isMergedRecord(s) ? '已合并记录' : verdict.delta}</td>
        <td class="gate-rule-text">${isMergedRecord(s) ? 'PR 阶段已通过两阶段门控；合并后发布到页面。' : verdict.rule}</td>
        <td>${badge(stage.result || 'PASS')}</td>
      </tr>`;
    }).join('');
  }
  function renderStage(stage, s){
    const failedMetrics = isMergedRecord(s) ? [] : metricDefs.filter(def => !metricVerdict(def, stage.baseline[def.key], stage.candidate[def.key]).pass).map(def => def.name);
    const reason = isMergedRecord(s)
      ? '该分支已通过 PR 门控并合并到 main，因此同步到页面。未通过门控的分支不会进入此列表。'
      : failedMetrics.length ? `未通过指标：${failedMetrics.join('、')}。` : '所有性能指标均满足门控阈值。';
    return `<article class="gate-card">
      <div class="gate-card-head"><div><div class="gate-card-title">${stageCnTitle(stage, s)}</div><div class="gate-card-subtitle">${stagePurpose(stage, s)}</div></div>${badge(stage.result || s.finalStatus)}</div>
      <div class="gate-explain"><strong>页面同步规则：</strong>${reason}</div>
      ${isMergedRecord(s) && s.metrics ? `<div class="gate-explain"><strong>已发布 benchmark：</strong>${s.metrics.model || ''} · ${s.metrics.scenario || ''} · ${s.metrics.hardware || ''}</div>` : ''}
      <div class="gate-sha-row"><div class="gate-sha-box"><span>${isMergedRecord(s) ? 'main 记录' : '基线 ' + stage.baselineLabel}</span><code>${stage.baselineSha}</code></div><div class="gate-sha-box"><span>${isMergedRecord(s) ? '合并提交' : '候选 ' + stage.candidateLabel}</span><code>${stage.candidateSha}</code></div></div>
      <table class="leaderboard-table"><thead><tr><th>指标</th><th>基线值</th><th>候选/发布值</th><th>变化量</th><th>门控/同步规则</th><th>结果</th></tr></thead><tbody>${checkRows(stage, s)}</tbody></table>
    </article>`;
  }
  function renderGraph(s){
    const c=s.commits;
    graph.innerHTML = `<svg viewBox="0 0 980 310" role="img">
      <defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#94a3b8"/></marker><marker id="arrowGreen" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#22c55e"/></marker><marker id="arrowBlue" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#0ea5e9"/></marker></defs>
      <text x="24" y="72" class="gate-lane-label">main 主线</text><text x="24" y="154" class="gate-lane-label">PR 分支</text><text x="24" y="246" class="gate-lane-label">合并/发布</text>
      <path d="M120 70 L260 70 L400 70 L540 70 L680 70" class="gate-commit-line" marker-end="url(#arrow)"/>
      <path d="M260 70 C300 112,330 132,380 150 L560 150" class="gate-branch-line" marker-end="url(#arrowGreen)"/>
      <path d="M680 70 C720 118,750 214,805 240 L925 240" class="gate-rebase-line" marker-end="url(#arrowBlue)"/>
      ${[[120,70,'main'],[260,70,'M1 '+(c.m1||'')],[680,70,'M2 '+(c.m2||'')],[380,150,'PR'],[560,150,'B1 '+(c.b1||'')],[805,240,'Checks PASS'],[925,240,'已合并 '+(c.b1p||'')]].map(([x,y,t])=>`<circle cx="${x}" cy="${y}" r="12" class="gate-commit-dot"/><text x="${x-46}" y="${y-24}" class="gate-commit-label">${t}</text>`).join('')}
    </svg>`;
  }
  function renderAcceptedList(){
    const records = acceptedPayload?.records || [];
    if (!records.length) return '<div class="gate-linkage-panel"><h3>暂无已合并记录</h3><p>PR 必须通过性能门控并合并到 main 后，才会显示在这里。</p></div>';
    return `<div class="gate-linkage-panel"><h3>已合并成功记录</h3><p>这些记录来自 main 上的 Pages 发布流程。性能不达标的 PR 因为没有合并，不会同步到页面。</p><table class="leaderboard-table"><thead><tr><th>合并提交</th><th>模型/场景</th><th>输出吞吐</th><th>请求吞吐</th><th>TTFT</th><th>状态</th></tr></thead><tbody>${records.map(r=>`<tr><td><code>${r.source?.sha?.slice(0,8)||''}</code></td><td>${r.metrics?.model||''}<br><span class="gate-rule-text">${r.metrics?.scenario||''}</span></td><td>${fmt(r.metrics?.outputThroughput, ' tok/s')}</td><td>${fmt(r.metrics?.requestThroughput, ' req/s')}</td><td>${fmt(r.metrics?.meanTtftMs, ' ms')}</td><td>${badge('PASS')}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function renderRejectedExamples(){
    const items = acceptedPayload?.rejectedExamples || [];
    if (!items.length) return '';
    return `<div class="gate-linkage-panel"><h3>未同步到页面的失败分支示例</h3><ul>${items.map(item=>`<li><strong>${item.branch}</strong>：${item.reason}</li>`).join('')}</ul></div>`;
  }
  function render(id){
    const s = scenarios.find(x=>x.id===id) || scenarios[0];
    overview.innerHTML = `
      <div class="gate-tile"><div class="gate-tile-label">页面口径</div><div class="gate-tile-value">已合并</div><div class="gate-tile-sub">只展示 main 已接受记录</div></div>
      <div class="gate-tile"><div class="gate-tile-label">PR 门控</div><div class="gate-tile-value">拦截失败</div><div class="gate-tile-sub">失败 PR 不能合并</div></div>
      <div class="gate-tile"><div class="gate-tile-label">数据来源</div><div class="gate-tile-value">main Pages</div><div class="gate-tile-sub">合并后发布 accepted-runs</div></div>
      <div class="gate-tile"><div class="gate-tile-label">当前记录</div><div class="gate-tile-value">${badge(s.finalStatus)}</div><div class="gate-tile-sub">${isMergedRecord(s) ? '已合并成功' : '仅用于场景说明'}</div></div>`;
    rebaseBadge.textContent = isMergedRecord(s) ? '合并：已同步页面' : `rebase：${s.rebaseStatus === 'clean' ? '成功' : s.rebaseStatus === 'conflict' ? '冲突' : '未执行'}`;
    rebaseBadge.className = `gate-status ${s.finalStatus === 'FAIL' ? 'fail' : 'pass'}`;
    renderGraph(s);
    let html = `${renderAcceptedList()}${renderRejectedExamples()}<div class="gate-linkage-panel"><h3>为什么失败分支不显示？</h3><p>PR 上的 two-stage gate 是合并前检查：阶段一或阶段二失败时，Checks 为失败，分支不能合并到 main。页面部署只在 main push 后运行，所以失败分支自然不会进入页面数据。</p></div>`;
    html += s.stages.map(stage=>renderStage(stage, s)).join('');
    stageResults.innerHTML = html;
  }
  function updateMeta(){
    if (!meta) return;
    const records = acceptedPayload?.records?.length || 0;
    meta.textContent = `页面只展示已合并成功记录：当前 ${records} 条。失败 PR 只会停留在 Checks，不会同步到页面。`;
  }
  async function loadAcceptedRuns(){
    try {
      const response = await fetch('./data/accepted-runs.json', { cache: 'no-cache' });
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.warn('[gate] accepted runs unavailable, using mock scenarios only', error);
      return null;
    }
  }
  async function init(){
    acceptedPayload = await loadAcceptedRuns();
    const acceptedScenarios = (acceptedPayload?.records || []).map(record => ({ ...record, id: record.id || `merged-${record.source?.sha?.slice(0,8)}` }));
    scenarios = acceptedScenarios.length ? acceptedScenarios.concat(mockScenarios) : mockScenarios;
    scenarios.forEach(s=>{ const option=document.createElement('option'); option.value=s.id; option.textContent=s.label; select.appendChild(option); });
    updateMeta();
    select.addEventListener('change', e=>render(e.target.value));
    render(scenarios[0].id);
  }
  init();
})();
