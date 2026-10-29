// Collects upcoming horse shows, races, competitions and auctions from official public sources into
// events.json. Run weekly by .github/workflows/update-events.yml (Node 20+, no dependencies).
//
// Only basic event facts are kept: name, type, dates, place and links. For each source the script
// checks robots.txt first, then reads structured data the site itself publishes:
//   - schema.org Event data embedded in the page (<script type="application/ld+json">)
//   - iCal (.ics / webcal:) calendar feeds linked from the page
//   - the public events API of WordPress sites that run "The Events Calendar"
// If a source can't be read, its last known events are kept and the error is logged.
// Events whose end date has passed are removed.

import { readFile, writeFile, appendFile } from "node:fs/promises";

const OUTPUT = new URL("../events.json", import.meta.url);
const USER_AGENT = "NexaHorseTransportEventsBot/1.0 (+https://nexahorsetransport.ca; weekly public calendar check)";
const TIMEOUT_MS = 20000;
const MAX_REQUESTS_PER_SOURCE = 8;
const MAX_EVENTS_PER_SOURCE = 60;
const MONTHS_AHEAD = 18;
// Pause between requests to the same site, to stay well within any site's limits.
const REQUEST_GAP_MS = Number(process.env.EVENTS_REQUEST_GAP_MS ?? 1500);

// `pages` are tried in order; the first that loads becomes the calendar link shown on the website.
// `defaults` fill in facts a source doesn't publish (e.g. every Spruce Meadows event is in Calgary).
// `horseOnly` sources also list non-horse events (concerts, casino nights, food shows), so only events
// whose names are clearly about racing, shows, competitions or sales are kept.
const SOURCES = [
  { id: "equestrian-canada", name: "Equestrian Canada", type: "competition",
    pages: ["https://www.equestrian.ca/competitions", "https://www.equestrian.ca/events", "https://www.equestrian.ca/"],
    defaults: { country: "CA" } },
  { id: "usef", name: "US Equestrian (USEF)", type: "competition",
    pages: ["https://www.usef.org/compete/competitions", "https://www.usef.org/events", "https://www.usef.org/"],
    defaults: { country: "US" } },
  { id: "spruce-meadows", name: "Spruce Meadows", type: "show",
    pages: ["https://www.sprucemeadows.com/tournaments", "https://www.sprucemeadows.com/events", "https://www.sprucemeadows.com/"],
    defaults: { venue: "Spruce Meadows", city: "Calgary", region: "AB", country: "CA" } },
  { id: "calgary-stampede", horseOnly: true, name: "Calgary Stampede", type: "competition",
    pages: ["https://www.calgarystampede.com/stampede", "https://www.calgarystampede.com/"],
    defaults: { venue: "Stampede Park", city: "Calgary", region: "AB", country: "CA" } },
  { id: "horse-racing-alberta", name: "Horse Racing Alberta", type: "race",
    pages: ["https://www.horseracingalberta.com/race-dates", "https://www.horseracingalberta.com/"],
    defaults: { region: "AB", country: "CA" } },
  { id: "century-mile", horseOnly: true, name: "Century Mile Racetrack", type: "race",
    pages: ["https://www.centurymile.com/racing", "https://www.centurymile.com/events", "https://www.centurymile.com/"],
    defaults: { venue: "Century Mile", city: "Edmonton", region: "AB", country: "CA" } },
  { id: "woodbine", horseOnly: true, name: "Woodbine Racetrack", type: "race",
    pages: ["https://woodbine.com/events", "https://woodbine.com/"],
    defaults: { venue: "Woodbine Racetrack", city: "Toronto", region: "ON", country: "CA" } },
  { id: "hastings", horseOnly: true, name: "Hastings Racecourse", type: "race",
    pages: ["https://www.hastingsracecourse.com/events", "https://www.hastingsracecourse.com/"],
    defaults: { venue: "Hastings Racecourse", city: "Vancouver", region: "BC", country: "CA" } },
  { id: "royal-winter-fair", horseOnly: true, name: "Royal Agricultural Winter Fair (Royal Horse Show)", type: "show",
    pages: ["https://www.royalfair.org/"],
    defaults: { venue: "Exhibition Place", city: "Toronto", region: "ON", country: "CA" } },
  { id: "cths-alberta", name: "Canadian Thoroughbred Horse Society (Alberta) sales", type: "auction",
    pages: ["https://www.cthsalberta.com/sales", "https://www.cthsalberta.com/"],
    defaults: { region: "AB", country: "CA" } },
  { id: "keeneland", horseOnly: true, name: "Keeneland (racing and sales)", type: "race",
    pages: ["https://www.keeneland.com/sales", "https://www.keeneland.com/racing", "https://www.keeneland.com/"],
    defaults: { venue: "Keeneland", city: "Lexington", region: "KY", country: "US" } },
  { id: "kentucky-derby", horseOnly: true, name: "Kentucky Derby / Churchill Downs", type: "race",
    pages: ["https://www.kentuckyderby.com/", "https://www.churchilldowns.com/"],
    defaults: { venue: "Churchill Downs", city: "Louisville", region: "KY", country: "US" } },
  { id: "breeders-cup", name: "Breeders' Cup", type: "race",
    pages: ["https://www.breederscup.com/"],
    defaults: { country: "US" } },
  { id: "fasig-tipton", name: "Fasig-Tipton sales", type: "auction",
    pages: ["https://www.fasigtipton.com/sales", "https://www.fasigtipton.com/"],
    defaults: { country: "US" } }
];

