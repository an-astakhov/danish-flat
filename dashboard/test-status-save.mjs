import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DASHBOARD_ROOT = dirname(fileURLToPath(import.meta.url));
const TEMP_PREFIX = "danish-flat-status-test-";
const testRoot = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
const port = 45000 + Math.floor(Math.random() * 10000);
let child;

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

try {
  await mkdir(join(testRoot, "data"));
  await copyFile(join(DASHBOARD_ROOT, "server.mjs"), join(testRoot, "server.mjs"));
  await copyFile(join(DASHBOARD_ROOT, "data", "flats.json"), join(testRoot, "data", "flats.json"));

  const before = JSON.parse(await readFile(join(testRoot, "data", "flats.json"), "utf8"));
  const flat = before.flats[0];
  assert.ok(flat, "test fixture needs at least one flat");

  child = spawn(process.execPath, [join(testRoot, "server.mjs")], {
    cwd: testRoot,
    env: { ...process.env, DANISH_FLAT_PORT: String(port) },
    stdio: "ignore",
    windowsHide: true
  });

  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/flats`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      await delay(100);
    }
  }
  assert.equal(ready, true, "temporary dashboard server did not start");

  const nextStatus = flat.status === "Applied" ? "Viewing" : "Applied";
  const response = await fetch(`http://127.0.0.1:${port}/api/flats/${encodeURIComponent(flat.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: nextStatus })
  });
  assert.equal(response.status, 200, await response.text());

  const after = JSON.parse(await readFile(join(testRoot, "data", "flats.json"), "utf8"));
  const updated = after.flats.find((item) => item.id === flat.id);
  assert.equal(updated.status, nextStatus, "status-only PATCH did not save status");
  assert.equal(updated.note, flat.note, "status-only PATCH changed the personal note");
  console.log("Dashboard status autosave test passed");
} finally {
  if (child && !child.killed) child.kill();
  await delay(100);
  const resolvedRoot = resolve(testRoot);
  assert.equal(resolve(dirname(resolvedRoot)), resolve(tmpdir()), "refusing to remove a non-temporary test directory");
  assert.equal(basename(resolvedRoot).startsWith(TEMP_PREFIX), true, "unexpected test-directory name");
  await rm(resolvedRoot, { recursive: true, force: true });
}
