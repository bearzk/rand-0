import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { WeatherSession } from "./weather";
import { ReaderSession } from "./reader";

const CONFIG_PATH = join(homedir(), ".config", "rand-0.json");
const DEFAULT_CONFIG = { ip: "192.168.178.132", cities: ["munich", "xian"], bookUrl: "", bookId: "" };

function loadConfig() {
  try {
    if (existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, "utf8")) };
  } catch {}
  return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg: typeof DEFAULT_CONFIG) {
  mkdirSync(join(homedir(), ".config"), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

import { paginateText } from "./render";

// book cache: url → pages (survives stop/start within same server process)
const bookCache = new Map<string, { pages: string[][], bookId: string }>();

// active session
type Mode = "weather" | "reader" | "idle";
let mode: Mode = "idle";
let session: WeatherSession | ReaderSession | null = null;

function stopCurrent() {
  session?.close();
  session = null;
  mode = "idle";
}

const app = new Hono();

app.use("/", serveStatic({ path: "./public/index.html" }));

app.get("/state", (c) => {
  const cfg = loadConfig();
  return c.json({ mode, config: cfg });
});

app.post("/weather/start", async (c) => {
  const body = await c.req.json() as { cities?: string[] };
  const cfg = loadConfig();
  if (body.cities?.length) cfg.cities = body.cities;
  saveConfig(cfg);

  stopCurrent();
  const ws = new WeatherSession(cfg.cities, cfg.ip);
  await ws.start();
  session = ws;
  mode = "weather";
  return c.json({ ok: true, mode });
});

app.post("/reader/start", async (c) => {
  const body = await c.req.json() as { url?: string; bookId?: string };
  const cfg = loadConfig();

  const url = body.url || cfg.bookUrl;
  if (!url) return c.json({ error: "no book url" }, 400);

  let cached = bookCache.get(url);
  if (!cached) {
    console.log(`Fetching book from ${url}...`);
    const r = await fetch(url);
    if (!r.ok) return c.json({ error: `fetch failed: ${r.status}` }, 400);
    const text = await r.text();
    const bookId = body.bookId || url.split("/").pop()?.replace(/\W+/g, "_") || "book";
    console.log(`Paginating...`);
    const pages = paginateText(text);
    console.log(`${pages.length} pages`);
    cached = { pages, bookId };
    bookCache.set(url, cached);
    cfg.bookUrl = url;
    cfg.bookId = bookId;
    saveConfig(cfg);
  } else {
    console.log(`Book cached (${cached.pages.length} pages), skipping fetch+paginate`);
  }

  stopCurrent();
  const rs = new ReaderSession(cached.pages, cached.bookId, cfg.ip);
  await rs.start();
  session = rs;
  mode = "reader";
  return c.json({ ok: true, mode });
});

app.post("/stop", (c) => {
  stopCurrent();
  return c.json({ ok: true, mode });
});

const PORT = 3000;
console.log(`rand-0 server → http://localhost:${PORT}`);
export default { port: PORT, fetch: app.fetch };
