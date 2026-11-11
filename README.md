# Gator League Power Rankings

A static site that ranks the Gator League (ESPN Fantasy Football league `1965180370`) every week. A small job pulls the league from ESPN, and the page does the math in the browser using one league formula.

```
site/
  index.html          page, styles, and the league settings (GATOR_CONFIG)
  assets/engine.js    the rankings math (no dependencies)
  assets/app.js       page behavior, charts, formula controls
  data/league.json    league data (sample data until the job runs)
scripts/
  fetch-league.mjs    pulls the league from ESPN into site/data/league.json
.github/workflows/
  update.yml          runs the pull every morning and publishes to GitHub Pages
```

## Put it online (GitHub Pages)

1. Create a **public** GitHub repository and push this folder to its `main` branch.
2. In the repository, open **Settings > Pages** and set **Source** to **GitHub Actions**.
3. Open **Actions > Update power rankings > Run workflow**. When it finishes, the site is live at `https://<your-user>.github.io/<repo>/`.

After that it refreshes on its own every morning at 11:17 UTC, and on every push to `main`.

### Private league: add two ESPN cookies as secrets

ESPN only returns a private league's data to a signed-in member. The job signs in the same way your browser does, using two cookies from your ESPN session. They are stored as encrypted GitHub secrets, never in the code or the published site.

1. In Chrome, sign in at fantasy.espn.com and open the league.
2. Open DevTools (F12, or Cmd+Option+I on a Mac) and go to **Application > Storage > Cookies**, then pick the espn.com entry.
3. Copy the values of `espn_s2` and `SWID`. Keep the curly braces that are part of the SWID value.
4. In this repository, open **Settings > Secrets and variables > Actions > New repository secret** and add:
   - `ESPN_S2`: the espn_s2 value
   - `SWID`: the SWID value, braces included
5. Open **Actions > Update power rankings > Run workflow**.

Treat these like a password for your ESPN account: paste them only into GitHub secrets. If they ever stop working, the job fails with an "ESPN refused access" message; copy fresh values and update the two secrets.

The other route is for the league manager to make the league viewable to the public in ESPN's league settings. Then no secrets are needed.

### Who can see the site

A GitHub Pages site is public to anyone who has the link, even when the league is private. The page tells search engines not to index it. It shows team names, scores and owner first names with a last initial. To leave owner names out, add a repository variable `OWNER_NAMES` set to `off`.

### Hosting on Netlify instead

`netlify.toml` already tells Netlify how to build the site (`node scripts/fetch-league.mjs`, publish `site`).

1. In Netlify: **Add new project > Import an existing project > GitHub**, pick `gator-power-rankings`, and deploy. The build settings fill in from `netlify.toml`.
2. In the new project: **Project configuration > Environment variables**, add `ESPN_S2` and `SWID` (same values as the GitHub secrets). Then **Deploys > Trigger deploy**.
3. For the daily refresh: **Project configuration > Build & deploy > Continuous deployment > Build hooks > Add build hook** (branch `main`). Copy the URL into a GitHub secret named `NETLIFY_BUILD_HOOK`. The daily workflow then asks Netlify to rebuild every morning.
4. To stop GitHub Pages: add a GitHub repository variable `PAGES` set to `off`, then unpublish the site under **Settings > Pages**. Once Pages is off, GitHub no longer needs the `ESPN_S2` and `SWID` secrets and they can be deleted there.

### Next season

The season year is picked automatically (July onward is the new season). To pin it, add a repository variable `SEASON`, e.g. `2027`. A different league goes in a variable named `LEAGUE_ID`.

## How the rankings work

**Power score = 80% points per game + 20% recent form (average of the last 3 weeks).** Each factor is scaled 0 to 100 across the league (lowest team 0, highest 100), weighted, and added up. Ties on the displayed score go to total points. Tiers break at the biggest gaps in the score. Movement compares against the same formula one week earlier.

Why those two: in a head-to-head league your score is the only thing you control. Week-to-week scoring is noisy, so the season average is the steadiest read on how good a team is, and recent form catches teams that changed through trades, waivers and injuries. The weights were chosen by testing every factor against thousands of seasons simulated from this league's own scoring (9 weeks of 2026 data) and checking which formula identified each team's true strength best. The other factors are still on the page as context, but they made the ranking worse:

| Factor | Why it is not in the score |
|---|---|
| Win percentage | Wins depend on who you happened to play; that schedule luck does not carry forward |
| All-play record | A coarser version of points per game (it ignores margins); slightly worse in testing |
| Top-half finishes | An even coarser version of all-play |
| Point differential | Points against is your opponents' scoring, which you do not control |
| Consistency | This league shows no real difference in how steady teams are, so it measures noise |
| Schedule strength | Facing strong opponents does not make your own team better |

Luck is actual wins minus expected wins, where expected wins are the all-play win rate times games played.

The weekly write-ups and headline are generated from the numbers. To write your own for a team, add it to `notes` in `GATOR_CONFIG`.

## Changing the formula

The formula lives in `GATOR_CONFIG` near the top of `site/index.html`. Visitors cannot change it.

- `weights`: relative weights by factor (`allPlay`, `pointsFor`, `recent`, `winPct`, `median`, `diff`, `consistency`, `schedule`). The page turns them into percentages.
- `recentWeeks`: the window for recent form.
- `scale`: `'range'` (lowest team 0, highest 100) or `'rank'` (rank order).
- `tierNames`: custom tier names by tier count, e.g. `{ 4: ['Apex Predators', 'Lurking', 'Treading Water', 'Bottom Feeders'] }`.
- `notes`: commissioner write-ups by team name, replacing the automatic ones.

Push the change to `main` and the site redeploys.

## Run it locally

```
node scripts/fetch-league.mjs     # needs internet access to ESPN
python3 -m http.server -d site 8000
```

Then open http://localhost:8000. Opening `index.html` straight from the disk will not load the data; it needs a local server.
