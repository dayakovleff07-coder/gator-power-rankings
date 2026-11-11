#!/usr/bin/env node
/*
 * Pulls the league from ESPN's fantasy football API and writes site/data/league.json.
 * No dependencies. Node 18 or newer.
 *
 *   LEAGUE_ID  ESPN league id (default 1965180370)
 *   SEASON     season year, e.g. 2026 (default: this year from July on, last year before that)
 *   ESPN_S2, SWID   only needed if the league is private
 *   OWNER_NAMES     set to 'off' to leave owner names out of the published data
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT_FILE || resolve(here, '..', 'site', 'data', 'league.json');
const LEAGUE_ID = (process.env.LEAGUE_ID || '1965180370').trim();
const now = new Date();
const SEASON = (process.env.SEASON || String(now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1)).trim();
const BASE = process.env.ESPN_BASE_URL ||
  `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}`;
const URL_ = `${BASE}?view=mTeam&view=mMatchupScore&view=mSettings`;

function fail(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

const headers = { Accept: 'application/json', 'User-Agent': 'gator-power-rankings' };
if (process.env.ESPN_S2 && process.env.SWID) {
  headers.Cookie = `espn_s2=${process.env.ESPN_S2.trim()}; SWID=${process.env.SWID.trim()}`;
}

async function get(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers });
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      last = e;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}

let res;
try { res = await get(URL_); }
catch (e) { fail(`Could not reach ESPN: ${e.message}`); }

if (res.status === 401 || res.status === 403) {
  fail(`ESPN refused access (HTTP ${res.status}). The league is probably private.\n` +
    `Either have the league manager make it viewable to the public in the league settings,\n` +
    `or add ESPN_S2 and SWID as repository secrets (see README).`);
}
if (res.status === 404) fail(`ESPN has no league ${LEAGUE_ID} for the ${SEASON} season (HTTP 404). Check LEAGUE_ID and SEASON.`);
if (!res.ok) fail(`ESPN returned HTTP ${res.status}.`);

const text = await res.text();
let data;
try { data = JSON.parse(text); } catch { fail('ESPN returned something that is not JSON. Try again later.'); }
if (Array.isArray(data)) data = data[0];
if (!data || !Array.isArray(data.teams) || !Array.isArray(data.schedule)) {
  fail('ESPN answered, but without teams and a schedule. The league may be private or the API may have changed.');
}

// Keep only what the site needs. Owner names are reduced to "First L." (or the ESPN display name).
const members = new Map((data.members || []).map(m => [m.id, m]));
const SHOW_OWNERS = String(process.env.OWNER_NAMES || 'on').toLowerCase() !== 'off';
const ownerName = t => {
  if (!SHOW_OWNERS) return '';
  const m = members.get((t.owners && t.owners[0]) || t.primaryOwner);
  if (!m) return '';
  if (m.firstName) return `${m.firstName}${m.lastName ? ' ' + m.lastName[0] + '.' : ''}`;
  return m.displayName || '';
};
const side = s => s ? { teamId: s.teamId, totalPoints: s.totalPoints } : undefined;
const s = data.settings || {};
const out = {
  fetchedAt: new Date().toISOString(),
  source: URL_,
  espn: {
    id: data.id,
    seasonId: data.seasonId,
    scoringPeriodId: data.scoringPeriodId,
    status: data.status ? {
      currentMatchupPeriod: data.status.currentMatchupPeriod,
      latestScoringPeriod: data.status.latestScoringPeriod,
      finalScoringPeriod: data.status.finalScoringPeriod,
      isActive: data.status.isActive
    } : {},
    settings: {
      name: s.name,
      size: s.size,
      scheduleSettings: s.scheduleSettings ? {
        matchupPeriodCount: s.scheduleSettings.matchupPeriodCount,
        playoffTeamCount: s.scheduleSettings.playoffTeamCount
      } : {}
    },
    teams: data.teams.map(t => ({
      id: t.id, abbrev: t.abbrev, name: t.name, location: t.location, nickname: t.nickname,
      ownerName: ownerName(t),
      record: t.record && t.record.overall ? { overall: t.record.overall } : undefined
    })),
    schedule: data.schedule.map(m => ({
      id: m.id, matchupPeriodId: m.matchupPeriodId, winner: m.winner, playoffTierType: m.playoffTierType,
      home: side(m.home), away: side(m.away)
    }))
  }
};

const done = new Set(out.espn.schedule.filter(m => m.winner && m.winner !== 'UNDECIDED').map(m => m.matchupPeriodId));
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out));
console.log(`${s.name || 'League'} (${LEAGUE_ID}, ${SEASON}): ${out.espn.teams.length} teams, ` +
  `${done.size} week(s) with final results. Wrote ${OUT}`);
