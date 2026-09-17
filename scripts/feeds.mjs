/**
 * Generates a feed and a calendar per country, so people can follow the calls
 * open to them without visiting the site.
 *
 * A static site cannot collect an address or send mail. It can publish a file
 * per country that any reader or calendar subscribes to — which needs no
 * server, no signup, and holds nobody's personal data.
 *
 *   feeds/<CODE>.xml  RSS: calls open to that country, newest verification first
 *   feeds/<CODE>.ics  calendar: one all-day event per deadline
 *   feeds/all.xml     every call
 *
 * Run by the deploy workflow, so the feeds are rebuilt whenever the data is.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://mediagrants.github.io";
const OUT = path.join(ROOT, "feeds");

const read = async (f) => JSON.parse(await fs.readFile(path.join(ROOT, "data", f), "utf8"));
const [{ grants }, geo] = await Promise.all([read("grants.json"), read("geo.json")]);

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const TODAY = new Date().toISOString().slice(0, 10);

/* Same rule the site uses: a call is open to a country if it is worldwide, names
   the country, or names a region containing it. */
const regionsOf = (code) =>
  Object.entries(geo.regionMembers).filter(([, m]) => m.includes(code)).map(([r]) => r);

function openTo(g, code) {
  const scope = g.geoScope || [];
  if (scope.includes("global") || scope.includes(code)) return true;
  return regionsOf(code).some((r) => scope.includes(r));
}

/* A closed call is noise in a feed; the site keeps them, the feed does not. */
const live = grants.filter((g) => {
  if (g.status === "closed") return false;
  return !(g.deadline && g.deadline < TODAY);
});

function describe(g) {
  const bits = [g.summary];
  if (g.deadline) bits.push(`Deadline: ${g.deadline}.`);
  else if (g.deadlineType === "rolling") bits.push("Rolling — no deadline.");
  if (g.amount && (g.amount.max || g.amount.note)) {
    bits.push(`Amount: ${g.amount.note || `up to ${g.amount.max} ${g.amount.currency || ""}`.trim()}.`);
  }
  bits.push(`Who can apply: ${(g.applicantTypes || []).join(" or ")}.`);
  if (g.track === "adjacent" && g.eligibleActivity) bits.push(`Journalism angle: ${g.eligibleActivity}`);
  if (g.confidence !== "high") bits.push("Not confirmed on the funder's own page — check before applying.");
  return bits.filter(Boolean).join(" ");
}

function rss(items, title) {
  const entries = items.map((g) => `    <item>
      <title>${esc(g.programme)} — ${esc(g.funder)}</title>
      <link>${esc(g.applyUrl || g.url)}</link>
      <guid isPermaLink="false">${esc(g.id)}-${esc(g.lastVerified || "")}</guid>
      <description>${esc(describe(g))}</description>
    </item>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${esc(title)}</title>
    <link>${SITE}</link>
    <description>Open funding calls for independent journalism.</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${entries}
  </channel>
</rss>
`;
}

function ics(items, name) {
  const dated = items.filter((g) => g.deadline);
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const events = dated.map((g) => {
    const day = g.deadline.replace(/-/g, "");
    const end = new Date(Date.parse(g.deadline) + 86400000).toISOString().slice(0, 10).replace(/-/g, "");
    // Fold nothing, but strip the characters that would break the format.
    const clean = (s) => String(s).replace(/[\r\n]+/g, " ").replace(/([,;\\])/g, "\\$1");
    return `BEGIN:VEVENT
UID:${g.id}@mediagrants.github.io
DTSTAMP:${stamp}
DTSTART;VALUE=DATE:${day}
DTEND;VALUE=DATE:${end}
SUMMARY:${clean(`Deadline: ${g.programme} (${g.funder})`)}
DESCRIPTION:${clean(describe(g))}
URL:${clean(g.applyUrl || g.url)}
END:VEVENT`;
  }).join("\n");

  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Media Grant Radar//EN
CALSCALE:GREGORIAN
X-WR-CALNAME:${name}
${events}
END:VCALENDAR
`.replace(/\n/g, "\r\n");
}

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });

await fs.writeFile(path.join(OUT, "all.xml"), rss(live, "Media Grant Radar — all open calls"), "utf8");
await fs.writeFile(path.join(OUT, "all.ics"), ics(live, "Media Grant Radar"), "utf8");

let countries = 0;
for (const [code, name] of Object.entries(geo.countryNames)) {
  const mine = live.filter((g) => openTo(g, code));
  if (!mine.length) continue;
  await fs.writeFile(path.join(OUT, `${code}.xml`), rss(mine, `Media Grant Radar — ${name}`), "utf8");
  await fs.writeFile(path.join(OUT, `${code}.ics`), ics(mine, `Grant deadlines — ${name}`), "utf8");
  countries++;
}

console.log(`${live.length} open calls → feeds for ${countries} countries, plus all.xml / all.ics`);