const PROVINCES = { AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador",
  NS: "Nova Scotia", NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec",
  SK: "Saskatchewan", YT: "Yukon" };
const STATES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia" };

// ---------- fetching, politely ----------

const robotsCache = new Map();
const lastRequestAt = new Map();

async function rawFetch(url, accept) {
  const host = new URL(url).host;
  const wait = (lastRequestAt.get(host) || 0) + REQUEST_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt.set(host, Date.now());
  return fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: accept || "text/html,application/xhtml+xml,application/json,text/calendar;q=0.9,*/*;q=0.5" },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
}

// robots.txt rules for our bot (or "*"), per RFC 9309: a missing robots.txt allows everything;
// a server error or network failure is treated as "disallow all".
async function robotsRules(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  let rules;
  try {
    const res = await rawFetch(origin + "/robots.txt", "text/plain");
    if (res.status >= 400 && res.status < 500) rules = [];
    else if (!res.ok) rules = [{ allow: false, path: "/" }];
    else rules = parseRobots(await res.text());
  } catch {
    rules = [{ allow: false, path: "/" }];
  }
  robotsCache.set(origin, rules);
  return rules;
}

function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && (key === "allow" || key === "disallow") && value) current.rules.push({ allow: key === "allow", path: value });
    }
  }
  const mine = groups.filter((g) => g.agents.includes("nexahorsetransporteventsbot"));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  return chosen.flatMap((g) => g.rules);
}

function robotsAllows(rules, url) {
  const u = new URL(url);
  const path = u.pathname + u.search;
  let best = null;
  for (const rule of rules) {
    // "*" matches anything; a trailing "$" anchors the end of the path.
    const body = rule.path.replace(/[.+?^(){}|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    const pattern = "^" + (body.endsWith("$") ? body.slice(0, -1).replace(/\$/g, "\\$") + "$" : body.replace(/\$/g, "\\$"));
    if (new RegExp(pattern).test(path) && (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow))) {
      best = rule;
    }
  }
  return !best || best.allow;
}

async function politeGet(url, budget, accept) {
  if (budget.left <= 0) throw new Error("request budget used up");
  const u = new URL(url);
  if (!robotsAllows(await robotsRules(u.origin), url)) throw new Error("blocked by robots.txt: " + u.pathname);
  budget.left--;
  const res = await rawFetch(url, accept);
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return { url: res.url || url, type: res.headers.get("content-type") || "", text: await res.text() };
}

// ---------- reading structured data ----------

function decodeEntities(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&nbsp;/g, " ");
}

