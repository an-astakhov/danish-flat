import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const REVERSE_SCRIPT = join(SKILL_DIR, "scripts", "sync.mjs");
const FORWARD_SCRIPT = resolve(SKILL_DIR, "..", "sync-flat-dashboard", "scripts", "sync.mjs");
const HEADER = "| Ad | Map / address | Nearest metro | To Nordhavn | To Havneholmen | Available | sqm | Rooms | Floor | Outdoor | Rent | Utilities | Deposit | Prepaid rent | Rental period | Status | Note | Note AI |";
const SEPARATOR = "|---|---|---|---:|---:|---:|---:|---:|---|---|---:|---:|---:|---:|---|---|---|---|";

function row(url, label, status, note) {
  const cells = [
    `[Ad](${url})`,
    `[${label}](https://maps.example/${label.toLowerCase()})`,
    "&mdash;",
    "&mdash;",
    "&mdash;",
    "2026-10-01",
    "80 m&sup2;",
    "3",
    "2nd",
    "Private balcony",
    "DKK 18,000",
    "DKK 900",
    "DKK 54,000 (3 months)",
    "DKK 18,000 (1 month)",
    "Unlimited",
    status,
    note,
    "AI note"
  ];
  return `| ${cells.join(" | ")} |`;
}

function flat(url, address, status, note, sync) {
  return {
    id: address.toLowerCase(),
    title: `${address} flat`,
    adUrl: url,
    address,
    mapUrl: `https://maps.example/${address.toLowerCase()}`,
    location: { lat: 55.67, lng: 12.56, approximate: false },
    nearestMetro: null,
    commute: { nordhavn: { minutes: null, mapsUrl: null }, havneholmen: { minutes: null, mapsUrl: null } },
    available: "2026-10-01",
    sqm: 80,
    rooms: 3,
    roomsLabel: null,
    floor: "2nd",
    outdoor: ["Private balcony"],
    rentDkk: 18000,
    utilitiesDkk: 900,
    utilitiesText: null,
    depositDkk: 54000,
    depositText: null,
    prepaidRentDkk: 18000,
    prepaidRentText: null,
    rentalPeriod: "Unlimited",
    status,
    note,
    noteAi: "AI note",
    photos: [{ url: `https://images.example/${address.toLowerCase()}.jpg`, alt: `${address} photo` }],
    source: { site: "Example", checkedAt: "2026-08-14T10:00:00Z" },
    ...(sync ? { sync } : {})
  };
}

const fixtureRoot = await mkdtemp(join(tmpdir(), "danish-flat-sync-"));
const resolvedTemp = resolve(tmpdir());
if (!resolve(fixtureRoot).startsWith(`${resolvedTemp}\\`) && !resolve(fixtureRoot).startsWith(`${resolvedTemp}/`)) {
  throw new Error("Refusing to use a fixture outside the temporary directory");
}

