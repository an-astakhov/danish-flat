import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const rootArgumentIndex = process.argv.indexOf("--root");
if (rootArgumentIndex >= 0 && !process.argv[rootArgumentIndex + 1]) {
  throw new Error("--root requires a path");
}

const ROOT = rootArgumentIndex >= 0
  ? resolve(process.argv[rootArgumentIndex + 1])
  : resolve(SKILL_DIR, "..", "..", "..");
const MARKDOWN_FILE = join(ROOT, "flats.md");
const DATA_FILE = join(ROOT, "dashboard", "data", "flats.json");

const candidates = [];
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "--candidate") {
    if (!process.argv[index + 1]) throw new Error("--candidate requires a URL");
    candidates.push(process.argv[index + 1]);
  }
}

function canonicalUrl(raw) {
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol)) throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|fbclid|gclid|dclid|msclkid|ref|referrer|bLat|lLng|rLng|tLat|view)$/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  return url.href.replace(/\/$/, "");
}

function splitRow(line) {
  const cells = [];
  let current = "";
  let escaped = false;
  for (const character of line) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      current += character;
      escaped = true;
    } else if (character === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells.slice(1, -1);
}

function parseLink(cell) {
  const match = String(cell || "").match(/^\[([^\]]+)\]\((https?:\/\/.+)\)$/);
  return match ? { label: match[1], url: match[2] } : null;
}

function textValue(value = "") {
  return String(value)
    .replaceAll("&mdash;", "")
    .replaceAll("&sup2;", "²")
    .replaceAll("<br>", " ")
    .replaceAll("\\|", "|")
    .trim();
}

function numericValue(value = "") {
  const match = textValue(value).match(/[\d,.]+/);
  if (!match) return null;
  const parsed = Number(match[0].replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function hostOf(raw) {
  return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
}

const [markdown, dashboardText] = await Promise.all([
  readFile(MARKDOWN_FILE, "utf8"),
  readFile(DATA_FILE, "utf8")
]);
const dashboard = JSON.parse(dashboardText);
if (!Array.isArray(dashboard.flats)) throw new Error("dashboard/data/flats.json must contain a flats array");

const records = new Map();
function mergeRecord(input, tracker) {
  const key = canonicalUrl(input.adUrl);
  const existing = records.get(key);
  if (existing) {
    if (!existing.trackers.includes(tracker)) existing.trackers.push(tracker);
    for (const field of ["title", "address", "sqm", "rooms", "rentDkk", "available", "status", "note", "listingId"]) {
      if ((existing[field] === null || existing[field] === "" || existing[field] === undefined) && input[field] !== undefined) {
        existing[field] = input[field];
      }
    }
    return;
  }
  records.set(key, {
    adUrl: input.adUrl,
    canonicalUrl: key,
    trackers: [tracker],
    title: input.title || "",
    address: input.address || "",
    sqm: Number.isFinite(input.sqm) ? input.sqm : null,
    rooms: Number.isFinite(input.rooms) ? input.rooms : (input.rooms || null),
    rentDkk: Number.isFinite(input.rentDkk) ? input.rentDkk : null,
    available: input.available || "",
    status: input.status || "",
    note: input.note || "",
    listingId: input.listingId || ""
  });
}

for (const flat of dashboard.flats) {
  if (!flat?.adUrl) throw new Error("Dashboard record is missing adUrl");
  mergeRecord({
    adUrl: flat.adUrl,
    title: flat.title,
    address: flat.address,
    sqm: flat.sqm,
    rooms: flat.roomsLabel || flat.rooms,
    rentDkk: flat.rentDkk,
    available: flat.available,
    status: flat.status,
    note: flat.note,
    listingId: flat.source?.listingId
  }, "dashboard");
}

const lines = markdown.split(/\r?\n/);
const headerIndex = lines.findIndex((line) => line.startsWith("| Ad | Map / address |"));
if (headerIndex < 0) throw new Error("Could not find the flats.md tracker table");
for (const line of lines.slice(headerIndex + 2)) {
  if (!line.startsWith("|")) break;
  const cells = splitRow(line);
  if (cells.length !== 18) throw new Error(`Markdown tracker row has ${cells.length} cells instead of 18`);
  const ad = parseLink(cells[0]);
  if (!ad) throw new Error("Markdown tracker row has no valid ad link in its first cell");
  const map = parseLink(cells[1]);
  mergeRecord({
    adUrl: ad.url,
    address: map?.label || "",
    sqm: numericValue(cells[6]),
    rooms: numericValue(cells[7]) ?? textValue(cells[7]),
    rentDkk: numericValue(cells[10]),
    available: textValue(cells[5]),
    status: textValue(cells[15]),
    note: textValue(cells[16])
  }, "markdown");
}

const knownListings = [...records.values()].sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl));
const portalMap = new Map();
for (const listing of knownListings) {
  const host = hostOf(listing.adUrl);
  portalMap.set(host, (portalMap.get(host) || 0) + 1);
}
const portals = [...portalMap.entries()]
  .map(([host, savedAds]) => ({ host, savedAds }))
  .sort((a, b) => b.savedAds - a.savedAds || a.host.localeCompare(b.host));

const exactCandidateMatches = candidates.map((candidate) => {
  const canonical = canonicalUrl(candidate);
  const match = records.get(canonical);
  return {
    candidate,
    canonicalUrl: canonical,
    known: Boolean(match),
    trackers: match?.trackers || [],
    matchedAdUrl: match?.adUrl || null
  };
});

const trackerCounts = {
  dashboard: dashboard.flats.length,
  markdown: knownListings.filter((listing) => listing.trackers.includes("markdown")).length,
  union: knownListings.length
};
const duplicateCanonicalUrls = knownListings
  .filter((listing) => listing.trackers.length > 1)
  .map((listing) => listing.canonicalUrl);

console.log(JSON.stringify({
  root: ROOT,
  trackerCounts,
  portals,
  exactCandidateMatches,
  knownListings,
  overlapCount: duplicateCanonicalUrls.length
}, null, 2));