function cleanText(s) {
  return decodeEntities(String(s || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function toDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

function jsonLdEvents(html) {
  const found = [];
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const types = [].concat(node["@type"] || []);
    if (types.some((t) => /Event$/.test(String(t))) && node.name && node.startDate) found.push(node);
    for (const key of ["@graph", "itemListElement", "item", "subEvent", "event", "events"]) if (node[key]) visit(node[key]);
  };
  for (const block of blocks) {
    try {
      visit(JSON.parse(block.replace(/^<script[^>]*>|<\/script>$/gi, "").trim()));
    } catch { /* ignore malformed blocks */ }
  }
  return found.map((e) => {
    const loc = [].concat(e.location || [])[0] || {};
    const addr = typeof loc.address === "string" ? { streetAddress: loc.address } : loc.address || {};
    return {
      name: cleanText(e.name),
      start: toDate(e.startDate),
      end: toDate(e.endDate || e.startDate),
      venue: cleanText(loc.name),
      city: cleanText(addr.addressLocality),
      region: cleanText(addr.addressRegion),
      country: cleanText(typeof addr.addressCountry === "object" ? addr.addressCountry.name : addr.addressCountry),
      placeText: cleanText([loc.name, addr.streetAddress, addr.addressLocality, addr.addressRegion].filter(Boolean).join(", ")),
      website: typeof e.url === "string" ? e.url : null
    };
  });
}

function icalEvents(text) {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events = [];
  let cur = null;
  const unescape = (v) => v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") { if (cur && cur.name && cur.start) events.push(cur); cur = null; }
    else if (cur) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const key = line.slice(0, i).split(";")[0].toUpperCase();
      const params = line.slice(0, i);
      const value = line.slice(i + 1);
      if (key === "SUMMARY") cur.name = unescape(value);
      else if (key === "DTSTART") cur.start = toDate(value);
      else if (key === "DTEND") {
        // An all-day DTEND is exclusive (the day after the event ends).
        let end = toDate(value);
        if (end && /VALUE=DATE(?!-)/i.test(params)) { const d = new Date(end + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); end = d.toISOString().slice(0, 10); }
        cur.end = end;
      } else if (key === "LOCATION") cur.placeText = unescape(value);
      else if (key === "URL") cur.website = value.trim();
    }
  }
  return events.map((e) => ({ ...e, end: e.end && e.end >= e.start ? e.end : e.start }));
}

function tribeEvents(json) {
  return (json.events || []).map((e) => {
    const v = e.venue || {};
    return {
      name: cleanText(e.title),
      start: toDate(e.start_date),
      end: toDate(e.end_date || e.start_date),
      venue: cleanText(v.venue),
      city: cleanText(v.city),
      region: cleanText(v.stateprovince || v.state || v.province),
      country: cleanText(v.country),
      placeText: cleanText([v.venue, v.city, v.stateprovince].filter(Boolean).join(", ")),
      website: e.website || e.url || null
    };
  });
}

// Links on a page that point to iCal calendar feeds.
function icalLinks(html, base) {
  const links = new Set();
  const re = /(?:href|src)=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = decodeEntities(m[1]);
    if (/^webcal:/i.test(href) || /\.ics(\?|$)/i.test(href) || /[?&](ical|outlook-ical)=1/i.test(href) || /format=ical/i.test(href)) {
      try { links.add(new URL(href.replace(/^webcal:/i, "https:"), base).href); } catch { /* bad link */ }
    }
  }
  const alt = /<link[^>]+type=["']text\/calendar["'][^>]*>/gi;
  while ((m = alt.exec(html))) {
    const h = m[0].match(/href=["']([^"']+)["']/i);
    if (h) try { links.add(new URL(decodeEntities(h[1]), base).href); } catch { /* bad link */ }
  }
  return [...links];
}

// ---------- tidying the facts ----------

