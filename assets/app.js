/* Media Grant Radar — static front end over data/grants.json.
   No build step, no dependencies. Everything is derived from the data files,
   so the daily updater can add funders, support types and regions without
   anyone touching this file. */

(function () {
  "use strict";

  var SUPPORT_LABELS = {
    project: "Project / story grant",
    core: "Core / institutional support",
    fellowship: "Fellowship",
    emergency: "Emergency assistance",
    legal: "Legal defence",
    investment: "Loan / investment",
    regranting: "Re-granting to others",
    training: "Training",
    travel: "Travel",
    equipment: "Equipment"
  };

  var APPLICANT_LABELS = {
    freelancer: "Freelancers",
    organisation: "Media outlets"
  };

  /* Two tracks. "media" is a fund whose purpose is journalism. "adjacent" is a
     fund for some other cause — a green transition, gender equality, rule of
     law — that accepts reporting or public-information work as an eligible
     activity. The second kind is invisible on every journalism grant list,
     which is exactly why it is worth surfacing. */
  var TRACK_LABELS = {
    media: "Media fund",
    adjacent: "Journalism eligible"
  };

  var state = { geo: null, grants: [], generatedAt: null, filtered: [] };

  var el = {
    form: document.getElementById("filter-form"),
    q: document.getElementById("q"),
    country: document.getElementById("country"),
    supportTypes: document.getElementById("support-types"),
    sort: document.getElementById("sort"),
    cards: document.getElementById("cards"),
    empty: document.getElementById("empty"),
    count: document.getElementById("result-count"),
    context: document.getElementById("result-context"),
    freshness: document.getElementById("freshness-text"),
    footGenerated: document.getElementById("foot-generated")
  };

  /* ---------- dates ---------- */

  function today() {
    var d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  function parseDate(iso) {
    if (!iso) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }

  function daysBetween(from, to) {
    return Math.round((to - from) / 86400000);
  }

  function formatDate(iso) {
    var d = parseDate(iso);
    if (!d) return "";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }

  /* A stale data file must never advertise an expired call as open, so status
     is recomputed from the deadline rather than trusted from the file. */
  function effectiveStatus(g) {
    var now = today();
    var deadline = parseDate(g.deadline);
    if (deadline && daysBetween(now, deadline) < 0) return "closed";
    if (g.status === "closed") return "closed";
    if (g.deadlineType === "rolling") return "open";
    var opens = parseDate(g.opensAt);
    if (opens && daysBetween(now, opens) > 0) return "upcoming";
    if (g.status === "upcoming") return "upcoming";
    return g.status === "open" ? "open" : "upcoming";
  }

  function daysLeft(g) {
    var deadline = parseDate(g.deadline);
    return deadline ? daysBetween(today(), deadline) : null;
  }

  /* ---------- geography ---------- */

  function regionsForCountry(code) {
    var out = [];
    var members = state.geo.regionMembers;
    for (var region in members) {
      if (members[region].indexOf(code) !== -1) out.push(region);
    }
    return out;
  }

  function matchesCountry(g, code) {
    if (!code) return true;
    var scope = g.geoScope || [];
    if (scope.indexOf("global") !== -1) return true;
    if (scope.indexOf(code) !== -1) return true;
    var regions = regionsForCountry(code);
    for (var i = 0; i < scope.length; i++) {
      if (regions.indexOf(scope[i]) !== -1) return true;
    }
    return false;
  }

  function scopeLabel(scope) {
    if (!scope || !scope.length) return "Scope not stated";
    if (scope.indexOf("global") !== -1) return "Worldwide";
    var names = scope.map(function (key) {
      return state.geo.regionNames[key] || state.geo.countryNames[key] || key;
    });
    if (names.length <= 3) return names.join(" · ");
    return names.slice(0, 2).join(" · ") + " +" + (names.length - 2) + " more";
  }

  /* ---------- money ---------- */

  function amountLabel(a) {
    if (!a) return null;
    var cur = a.currency || "";
    var sym = { EUR: "€", USD: "$", GBP: "£" }[cur] || (cur ? cur + " " : "");
    function n(v) { return sym + v.toLocaleString("en-GB"); }
    if (a.min != null && a.max != null) return n(a.min) + " – " + n(a.max);
    if (a.max != null) return "up to " + n(a.max);
    if (a.min != null) return "from " + n(a.min);
    return null; // amount.note is shown in the card notes instead
  }

  /* ---------- filtering ---------- */

  function readFilters() {
    var data = new FormData(el.form);
    return {
      q: (data.get("q") || "").toString().trim().toLowerCase(),
      country: (data.get("country") || "").toString(),
      applicant: (data.get("applicant") || "").toString(),
      track: (data.get("track") || "").toString(),
      support: data.getAll("support").map(String),
      status: data.getAll("status").map(String),
      sort: (data.get("sort") || "deadline").toString()
    };
  }

  function apply(f) {
    var list = state.grants.filter(function (g) {
      if (f.status.indexOf(effectiveStatus(g)) === -1) return false;
      if (!matchesCountry(g, f.country)) return false;
      // Entries written before the two tracks existed are media funds.
      if (f.track && (g.track || "media") !== f.track) return false;

      if (f.applicant) {
        var who = g.applicantTypes || [];
        if (who.indexOf(f.applicant) === -1) return false;
      }

      if (f.support.length) {
        var kinds = g.supportTypes || [];
        var hit = f.support.some(function (s) { return kinds.indexOf(s) !== -1; });
        if (!hit) return false;
      }

      if (f.q) {
        var haystack = [
          g.funder, g.programme, g.summary, g.notes,
          (g.topics || []).join(" "), (g.supportTypes || []).join(" ")
        ].join(" ").toLowerCase();
        if (haystack.indexOf(f.q) === -1) return false;
      }

      return true;
    });

    list.sort(function (a, b) {
      if (f.sort === "funder") return (a.funder || "").localeCompare(b.funder || "");
      if (f.sort === "verified") {
        return (b.lastVerified || "").localeCompare(a.lastVerified || "");
      }
      // Deadline order: dated calls soonest first, then rolling, then undated.
      var da = daysLeft(a), db = daysLeft(b);
      var ra = da != null ? 0 : (a.deadlineType === "rolling" ? 1 : 2);
      var rb = db != null ? 0 : (b.deadlineType === "rolling" ? 1 : 2);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return da - db;
      return (a.funder || "").localeCompare(b.funder || "");
    });

    return list;
  }

  /* ---------- rendering ---------- */

  function make(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function badge(cls, text) {
    return make("span", "badge " + cls, text);
  }

  /* Where a card's facts came from, in the reader's own terms. A deadline read
     off the funder's page and a deadline quoted in somebody's search result are
     not the same claim, and the second is often last year's round. Saying only
     "last verified" would hide that difference behind a date. */
  function provenanceLine(g) {
    if (!g.lastVerified) return "Not yet checked automatically";
    var when = formatDate(g.lastVerified);
    if (g.confidence === "high") return "Read on the funder's own page, " + when;
    if (g.confidence === "medium") return "From search results, " + when + " — not confirmed on the funder's page";
    return "Unverified — written by hand, never checked against the funder";
  }

  function renderCard(g) {
    var status = effectiveStatus(g);
    var left = daysLeft(g);
    var urgent = left != null && left >= 0 && left <= 21;

    var card = make("article", "card");
    if (status === "closed") card.classList.add("is-closed");
    else if (urgent) card.classList.add("is-urgent");
    else if (g.deadlineType === "rolling") card.classList.add("is-rolling");

    var head = make("div", "card-head");
    head.appendChild(make("span", "card-funder", g.funder || "Unknown funder"));
    card.appendChild(head);

    var h3 = make("h3");
    var link = make("a", null, g.programme || "Untitled call");
    link.href = g.url || g.applyUrl || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    h3.appendChild(link);
    card.appendChild(h3);

    if (g.summary) card.appendChild(make("p", "card-summary", g.summary));

    var badges = make("div", "badges");

    if (status === "closed") {
      badges.appendChild(badge("badge-deadline", "Closed" + (g.deadline ? " " + formatDate(g.deadline) : "")));
    } else if (left != null) {
      var word = left === 0 ? "Closes today" : left === 1 ? "1 day left" : left + " days left";
      badges.appendChild(badge(urgent ? "badge-urgent" : "badge-deadline", word + " · " + formatDate(g.deadline)));
    } else if (g.deadlineType === "rolling") {
      badges.appendChild(badge("badge-rolling", "Rolling — no deadline"));
    } else if (g.opensAt) {
      badges.appendChild(badge("badge-deadline", "Opens " + formatDate(g.opensAt)));
    } else {
      badges.appendChild(badge("badge-deadline", "Next round — date not announced"));
    }

    // Only the adjacent track is badged: a media fund is the unremarkable case,
    // but "this is not a journalism grant" is something the reader must see.
    if ((g.track || "media") === "adjacent") {
      badges.appendChild(badge("badge-adjacent", TRACK_LABELS.adjacent));
    }

    var money = amountLabel(g.amount);
    if (money) badges.appendChild(badge("badge-money", money));

    (g.applicantTypes || []).forEach(function (t) {
      badges.appendChild(badge("badge-who", APPLICANT_LABELS[t] || t));
    });

    (g.supportTypes || []).forEach(function (t) {
      badges.appendChild(badge("badge-kind", SUPPORT_LABELS[t] || t));
    });

    badges.appendChild(badge("badge-where", scopeLabel(g.geoScope)));

    var stale = !g.lastVerified || daysBetween(parseDate(g.lastVerified), today()) > 14;
    if (g.confidence === "low" || stale) {
      badges.appendChild(badge("badge-check", "Verify on the funder's site"));
    }

    card.appendChild(badges);

    // For an adjacent call this is the whole point of the card: the reader needs
    // to see the route from a cause-based grant to journalistic work.
    if (g.eligibleActivity) {
      var angle = make("p", "card-angle");
      angle.appendChild(make("strong", null, "Journalism angle. "));
      angle.appendChild(document.createTextNode(g.eligibleActivity));
      card.appendChild(angle);
    }

    if (g.notes) card.appendChild(make("p", "card-note", g.notes));

    var foot = make("div", "card-foot");
    foot.appendChild(make("span", null, provenanceLine(g)));

    if (g.applyUrl) {
      var apply = make("a", "apply", "Open application page");
      apply.href = g.applyUrl;
      apply.target = "_blank";
      apply.rel = "noopener noreferrer";
      foot.appendChild(apply);
    }
    card.appendChild(foot);

    return card;
  }

  function render() {
    var f = readFilters();
    var list = apply(f);
    state.filtered = list;

    el.cards.textContent = "";
    list.forEach(function (g) { el.cards.appendChild(renderCard(g)); });
    el.empty.hidden = list.length > 0;

    var openNow = list.filter(function (g) { return effectiveStatus(g) === "open"; }).length;
    el.count.textContent = list.length === 1 ? "1 call" : list.length + " calls";

    var bits = [];
    if (openNow) bits.push(openNow + " accepting applications right now");
    if (f.country) bits.push("eligible from " + (state.geo.countryNames[f.country] || f.country));
    if (f.applicant) bits.push("open to " + (APPLICANT_LABELS[f.applicant] || f.applicant).toLowerCase());
    el.context.textContent = bits.join(" · ");

    // The feeds are per country, not per filter combination: a file exists for
    // each country, and there is no server to build one for an arbitrary query.
    var feed = f.country || "all";
    document.getElementById("feed-rss").href = "feeds/" + feed + ".xml";
    document.getElementById("feed-ics").href = "feeds/" + feed + ".ics";
    document.getElementById("feed-scope").textContent = f.country
      ? "— for " + (state.geo.countryNames[f.country] || f.country)
      : "— worldwide; pick a country above to narrow them";

    writeUrl(f);
  }

  /* ---------- URL state, so a filtered view can be shared ---------- */

  function writeUrl(f) {
    var p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.country) p.set("country", f.country);
    if (f.applicant) p.set("applicant", f.applicant);
    if (f.track) p.set("track", f.track);
    if (f.support.length) p.set("support", f.support.join(","));
    if (f.status.join(",") !== "open,upcoming") p.set("status", f.status.join(","));
    if (f.sort !== "deadline") p.set("sort", f.sort);
    var qs = p.toString();
    history.replaceState(null, "", qs ? "?" + qs : location.pathname);
  }

  function readUrl() {
    var p = new URLSearchParams(location.search);
    if (p.get("q")) el.q.value = p.get("q");
    if (p.get("country")) el.country.value = p.get("country");
    if (p.get("sort")) el.sort.value = p.get("sort");

    ["applicant", "track"].forEach(function (name) {
      var value = p.get(name);
      if (!value) return;
      var radio = el.form.querySelector(
        'input[name="' + name + '"][value="' + CSS.escape(value) + '"]');
      if (radio) radio.checked = true;
    });

    var support = (p.get("support") || "").split(",").filter(Boolean);
    if (support.length) {
      el.form.querySelectorAll('input[name="support"]').forEach(function (box) {
        box.checked = support.indexOf(box.value) !== -1;
      });
    }

    var status = (p.get("status") || "").split(",").filter(Boolean);
    if (status.length) {
      el.form.querySelectorAll('input[name="status"]').forEach(function (box) {
        box.checked = status.indexOf(box.value) !== -1;
      });
    }
  }

  /* ---------- controls built from the data ---------- */

  function buildCountrySelect() {
    var names = state.geo.countryNames;
    var codes = Object.keys(names).sort(function (a, b) {
      return names[a].localeCompare(names[b]);
    });
    var frag = document.createDocumentFragment();
    codes.forEach(function (code) {
      var opt = document.createElement("option");
      opt.value = code;
      opt.textContent = names[code];
      frag.appendChild(opt);
    });
    el.country.appendChild(frag);
  }

  function buildSupportChecks() {
    var seen = {};
    state.grants.forEach(function (g) {
      (g.supportTypes || []).forEach(function (t) { seen[t] = true; });
    });
    var types = Object.keys(seen).sort(function (a, b) {
      return (SUPPORT_LABELS[a] || a).localeCompare(SUPPORT_LABELS[b] || b);
    });
    types.forEach(function (t) {
      var label = document.createElement("label");
      var box = document.createElement("input");
      box.type = "checkbox";
      box.name = "support";
      box.value = t;
      label.appendChild(box);
      label.appendChild(make("span", null, SUPPORT_LABELS[t] || t));
      el.supportTypes.appendChild(label);
    });
  }

  /* ---------- CSV export ---------- */

  function toCsv(rows) {
    var cols = ["funder", "programme", "status", "deadline", "deadlineType", "amount",
                "applicants", "supportTypes", "eligibleFrom", "lastVerified", "url"];
    function esc(v) {
      var s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var lines = [cols.join(",")];
    rows.forEach(function (g) {
      lines.push([
        g.funder, g.programme, effectiveStatus(g), g.deadline || "", g.deadlineType || "",
        amountLabel(g.amount) || (g.amount && g.amount.note) || "",
        (g.applicantTypes || []).join(" / "), (g.supportTypes || []).join(" / "),
        scopeLabel(g.geoScope), g.lastVerified || "", g.applyUrl || g.url || ""
      ].map(esc).join(","));
    });
    return lines.join("\n");
  }

  function download() {
    var blob = new Blob(["﻿" + toCsv(state.filtered)], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "media-grant-radar-" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ---------- boot ---------- */

  function freshnessText(generatedAt) {
    var d = parseDate(generatedAt);
    if (!d) return "Update time unknown";
    var age = daysBetween(d, today());
    if (age <= 0) return "Updated today";
    if (age === 1) return "Updated yesterday";
    return "Updated " + age + " days ago";
  }

  function fail(message) {
    el.count.textContent = "Could not load the grant data";
    el.context.textContent = message;
    el.freshness.textContent = "Data unavailable";
  }

  Promise.all([
    fetch("data/geo.json").then(function (r) { return r.json(); }),
    fetch("data/grants.json").then(function (r) { return r.json(); })
  ]).then(function (results) {
    state.geo = results[0];
    state.grants = results[1].grants || [];
    state.generatedAt = results[1].generatedAt;

    buildCountrySelect();
    buildSupportChecks();
    readUrl();

    el.freshness.textContent = freshnessText(state.generatedAt) +
      " · " + state.grants.length + " calls tracked";
    el.footGenerated.textContent = state.generatedAt
      ? "Data generated " + formatDate(state.generatedAt) + "."
      : "";

    el.form.addEventListener("input", render);
    el.form.addEventListener("change", render);

    document.getElementById("reset").addEventListener("click", function () {
      el.form.reset();
      el.form.querySelectorAll('input[name="support"]').forEach(function (b) { b.checked = false; });
      render();
    });

    document.getElementById("share").addEventListener("click", function (e) {
      navigator.clipboard.writeText(location.href).then(function () {
        e.target.textContent = "Link copied";
        setTimeout(function () { e.target.textContent = "Copy link to this view"; }, 1800);
      });
    });

    document.getElementById("export").addEventListener("click", download);

    render();
  }).catch(function (err) {
    fail("Open the site through a web server or GitHub Pages — opening index.html straight from disk blocks the data files. (" + err.message + ")");
  });
})();
