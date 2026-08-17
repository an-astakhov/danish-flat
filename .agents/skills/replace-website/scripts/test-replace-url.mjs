import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = resolve(dirname(fileURLToPath(import.meta.url)), "replace-url.mjs");
const fixtureRoot = await mkdtemp(join(tmpdir(), "danish-flat-replace-test-"));
const oldUrl = "https://paid.example/listing/123?utm_source=test";
const newUrl = "https://www.boligzonen.dk/en/rentals/test-flat-abc123/";

try {
  await mkdir(join(fixtureRoot, "dashboard", "data"), { recursive: true });
  const originalFlat = {
    id: "paid-example-123",
    title: "Test flat",
    adUrl: oldUrl,
    address: "Testvej 1, 2. th, København",
    status: "Apply",
    note: "Great location",
    noteAi: "Paid contact source.",
    photos: [{ url: "https://images.example/1.jpg", alt: "Photo" }],
    source: { site: "Paid example", listingId: "123", checkedAt: "2026-08-17T00:00:00Z" },
    sync: { markdownStatus: "Apply", markdownNote: "Great location", presentInMarkdown: true }
  };
  await writeFile(join(fixtureRoot, "dashboard", "data", "flats.json"), `${JSON.stringify({
    version: 1,
    updatedAt: "2026-08-17T00:00:00Z",
    flats: [originalFlat]
  }, null, 2)}\n`, "utf8");
  const markdown = [
    "# Copenhagen rental flats",
    "",
    "| Ad | Map / address | Nearest metro | To Nordhavn | To Havneholmen | Available | sqm | Rooms | Floor | Outdoor | Rent | Utilities | Deposit | Prepaid rent | Rental period | Status | Note | Note AI |",
    "|---|---|---|---:|---:|---:|---:|---:|---|---|---:|---:|---:|---:|---|---|---|---|",
    `| [Ad](${oldUrl}) | [Testvej 1](https://maps.example/test) | &mdash; | &mdash; | &mdash; | Now | 90 m&sup2; | 3 | 2nd | Balcony | DKK 20,000 | &mdash; | &mdash; | &mdash; | Unlimited | Apply | Great location | Paid contact source. |`,
    ""
  ].join("\n");
  await writeFile(join(fixtureRoot, "flats.md"), markdown, "utf8");

  const dry = spawnSync(process.execPath, [script, "--root", fixtureRoot, "--old", oldUrl, "--new", newUrl], { encoding: "utf8" });
  if (dry.status !== 0 || !dry.stdout.startsWith("Dry run:")) throw new Error(dry.stderr || "Dry run failed");
  const dryData = JSON.parse(await readFile(join(fixtureRoot, "dashboard", "data", "flats.json"), "utf8"));
  if (dryData.flats[0].adUrl !== oldUrl) throw new Error("Dry run mutated dashboard data");

  const write = spawnSync(process.execPath, [script, "--root", fixtureRoot, "--old", oldUrl, "--new", newUrl, "--write"], { encoding: "utf8" });
  if (write.status !== 0 || !write.stdout.startsWith("Applied:")) throw new Error(write.stderr || "Write failed");

  const nextData = JSON.parse(await readFile(join(fixtureRoot, "dashboard", "data", "flats.json"), "utf8"));
  const nextFlat = nextData.flats[0];
  if (nextFlat.adUrl !== "https://boligzonen.dk/en/rentals/test-flat-abc123") throw new Error("Dashboard URL was not canonicalized and replaced");
  for (const field of ["id", "status", "note", "title", "noteAi"]) {
    if (nextFlat[field] !== originalFlat[field]) throw new Error(`${field} was not preserved`);
  }
  if (JSON.stringify(nextFlat.source) !== JSON.stringify(originalFlat.source) || JSON.stringify(nextFlat.photos) !== JSON.stringify(originalFlat.photos)) {
    throw new Error("Listing details changed during the narrow URL swap");
  }
  const nextMarkdown = await readFile(join(fixtureRoot, "flats.md"), "utf8");
  if (!nextMarkdown.includes("https://boligzonen.dk/en/rentals/test-flat-abc123") || nextMarkdown.includes(oldUrl)) {
    throw new Error("Markdown URL was not replaced cleanly");
  }

  console.log("Replace website URL test passed");
} finally {
  const resolvedFixture = resolve(fixtureRoot);
  const resolvedTemp = resolve(tmpdir());
  if (!resolvedFixture.startsWith(`${resolvedTemp}\\`) || !resolvedFixture.includes("danish-flat-replace-test-")) {
    throw new Error(`Refusing to remove unexpected test path: ${resolvedFixture}`);
  }
  await rm(resolvedFixture, { recursive: true, force: true });
}

