/**
 * Fetches the pages of every source due today and saves them as plain text in
 * data/snapshots/, so the daily sweep can read the funder's own words.
 *
 * Why this exists: the cloud sandbox the sweep runs in blocks all outbound
 * network access, so the agent can only ever see search results — someone
 * else's description of a funder's page, often describing last year's round.
 * GitHub Actions has no such restriction. It fetches; the agent reads from
 * disk. That is the difference between "a deadline someone wrote about" and
 * "the deadline on the funder's site this morning".
 *
 * Usage:
 *   node scripts/snapshot.mjs              # sources due today
 *   node scripts/snapshot.mjs --all        # every source
 *   node scripts/snapshot.mjs --only=ij4eu # one source
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const OUT = path.join(DATA, "snapshots");

const TIER_DAYS = { 1: 1, 2: 3, 3: 14 };
const MAX_SOURCES = Number(process.env.MAX_SOURCES || 25);
const MAIN_CHARS = 6000;        // kept from the source's own page
const SUB_CHARS = 3500;         // kept from each linked call page
const MAX_FOLLOW = 4;           // sub-pages followed per source
const CONCURRENCY = 6;
const TIMEOUT_MS = 25000;

// An honest bot string gets 403'd by several funder sites (europa.rs among
// them) while the same request with a browser string is served. We are reading
// public pages a journalist could open by hand, at 25 requests a day.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Sub-pages worth following from a listing page. */
const RELEVANT = /grant|fund|call|apply|opportunit|fellowship|support|scheme|proposal/i;

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : null;
};

const TODAY = new Date().toISOString().slice(0, 10);
const daysSince = (iso) =>
  iso ? Math.round((Date.parse(TODAY) - Date.parse(iso.slice(0, 10))) / 86400000) : Infinity;

/* ------------------------------------------------------------- html → text */

const ENTITIES = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&#39;": "'", "&apos;": "'", "&mdash;": "—", "&ndash;": "–",
  "&euro;": "€", "&pound;": "£", "&hellip;": "…", "&rsquo;": "'", "&lsquo;": "'",
  "&ldquo;": '"', "&rdquo;": '"'
};

function toText(html) {
  return html
    // Drop anything that is markup rather than content.
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    // Keep block structure as newlines so lists of calls stay readable.
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|td)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? " ")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n").map((l) => l.trim()).join("\n")
    .trim();
}

/* Lines that could carry a deadline, an amount or an eligibility rule. */
const SIGNAL = new RegExp([
  "deadline", "apply", "application", "eligib", "grant", "fund", "call for",
  "award", "closes", "closing", "opens", "submit", "proposal", "fellowship",
  "\\b20\\d\\d\\b",
  "\\b\\d{1,2}\\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)",
  "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\s+\\d{1,2}",
  "[€$£]\\s?\\d", "\\d[\\d,. ]*\\s?(eur|usd|gbp|€|\\$|£)"
].join("|"), "i");

/**
 * Keeps the opening of the page plus every line that could carry a fact we
 * record, and drops the rest. A funder's page is mostly navigation and mission
 * statement; storing all of it every day would grow the repository by hundreds
 * of megabytes a year to no benefit, and give the sweep more to wade through.
 */
function condense(text, budget) {
  const head = text.slice(0, 1200);
  const rest = text.slice(1200).split("\n");
  const kept = [];
  let size = head.length;
  for (const line of rest) {
    if (line.length < 3 || !SIGNAL.test(line)) continue;
    if (size + line.length > budget) break;
    kept.push(line);
    size += line.length + 1;
  }
  return kept.length ? `${head}\n\n--- relevant lines ---\n${kept.join("\n")}` : head;
}

function titleOf(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? toText(m[1]).slice(0, 200) : "";
}

/** Same-host links that look like they lead to a call. */
function subLinks(html, base) {
  const out = new Map();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.size < MAX_FOLLOW * 4) {
    const label = toText(m[2]);
    let url;
    try { url = new URL(m[1], base); } catch { continue; }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    if (url.host !== new URL(base).host) continue;
    url.hash = "";
    if (url.href === base) continue;
    if (!RELEVANT.test(url.pathname) && !RELEVANT.test(label)) continue;
    if (!out.has(url.href)) out.set(url.href, label);
  }
  return [...out.keys()].slice(0, MAX_FOLLOW);
}

