# Media Grant Radar

A daily-updated, searchable index of open funding calls for independent journalism — built so that a newsroom project manager or a freelance journalist can open one page in the morning and see what they can actually apply for today, and where.

Every call is filterable by:

- **country you are applying from** — the filter understands that a call scoped to "Western Balkans" or "EU candidate countries" is open to someone in Serbia, and a worldwide call is open to everyone;
- **who is applying** — an individual freelancer, or a registered media organisation;
- **kind of support** — project and story grants, unrestricted **core support**, fellowships, emergency assistance, legal defence, loans and investment;
- **status** — open now, next round announced, or recently closed.

Filtered views are shareable: the filters live in the URL, so `?country=RS&applicant=freelancer` is a link you can send to a colleague.

## Two tracks

Calls are split by what the funder is actually trying to buy.

**Media funds** (`"track": "media"`) exist to fund journalism. These are what every other grant list already covers.

**Broader calls** (`"track": "adjacent"`) fund something else — an inclusive green transition, women's participation in the economy, rule of law, migration, LGBT rights — and accept reporting, public information or community education as an eligible activity. A newsroom can win these, and almost nobody looks for them, because they never appear on a journalism grant list. An embassy's small-grants scheme is the typical case.

Every adjacent entry must carry an `eligibleActivity` field spelling out the route from the funder's aim to journalistic work; the validator rejects one that doesn't. That field is the entire value of the category — without it the card is just a grant a newsroom cannot obviously use.

## How it stays current

```
data/sources.json   the funders and aggregators to watch  (edit this by hand)
      │
      ▼
scripts/update.mjs  daily sweep, run by GitHub Actions
      │             ├─ pass 1: Claude Opus 5 + web search reads the funder's pages
      │             └─ pass 2: Claude Haiku 4.5 turns that report into validated JSON
      ▼
data/grants.json    the dataset the site reads          (written by the sweep)
      │
      ▼
index.html          static site, no build step, deployed to GitHub Pages
```

The sweep runs at 04:10 UTC. Sources are re-checked on a schedule set by their `tier`: tier 1 daily, tier 2 every three days, tier 3 weekly. Aggregators and high-churn funders are tier 1; slow-moving institutional funders are tier 3.

Two rules keep the data honest:

- **Nothing is inferred.** The research prompt forbids estimating a deadline or an eligibility rule. If a page does not state something, the field is `null` and the card says so.
- **Expiry is computed, not trusted.** Both the sweep and the front end recompute status from the deadline, so a stale file can never advertise a closed call as open. A call that disappears from its source for two consecutive sweeps is marked closed; a call more than 90 days past its deadline is dropped.

Web pages are treated as data, never as instructions — the research prompt says so explicitly, and the script only ever writes JSON.

## Running it yourself

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...

npm run dry-run              # research + extract, write nothing
npm run update               # sweep the sources due today
node scripts/update.mjs --only=ij4eu --dry-run   # debug one source
npm run validate             # check data/grants.json is well formed
npm run serve                # preview the site at localhost:3000
```

Opening `index.html` directly from disk will not work — the browser blocks `fetch` on `file://` URLs. Use `npm run serve`.

## Cost

Each source check is one web-search research call plus one small extraction call. With the defaults — Claude Opus 5, `effort: high`, up to 8 searches — expect roughly **$0.40–0.50 per source checked**, and about 18 source-checks a day once the tier schedule settles. That is in the region of **$250–300 a month**.

Four repository variables tune this without touching code, under *Settings → Secrets and variables → Actions → Variables*:

| Variable | Default | Effect |
|---|---|---|
| `RESEARCH_MODEL` | `claude-opus-5` | `claude-sonnet-5` costs about 40% as much per token |
| `RESEARCH_EFFORT` | `high` | `medium` or `low` means fewer searches and less reasoning per source |
| `MAX_SEARCHES` | `8` | Hard ceiling on searches and fetches per source |
| `CONCURRENCY` | `3` | Parallel sources; affects wall-clock time, not cost |

`RESEARCH_MODEL=claude-sonnet-5` with `RESEARCH_EFFORT=medium` and `MAX_SEARCHES=4` brings the bill down to roughly $50–80 a month. The trade-off is real: lower effort means the model reads fewer pages per funder and is more likely to miss a call buried two clicks deep. Start high, look at what the sweep actually finds, then tune down.

You can also cut cost by demoting sources to tier 3 in `data/sources.json`, or setting `"enabled": false` on ones that never yield anything.

## Adding a funder

Append an object to `data/sources.json`. No code change is needed — the next sweep picks it up, and any new support type appears as a filter checkbox automatically.

```json
{
  "id": "short-slug",
  "name": "Name as it should appear on the card",
  "kind": "funder",
  "tier": 2,
  "url": "https://example.org/grants",
  "scope": ["europe-western-balkans"]
}
```

## Correcting an entry by hand

The sweep overwrites `data/grants.json` on every run, so a manual edit there is lost. To make a correction stick, add a `pinned` object to the entry — those fields survive the sweep:

```json
{
  "id": "ij4eu-freelancer-support-scheme",
  "pinned": { "notes": "Our 2026 application was rejected on eligibility — see internal notes." }
}
```

## Caveat

This is a research aid, not a system of record. Deadlines move, calls are withdrawn mid-round, and eligibility rules change between rounds without the page being updated. Every card carries the date it was last verified. **Always open the funder's own page before you invest time in an application.**
