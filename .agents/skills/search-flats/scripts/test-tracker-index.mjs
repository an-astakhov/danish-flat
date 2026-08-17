import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = resolve(dirname(fileURLToPath(import.meta.url)), "tracker-index.mjs");
const fixtureRoot = await mkdtemp(join(tmpdir(), "danish-flat-search-test-"));

try {
  await mkdir(join(fixtureRoot, "dashboard", "data"), { recursive: true });
  await writeFile(join(fixtureRoot, "dashboard", "data", "flats.json"), JSON.stringify({
    version: 1,
    flats: [{
      adUrl: "https://www.example.dk/listing/123/?utm_source=test",
      title: "Test flat",
      address: "Testvej 1, København",
      sqm: 90,
      rooms: 3,
      rentDkk: 20000,
      available: "2026-10-01",
      status: "Apply",
      note: "Keep me",
      source: { listingId: "123" }
    }]
  }), "utf8");
  await writeFile(join(fixtureRoot, "flats.md"), [
    "# Copenhagen rental flats",
    "",
    "| Ad | Map / address | Nearest metro | To Nordhavn | To Havneholmen | Available | sqm | Rooms | Floor | Outdoor | Rent | Utilities | Deposit | Prepaid rent | Rental period | Status | Note | Note AI |",
    "|---|---|---|---:|---:|---:|---:|---:|---|---|---:|---:|---:|---:|---|---|---|---|",
    "| [Ad](https://example.dk/listing/123) | [Testvej 1, København](https://maps.example/test) | &mdash; | &mdash; | &mdash; | 2026-10-01 | 90 m&sup2; | 3 | &mdash; | Balcony | DKK 20,000 | &mdash; | &mdash; | &mdash; | Unlimited | Apply | Keep me | &mdash; |",
    "| [Ad](https://other.dk/ad/456/) | [Elsewhere](https://maps.example/elsewhere) | &mdash; | &mdash; | &mdash; | Now | 100 m&sup2; | 4 | &mdash; | &mdash; | DKK 22,000 | &mdash; | &mdash; | &mdash; | Unlimited |  |  | &mdash; |",
    ""
  ].join("\n"), "utf8");

  const result = spawnSync(process.execPath, [
    script,
    "--root", fixtureRoot,
    "--candidate", "http://www.example.dk/listing/123/?fbclid=abc#gallery",
    "--candidate", "https://new.dk/flat/789"
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `Index exited ${result.status}`);

  const output = JSON.parse(result.stdout);
  if (output.trackerCounts.dashboard !== 1 || output.trackerCounts.markdown !== 2 || output.trackerCounts.union !== 2) {
    throw new Error(`Unexpected tracker counts: ${JSON.stringify(output.trackerCounts)}`);
  }
  if (!output.exactCandidateMatches[0].known || output.exactCandidateMatches[1].known) {
    throw new Error("Candidate canonical matching failed");
  }
  if (output.portals.length !== 2 || output.overlapCount !== 1) {
    throw new Error("Portal or overlap indexing failed");
  }
  const known = output.knownListings.find((listing) => listing.canonicalUrl.includes("/listing/123"));
  if (!known || known.note !== "Keep me" || known.trackers.length !== 2) {
    throw new Error("Merged listing metadata was not preserved");
  }
  console.log("Search tracker index test passed");
} finally {
  const resolvedFixture = resolve(fixtureRoot);
  const resolvedTemp = resolve(tmpdir());
  if (!resolvedFixture.startsWith(`${resolvedTemp}\\`) || !resolvedFixture.includes("danish-flat-search-test-")) {
    throw new Error(`Refusing to remove unexpected test path: ${resolvedFixture}`);
  }
  await rm(resolvedFixture, { recursive: true, force: true });
}