/* ----------------------------------------------------------------- fetching */

async function get(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" }
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const type = res.headers.get("content-type") || "";
    if (!/html|text/i.test(type)) return { error: `not html (${type.split(";")[0]})` };
    return { html: await res.text(), finalUrl: res.url };
  } catch (err) {
    return { error: err.name === "AbortError" ? "timeout" : err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function snapshot(source) {
  const main = await get(source.url);
  if (main.error) return { id: source.id, ok: false, error: main.error };

  const parts = [
    `SOURCE: ${source.name}`,
    `URL: ${source.url}`,
    `FETCHED: ${new Date().toISOString()}`,
    `TITLE: ${titleOf(main.html)}`,
    "",
    "=== MAIN PAGE ===",
    condense(toText(main.html), MAIN_CHARS)
  ];

  // A listing page usually names the programmes but keeps the dates one click
  // away, so the linked pages matter more than the listing itself.
  for (const link of subLinks(main.html, main.finalUrl || source.url)) {
    const sub = await get(link);
    if (sub.error) continue;
    const text = toText(sub.html);
    if (text.length < 200) continue;
    parts.push("", `=== ${link} ===`, condense(text, SUB_CHARS));
  }

  const body = parts.join("\n");
  await fs.writeFile(path.join(OUT, `${source.id}.txt`), body + "\n", "utf8");

  const words = body.split(/\s+/).length;
  return { id: source.id, ok: true, words, pages: parts.filter((p) => p.startsWith("=== ")).length };
}

async function mapLimit(items, limit, worker) {
  const out = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await worker(items[i]);
    }
  }));
  return out;
}

/* --------------------------------------------------------------------- main */

const { sources } = JSON.parse(await fs.readFile(path.join(DATA, "sources.json"), "utf8"));
const state = await fs.readFile(path.join(DATA, "state.json"), "utf8")
  .then(JSON.parse).catch(() => ({ lastChecked: {} }));

await fs.mkdir(OUT, { recursive: true });

const age = (id) => Math.min(daysSince(state.lastChecked[id]), 9999);

const only = opt("only");
// Same due-list rule the sweep uses half an hour later, so the pages on disk
// are the pages it is about to be asked about.
const due = sources
  .filter((s) => s.id && s.enabled !== false)
  .filter((s) => {
    if (only) return s.id === only;
    if (flag("all")) return true;
    return daysSince(state.lastChecked[s.id]) >= (TIER_DAYS[s.tier] ?? 14);
  })
  // Tier first, then whichever has gone longest without a look, so a slow
  // source cannot sit at the back of the queue forever. Never-checked sources
  // are the oldest of all, but as a finite number: subtracting two Infinities
  // gives NaN, which would silently destroy the ordering on the first run.
  .sort((a, b) => a.tier - b.tier || age(b.id) - age(a.id) || a.id.localeCompare(b.id))
  .slice(0, (only || flag("all")) ? sources.length : MAX_SOURCES);

console.log(`fetching ${due.length} of ${sources.filter((s) => s.id).length} sources`);

const results = await mapLimit(due, CONCURRENCY, snapshot);

const index = { generatedAt: new Date().toISOString(), captured: {}, failed: {} };
for (const r of results) {
  if (r.ok) {
    index.captured[r.id] = { fetchedAt: new Date().toISOString(), words: r.words, pages: r.pages };
    console.log(`  ok    ${r.id} — ${r.words} words, ${r.pages} page(s)`);
  } else {
    index.failed[r.id] = r.error;
    console.log(`  FAIL  ${r.id} — ${r.error}`);
  }
}

await fs.writeFile(path.join(OUT, "_index.json"), JSON.stringify(index, null, 2) + "\n", "utf8");

const ok = Object.keys(index.captured).length;
console.log(`\n${ok} captured, ${Object.keys(index.failed).length} failed`);

// A page that yields almost no text is usually rendered by JavaScript; the file
// exists but is useless, and the sweep must not treat it as having read the page.
const thin = Object.entries(index.captured).filter(([, v]) => v.words < 150).map(([k]) => k);
if (thin.length) console.log(`thin (likely JavaScript-rendered): ${thin.join(", ")}`);
