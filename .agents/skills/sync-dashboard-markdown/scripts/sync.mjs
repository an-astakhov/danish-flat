import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WRITE = process.argv.includes("--write");
const ALLOW_CONFLICTS = process.argv.includes("--allow-conflicts");
const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const rootArgumentIndex = process.argv.indexOf("--root");
if (rootArgumentIndex >= 0 && !process.argv[rootArgumentIndex + 1]) throw new Error("--root requires a path");
const ROOT = rootArgumentIndex >= 0
  ? resolve(process.argv[rootArgumentIndex + 1])
  : resolve(SKILL_DIR, "..", "..", "..");
const MARKDOWN_FILE = join(ROOT, "flats.md");
const DATA_FILE = join(ROOT, "dashboard", "data", "flats.json");
const HEADER_PREFIX = "| Ad | Map / address | Nearest metro |";
const EMPTY = "&mdash;";

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

function decode(value = "") {
  return value
    .replaceAll("&mdash;", "—")
    .replaceAll("&sup2;", "²")
    .replaceAll("&amp;", "&")
    .replaceAll("<br>", "\n")
    .replaceAll("\\|", "|")
    .trim();
}

function value(value = "") {
  const decoded = decode(value);
  return !decoded || decoded === "—" ? "" : decoded;
}

function escapeCell(input) {
  return String(input ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\r\n", "<br>")
    .replaceAll("\n", "<br>")
    .trim();
}

function escapeLabel(input) {
  return escapeCell(input).replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function markdownUrl(input) {
  return String(input).replaceAll(" ", "%20").replaceAll("(", "%28").replaceAll(")", "%29");
}

function link(label, url) {
  return label && url ? `[${escapeLabel(label)}](${markdownUrl(url)})` : EMPTY;
}

function parseLink(cell) {
  const match = cell.match(/^\[([^\]]+)\]\((.+)\)$/);
  return match ? { label: decode(match[1]), url: match[2] } : null;
}

function canonicalUrl(raw) {
  const url = new URL(raw);
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|bLat|lLng|rLng|tLat|view)/i.test(key)) url.searchParams.delete(key);
  }
  url.hash = "";
  return url.href.replace(/\/$/, "");
}

