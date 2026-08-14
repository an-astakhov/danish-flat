import { createServer } from "node:http";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.DANISH_FLAT_PORT || "4173", 10);
const DASHBOARD_ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(DASHBOARD_ROOT, "data", "flats.json");
const MAX_BODY_BYTES = 32 * 1024;

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"]
]);

function send(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": contentType.startsWith("application/json") ? "no-store" : "no-cache",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
}

function sendJson(res, statusCode, payload) {
  send(res, statusCode, JSON.stringify(payload), "application/json; charset=utf-8");
}

async function readTracker() {
  const tracker = JSON.parse(await readFile(DATA_FILE, "utf8"));
  if (tracker.version !== 1 || !Array.isArray(tracker.flats)) {
    throw new Error("dashboard/data/flats.json has an unsupported shape");
  }
  return tracker;
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function updateManualFields(req, res, id) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, 400, { error: error.message });
  }

  if (typeof body.status !== "string" || typeof body.note !== "string") {
    return sendJson(res, 400, { error: "status and note must both be strings" });
  }
  if (body.status.length > 80 || body.note.length > 4000) {
    return sendJson(res, 400, { error: "status or note exceeds the allowed length" });
  }

  const tracker = await readTracker();
  const flat = tracker.flats.find((item) => item.id === id);
  if (!flat) return sendJson(res, 404, { error: "Flat not found" });

  flat.status = body.status.trim();
  flat.note = body.note.trim();
  tracker.updatedAt = new Date().toISOString();

  const temporaryFile = `${DATA_FILE}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(tracker, null, 2)}\n`, "utf8");
  await rename(temporaryFile, DATA_FILE);
  return sendJson(res, 200, { flat, updatedAt: tracker.updatedAt });
}

async function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = resolve(DASHBOARD_ROOT, normalize(requested));
  const rootPrefix = `${resolve(DASHBOARD_ROOT)}${sep}`;
  if (!filePath.startsWith(rootPrefix)) return send(res, 403, "Forbidden");

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return send(res, 404, "Not found");
    const content = await readFile(filePath);
    return send(res, 200, content, MIME_TYPES.get(extname(filePath)) || "application/octet-stream");
  } catch (error) {
    if (error.code === "ENOENT") return send(res, 404, "Not found");
    throw error;
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

    if (req.method === "GET" && url.pathname === "/api/flats") {
      return sendJson(res, 200, await readTracker());
    }

    const manualEditMatch = url.pathname.match(/^\/api\/flats\/([^/]+)$/);
    if (req.method === "PATCH" && manualEditMatch) {
      return updateManualFields(req, res, decodeURIComponent(manualEditMatch[1]));
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendJson(res, 405, { error: "Method not allowed" });
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Copenhagen flat dashboard: http://${HOST}:${PORT}`);
});
