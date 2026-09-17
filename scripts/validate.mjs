/**
 * Sanity check on data/grants.json before it goes live. Runs in CI so a bad
 * sweep fails the build instead of publishing broken cards.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = async (f) => JSON.parse(await fs.readFile(path.join(ROOT, "data", f), "utf8"));

const APPLICANTS = new Set(["freelancer", "organisation"]);
const STATUSES = new Set(["open", "upcoming", "closed"]);
const DEADLINE_TYPES = new Set(["fixed", "rolling", "recurring", "unknown"]);
const TRACKS = new Set(["media", "adjacent"]);

const [{ grants }, geo] = await Promise.all([read("grants.json"), read("geo.json")]);

const validScope = new Set([
  ...Object.keys(geo.regionNames),
  ...Object.keys(geo.countryNames)
]);

const errors = [];
const warnings = [];
const seen = new Set();

for (const g of grants) {
  const where = g.id || g.programme || "(unnamed entry)";

  if (!g.id) errors.push(`${where}: missing id`);
  else if (seen.has(g.id)) errors.push(`${g.id}: duplicate id`);
  else seen.add(g.id);

  for (const field of ["funder", "programme", "summary", "url"]) {
    if (!g[field]) errors.push(`${where}: missing ${field}`);
  }

  if (g.url && !/^https?:\/\//.test(g.url)) errors.push(`${where}: url is not absolute`);
  if (g.applyUrl && !/^https?:\/\//.test(g.applyUrl)) errors.push(`${where}: applyUrl is not absolute`);

  // track is optional; entries written before the two tracks existed are media.
  if (g.track !== undefined && !TRACKS.has(g.track)) {
    errors.push(`${where}: bad track "${g.track}"`);
  }
  if (g.track === "adjacent" && !g.eligibleActivity) {
    errors.push(`${where}: an adjacent call must say in eligibleActivity how journalism fits`);
  }

  if (!STATUSES.has(g.status)) errors.push(`${where}: bad status "${g.status}"`);
  if (!DEADLINE_TYPES.has(g.deadlineType)) errors.push(`${where}: bad deadlineType "${g.deadlineType}"`);

  if (g.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(g.deadline)) {
    errors.push(`${where}: deadline "${g.deadline}" is not YYYY-MM-DD`);
  }
  if (g.opensAt && !/^\d{4}-\d{2}-\d{2}$/.test(g.opensAt)) {
    errors.push(`${where}: opensAt "${g.opensAt}" is not YYYY-MM-DD`);
  }

  if (!Array.isArray(g.applicantTypes) || !g.applicantTypes.length) {
    errors.push(`${where}: applicantTypes is empty — the card would not answer "who can apply"`);
  } else {
    for (const t of g.applicantTypes) {
      if (!APPLICANTS.has(t)) errors.push(`${where}: unknown applicant type "${t}"`);
    }
  }

  if (!Array.isArray(g.geoScope) || !g.geoScope.length) {
    errors.push(`${where}: geoScope is empty — the country filter would never match it`);
  } else {
    for (const s of g.geoScope) {
      if (s !== "global" && !validScope.has(s)) {
        errors.push(`${where}: geoScope "${s}" is neither a region key nor a country code`);
      }
    }
  }

  if (g.status === "open" && g.deadlineType === "fixed" && !g.deadline) {
    warnings.push(`${where}: marked open with a fixed deadline but no date`);
  }
  if (!g.lastVerified) warnings.push(`${where}: never verified`);
}

if (!grants.length) errors.push("grants.json contains no entries at all");

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`ERROR ${e}`);

console.log(`\n${grants.length} entries, ${errors.length} error(s), ${warnings.length} warning(s)`);
if (errors.length) process.exit(1);
