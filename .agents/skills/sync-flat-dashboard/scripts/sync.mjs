import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WRITE = process.argv.includes("--write");
const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(SKILL_DIR, "..", "..", "..");
const MARKDOWN_FILE = join(ROOT, "flats.md");
const DATA_FILE = join(ROOT, "dashboard", "data", "flats.json");

function splitRow(line) {
  const cells = [];
  let current = "";
  let escaped = false;
  for (const character of line) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
      current += character;
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

function decode(value = "") {
  return value
    .replaceAll("&mdash;", "—")
    .replaceAll("&sup2;", "²")
    .replaceAll("&amp;", "&")
    .replaceAll("â€”", "—")
    .replaceAll("â€™", "’")
    .replaceAll("â€“", "–")
    .replaceAll("Â²", "²")
    .replaceAll("<br>", "\n")
    .trim();
}

function valueOrNull(value) {
  const decoded = decode(value);
  return !decoded || decoded === "—" ? null : decoded;
}

function parseLink(value) {
  const match = value.match(/^\[([^\]]+)\]\((.+)\)$/);
  return match ? { label: decode(match[1]), url: match[2] } : null;
}

function parseNumber(value) {
  const match = decode(value).match(/-?[\d,.]+/);
  if (!match) return null;
  const normalized = match[0].replaceAll(",", "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMoney(value) {
  const decoded = valueOrNull(value);
  if (!decoded || !/^DKK\s/i.test(decoded)) return null;
  return parseNumber(decoded);
}

function parseTravel(value) {
  const link = parseLink(value);
  const label = link?.label || valueOrNull(value);
  return { minutes: label ? parseNumber(label) : null, mapsUrl: link?.url || null };
}

function parseNearestMetro(value) {
  const link = parseLink(value);
  if (!link) return null;
  const match = link.label.match(/^(.+?)\s+—\s+~?([\d.]+)\s*(m|km)$/i);
  if (!match) return null;
  const distance = Number(match[2]) * (match[3].toLowerCase() === "km" ? 1000 : 1);
  return { name: match[1].trim(), distanceMeters: Math.round(distance), mapsUrl: link.url };
}

function canonicalUrl(raw) {
  const url = new URL(raw);
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|bLat|lLng|rLng|tLat|view)/i.test(key)) url.searchParams.delete(key);
  }
  url.hash = "";
  return url.href.replace(/\/$/, "");
}

function siteName(url) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const names = {
    "boligzonen.dk": "BoligZonen",
    "boligportal.dk": "BoligPortal",
    "housinganywhere.com": "HousingAnywhere",
    "edc.dk": "EDC",
    "balder.dk": "Balder",
    "findbolig.nu": "FindBolig",
    "home.dk": "home"
  };
  return names[host] || host;
}

function makeId(adUrl) {
  const url = new URL(adUrl);
  const site = url.hostname.replace(/^www\./, "").split(".")[0].replace(/[^a-z0-9]+/g, "-");
  const slug = url.pathname.split("/").filter(Boolean).at(-1)?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "flat";
  const hash = createHash("sha1").update(canonicalUrl(adUrl)).digest("hex").slice(0, 7);
  return `${site}-${slug.slice(0, 42)}-${hash}`;
}

function fallbackTitle(roomsLabel, address) {
  return `${roomsLabel || "Rental"}${roomsLabel ? " rooms" : ""} · ${address || "Copenhagen"}`;
}

function resolveManualField(existing, field, markdownValue, conflicts) {
  if (!existing) return markdownValue;
  const syncKey = field === "status" ? "markdownStatus" : "markdownNote";
  const previousMarkdown = existing.sync?.[syncKey];
  if (previousMarkdown === undefined) return existing[field] || markdownValue;
  const dashboardChanged = existing[field] !== previousMarkdown;
  const markdownChanged = markdownValue !== previousMarkdown;
  if (dashboardChanged && markdownChanged) {
    conflicts.push(field);
    return existing[field];
  }
  return dashboardChanged ? existing[field] : markdownValue;
}