function normaliseCountry(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return null;
  if (["ca", "can", "canada"].includes(v)) return "CA";
  if (["us", "usa", "united states", "united states of america", "u.s.", "u.s.a."].includes(v)) return "US";
  return null;
}

function normaliseRegion(value) {
  const v = String(value || "").trim();
  if (!v) return null;
  const up = v.toUpperCase().replace(/\./g, "");
  if (PROVINCES[up] || STATES[up]) return up;
  const byName = (table) => Object.keys(table).find((k) => table[k].toLowerCase() === v.toLowerCase());
  return byName(PROVINCES) || byName(STATES) || null;
}

// Finds "City, ST" in free text such as "Spruce Meadows, 18011 Spruce Meadows Way SW, Calgary, AB T2X 4B7".
function placeFromText(text) {
  const parts = String(text || "").split(/\s*,\s*/).filter(Boolean);
  for (let i = parts.length - 1; i >= 1; i--) {
    const code = normaliseRegion(parts[i].split(/\s+/)[0]) || normaliseRegion(parts[i].replace(/\s+[A-Z]\d[A-Z].*$|\s+\d{5}(-\d{4})?$/, ""));
    if (code) return { city: parts[i - 1].replace(/^\d+\s.*$/, ""), region: code };
  }
  return {};
}