try {
  await mkdir(join(fixtureRoot, "dashboard", "data"), { recursive: true });
  const markdownPath = join(fixtureRoot, "flats.md");
  const dataPath = join(fixtureRoot, "dashboard", "data", "flats.json");
  const markdown = [
    "# Test flats",
    "",
    HEADER,
    SEPARATOR,
    row("https://example.com/a?utm_source=test", "A", "Interested", "x"),
    row("https://example.com/b", "B", "", "markdown only"),
    ""
  ].join("\n");
  const tracker = {
    version: 1,
    updatedAt: "2026-08-14T10:00:00Z",
    flats: [
      flat("https://example.com/a", "A", "Viewing", "x", {
        markdownStatus: "Interested",
        markdownNote: "x",
        syncedAt: "2026-08-14T10:00:00Z",
        presentInMarkdown: true
      }),
      flat("https://example.com/c", "C", "Applied", "dashboard only")
    ]
  };
  await writeFile(markdownPath, markdown, "utf8");
  await writeFile(dataPath, `${JSON.stringify(tracker, null, 2)}\n`, "utf8");

  const beforeDryMarkdown = await readFile(markdownPath, "utf8");
  const beforeDryJson = await readFile(dataPath, "utf8");
  execFileSync(process.execPath, [REVERSE_SCRIPT, "--root", fixtureRoot], { encoding: "utf8" });
  assert.equal(await readFile(markdownPath, "utf8"), beforeDryMarkdown, "dry run changed Markdown");
  assert.equal(await readFile(dataPath, "utf8"), beforeDryJson, "dry run changed JSON");

  execFileSync(process.execPath, [REVERSE_SCRIPT, "--root", fixtureRoot, "--write"], { encoding: "utf8" });
  const reverseMarkdown = await readFile(markdownPath, "utf8");
  const reverseTracker = JSON.parse(await readFile(dataPath, "utf8"));
  assert.match(reverseMarkdown, /example\.com\/b/, "Markdown-only record was removed");
  assert.match(reverseMarkdown, /example\.com\/c/, "dashboard-only record was not appended");
  assert.match(reverseMarkdown, /\| Viewing \| x \|/, "dashboard status was not exported");
  assert.equal(reverseTracker.flats[0].photos.length, 1, "reverse sync removed photos");
  assert.equal(reverseTracker.flats[0].status, "Viewing", "reverse sync changed dashboard status");
  assert.equal(reverseTracker.flats[1].note, "dashboard only", "reverse sync changed dashboard note");

  execFileSync(process.execPath, [FORWARD_SCRIPT, "--root", fixtureRoot, "--write"], { encoding: "utf8" });
  const roundTripTracker = JSON.parse(await readFile(dataPath, "utf8"));
  assert.equal(roundTripTracker.flats.length, 3, "round trip lost a record");
  assert.equal(roundTripTracker.flats.find((item) => item.adUrl.includes("/a"))?.photos.length, 1, "round trip removed photos");
  assert.equal(roundTripTracker.flats.find((item) => item.adUrl.includes("/a"))?.status, "Viewing", "round trip changed status");
  assert.equal(roundTripTracker.flats.find((item) => item.adUrl.includes("/c"))?.note, "dashboard only", "round trip changed note");

  const conflictedMarkdown = (await readFile(markdownPath, "utf8")).replace("| Viewing | x |", "| Passed | x |");
  const conflictedTracker = JSON.parse(await readFile(dataPath, "utf8"));
  const recordA = conflictedTracker.flats.find((item) => item.adUrl.includes("/a"));
  recordA.status = "Applied";
  await writeFile(markdownPath, conflictedMarkdown, "utf8");
  await writeFile(dataPath, `${JSON.stringify(conflictedTracker, null, 2)}\n`, "utf8");
  const beforeConflictMarkdown = await readFile(markdownPath, "utf8");
  const beforeConflictJson = await readFile(dataPath, "utf8");
  const conflictRun = spawnSync(process.execPath, [REVERSE_SCRIPT, "--root", fixtureRoot, "--write"], { encoding: "utf8" });
  assert.equal(conflictRun.status, 2, "conflicted write did not stop");
  assert.equal(await readFile(markdownPath, "utf8"), beforeConflictMarkdown, "conflicted write changed Markdown");
  assert.equal(await readFile(dataPath, "utf8"), beforeConflictJson, "conflicted write changed JSON");

  const forwardConflictRun = spawnSync(process.execPath, [FORWARD_SCRIPT, "--root", fixtureRoot, "--write"], { encoding: "utf8" });
  assert.equal(forwardConflictRun.status, 2, "forward conflicted write did not stop");
  assert.equal(await readFile(markdownPath, "utf8"), beforeConflictMarkdown, "forward conflicted write changed Markdown");
  assert.equal(await readFile(dataPath, "utf8"), beforeConflictJson, "forward conflicted write changed JSON");

  const duplicateMarkdown = beforeConflictMarkdown.replace("| Passed | x |", "| Applied | x |");
  const duplicateTracker = JSON.parse(beforeConflictJson);
  duplicateTracker.flats.push({ ...duplicateTracker.flats.find((item) => item.adUrl.includes("/a")), id: "duplicate-a" });
  await writeFile(markdownPath, duplicateMarkdown, "utf8");
  await writeFile(dataPath, `${JSON.stringify(duplicateTracker, null, 2)}\n`, "utf8");
  const beforeDuplicateMarkdown = await readFile(markdownPath, "utf8");
  const beforeDuplicateJson = await readFile(dataPath, "utf8");
  for (const script of [REVERSE_SCRIPT, FORWARD_SCRIPT]) {
    const duplicateRun = spawnSync(process.execPath, [script, "--root", fixtureRoot, "--write"], { encoding: "utf8" });
    assert.equal(duplicateRun.status, 2, "duplicate canonical URL write did not stop");
    assert.equal(await readFile(markdownPath, "utf8"), beforeDuplicateMarkdown, "duplicate URL write changed Markdown");
    assert.equal(await readFile(dataPath, "utf8"), beforeDuplicateJson, "duplicate URL write changed JSON");
  }

  console.log("Bidirectional sync tests passed");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
