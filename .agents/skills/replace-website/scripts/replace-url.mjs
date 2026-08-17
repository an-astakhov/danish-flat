import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WRITE = process.argv.includes("--write");
const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} requires a value`);
  return process.argv[index + 1];
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

const rootIndex = process.argv.indexOf("--root");
if (rootIndex >= 0 && !process.argv[rootIndex + 1]) throw new Error("--root requires a path");
const ROOT = rootIndex >= 0
  ? resolve(process.argv[rootIndex + 1])
  : resolve(SKILL_DIR, "..", "..", "..");
const OLD_URL = canonicalUrl(argument("--old"));
const NEW_URL = canonicalUrl(argument("--new"));
if (OLD_URL === NEW_URL) throw new Error("Old and new URLs resolve to the same canonical URL");

const DATA_FILE = join(ROOT, "dashboard", "data", "flats.json");
const MARKDOWN_FILE = join(ROOT, "flats.md");
const [dataText, markdown] = await Promise.all([
  readFile(DATA_FILE, "utf8"),
  readFile(MARKDOWN_FILE, "utf8")
]);
const tracker = JSON.parse(dataText);
if (!Array.isArray(tracker.flats)) throw new Error("dashboard/data/flats.json must contain a flats array");

const dashboardOld = [];
const dashboardNew = [];
for (let index = 0; index < tracker.flats.length; index += 1) {
  const flat = tracker.flats[index];
  if (!flat?.adUrl) throw new Error(`Dashboard record ${index} is missing adUrl`);
  const key = canonicalUrl(flat.adUrl);
  if (key === OLD_URL) dashboardOld.push(index);
  if (key === NEW_URL) dashboardNew.push(index);
}

const lines = markdown.split(/\r?\n/);
const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
const headerIndex = lines.findIndex((line) => line.startsWith("| Ad | Map / address |"));
if (headerIndex < 0) throw new Error("Could not find the flats.md tracker table");
const markdownRows = [];
for (let index = headerIndex + 2; index < lines.length && lines[index].startsWith("|"); index += 1) {
  const match = lines[index].match(/^(\s*\|\s*\[[^\]]+\]\()(.+?)(\)\s*\|)/);
  if (!match) throw new Error(`Markdown row ${index + 1} has no valid ad link`);
  const key = canonicalUrl(match[2]);
  markdownRows.push({ index, match, key });
}
const markdownOld = markdownRows.filter((row) => row.key === OLD_URL);
const markdownNew = markdownRows.filter((row) => row.key === NEW_URL);

const summary = {
  oldUrl: OLD_URL,
  newUrl: NEW_URL,
  dashboardMatches: dashboardOld.length,
  markdownMatches: markdownOld.length,
  destinationDashboardMatches: dashboardNew.length,
  destinationMarkdownMatches: markdownNew.length,
  dashboardRecords: tracker.flats.length,
  markdownRows: markdownRows.length,
  preservesIdStatusAndNote: true
};

if (dashboardOld.length > 1 || markdownOld.length > 1) {
  console.error(`Not applied: ambiguous source URL. ${JSON.stringify(summary)}`);
  process.exitCode = 2;
} else if (dashboardNew.length || markdownNew.length) {
  console.error(`Not applied: destination URL already exists. ${JSON.stringify(summary)}`);
  process.exitCode = 2;
} else if (!dashboardOld.length && !markdownOld.length) {
  const prefix = WRITE ? "Not applied" : "Dry run";
  console.error(`${prefix}: source URL was not found. ${JSON.stringify(summary)}`);
  if (WRITE) process.exitCode = 2;
} else if (!WRITE) {
  console.log(`Dry run: ${JSON.stringify(summary)}`);
} else {
  const manualBefore = tracker.flats.map((flat) => ({
    id: flat.id,
    status: flat.status,
    note: flat.note
  }));

  if (dashboardOld.length) tracker.flats[dashboardOld[0]].adUrl = NEW_URL;
  for (const row of markdownOld) {
    const { match } = row;
    lines[row.index] = `${match[1]}${NEW_URL}${match[3]}${lines[row.index].slice(match[0].length)}`;
  }
  if (dashboardOld.length) tracker.updatedAt = new Date().toISOString();

  const manualAfter = tracker.flats.map((flat) => ({
    id: flat.id,
    status: flat.status,
    note: flat.note
  }));
  if (JSON.stringify(manualBefore) !== JSON.stringify(manualAfter)) {
    throw new Error("Refusing to write because an ID, status, or note changed");
  }
  if (tracker.flats.length !== summary.dashboardRecords || markdownRows.length !== summary.markdownRows) {
    throw new Error("Refusing to write because a tracker row count changed");
  }

  const nextData = `${JSON.stringify(tracker, null, 2)}\n`;
  const nextMarkdown = lines.join(newline);
  JSON.parse(nextData);
  const dataTemp = `${DATA_FILE}.replace-url-${process.pid}.tmp`;
  const markdownTemp = `${MARKDOWN_FILE}.replace-url-${process.pid}.tmp`;
  await Promise.all([
    writeFile(dataTemp, nextData, "utf8"),
    writeFile(markdownTemp, nextMarkdown, "utf8")
  ]);

  let dashboardReplaced = false;
  try {
    if (dashboardOld.length) {
      await rename(dataTemp, DATA_FILE);
      dashboardReplaced = true;
    }
    if (markdownOld.length) await rename(markdownTemp, MARKDOWN_FILE);
  } catch (error) {
    if (dashboardReplaced) await writeFile(DATA_FILE, dataText, "utf8");
    throw error;
  } finally {
    await Promise.all([
      rm(dataTemp, { force: true }),
      rm(markdownTemp, { force: true })
    ]);
  }

  console.log(`Applied: ${JSON.stringify(summary)}`);
}