// The event type from its name, or null if the name doesn't say.
function classify(name) {
  const n = name.toLowerCase();
  if (/\b(sale|sales|auction)\b/.test(n)) return "auction";
  if (/\b(race|races|racing|stakes|derby|cup day|handicap|post time|breeders'? cup|plate)\b/.test(n)) return "race";
  if (/\b(horse show|show jumping|tournament|masters|royal horse show|national|north american|hunter|jumper)\b/.test(n)) return "show";
  if (/\b(championships?|competition|rodeo|stampede|dressage|eventing|reining|cutting|trials?|equestrian|equine)\b/.test(n)) return "competition";
  if (/\bhorses?\b/.test(n)) return "show";
  return null;
}

function slug(s) {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function tidy(raw, source, sourceUrl, today, horizon) {
  if (!raw.name || !raw.start) return null;
  const end = raw.end && raw.end >= raw.start ? raw.end : raw.start;
  if (end < today || raw.start > horizon) return null;
  const fromText = placeFromText(raw.placeText);
  const region = normaliseRegion(raw.region) || fromText.region || source.defaults.region || null;
  const country = normaliseCountry(raw.country) || (region && PROVINCES[region] ? "CA" : region && STATES[region] ? "US" : null) || source.defaults.country || null;
  if (country !== "CA" && country !== "US") return null;
  const name = raw.name.slice(0, 160);
  const type = classify(name) || (source.horseOnly ? null : source.type);
  if (!type) return null;
  return {
    id: slug(source.id + "-" + name + "-" + raw.start),
    name,
    type,
    start: raw.start,
    end,
    venue: raw.venue || source.defaults.venue || null,
    city: raw.city || fromText.city || source.defaults.city || null,
    region,
    country,
    website: raw.website && /^https?:\/\//.test(raw.website) ? raw.website : sourceUrl,
    sourceUrl,
    sourceId: source.id,
    sourceName: source.name
  };
}

// ---------- one source ----------

async function collect(source, today, horizon) {
  const budget = { left: MAX_REQUESTS_PER_SOURCE };
  const log = [];
  const raw = [];
  let calendarUrl = null;
  let pageErrors = [];
  for (const pageUrl of source.pages) {
    let page;
    try {
      page = await politeGet(pageUrl, budget);
    } catch (err) {
      pageErrors.push(err.message);
      continue;
    }
    calendarUrl = calendarUrl || page.url;
    const ld = jsonLdEvents(page.text);
    if (ld.length) log.push(`${ld.length} schema.org events on ${page.url}`);
    raw.push(...ld.map((e) => ({ ...e, sourceUrl: page.url })));

    for (const feed of icalLinks(page.text, page.url).slice(0, 3)) {
      try {
        const res = await politeGet(feed, budget, "text/calendar,*/*;q=0.5");
        const events = icalEvents(res.text);
        log.push(`${events.length} events in iCal feed ${feed}`);
        raw.push(...events.map((e) => ({ ...e, sourceUrl: page.url })));
      } catch (err) {
        log.push(`iCal feed failed: ${err.message}`);
      }
    }

    if (/tribe-events|the-events-calendar/i.test(page.text)) {
      const api = new URL("/wp-json/tribe/events/v1/events?per_page=50&start_date=" + today, page.url).href;
      try {
        const res = await politeGet(api, budget, "application/json");
        const events = tribeEvents(JSON.parse(res.text));
        log.push(`${events.length} events from the site's events API`);
        raw.push(...events.map((e) => ({ ...e, sourceUrl: page.url })));
      } catch (err) {
        log.push(`events API failed: ${err.message}`);
      }
    }
    if (raw.length) break;
  }
  if (!calendarUrl) throw Object.assign(new Error(pageErrors.join("; ") || "no page could be loaded"), { log });
  const seen = new Set();
  const events = raw
    .map((e) => tidy(e, source, e.sourceUrl, today, horizon))
    .filter((e) => e && !seen.has(e.id) && seen.add(e.id))
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, MAX_EVENTS_PER_SOURCE);
  if (!raw.length) log.push("no calendar feed or structured event data found" + (pageErrors.length ? ` (also: ${pageErrors.join("; ")})` : ""));
  return { events, calendarUrl, log, readable: raw.length > 0 };
}

// ---------- main ----------

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const horizonDate = new Date();
  horizonDate.setUTCMonth(horizonDate.getUTCMonth() + MONTHS_AHEAD);
  const horizon = horizonDate.toISOString().slice(0, 10);

  let previous = { events: [], sources: [] };
  try { previous = JSON.parse(await readFile(OUTPUT, "utf8")); } catch { /* first run */ }
  const previousSource = new Map((previous.sources || []).map((s) => [s.id, s]));

  const events = [];
  const sources = [];
  const report = [];
  for (const source of SOURCES) {
    const before = previousSource.get(source.id) || {};
    const kept = (previous.events || []).filter((e) => e.sourceId === source.id && e.end >= today);
    try {
      const result = await collect(source, today, horizon);
      // A source that loads but publishes nothing readable keeps its last known events.
      const useNew = result.readable;
      events.push(...(useNew ? result.events : kept));
      sources.push({
        id: source.id, name: source.name, calendarUrl: result.calendarUrl,
        status: useNew ? "ok" : "not-readable",
        lastSuccess: useNew ? today : before.lastSuccess || null,
        message: result.log.join("; ")
      });
      report.push(`${useNew ? "OK  " : "--  "} ${source.name}: ${useNew ? result.events.length + " upcoming events" : "not readable automatically"}${result.log.length ? " — " + result.log.join("; ") : ""}`);
    } catch (err) {
      events.push(...kept);
      sources.push({
        id: source.id, name: source.name, calendarUrl: before.calendarUrl || source.pages[source.pages.length - 1],
        status: "error", lastSuccess: before.lastSuccess || null, message: err.message
      });
      report.push(`ERR  ${source.name}: ${err.message} (kept ${kept.length} last known events)`);
      console.error(`::warning title=${source.name}::${err.message}`);
    }
  }

  const seen = new Set();
  const unique = events
    .filter((e) => e.end >= today)
    .filter((e) => { const k = (e.name + "|" + e.start).toLowerCase(); return !seen.has(k) && seen.add(k); })
    .sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));

  const output = { updated: new Date().toISOString(), sources, events: unique };
  await writeFile(OUTPUT, JSON.stringify(output, null, 2) + "\n");

  const summary = [`Events calendar update — ${unique.length} upcoming events`, "", ...report].join("\n");
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, "```\n" + summary + "\n```\n");
  }
}

main().catch((err) => {
  // Something unexpected: leave events.json as it was so the website keeps working.
  console.error("Events update failed, events.json left unchanged:", err);
  process.exit(1);
});
