/*
 * Gator League power rankings engine.
 * Pure functions: parse ESPN league JSON, compute factors, weighted scores,
 * tiers, movement, history, weekly awards, blurbs and a headline.
 * Works in the browser (window.PowerEngine) and in Node (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PowerEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Every factor is oriented so that a higher value is better.
  var FACTORS = [
    { key: 'allPlay', label: 'All-play record', short: 'All-play',
      desc: 'Your record if you played every team every week. The best single read on how good a team is.' },
    { key: 'pointsFor', label: 'Points per game', short: 'Points',
      desc: 'Average points scored. Rewards teams that put up points week after week.' },
    { key: 'recent', label: 'Recent form', short: 'Form',
      desc: 'Average score over the last {n} weeks, so hot and cold streaks move the needle.' },
    { key: 'winPct', label: 'Win percentage', short: 'Record',
      desc: 'Actual head-to-head results. The scoreboard still counts.' },
    { key: 'median', label: 'Top-half finishes', short: 'Top half',
      desc: 'How often you finished in the top half of the league that week.' },
    { key: 'diff', label: 'Point differential', short: 'Margin',
      desc: 'Average margin per game: points for minus points against.' },
    { key: 'consistency', label: 'Consistency', short: 'Steady',
      desc: 'Steadier weekly scores rank higher. Measured by how much scores swing week to week.' },
    { key: 'schedule', label: 'Schedule strength', short: 'Schedule',
      desc: 'Average scoring of the opponents you have faced. A tougher road earns credit.' }
  ];

  var DEFAULT_TIER_NAMES = {
    1: ['The League'],
    2: ['Apex Predators', 'Bottom Feeders'],
    3: ['Apex Predators', 'Treading Water', 'Bottom Feeders'],
    4: ['Apex Predators', 'Lurking', 'Treading Water', 'Bottom Feeders'],
    5: ['Apex Predators', 'Lurking', 'Sunning on the Bank', 'Treading Water', 'Bottom Feeders']
  };

  // ------------------------------------------------------------ helpers
  function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function avg(a) { return a.length ? sum(a) / a.length : 0; }
  function sd(a) {
    if (a.length < 2) return 0;
    var m = avg(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / a.length);
  }
  function r1(x) { return Math.round(x * 10) / 10; }
  function f1(x) { return (Math.round(x * 10) / 10).toFixed(1); }
  function fmtPts(x) {
    var s = f1(x);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }
  function signed(x) {
    var v = r1(x);
    if (Math.abs(v) < 0.05) return '0.0';
    return (v > 0 ? '+' : '') + v.toFixed(1);
  }
  var WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  function word(n) { return n >= 0 && n < WORDS.length ? WORDS[n] : String(n); }
  var ORD = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
    'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth'];
  function ordWord(n) { return n >= 0 && n < ORD.length ? ORD[n] : ordinal(n); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function recStr(w, l, t) { return w + '-' + l + (t ? '-' + t : ''); }

  // ------------------------------------------------------------ parse ESPN
  function normalize(input) {
    var espn = input && input.espn ? input.espn : input;
    if (!espn || !Array.isArray(espn.teams)) throw new Error('This does not look like ESPN league data.');
    var members = {};
    (espn.members || []).forEach(function (m) { members[m.id] = m; });
    function ownerOf(t) {
      if (t.ownerName) return t.ownerName;
      var id = (t.owners && t.owners[0]) || t.primaryOwner;
      var m = members[id];
      if (!m) return '';
      if (m.firstName) return m.firstName + (m.lastName ? ' ' + m.lastName.charAt(0) + '.' : '');
      return m.displayName || '';
    }
    var teams = espn.teams.map(function (t) {
      var name = t.name || [t.location, t.nickname].filter(Boolean).join(' ') || t.abbrev || ('Team ' + t.id);
      return { id: t.id, name: String(name).replace(/\s+/g, ' ').trim(), abbrev: t.abbrev || '', owner: ownerOf(t) };
    });
    var known = {};
    teams.forEach(function (t) { known[t.id] = true; });

    var settings = espn.settings || {};
    var ss = settings.scheduleSettings || {};
    var regWeeks = num(ss.matchupPeriodCount) || Infinity;
    var byWeek = {};
    (espn.schedule || []).forEach(function (m) {
      var wk = num(m.matchupPeriodId);
      if (!wk || wk > regWeeks) return;
      if (m.playoffTierType && m.playoffTierType !== 'NONE') return;
      (byWeek[wk] = byWeek[wk] || []).push(m);
    });
    var weeks = [];
    Object.keys(byWeek).map(Number).sort(function (a, b) { return a - b; }).forEach(function (wk) {
      var ms = byWeek[wk];
      var games = ms.filter(function (m) { return m.home && m.away; });
      if (!games.length) return;
      var decided = games.every(function (m) { return m.winner && m.winner !== 'UNDECIDED'; });
      if (!decided) return;
      var scores = {}, matchups = [];
      ms.forEach(function (m) {
        if (m.home && known[m.home.teamId]) scores[m.home.teamId] = num(m.home.totalPoints);
        if (m.away && known[m.away.teamId]) scores[m.away.teamId] = num(m.away.totalPoints);
        if (m.home && m.away && known[m.home.teamId] && known[m.away.teamId]) {
          matchups.push({ home: m.home.teamId, away: m.away.teamId,
            hs: num(m.home.totalPoints), as: num(m.away.totalPoints), winner: m.winner });
        }
      });
      weeks.push({ week: wk, scores: scores, matchups: matchups });
    });
    var status = espn.status || {};
    return {
      leagueId: espn.id,
      season: espn.seasonId,
      name: settings.name || 'Fantasy League',
      teams: teams,
      weeks: weeks,
      lastWeek: weeks.length ? weeks[weeks.length - 1].week : 0,
      currentWeek: num(status.currentMatchupPeriod) || null,
      regularSeasonWeeks: isFinite(regWeeks) ? regWeeks : null,
      fetchedAt: (input && input.fetchedAt) || null,
      sample: !!(input && input.sample)
    };
  }

  // ------------------------------------------------------------ metrics
  function metricsThrough(league, W, recentN) {
    var M = {};
    league.teams.forEach(function (t) {
      M[t.id] = { id: t.id, name: t.name, owner: t.owner, abbrev: t.abbrev,
        w: 0, l: 0, t: 0, g: 0, pf: 0, pa: 0, scored: 0,
        apw: 0, apl: 0, apt: 0, mw: 0, ml: 0, mt: 0, results: [], weekly: [] };
    });
    var weeks = league.weeks.filter(function (w) { return w.week <= W; });
    weeks.forEach(function (wk) {
      var ids = Object.keys(wk.scores).map(Number);
      var vals = ids.map(function (id) { return wk.scores[id]; }).sort(function (a, b) { return a - b; });
      var n = vals.length;
      var med = n % 2 ? vals[(n - 1) / 2] : (vals[n / 2 - 1] + vals[n / 2]) / 2;
      ids.forEach(function (id) {
        var m = M[id], s = wk.scores[id];
        m.pf += s; m.scored++;
        ids.forEach(function (oid) {
          if (oid === id) return;
          var o = wk.scores[oid];
          if (s > o) m.apw++; else if (s < o) m.apl++; else m.apt++;
        });
        if (s > med) m.mw++; else if (s < med) m.ml++; else m.mt++;
      });
      wk.matchups.forEach(function (g) {
        var h = M[g.home], a = M[g.away];
        var hr = g.winner === 'HOME' ? 'W' : g.winner === 'AWAY' ? 'L' : 'T';
        var ar = hr === 'W' ? 'L' : hr === 'L' ? 'W' : 'T';
        [[h, hr, g.away, g.hs, g.as], [a, ar, g.home, g.as, g.hs]].forEach(function (x) {
          var m = x[0];
          m.g++; m.pa += x[4];
          if (x[1] === 'W') m.w++; else if (x[1] === 'L') m.l++; else m.t++;
          m.results.push({ week: wk.week, opp: x[2], pf: x[3], pa: x[4], r: x[1] });
        });
      });
      ids.forEach(function (id) {
        var m = M[id];
        var res = null;
        for (var i = m.results.length - 1; i >= 0; i--) if (m.results[i].week === wk.week) { res = m.results[i]; break; }
        m.weekly.push({ week: wk.week, score: wk.scores[id], r: res ? res.r : 'B', opp: res ? res.opp : null, pa: res ? res.pa : null });
      });
    });
    var all = Object.keys(M).map(function (k) { return M[k]; });
    all.forEach(function (m) {
      var scores = m.weekly.map(function (x) { return x.score; });
      var apTot = m.apw + m.apl + m.apt, mTot = m.mw + m.ml + m.mt;
      m.winPct = m.g ? (m.w + 0.5 * m.t) / m.g : 0;
      m.allPlayPct = apTot ? (m.apw + 0.5 * m.apt) / apTot : 0;
      m.medianPct = mTot ? (m.mw + 0.5 * m.mt) / mTot : 0;
      m.ppg = m.scored ? m.pf / m.scored : 0;
      var last = scores.slice(-recentN);
      m.recent = avg(last); m.recentN = last.length;
      m.diff = m.g ? sum(m.results.map(function (r) { return r.pf - r.pa; })) / m.g : 0;
      m.sd = sd(scores);
      m.expW = m.allPlayPct * m.g;
      m.luck = (m.w + 0.5 * m.t) - m.expW;
      m.streak = streak(m.results);
      m.last = m.results.length ? m.results[m.results.length - 1] : null;
    });
    all.forEach(function (m) {
      m.sos = m.results.length ? avg(m.results.map(function (r) { return M[r.opp].ppg; })) : 0;
    });
    return { byId: M, list: all, weeks: weeks };
  }

  function streak(results) {
    if (!results.length) return { type: '', n: 0, label: '' };
    var type = results[results.length - 1].r, n = 0;
    for (var i = results.length - 1; i >= 0 && results[i].r === type; i--) n++;
    return { type: type, n: n, label: type + n };
  }

  function factorValue(m, key) {
    switch (key) {
      case 'allPlay': return m.allPlayPct;
      case 'pointsFor': return m.ppg;
      case 'recent': return m.recent;
      case 'winPct': return m.winPct;
      case 'median': return m.medianPct;
      case 'diff': return m.diff;
      case 'consistency': return -m.sd;
      case 'schedule': return m.sos;
    }
    return 0;
  }

  function scaleValues(vals, method) {
    var n = vals.length;
    if (method === 'rank') {
      if (n < 2) return vals.map(function () { return 0.5; });
      return vals.map(function (v) {
        var below = 0, eq = 0;
        vals.forEach(function (x) { if (x < v - 1e-9) below++; else if (Math.abs(x - v) <= 1e-9) eq++; });
        return (below + (eq - 1) / 2) / (n - 1);
      });
    }
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    return vals.map(function (v) { return hi - lo < 1e-9 ? 0.5 : (v - lo) / (hi - lo); });
  }

  function cleanWeights(weights) {
    var w = {}, total = 0;
    FACTORS.forEach(function (f) {
      var v = Math.max(0, num(weights && weights[f.key]));
      w[f.key] = v; total += v;
    });
    if (total <= 0) { FACTORS.forEach(function (f) { w[f.key] = 1; }); total = FACTORS.length; }
    return { w: w, total: total };
  }

  // Score and rank every team through week W.
  function rankThrough(league, W, opts) {
    var recentN = Math.max(1, num(opts.recentWeeks) || 3);
    var data = metricsThrough(league, W, recentN);
    var list = data.list;
    var cw = cleanWeights(opts.weights);
    var scaled = {};
    FACTORS.forEach(function (f) {
      scaled[f.key] = scaleValues(list.map(function (m) { return factorValue(m, f.key); }), opts.scale);
    });
    list.forEach(function (m, i) {
      var parts = {}, score = 0;
      FACTORS.forEach(function (f) {
        var s = scaled[f.key][i];
        var share = cw.w[f.key] / cw.total;
        var pts = 100 * share * s;
        parts[f.key] = { raw: factorValue(m, f.key), scaled: 100 * s, share: share, points: pts };
        score += pts;
      });
      m.parts = parts;
      m.score = score;
    });
    list.sort(function (a, b) {
      return (r1(b.score) - r1(a.score)) || (b.pf - a.pf) || (b.allPlayPct - a.allPlayPct) || (a.id - b.id);
    });
    list.forEach(function (m, i) { m.rank = i + 1; });
    return data;
  }

  // ------------------------------------------------------------ tiers
  function makeTiers(sorted, names) {
    var n = sorted.length;
    if (!n) return [];
    var k = n <= 3 ? 1 : n <= 6 ? 2 : n <= 9 ? 3 : n <= 14 ? 4 : 5;
    var gaps = [];
    for (var i = 0; i < n - 1; i++) gaps.push({ i: i, g: sorted[i].score - sorted[i + 1].score });
    var cuts = gaps.slice().sort(function (a, b) { return (b.g - a.g) || (a.i - b.i); })
      .slice(0, k - 1).map(function (x) { return x.i; }).sort(function (a, b) { return a - b; });
    var tiers = [], start = 0;
    cuts.concat([n - 1]).forEach(function (end) {
      tiers.push(sorted.slice(start, end + 1));
      start = end + 1;
    });
    var labels = (names && names[tiers.length]) || DEFAULT_TIER_NAMES[tiers.length] || [];
    return tiers.map(function (teams, idx) {
      var first = teams[0], lastT = teams[teams.length - 1];
      var note;
      if (teams.length > 1) {
        var spread = first.score - lastT.score;
        note = cap(word(teams.length)) + ' teams within ' + f1(spread) + ' of each other.';
        if (spread < 0.05) note = cap(word(teams.length)) + ' teams dead even.';
      } else if (idx === 0) {
        var nextT = tiers[1] ? tiers[1][0] : null;
        note = nextT ? 'Leads the next team by ' + f1(first.score - nextT.score) + '.' : 'Alone at the top.';
      } else {
        var prevT = tiers[idx - 1][tiers[idx - 1].length - 1];
        note = 'Trails the next team by ' + f1(prevT.score - first.score) + '.';
      }
      return { index: idx + 1, name: labels[idx] || ('Tier ' + (idx + 1)), teams: teams, note: note };
    });
  }

  // ------------------------------------------------------------ awards
  function weekAwards(league, W, byId) {
    var wk = null;
    league.weeks.forEach(function (x) { if (x.week === W) wk = x; });
    if (!wk) return null;
    var ids = Object.keys(wk.scores).map(Number);
    var scores = ids.map(function (id) { return wk.scores[id]; });
    var hi = ids[0], lo = ids[0];
    ids.forEach(function (id) {
      if (wk.scores[id] > wk.scores[hi]) hi = id;
      if (wk.scores[id] < wk.scores[lo]) lo = id;
    });
    var games = wk.matchups.map(function (g) {
      var homeWon = g.winner === 'HOME';
      var tie = g.winner === 'TIE';
      return {
        tie: tie,
        winner: tie ? g.home : homeWon ? g.home : g.away,
        loser: tie ? g.away : homeWon ? g.away : g.home,
        ws: tie ? g.hs : homeWon ? g.hs : g.as,
        ls: tie ? g.as : homeWon ? g.as : g.hs,
        margin: Math.abs(g.hs - g.as)
      };
    });
    var blow = null, close = null, wrong = null;
    games.forEach(function (g) {
      if (!blow || g.margin > blow.margin) blow = g;
      if (!close || g.margin < close.margin) close = g;
      if (!g.tie && (!wrong || g.ls > wrong.ls)) wrong = g;
    });
    var name = function (id) { return byId[id] ? byId[id].name : ''; };
    var out = {
      week: W,
      average: avg(scores),
      high: { team: name(hi), id: hi, score: wk.scores[hi] },
      low: { team: name(lo), id: lo, score: wk.scores[lo] }
    };
    if (blow) out.blowout = { winner: name(blow.winner), loser: name(blow.loser), ws: blow.ws, ls: blow.ls, margin: blow.margin, tie: blow.tie };
    if (close) out.close = { winner: name(close.winner), loser: name(close.loser), ws: close.ws, ls: close.ls, margin: close.margin, tie: close.tie };
    if (wrong) {
      var beat = ids.filter(function (id) { return id !== wrong.loser && wk.scores[id] < wrong.ls; }).length;
      out.wrong = { team: name(wrong.loser), id: wrong.loser, score: wrong.ls, beat: beat, others: ids.length - 1 };
    }
    return out;
  }

  // ------------------------------------------------------------ blurbs
  function competitionRank(list, key, higherBetter) {
    var out = {};
    list.forEach(function (m) {
      var v = typeof key === 'function' ? key(m) : m[key];
      var better = 0, same = 0;
      list.forEach(function (o) {
        var ov = typeof key === 'function' ? key(o) : o[key];
        if (Math.abs(ov - v) < 1e-9) same++;
        else if (higherBetter ? ov > v : ov < v) better++;
      });
      out[m.id] = { rank: better + 1, tied: same > 1, count: same };
    });
    return out;
  }

  function uniqueTop(r, id) { return r[id].rank === 1 && !r[id].tied; }
  function uniqueBottom(r, id, n) {
    var worst = 0;
    Object.keys(r).forEach(function (k) { worst = Math.max(worst, r[k].rank); });
    return r[id].rank === worst && !r[id].tied && worst === n;
  }

  function makeBlurbs(res, awards, history, notes) {
    var T = res.teams, n = T.length, W = res.week, N = res.recentN;
    var recR = competitionRank(T, 'winPct', true);
    var apR = competitionRank(T, 'allPlayPct', true);
    var pfR = competitionRank(T, 'pf', true);
    var rcR = competitionRank(T, 'recent', true);
    var sdR = competitionRank(T, 'sd', false);
    var soR = competitionRank(T, 'sos', true);
    var out = {};
    T.forEach(function (t, i) {
      var note = notes && (notes[t.name] || notes[t.id]);
      if (note) { out[t.id] = String(note); return; }
      var facts = [];
      var add = function (p, cat, text) { facts.push({ p: p, cat: cat, text: text }); };
      var rec = recStr(t.w, t.l, t.t);

      [T[i - 1], T[i + 1]].forEach(function (o, j) {
        if (o && r1(o.score) === r1(t.score)) {
          add(95, 'tie', j === 0
            ? 'Dead even with ' + o.name + ' at ' + f1(t.score) + ' and behind on total points.'
            : 'Dead even with ' + o.name + ' at ' + f1(t.score) + ' and ahead on total points.');
        }
      });
      if (t.streak.n >= 3) {
        add(80, 'streak', cap(word(t.streak.n)) + (t.streak.type === 'W' ? ' straight wins.' : t.streak.type === 'L' ? ' straight losses.' : ' straight ties.'));
      }
      var rr = recR[t.id];
      if (Math.abs(rr.rank - t.rank) >= 4 && rr.count <= 2 && t.g >= 3) {
        add(85, 'mismatch', 'The ' + rec + ' record ' + (rr.tied ? 'ties for ' : 'ranks ') + ordinal(rr.rank) +
          ' in the league. The numbers say ' + ordinal(t.rank) + '.');
      }
      var luckW = Math.round(Math.abs(t.luck));
      if (t.luck >= 1.5) add(75, 'luck', 'The record is running about ' + (luckW === 1 ? 'a win' : word(luckW) + ' wins') + ' ahead of the scoring.');
      if (t.luck <= -1.5) add(75, 'luck', 'The record is running about ' + (luckW === 1 ? 'a win' : word(luckW) + ' wins') + ' behind the scoring.');
      var ap = recStr(t.apw, t.apl, t.apt);
      if (uniqueTop(apR, t.id)) add(70, 'allplay', 'Best all-play record in the league at ' + ap + '.');
      if (uniqueBottom(apR, t.id, n)) add(60, 'allplay', 'Worst all-play record in the league at ' + ap + '.');

      var lastWk = t.weekly.length ? t.weekly[t.weekly.length - 1] : null;
      if (lastWk && lastWk.week === W) {
        if (awards && awards.high && awards.high.id === t.id) add(78, 'week', 'Week ' + W + '’s top score at ' + f1(lastWk.score) + '.');
        if (awards && awards.low && awards.low.id === t.id) add(72, 'week', 'Week ' + W + '’s lowest score at ' + f1(lastWk.score) + '.');
        if (t.last && t.last.week === W) {
          var mg = Math.abs(t.last.pf - t.last.pa);
          if (t.last.r === 'W' && mg < 3) add(74, 'week', 'Escaped Week ' + W + ' by ' + f1(mg) + '.');
          if (t.last.r === 'L' && mg < 3) add(76, 'week', 'Lost Week ' + W + ' by ' + f1(mg) + '.');
          if (t.last.r === 'W' && mg >= 40) add(65, 'week', 'Won Week ' + W + ' by ' + f1(mg) + '.');
          if (awards && awards.wrong && awards.wrong.id === t.id && awards.wrong.beat >= Math.ceil(awards.wrong.others / 2)) {
            add(73, 'week', 'Lost Week ' + W + ' with a score that beat ' + word(awards.wrong.beat) + ' other teams.');
          }
        }
      }
      if (t.move !== null) {
        var lr = t.last && t.last.week === W ? t.last.r : null;
        if (t.move >= 2 && lr === 'L') add(82, 'move', 'Up ' + word(t.move) + ' spots despite a loss.');
        else if (t.move <= -2 && lr === 'W') add(82, 'move', 'Won and still dropped ' + word(-t.move) + ' spots.');
        else if (t.move >= 3) add(68, 'move', 'Up ' + word(t.move) + ' spots this week.');
        else if (t.move <= -3) add(68, 'move', 'Down ' + word(-t.move) + ' spots this week.');
      }
      if (N >= 2 && W > N) {
        if (uniqueTop(rcR, t.id)) add(66, 'form', 'Hottest team over the last ' + word(N) + ' weeks at ' + f1(t.recent) + ' a week.');
        if (uniqueBottom(rcR, t.id, n)) add(62, 'form', 'Coldest team over the last ' + word(N) + ' weeks at ' + f1(t.recent) + ' a week.');
      }
      if (uniqueTop(pfR, t.id)) add(64, 'points', 'Most points in the league at ' + fmtPts(t.pf) + '.');
      if (uniqueBottom(pfR, t.id, n)) add(58, 'points', 'Fewest points in the league at ' + fmtPts(t.pf) + '.');
      if (t.weekly.length >= 4) {
        if (uniqueTop(sdR, t.id)) add(50, 'steady', 'The steadiest scorer in the league.');
        if (uniqueBottom(sdR, t.id, n)) add(48, 'steady', 'The most up-and-down scorer in the league.');
      }
      var wks = t.weekly.length;
      if (wks >= 4 && t.mw >= 0.75 * wks) add(45, 'median', 'Top half of the league in ' + word(t.mw) + ' of ' + word(wks) + ' weeks.');
      if (wks >= 4 && t.mw <= 0.25 * wks) add(44, 'median', 'Top half of the league in just ' + word(t.mw) + ' of ' + word(wks) + ' weeks.');
      if (t.g >= 3 && uniqueTop(soR, t.id)) add(46, 'schedule', 'Has faced the toughest schedule in the league.');
      if (t.g >= 3 && uniqueBottom(soR, t.id, n)) add(45, 'schedule', 'Has had the easiest schedule in the league.');
      var h = history[t.id] || [];
      if (h.length >= 3 && h.every(function (r) { return r === t.rank; })) {
        add(55, 'history', t.rank === 1 ? 'No. 1 in every edition so far.' : ordinal(t.rank) + ' in every edition so far.');
      }
      add(10, 'base', rec + ' with ' + f1(t.ppg) + ' points a game.');

      facts.sort(function (a, b) { return b.p - a.p; });
      var picked = [], cats = {};
      for (var k = 0; k < facts.length && picked.length < 2; k++) {
        if (cats[facts[k].cat]) continue;
        if (facts[k].cat === 'base' && picked.length) continue;
        cats[facts[k].cat] = true;
        picked.push(facts[k].text);
      }
      out[t.id] = picked.join(' ');
    });
    return out;
  }

  function joinClauses(c) {
    if (c.length === 1) return c[0];
    if (c.length === 2) return c[0] + ' and ' + c[1];
    return c.slice(0, -1).join(', ') + ', and ' + c[c.length - 1];
  }

  function makeHeadline(res, awards) {
    var T = res.teams;
    if (!T.length) return '';
    var a = T[0], b = T[1];
    var used = {}, clauses = [];
    if (b && r1(a.score) === r1(b.score)) {
      clauses.push(a.name + ' and ' + b.name + ' finished dead even at ' + f1(a.score));
      used[a.id] = used[b.id] = true;
    } else if (res.week === 1 || a.prevRank === null) {
      clauses.push(a.name + ' opened on top'); used[a.id] = true;
    } else if (a.prevRank === 1) {
      clauses.push(a.name + ' stayed on top'); used[a.id] = true;
    } else {
      clauses.push(a.name + ' took over the top spot'); used[a.id] = true;
    }
    var cands = [];
    T.forEach(function (t) {
      if (t.streak.type === 'W' && t.streak.n >= 3) cands.push({ p: 40 + 3 * t.streak.n, id: t.id, text: t.name + ' won a ' + ordWord(t.streak.n) + ' straight' });
      if (t.move !== null && t.move >= 2) cands.push({ p: 44 + 3 * t.move, id: t.id, text: t.name + ' climbed ' + word(t.move) + ' spots' });
      if (t.move !== null && t.move <= -3) cands.push({ p: 40 - 3 * t.move, id: t.id, text: t.name + ' slid ' + word(-t.move) + ' spots' });
      if (t.streak.type === 'L' && t.streak.n >= 4) cands.push({ p: 36 + 2 * t.streak.n, id: t.id, text: t.name + ' dropped a ' + ordWord(t.streak.n) + ' straight' });
    });
    if (awards && awards.close && !awards.close.tie && awards.close.margin < 3) {
      var lid = null;
      T.forEach(function (t) { if (t.name === awards.close.loser) lid = t.id; });
      cands.push({ p: 50, id: lid, text: awards.close.loser + ' lost to ' + awards.close.winner + ' by ' + f1(awards.close.margin) });
    }
    if (awards && awards.high) cands.push({ p: 30, id: awards.high.id, text: awards.high.team + ' posted the week\u2019s top score' });
    cands.sort(function (x, y) { return y.p - x.p; });
    cands.forEach(function (c) {
      if (clauses.length >= 3 || used[c.id]) return;
      used[c.id] = true; clauses.push(c.text);
    });
    return joinClauses(clauses) + '.';
  }

  // ------------------------------------------------------------ storylines for the movement chart
  function storylines(res, history, span) {
    var T = res.teams, picks = [], used = {};
    var from = Math.max(0, res.week - span);
    function window(id) { return (history[id] || []).slice(from); }
    var climb = null, slide = null, hot = null;
    T.forEach(function (t) {
      var h = window(t.id);
      if (h.length < 2) return;
      var c = h[0] - t.rank;
      if (c >= 2 && (!climb || c > climb.v)) climb = { id: t.id, v: c };
      var best = Math.min.apply(null, h);
      var s = t.rank - best;
      if (s >= 2 && (!slide || s > slide.v)) slide = { id: t.id, v: s };
      if (t.streak.type === 'W' && t.streak.n >= 3 && (!hot || t.streak.n > hot.v)) hot = { id: t.id, v: t.streak.n };
    });
    [[climb, 'The climb'], [hot, 'The streak'], [slide, 'The slide']].forEach(function (x) {
      if (x[0] && !used[x[0].id]) { used[x[0].id] = true; picks.push({ id: x[0].id, role: x[1] }); }
    });
    for (var i = 0; i < T.length && picks.length < 3; i++) {
      if (!used[T[i].id]) { used[T[i].id] = true; picks.push({ id: T[i].id, role: 'Top ' + (i + 1) }); }
    }
    return picks;
  }

  // ------------------------------------------------------------ main entry
  function compute(league, opts) {
    opts = opts || {};
    var W = opts.week && opts.week <= league.lastWeek ? opts.week : league.lastWeek;
    if (!W) return { week: 0, teams: [], empty: true };
    var cur = rankThrough(league, W, opts);
    var history = {};
    league.teams.forEach(function (t) { history[t.id] = []; });
    league.weeks.forEach(function (wk) {
      if (wk.week > W) return;
      var r = wk.week === W ? cur : rankThrough(league, wk.week, opts);
      r.list.forEach(function (m) { history[m.id].push(m.rank); });
    });
    var prev = null;
    var prevWeeks = league.weeks.filter(function (w) { return w.week < W; });
    if (prevWeeks.length) {
      prev = {};
      var p = rankThrough(league, prevWeeks[prevWeeks.length - 1].week, opts);
      p.list.forEach(function (m) { prev[m.id] = m.rank; });
    }
    var teams = cur.list;
    teams.forEach(function (t) {
      t.prevRank = prev ? prev[t.id] : null;
      t.move = prev ? prev[t.id] - t.rank : null;
    });
    var res = {
      week: W,
      recentN: Math.max(1, num(opts.recentWeeks) || 3),
      teams: teams,
      byId: cur.byId,
      history: history,
      weeksPlayed: cur.weeks.map(function (w) { return w.week; }),
      weights: cleanWeights(opts.weights)
    };
    res.awards = weekAwards(league, W, cur.byId);
    res.tiers = makeTiers(teams, opts.tierNames);
    res.blurbs = makeBlurbs(res, res.awards, history, opts.notes);
    res.headline = makeHeadline(res, res.awards);
    res.storylines = storylines(res, history, 8);
    return res;
  }

  return {
    FACTORS: FACTORS,
    DEFAULT_TIER_NAMES: DEFAULT_TIER_NAMES,
    normalize: normalize,
    compute: compute,
    rankThrough: rankThrough,
    util: { f1: f1, fmtPts: fmtPts, signed: signed, ordinal: ordinal, word: word, recStr: recStr }
  };
});
