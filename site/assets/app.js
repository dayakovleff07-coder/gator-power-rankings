/* Gator League power rankings: page logic. Depends on engine.js (window.PowerEngine). */
(function () {
  'use strict';
  const CFG = window.GATOR_CONFIG || {};
  const E = window.PowerEngine;
  const U = E.util;
  const FACTORS = E.FACTORS;
  const STORE = 'gator-pr-settings-v1';
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  // One league formula, set in GATOR_CONFIG. Visitors can't change it.
  const state = {
    league: null, res: null, week: null,
    weights: Object.assign({}, CFG.weights || { pointsFor: 80, recent: 20 }),
    recentWeeks: CFG.recentWeeks || 3,
    scale: CFG.scale || 'range',
    open: {}
  };

  // ------------------------------------------------------------ utils
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const f1 = U.f1, pts = U.fmtPts, signed = U.signed, rec = U.recStr;
  function fullWeights(w) { const o = {}; FACTORS.forEach(f => { o[f.key] = Math.max(0, Number(w && w[f.key]) || 0); }); return o; }
  function shares(w) {
    const full = fullWeights(w);
    let total = FACTORS.reduce((s, f) => s + full[f.key], 0);
    const keys = FACTORS.map(f => f.key);
    if (total <= 0) { keys.forEach(k => { full[k] = 1; }); total = keys.length; }
    const raw = keys.map(k => ({ k, v: 100 * full[k] / total }));
    const out = {}; let used = 0;
    raw.forEach(r => { out[r.k] = Math.floor(r.v); used += out[r.k]; });
    raw.slice().sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v))).slice(0, 100 - used).forEach(r => { out[r.k]++; });
    return out;
  }
  function factorDesc(f) { return f.desc.replace('{n}', U.word(state.recentWeeks)); }
  function fmtDate(iso, withTime, short) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const o = short ? { weekday: 'short', month: 'short', day: 'numeric', timeZone: CFG.timeZone || undefined }
      : { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: CFG.timeZone || undefined };
    if (withTime) { o.hour = 'numeric'; o.minute = '2-digit'; o.timeZoneName = 'short'; }
    try { return d.toLocaleString('en-US', o); } catch (e) { return d.toDateString(); }
  }

  function compute() {
    state.res = E.compute(state.league, {
      week: state.week, weights: state.weights, recentWeeks: state.recentWeeks, scale: state.scale,
      tierNames: CFG.tierNames || null, notes: CFG.notes || {}
    });
  }

  // ------------------------------------------------------------ small svg bits
  function moveHtml(m) {
    if (m === null || m === undefined) return '<span class="mv same"><span class="sr">New</span><svg width="12" height="10" viewBox="0 0 12 10" aria-hidden="true"><path d="M1 5 H11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>';
    if (m > 0) return `<span class="mv up"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1 L9.5 9 L0.5 9 Z" fill="currentColor"/></svg><span class="sr">Up </span>${m}</span>`;
    if (m < 0) return `<span class="mv down"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 9 L9.5 1 L0.5 1 Z" fill="currentColor"/></svg><span class="sr">Down </span>${-m}</span>`;
    return '<span class="mv same"><span class="sr">No change</span><svg width="12" height="10" viewBox="0 0 12 10" aria-hidden="true"><path d="M1 5 H11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>';
  }
  const chev = '<svg class="chev" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 5 L7 9 L11 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const dot = (filled) => `<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="${filled ? 3.5 : 3}" fill="${filled ? 'var(--ink)' : 'var(--bg)'}" stroke="var(--ink)" stroke-width="1.4"/></svg>`;

  function scoreRange() {
    let lo = Infinity, hi = -Infinity;
    state.res.teams.forEach(t => t.weekly.forEach(w => { lo = Math.min(lo, w.score); hi = Math.max(hi, w.score); }));
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    const pad = (hi - lo) * 0.08 || 5;
    return [lo - pad, hi + pad];
  }

  function sparkline(t, range) {
    const w = 124, h = 40, n = t.weekly.length;
    if (!n) return '';
    const [lo, hi] = range;
    const x = i => n === 1 ? w / 2 : 6 + i * (w - 12) / (n - 1);
    const y = s => h - 6 - (s - lo) / (hi - lo) * (h - 12);
    const p = t.weekly.map((wk, i) => `${x(i).toFixed(1)},${y(wk.score).toFixed(1)}`).join(' ');
    const dots = t.weekly.map((wk, i) => wk.r === 'W'
      ? `<circle cx="${x(i).toFixed(1)}" cy="${y(wk.score).toFixed(1)}" r="3" fill="var(--ink)"/>`
      : wk.r === 'B'
        ? `<rect x="${(x(i) - 2.5).toFixed(1)}" y="${(y(wk.score) - 2.5).toFixed(1)}" width="5" height="5" fill="var(--muted)"/>`
        : `<circle cx="${x(i).toFixed(1)}" cy="${y(wk.score).toFixed(1)}" r="2.6" fill="var(--bg)" stroke="var(--ink)" stroke-width="1.4"/>`).join('');
    const seq = t.weekly.map(wk => wk.r).join('');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Weekly scores, results ${seq}"><polyline points="${p}" fill="none" stroke="var(--ink)" stroke-width="1.5" stroke-linejoin="round"/>${dots}</svg>`;
  }

  function weeklyBars(t, width) {
    const res = state.res;
    const n = t.weekly.length;
    if (!n) return '';
    const h = 156, base = 118, top = 18;
    let max = 0, all = [];
    res.teams.forEach(o => o.weekly.forEach(w => { max = Math.max(max, w.score); all.push(w.score); }));
    const leagueAvg = all.reduce((a, b) => a + b, 0) / (all.length || 1);
    const gap = Math.max(4, Math.min(12, width / n * 0.3));
    const bw = Math.max(6, (width - gap * (n - 1)) / n);
    const yOf = s => base - s / (max || 1) * (base - top);
    let hiI = 0, loI = 0;
    t.weekly.forEach((w, i) => { if (w.score > t.weekly[hiI].score) hiI = i; if (w.score < t.weekly[loI].score) loI = i; });
    const parts = [];
    t.weekly.forEach((w, i) => {
      const x = i * (bw + gap), y = yOf(w.score), r = Math.min(4, bw / 2);
      const tip = `Week ${w.week}: ${f1(w.score)}${w.r === 'B' ? ', bye' : ', ' + (w.r === 'W' ? 'win' : w.r === 'L' ? 'loss' : 'tie') + ' vs ' + (res.byId[w.opp] ? res.byId[w.opp].name : '') + ' (' + f1(w.pa) + ')'}`;
      const path = `M${x.toFixed(1)},${base} V${(y + r).toFixed(1)} Q${x.toFixed(1)},${y.toFixed(1)} ${(x + r).toFixed(1)},${y.toFixed(1)} H${(x + bw - r).toFixed(1)} Q${(x + bw).toFixed(1)},${y.toFixed(1)} ${(x + bw).toFixed(1)},${(y + r).toFixed(1)} V${base} Z`;
      const fill = w.r === 'W' ? 'fill="var(--ink)"' : w.r === 'B' ? 'fill="var(--grey)"' : 'fill="var(--bg)" stroke="var(--ink)" stroke-width="1.5"';
      parts.push(`<g><title>${esc(tip)}</title><path d="${path}" ${fill}/></g>`);
      if (n <= 18 || i % 2 === 0) parts.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${base + 16}" text-anchor="middle" font-size="11" fill="var(--muted)">${w.week}</text>`);
      parts.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${base + 31}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--ink)">${w.r === 'B' ? 'B' : w.r}</text>`);
      if (i === hiI || i === loI) parts.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--ink)">${f1(w.score)}</text>`);
    });
    const ay = yOf(leagueAvg);
    parts.push(`<line x1="0" y1="${ay.toFixed(1)}" x2="${width}" y2="${ay.toFixed(1)}" stroke="var(--s3)" stroke-width="1.5" stroke-dasharray="4 3"/>`);
    parts.push(`<line x1="0" y1="${base}" x2="${width}" y2="${base}" stroke="var(--ink)" stroke-width="1"/>`);
    const svg = `<svg width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" role="img" aria-label="Weekly scores for ${esc(t.name)}">${parts.join('')}</svg>`;
    const key = `<p class="wk-key"><span>${dot(true)} Win</span><span>${dot(false)} Loss</span><span><svg width="16" height="4" viewBox="0 0 16 4" aria-hidden="true"><line x1="0" y1="2" x2="16" y2="2" stroke="var(--s3)" stroke-width="1.5" stroke-dasharray="4 3"/></svg>League average ${f1(leagueAvg)}</span></p>`;
    return svg + key;
  }

  // ------------------------------------------------------------ shell
  function shell() {
    $('#body').innerHTML = `
<section class="wrap sec" id="numbers" aria-labelledby="wk-title">
  <div class="bar nums-head"><h2 class="small-h" id="wk-title"></h2><p class="label" id="wk-avg" style="margin:0"></p></div>
  <div class="nums" id="nums"></div>
</section>

<section class="wrap" id="formula" aria-labelledby="f-title">
  <div class="bar f-head">
    <div>
      <h2 class="small-h" id="f-title">The formula</h2>
      <p class="f-sum" id="f-sum"></p>
    </div>
    <a class="btn ghost" href="#method">How it works</a>
  </div>
</section>

<section class="wrap sec" id="order" aria-labelledby="o-title">
  <div class="o-head" style="margin-top:56px; border-top:4px solid var(--ink)">
    <h2 class="h2" id="o-title">The Order</h2>
    <div class="legend"><span>Score runs 0 to 100.</span><span>All-play is your record if you played every team every week.</span><span>${dot(true)} Win ${dot(false)} Loss</span></div>
  </div>
  <div class="cols grid-cols" aria-hidden="true" id="cols"></div>
  <div id="rows"></div>
</section>

<section class="wrap" aria-label="Analysis">
  <div class="bar an">
    <div id="luck">
      <h2 class="h2s">Luck Index</h2>
      <p class="sub">Actual wins against expected wins. Expected wins come from the all-play record: how often your score would have beaten the rest of the league.</p>
      <p class="ckey"><span>${dot(true)} Actual wins</span><span>${dot(false)} Expected wins</span><span><i class="sw" style="background:var(--s2)"></i>Luckier than the scores</span><span><i class="sw" style="background:var(--s3)"></i>Unluckier than the scores</span></p>
      <div class="chart" id="luck-chart"></div>
    </div>
    <div id="movement">
      <h2 class="h2s">How the Order Moved</h2>
      <p class="sub" id="move-sub"></p>
      <p class="ckey" id="move-key"></p>
      <div class="chart bump" id="bump-chart"></div>
      <p class="chart-note">Hover or tap a team to follow its line.</p>
    </div>
  </div>
</section>

<section class="wrap" id="method" aria-labelledby="m-title">
  <div class="bar" style="padding:22px 0 56px">
    <h2 class="h2s" id="m-title">How the Score Works</h2>
    <div class="m-grid" id="m-grid"></div>
    <p class="m-note" id="m-note"></p>
  </div>
</section>

<footer class="wrap"><div class="foot" id="foot"></div></footer>`;

    $('#rows').addEventListener('click', e => {
      const b = e.target.closest('.row-main');
      if (!b) return;
      const id = b.closest('.row').dataset.team;
      state.open[id] = !state.open[id];
      toggleRow(b.closest('.row'), state.open[id]);
    });
  }

  // ------------------------------------------------------------ renders
  function renderMast() {
    const L = state.league, r = state.res;
    const bits = [`<span>After Week ${r.week}</span>`];
    if (L.fetchedAt) bits.push(`<span class="dim">Updated ${esc(fmtDate(L.fetchedAt, false, true))}</span>`);
    bits.push(`<span class="dim k-teams">${L.teams.length} teams</span>`);
    if (L.currentWeek && L.currentWeek > L.lastWeek && (!L.regularSeasonWeeks || L.currentWeek <= L.regularSeasonWeeks) && r.week === L.lastWeek) {
      bits.push(`<span class="dim">Week ${L.currentWeek} in progress</span>`);
    }
    $('#kicker').innerHTML = bits.join('<span class="sq" aria-hidden="true"></span>').replace('<span class="sq" aria-hidden="true"></span><span class="dim k-teams">', '<span class="sq k-teams" aria-hidden="true"></span><span class="dim k-teams">');
    $('#dek').textContent = r.headline;
    document.title = `${L.name} Power Rankings, Week ${r.week}`;
    $('.mark').textContent = L.name;
  }

  function renderNumbers() {
    const a = state.res.awards;
    $('#wk-title').textContent = `Week ${state.res.week} in numbers`;
    if (!a) { $('#nums').innerHTML = ''; return; }
    $('#wk-avg').textContent = `League average ${f1(a.average)}`;
    const cells = [
      ['Top score', f1(a.high.score), esc(a.high.team)],
      ['Bottom score', f1(a.low.score), esc(a.low.team)]
    ];
    if (a.blowout) cells.push(['Blowout', f1(a.blowout.margin), `${esc(a.blowout.winner)} over ${esc(a.blowout.loser)}, ${f1(a.blowout.ws)} to ${f1(a.blowout.ls)}`]);
    if (a.close) cells.push(a.close.tie
      ? ['Dead heat', '0.0', `${esc(a.close.winner)} and ${esc(a.close.loser)} tied at ${f1(a.close.ws)}`]
      : ['Nail-biter', f1(a.close.margin), `${esc(a.close.winner)} over ${esc(a.close.loser)}, ${f1(a.close.ws)} to ${f1(a.close.ls)}`]);
    if (a.wrong) cells.push(['Wrong week', f1(a.wrong.score), `${esc(a.wrong.team)} lost with a score that beat ${a.wrong.beat} of the other ${a.wrong.others} teams`]);
    $('#nums').innerHTML = cells.map(c => `<div><p class="label" style="margin:0">${c[0]}</p><p class="v">${c[1]}</p><p class="d">${c[2]}</p></div>`).join('');
  }

  function renderFormulaSummary() {
    const sh = shares(state.weights);
    const items = FACTORS.filter(f => sh[f.key] > 0).sort((x, y) => sh[y.key] - sh[x.key])
      .map(f => `<span>${esc(f.short)} <b>${sh[f.key]}%</b></span>`);
    $('#f-sum').innerHTML = items.join('');
  }

  function colsHtml() {
    return `<span>Rk</span><span>Move</span><span>Team</span><span class="r">Record</span><span class="r">All-play</span><span class="r">Points for</span><span class="r c-l3">Last ${state.res.recentN}</span><span class="r">Luck</span><span class="r">Streak</span><span class="c-sp">Weekly</span><span>Score</span><span></span>`;
  }

  function rowHtml(t, range) {
    const r = state.res;
    const open = !!state.open[t.id];
    const blurb = r.blurbs[t.id] || '';
    return `<li class="row${open ? ' open' : ''}" data-team="${t.id}">
<button class="row-main grid-cols" type="button" aria-expanded="${open}" aria-controls="d-${t.id}">
  <span class="c-rk rk${t.rank === 1 ? ' one' : ''}"><span class="sr">Rank </span>${t.rank}</span>
  <span class="c-mv">${moveHtml(t.move)}</span>
  <span class="c-tm tm"><span class="nm-line"><span class="nm">${esc(t.name)}</span><span class="ow">${esc(t.owner)}</span></span>
    <span class="meta">${rec(t.w, t.l, t.t)} / ${esc(t.streak.label || 'None')}</span>
    <span class="bl">${esc(blurb)}</span></span>
  <span class="c-num num"><span class="sr">Record </span>${rec(t.w, t.l, t.t)}</span>
  <span class="c-num num"><span class="sr">All-play </span>${rec(t.apw, t.apl, t.apt)}</span>
  <span class="c-num num"><span class="sr">Points for </span>${pts(t.pf)}</span>
  <span class="c-num c-l3 num"><span class="sr">Last ${r.recentN} average </span>${f1(t.recent)}</span>
  <span class="c-num num"><span class="sr">Luck </span>${signed(t.luck)}</span>
  <span class="c-num num"><span class="sr">Streak </span>${esc(t.streak.label)}</span>
  <span class="c-sp">${sparkline(t, range)}</span>
  <span class="c-sc sc"><span class="sr">Score </span><span class="sv">${f1(t.score)}</span><span class="sbar" aria-hidden="true"><span style="width:${Math.max(1.5, t.score).toFixed(1)}%"></span></span></span>
  <span class="c-ch">${chev}</span>
</button>
<div class="row-detail" id="d-${t.id}"${open ? '' : ' hidden'}>${open ? detailHtml(t) : ''}</div>
</li>`;
  }

  function factorRaw(t, key) {
    switch (key) {
      case 'allPlay': return rec(t.apw, t.apl, t.apt);
      case 'pointsFor': return f1(t.ppg) + ' a game';
      case 'recent': return f1(t.recent) + ' avg';
      case 'winPct': return rec(t.w, t.l, t.t);
      case 'median': return rec(t.mw, t.ml, t.mt);
      case 'diff': return signed(t.diff) + ' a game';
      case 'consistency': return 'swings ' + f1(t.sd);
      case 'schedule': return 'opp. ' + f1(t.sos);
    }
    return '';
  }

  function detailHtml(t) {
    const r = state.res;
    const parts = FACTORS.filter(f => t.parts[f.key].share > 0)
      .sort((a, b) => t.parts[b.key].points - t.parts[a.key].points);
    const why = parts.map(f => {
      const p = t.parts[f.key];
      return `<span class="fl"><b>${esc(f.short)}</b> <span>${esc(factorRaw(t, f.key))}</span></span>
<span class="fb" role="img" aria-label="${esc(f.short)}: ${Math.round(p.scaled)} of 100"><span style="width:${Math.max(1, p.scaled).toFixed(1)}%"></span></span>
<span class="fp">+${f1(p.points)}</span>`;
    }).join('');
    const stats = [
      ['Record', rec(t.w, t.l, t.t)], ['All-play', rec(t.apw, t.apl, t.apt)],
      ['Points for', pts(t.pf)], ['Points against', pts(t.pa)],
      [`Last ${r.recentN} avg`, f1(t.recent)], ['Top-half weeks', `${t.mw} of ${t.weekly.length}`],
      ['Luck', signed(t.luck)], ['Expected wins', f1(t.expW)],
      ['Streak', t.streak.label || 'None'], ['Opponents avg', f1(t.sos)]
    ];
    return `<p class="d-blurb">${esc(r.blurbs[t.id] || '')}</p>
<div class="d-grid">
  <div><h3>Why No. ${t.rank}</h3><div class="why">${why}<span class="fl tot">Power score</span><span class="tot"></span><span class="fp tot">${f1(t.score)}</span></div>
    <p class="chart-note">Bars show where the team sits on each factor, lowest in the league to highest. Points are its share of the score.</p></div>
  <div><h3>Weekly scores</h3><div class="wk-chart" data-team="${t.id}"></div></div>
  <div class="stats-wrap"><h3>Season</h3><dl class="stats">${stats.map(s => `<div><dt>${s[0]}</dt><dd>${esc(s[1])}</dd></div>`).join('')}</dl></div>
</div>`;
  }

  function drawWeekly(scope) {
    $$('.wk-chart', scope).forEach(el => {
      const t = state.res.byId[el.dataset.team];
      if (t) el.innerHTML = weeklyBars(t, Math.max(220, Math.min(520, el.clientWidth || 300)));
    });
  }

  function toggleRow(li, open) {
    const id = li.dataset.team;
    const t = state.res.byId[id];
    li.classList.toggle('open', open);
    $('.row-main', li).setAttribute('aria-expanded', String(open));
    const d = $('.row-detail', li);
    if (open) { d.innerHTML = detailHtml(t); d.hidden = false; drawWeekly(d); }
    else { d.hidden = true; d.innerHTML = ''; }
  }

  function renderOrder(animate) {
    const r = state.res;
    const host = $('#rows');
    const before = new Map();
    if (animate && !reduceMotion) $$('.row', host).forEach(el => before.set(el.dataset.team, el.getBoundingClientRect().top));
    $('#cols').innerHTML = colsHtml();
    const range = scoreRange();
    host.innerHTML = r.tiers.map(tier => `
<section aria-labelledby="tier-${tier.index}">
  <h3 class="tier-head" id="tier-${tier.index}"><span class="tn">Tier ${tier.index}</span><span class="tt">${esc(tier.name)}</span><span class="tx">${esc(tier.note)}</span></h3>
  <ol class="rows" start="${tier.teams[0].rank}">${tier.teams.map(t => rowHtml(t, range)).join('')}</ol>
</section>`).join('');
    drawWeekly(host);
    if (before.size) {
      const moved = [];
      $$('.row', host).forEach(el => {
        const b = before.get(el.dataset.team);
        if (b === undefined) return;
        const d = b - el.getBoundingClientRect().top;
        if (Math.abs(d) < 1) return;
        el.style.transition = 'none';
        el.style.transform = `translateY(${d}px)`;
        el.style.zIndex = '1';
        moved.push(el);
      });
      if (moved.length) {
        void host.offsetHeight;
        moved.forEach(el => {
          el.style.transition = 'transform 480ms cubic-bezier(.2,.7,.2,1)';
          el.style.transform = '';
          el.addEventListener('transitionend', () => { el.style.zIndex = ''; el.style.transition = ''; }, { once: true });
        });
      }
    }
  }

  function luckChart(width) {
    const T = state.res.teams.slice().sort((a, b) => (b.luck - a.luck) || (a.rank - b.rank));
    const rowH = 30, top = 30;
    const labW = Math.min(150, Math.max(104, width * 0.3)), valW = 46;
    const x0 = labW + 8, x1 = width - valW - 10;
    const maxG = Math.max(1, ...T.map(t => t.g));
    const X = v => x0 + v / maxG * (x1 - x0);
    const h = top + rowH * T.length + 4;
    const ticks = Array.from(new Set([0, Math.round(maxG / 3), Math.round(2 * maxG / 3), maxG]));
    const g = [];
    ticks.forEach(k => {
      g.push(`<line x1="${X(k).toFixed(1)}" y1="${top - 8}" x2="${X(k).toFixed(1)}" y2="${h - 2}" stroke="var(--rule)"/>`);
      g.push(`<text x="${X(k).toFixed(1)}" y="${top - 14}" text-anchor="middle" font-size="12" fill="var(--muted)">${k}${k === maxG ? ' wins' : ''}</text>`);
    });
    T.forEach((t, i) => {
      const y = top + i * rowH + rowH / 2 - 4;
      const act = t.w + 0.5 * t.t;
      const col = t.luck > 0.05 ? 'var(--s2)' : t.luck < -0.05 ? 'var(--s3)' : 'var(--grey)';
      const name = t.name.length > 18 && width < 420 ? t.name.slice(0, 17) + '…' : t.name;
      g.push(`<g><title>${esc(t.name)}: ${f1(act)} wins, ${f1(t.expW)} expected</title>
<rect x="0" y="${(y - rowH / 2).toFixed(1)}" width="${width}" height="${rowH}" fill="transparent"/>
<text x="0" y="${(y + 5).toFixed(1)}" font-size="14" font-weight="600" fill="var(--ink)">${esc(name)}</text>
<line x1="${X(t.expW).toFixed(1)}" y1="${y.toFixed(1)}" x2="${X(act).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${col}" stroke-width="4" stroke-linecap="round"/>
<circle cx="${X(t.expW).toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="var(--bg)" stroke="var(--ink)" stroke-width="2"/>
<circle cx="${X(act).toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" fill="var(--ink)" stroke="var(--bg)" stroke-width="2"/>
<text x="${width}" y="${(y + 5).toFixed(1)}" text-anchor="end" font-size="14" font-weight="700" fill="var(--ink)">${signed(t.luck)}</text></g>`);
    });
    return `<svg width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" role="img" aria-label="Luck index: actual wins compared with expected wins for each team">${g.join('')}</svg>`;
  }

  const ROLE_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
  function bumpChart(width) {
    const r = state.res, T = r.teams, n = T.length;
    const weeks = r.weeksPlayed;
    const picks = r.storylines;
    const colorOf = {};
    picks.forEach((p, i) => { colorOf[p.id] = ROLE_COLORS[i]; });
    const labW = Math.min(170, Math.max(108, width * 0.32));
    const x0 = 30, x1 = width - labW - 14;
    const rowH = Math.max(24, Math.min(34, 400 / n)), top = 34;
    const X = i => weeks.length === 1 ? (x0 + x1) / 2 : x0 + i * (x1 - x0) / (weeks.length - 1);
    const Y = rk => top + (rk - 1) * rowH;
    const h = top + (n - 1) * rowH + 16;
    const g = [];
    const every = weeks.length > 12 ? 2 : 1;
    weeks.forEach((wk, i) => {
      if (i % every === 0 || i === weeks.length - 1) g.push(`<text x="${X(i).toFixed(1)}" y="16" text-anchor="middle" font-size="12" font-weight="700" fill="var(--muted)">W${wk}</text>`);
      g.push(`<line x1="${X(i).toFixed(1)}" y1="24" x2="${X(i).toFixed(1)}" y2="${h - 8}" stroke="var(--rule)"/>`);
    });
    for (let k = 1; k <= n; k++) g.push(`<text x="${x0 - 16}" y="${(Y(k) + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="var(--muted)">${k}</text>`);
    const order = T.slice().sort((a, b) => (colorOf[a.id] ? 1 : 0) - (colorOf[b.id] ? 1 : 0) || b.rank - a.rank);
    order.forEach(t => {
      const hist = r.history[t.id];
      const ptsStr = hist.map((rk, i) => `${X(i).toFixed(1)},${Y(rk).toFixed(1)}`).join(' ');
      const c = colorOf[t.id] || 'var(--grey)';
      const hl = !!colorOf[t.id];
      g.push(`<g class="ln${hl ? ' pick' : ''}" data-team="${t.id}" style="--c:${c}"><title>${esc(t.name)}: ${hist.map((rk, i) => 'W' + weeks[i] + ' ' + rk).join(', ')}</title>
<polyline points="${ptsStr}" fill="none" stroke="${c}" stroke-width="${hl ? 3 : 1.5}" stroke-linejoin="round" stroke-linecap="round" class="vis"/>
${hl ? hist.map((rk, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(rk).toFixed(1)}" r="4.5" fill="${c}" stroke="var(--bg)" stroke-width="2"/>`).join('') : ''}
<polyline points="${ptsStr}" fill="none" stroke="transparent" stroke-width="14" class="hit"/></g>`);
    });
    T.forEach(t => {
      const hl = !!colorOf[t.id];
      const name = t.name.length > 20 && labW < 150 ? t.name.slice(0, 19) + '…' : t.name;
      g.push(`<text class="lab" data-team="${t.id}" tabindex="0" x="${(x1 + 14).toFixed(1)}" y="${(Y(t.rank) + 4.5).toFixed(1)}" font-size="13" font-weight="${hl ? 700 : 500}" fill="${hl ? 'var(--ink)' : 'var(--muted)'}">${esc(name)}</text>`);
    });
    return `<svg width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" role="img" aria-label="Power ranking for each team, week by week">${g.join('')}</svg>`;
  }

  function wireBump() {
    const host = $('#bump-chart');
    let pinned = null;
    const focus = id => {
      host.classList.toggle('focusing', !!id);
      $$('.ln', host).forEach(gEl => {
        const on = gEl.dataset.team === id;
        gEl.classList.toggle('on', on);
        const vis = $('.vis', gEl);
        if (on) { vis.setAttribute('stroke', gEl.classList.contains('pick') ? gEl.style.getPropertyValue('--c') : 'var(--ink)'); vis.setAttribute('stroke-width', '3'); }
        else { vis.setAttribute('stroke', gEl.style.getPropertyValue('--c')); vis.setAttribute('stroke-width', gEl.classList.contains('pick') ? '3' : '1.5'); }
      });
      $$('.lab', host).forEach(l => { if (!l.dataset.w) l.dataset.w = l.getAttribute('font-weight'); l.setAttribute('font-weight', l.dataset.team === id ? '800' : l.dataset.w); });
    };
    const target = e => { const el = e.target.closest('[data-team]'); return el ? el.dataset.team : null; };
    host.addEventListener('mouseover', e => { const id = target(e); if (id) focus(id); });
    host.addEventListener('mouseleave', () => focus(pinned));
    host.addEventListener('click', e => { const id = target(e); pinned = pinned === id ? null : id; focus(pinned); });
    host.addEventListener('focusin', e => { const id = target(e); if (id) focus(id); });
    host.addEventListener('focusout', () => focus(pinned));
  }

  function renderCharts() {
    const r = state.res;
    const lw = $('#luck-chart').clientWidth || 360;
    $('#luck-chart').innerHTML = luckChart(Math.min(lw, 620));
    const bw = $('#bump-chart').clientWidth || 360;
    $('#bump-chart').innerHTML = bumpChart(Math.min(bw, 620));
    $('#move-sub').textContent = `Where every team ranked after each week, using the current formula. Highlighted: ${r.storylines.map(s => s.role.toLowerCase()).join(', ').replace(/, ([^,]*)$/, ', and $1')}.`;
    $('#move-key').innerHTML = r.storylines.map((s, i) => `<span><i class="sw" style="background:${ROLE_COLORS[i]}"></i>${esc(r.byId[s.id].name)} <span class="dim">(${esc(s.role.toLowerCase())})</span></span>`).join('') + '<span><i class="sw" style="background:var(--grey)"></i>Everyone else</span>';
  }

  function renderMethod() {
    const sh = shares(state.weights);
    const used = FACTORS.filter(f => sh[f.key] > 0).sort((a, b) => sh[b.key] - sh[a.key]);
    const off = FACTORS.filter(f => sh[f.key] === 0);
    $('#m-grid').innerHTML = used.map(f => `<div><p class="pct">${sh[f.key]}%</p><h3>${esc(f.label)}</h3><p class="d">${esc(factorDesc(f))}</p></div>`).join('');
    const scaleTxt = state.scale === 'rank'
      ? 'Each factor is turned into a league rank, then spread from 0 (last) to 100 (first).'
      : 'Each factor is spread from 0 to 100 across the league: the lowest team gets 0, the highest gets 100.';
    $('#m-note').textContent = `${scaleTxt} Those are weighted and added together for the power score. Ties on the score go to total points. Tiers break at the biggest gaps in score.` +
      (off.length ? ` Shown on the page but left out of the score: ${off.map(f => f.label.toLowerCase()).join(', ')}. In testing against seasons built from this league's own scoring, each of them made the ranking worse at finding the best team, because they mostly measure luck (who you happened to play, and when) or repeat what points already show.` : '') +
      ' Luck is actual wins minus expected wins, where expected wins are the all-play win rate times games played.';
  }

  function renderFoot() {
    const L = state.league;
    $('#foot').innerHTML = `<span>${esc(L.name)}. ESPN Fantasy league ${esc(L.leagueId || CFG.leagueId || '')}, ${esc(L.season || '')} season.</span><span>${L.fetchedAt ? 'Data pulled ' + esc(fmtDate(L.fetchedAt, true)) + '.' : ''}</span>`;
  }

  function renderWeekSelect() {
    const sel = $('#week');
    sel.innerHTML = state.league.weeks.map(w => `<option value="${w.week}">Week ${w.week}</option>`).join('');
    sel.value = String(state.res.week);
    sel.disabled = false;
  }

  function renderAll(animate) {
    renderMast(); renderNumbers(); renderFormulaSummary();
    renderOrder(animate); renderCharts(); wireBumpOnce(); renderMethod(); renderFoot();
  }
  let bumpWired = false;
  function wireBumpOnce() { if (!bumpWired) { wireBump(); bumpWired = true; } }

  // ------------------------------------------------------------ boot
  async function getData() {
    const url = CFG.dataUrl || 'data/league.json';
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function boot() {
    try { localStorage.removeItem(STORE); } catch (e) { /* custom formulas from the old version are retired */ }
    let raw;
    try { raw = await getData(); }
    catch (e) {
      $('#kicker').textContent = 'No data yet';
      $('#body').innerHTML = `<div class="wrap"><p class="state">The league data could not be loaded. If the site was just set up, run the "Update power rankings" workflow once so it can pull the league from ESPN.</p></div>`;
      return;
    }
    try { state.league = E.normalize(raw); }
    catch (e) {
      $('#body').innerHTML = `<div class="wrap"><p class="state">${esc(e.message)}</p></div>`;
      return;
    }
    if (state.league.sample) {
      const b = $('#banner');
      b.textContent = 'Sample data. Team names and scores are placeholders until the site is connected to ESPN.';
      b.hidden = false;
    }
    if (!state.league.lastWeek) {
      $('#kicker').textContent = `${state.league.season || ''} season`;
      $('#dek').textContent = 'Rankings start once Week 1 is final. Check back after Monday night.';
      $('.mark').textContent = state.league.name;
      return;
    }
    state.week = state.league.lastWeek;
    shell();
    compute();
    renderWeekSelect();
    renderAll(false);
    $('#week').addEventListener('change', e => {
      state.week = Number(e.target.value);
      state.open = {};
      compute();
      renderAll(false);
    });
    let rt = null, lastW = window.innerWidth;
    window.addEventListener('resize', () => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      clearTimeout(rt);
      rt = setTimeout(() => { renderOrder(false); renderCharts(); }, 150);
    });
  }

  boot();
})();