function markdownRecord(cells, existing, now, conflicts) {
  const ad = parseLink(cells[0]);
  const map = parseLink(cells[1]);
  if (!ad) throw new Error("Row has no valid Ad link");

  const address = map?.label || null;
  const roomsLabel = valueOrNull(cells[7]);
  const markdownStatus = valueOrNull(cells[15]) || "";
  const markdownNote = valueOrNull(cells[16]) || "";
  const status = resolveManualField(existing, "status", markdownStatus, conflicts);
  const note = resolveManualField(existing, "note", markdownNote, conflicts);
  const utilitiesDkk = parseMoney(cells[11]);
  const depositDkk = parseMoney(cells[12]);
  const prepaidRentDkk = parseMoney(cells[13]);

  return {
    id: existing?.id || makeId(ad.url),
    title: existing?.title || fallbackTitle(roomsLabel, address),
    adUrl: ad.url,
    address,
    mapUrl: map?.url || null,
    location: existing?.location || null,
    nearestMetro: parseNearestMetro(cells[2]),
    commute: {
      nordhavn: parseTravel(cells[3]),
      havneholmen: parseTravel(cells[4])
    },
    available: valueOrNull(cells[5]),
    sqm: parseNumber(cells[6]),
    rooms: roomsLabel && /^\d+(\.\d+)?$/.test(roomsLabel) ? Number(roomsLabel) : null,
    roomsLabel: roomsLabel && !/^\d+(\.\d+)?$/.test(roomsLabel) ? roomsLabel : null,
    floor: valueOrNull(cells[8]),
    outdoor: valueOrNull(cells[9]) ? decode(cells[9]).split(/;\s*/).filter(Boolean) : [],
    rentDkk: parseMoney(cells[10]),
    utilitiesDkk,
    utilitiesText: utilitiesDkk === null ? valueOrNull(cells[11]) : null,
    depositDkk,
    depositText: depositDkk === null ? valueOrNull(cells[12]) : null,
    prepaidRentDkk,
    prepaidRentText: prepaidRentDkk === null ? valueOrNull(cells[13]) : null,
    rentalPeriod: valueOrNull(cells[14]),
    status,
    note,
    noteAi: valueOrNull(cells[17]) || "",
    photos: existing?.photos || [],
    source: {
      ...(existing?.source || {}),
      site: existing?.source?.site || siteName(ad.url),
      checkedAt: existing?.source?.checkedAt || null
    },
    sync: {
      markdownStatus,
      markdownNote,
      syncedAt: now,
      presentInMarkdown: true
    }
  };
}

const markdown = await readFile(MARKDOWN_FILE, "utf8");
const tracker = JSON.parse(await readFile(DATA_FILE, "utf8"));
const rows = markdown.split(/\r?\n/).filter((line) => line.startsWith("| [Ad]"));
const existingByUrl = new Map(tracker.flats.map((flat) => [canonicalUrl(flat.adUrl), flat]));
const seen = new Set();
const conflicts = [];
let added = 0;
let updated = 0;
const now = new Date().toISOString();
const synced = [];

for (const [index, line] of rows.entries()) {
  const cells = splitRow(line);
  if (cells.length !== 18) throw new Error(`Markdown row ${index + 1} has ${cells.length} cells instead of 18`);
  const ad = parseLink(cells[0]);
  const key = canonicalUrl(ad.url);
  if (seen.has(key)) continue;
  seen.add(key);
  const existing = existingByUrl.get(key);
  const recordConflicts = [];
  synced.push(markdownRecord(cells, existing, now, recordConflicts));
  if (existing) updated += 1;
  else added += 1;
  if (recordConflicts.length) conflicts.push({ adUrl: ad.url, fields: recordConflicts });
}

const retained = tracker.flats.filter((flat) => !seen.has(canonicalUrl(flat.adUrl))).map((flat) => ({
  ...flat,
  sync: flat.sync ? { ...flat.sync, presentInMarkdown: false, syncedAt: now } : flat.sync
}));
const nextTracker = { ...tracker, version: 1, updatedAt: now, flats: [...synced, ...retained] };
const summary = { markdownRows: rows.length, added, updated, retained: retained.length, conflicts };

if (WRITE) {
  const temporaryFile = `${DATA_FILE}.sync-tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(nextTracker, null, 2)}\n`, "utf8");
  await rename(temporaryFile, DATA_FILE);
}

console.log(`${WRITE ? "Applied" : "Dry run"}: ${JSON.stringify(summary)}`);