function parseNumber(cell) {
  const match = value(cell).match(/-?[\d,.]+/);
  if (!match) return null;
  const parsed = Number(match[0].replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function knownOrExisting(known, generated, existing) {
  return known ? generated : (existing || EMPTY);
}

function formatMoney(number, text, existing) {
  if (Number.isFinite(number)) {
    if (parseNumber(existing) === number && /^DKK\s/i.test(value(existing))) return existing;
    return `DKK ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(number)}`;
  }
  return text ? escapeCell(text) : (existing || EMPTY);
}

function formatDistance(flat) {
  const distance = flat.nearestMetro?.distanceMeters;
  if (!Number.isFinite(distance)) return null;
  const approximate = flat.location?.approximate ? "~" : "";
  if (distance >= 1000) return `${approximate}${(distance / 1000).toFixed(1)} km`;
  return `${approximate}${Math.round(distance)} m`;
}

function formatTravel(travel) {
  if (!travel || !Number.isFinite(travel.minutes) || !travel.mapsUrl) return null;
  const label = travel.minutes === 0 ? "0 min" : `~${travel.minutes} min`;
  return link(label, travel.mapsUrl);
}

function resolveManual(flat, field, markdownValue, hasRow) {
  const dashboardValue = String(flat[field] || "").trim();
  if (!hasRow) return { value: dashboardValue, baseline: dashboardValue, conflict: false };

  const syncKey = field === "status" ? "markdownStatus" : "markdownNote";
  const baseline = flat.sync?.[syncKey];
  if (baseline === undefined) {
    if (!markdownValue) return { value: dashboardValue, baseline: dashboardValue, conflict: false };
    if (!dashboardValue) return { value: markdownValue, baseline: undefined, conflict: false };
    if (dashboardValue === markdownValue) return { value: markdownValue, baseline: markdownValue, conflict: false };
    return { value: markdownValue, baseline: undefined, conflict: true };
  }

  const dashboardChanged = dashboardValue !== baseline;
  const markdownChanged = markdownValue !== baseline;
  if (dashboardChanged && markdownChanged && dashboardValue !== markdownValue) {
    return { value: markdownValue, baseline, conflict: true };
  }
  if (dashboardChanged) return { value: dashboardValue, baseline: dashboardValue, conflict: false };
  if (markdownChanged) return { value: markdownValue, baseline, conflict: false };
  return { value: markdownValue, baseline, conflict: false };
}

function renderRow(flat, existingCells, conflicts) {
  const hasRow = Boolean(existingCells);
  const cells = existingCells ? [...existingCells] : Array(18).fill(EMPTY);
  while (cells.length < 18) cells.push(EMPTY);

  const status = resolveManual(flat, "status", hasRow ? value(cells[15]) : "", hasRow);
  const note = resolveManual(flat, "note", hasRow ? value(cells[16]) : "", hasRow);
  if (status.conflict) conflicts.push("status");
  if (note.conflict) conflicts.push("note");

  cells[0] = link("Ad", flat.adUrl);
  cells[1] = knownOrExisting(flat.address && flat.mapUrl, link(flat.address, flat.mapUrl), cells[1]);

  const distance = formatDistance(flat);
  const nearestKnown = Boolean(flat.nearestMetro?.name && distance && flat.nearestMetro?.mapsUrl);
  cells[2] = knownOrExisting(
    nearestKnown,
    nearestKnown ? link(`${flat.nearestMetro.name} — ${distance}`, flat.nearestMetro.mapsUrl) : null,
    cells[2]
  );
  cells[3] = knownOrExisting(formatTravel(flat.commute?.nordhavn), formatTravel(flat.commute?.nordhavn), cells[3]);
  cells[4] = knownOrExisting(formatTravel(flat.commute?.havneholmen), formatTravel(flat.commute?.havneholmen), cells[4]);
  cells[5] = knownOrExisting(flat.available, escapeCell(flat.available), cells[5]);
  cells[6] = knownOrExisting(Number.isFinite(flat.sqm), `${flat.sqm} m&sup2;`, cells[6]);
  const rooms = flat.roomsLabel || flat.rooms;
  cells[7] = knownOrExisting(rooms !== null && rooms !== undefined && rooms !== "", escapeCell(rooms), cells[7]);
  cells[8] = knownOrExisting(flat.floor, escapeCell(flat.floor), cells[8]);
  cells[9] = knownOrExisting(flat.outdoor?.length, flat.outdoor.map(escapeCell).join("; "), cells[9]);
  cells[10] = formatMoney(flat.rentDkk, null, cells[10]);
  cells[11] = formatMoney(flat.utilitiesDkk, flat.utilitiesText, cells[11]);
  cells[12] = formatMoney(flat.depositDkk, flat.depositText, cells[12]);
  cells[13] = formatMoney(flat.prepaidRentDkk, flat.prepaidRentText, cells[13]);
  cells[14] = knownOrExisting(flat.rentalPeriod, escapeCell(flat.rentalPeriod), cells[14]);
  cells[15] = status.value ? escapeCell(status.value) : "";
  cells[16] = note.value ? escapeCell(note.value) : "";
  cells[17] = knownOrExisting(flat.noteAi, escapeCell(flat.noteAi), cells[17]);

  return { line: `| ${cells.join(" | ")} |`, status, note };
}

const markdown = await readFile(MARKDOWN_FILE, "utf8");
const tracker = JSON.parse(await readFile(DATA_FILE, "utf8"));
const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
const lines = markdown.split(/\r?\n/);
const headerIndex = lines.findIndex((line) => line.startsWith(HEADER_PREFIX));
if (headerIndex < 0) throw new Error("Could not find the flats.md tracker table");

let tableEnd = headerIndex + 2;
while (tableEnd < lines.length && lines[tableEnd].startsWith("|")) tableEnd += 1;
const rowLines = lines.slice(headerIndex + 2, tableEnd);
const rows = rowLines.map((line, index) => {
  const cells = splitRow(line);
  if (cells.length !== 18) throw new Error(`Markdown row ${index + 1} has ${cells.length} cells instead of 18`);
  const ad = parseLink(cells[0]);
  return { line, cells, key: ad ? canonicalUrl(ad.url) : null };
});

const dashboardByUrl = new Map();
const duplicateDashboardUrls = [];
for (const flat of tracker.flats) {
  const key = canonicalUrl(flat.adUrl);
  if (dashboardByUrl.has(key)) duplicateDashboardUrls.push(flat.adUrl);
  else dashboardByUrl.set(key, flat);
}

const seen = new Set();
const conflicts = [];
const nextRows = [];
let updated = 0;
let unchanged = 0;
let retainedMarkdownOnly = 0;
const now = new Date().toISOString();

for (const row of rows) {
  const flat = row.key ? dashboardByUrl.get(row.key) : null;
  if (!flat || seen.has(row.key)) {
    nextRows.push(row.line);
    retainedMarkdownOnly += 1;
    continue;
  }

  seen.add(row.key);
  const recordConflicts = [];
  const rendered = renderRow(flat, row.cells, recordConflicts);
  nextRows.push(rendered.line);
  if (rendered.line === row.line) unchanged += 1;
  else updated += 1;
  if (recordConflicts.length) conflicts.push({ adUrl: flat.adUrl, fields: recordConflicts });

  flat.sync = {
    ...(flat.sync || {}),
    ...(rendered.status.baseline !== undefined ? { markdownStatus: rendered.status.baseline } : {}),
    ...(rendered.note.baseline !== undefined ? { markdownNote: rendered.note.baseline } : {}),
    syncedAt: now,
    presentInMarkdown: true
  };
}

let added = 0;
for (const flat of tracker.flats) {
  const key = canonicalUrl(flat.adUrl);
  if (seen.has(key)) continue;
  seen.add(key);
  const recordConflicts = [];
  const rendered = renderRow(flat, null, recordConflicts);
  nextRows.push(rendered.line);
  added += 1;
  flat.sync = {
    ...(flat.sync || {}),
    markdownStatus: rendered.status.baseline,
    markdownNote: rendered.note.baseline,
    syncedAt: now,
    presentInMarkdown: true
  };
}

const nextLines = [...lines.slice(0, headerIndex + 2), ...nextRows, ...lines.slice(tableEnd)];
const nextMarkdown = nextLines.join(newline);
const nextTracker = { ...tracker, updatedAt: now };
const summary = {
  dashboardRecords: tracker.flats.length,
  added,
  updated,
  unchanged,
  retainedMarkdownOnly,
  conflicts,
  duplicateDashboardUrls
};

if (WRITE && (conflicts.length || duplicateDashboardUrls.length) && !ALLOW_CONFLICTS) {
  console.error(`Not applied: resolve manual-field conflicts or duplicate dashboard URLs first. ${JSON.stringify(summary)}`);
  process.exitCode = 2;
} else if (WRITE) {
  const markdownTemp = `${MARKDOWN_FILE}.reverse-sync-tmp`;
  const dataTemp = `${DATA_FILE}.reverse-sync-tmp`;
  await writeFile(markdownTemp, nextMarkdown, "utf8");
  await writeFile(dataTemp, `${JSON.stringify(nextTracker, null, 2)}\n`, "utf8");
  JSON.parse(await readFile(dataTemp, "utf8"));
  await rename(markdownTemp, MARKDOWN_FILE);
  await rename(dataTemp, DATA_FILE);
  console.log(`Applied: ${JSON.stringify(summary)}`);
} else {
  console.log(`Dry run: ${JSON.stringify(summary)}`);
}
