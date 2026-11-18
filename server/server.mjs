/**
 * Elektroplaner – kleiner Server für den Selbstbetrieb (Unraid, NAS, VPS).
 *
 * - liefert die gebaute App aus (dist/)
 * - speichert das Projekt zentral in DATA_DIR, damit alle Geräte denselben
 *   Stand sehen (mit Revisionszähler gegen versehentliches Überschreiben und
 *   rollierenden Sicherungen)
 * - leitet KI-Anfragen an die Claude-API weiter; der API-Schlüssel liegt nur
 *   auf dem Server (ANTHROPIC_API_KEY) und nie im Browser
 * - optional Passwortschutz (APP_PASSWORD, Benutzer APP_USER)
 *
 * Keine Abhängigkeiten außer Node.js ≥ 20.
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const STATIC_DIR = path.resolve(process.env.STATIC_DIR ?? path.join(here, '..', 'dist'));
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(here, '..', 'data'));
const API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const APP_USER = process.env.APP_USER || 'elektro';
const APP_PASSWORD = process.env.APP_PASSWORD ?? '';
const BACKUPS = Math.max(1, Number(process.env.BACKUPS ?? 30));
const MAX_BODY = 40 * 1024 * 1024; // Grundriss- und Verteilerfotos stecken im Projekt

const PROJECT_DIR = path.join(DATA_DIR, 'projekte');
const BACKUP_DIR = path.join(DATA_DIR, 'sicherungen');
const TRASH_DIR = path.join(DATA_DIR, 'papierkorb');
const LEGACY_FILE = path.join(DATA_DIR, 'projekt.json');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', ...headers });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Anfrage zu groß'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function authorized(req) {
  if (!APP_PASSWORD) return true;
  const h = req.headers.authorization ?? '';
  if (!h.startsWith('Basic ')) return false;
  const [user, ...rest] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
  const pass = rest.join(':');
  const eq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  return eq(user, APP_USER) & eq(pass, APP_PASSWORD) ? true : false;
}

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const projectFile = (id) => path.join(PROJECT_DIR, `${id}.json`);
const metaFile = (id) => path.join(PROJECT_DIR, `${id}.meta.json`);

async function readMeta(id) {
  try { return JSON.parse(await fs.readFile(metaFile(id), 'utf8')); } catch { return null; }
}

async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

// Schreibzugriffe nacheinander abarbeiten, damit sich zwei Geräte nicht überholen
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

const lastBackup = new Map();
async function backup(id) {
  if (!existsSync(projectFile(id))) return;
  if (Date.now() - (lastBackup.get(id) ?? 0) < 10 * 60 * 1000) return; // höchstens alle 10 Minuten
  lastBackup.set(id, Date.now());
  const dir = path.join(BACKUP_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await fs.copyFile(projectFile(id), path.join(dir, `${stamp}.json`));
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - BACKUPS))) await fs.rm(path.join(dir, f), { force: true });
}

/** Kurzinfo fürs Projektverzeichnis – wird beim Speichern mitgeschrieben, damit die Liste ohne große Dateien auskommt. */
function summarize(p) {
  return {
    name: String(p.name ?? 'Ohne Namen'),
    projectType: p.projectType ?? null,
    updatedAt: p.updatedAt ?? null,
    floors: Array.isArray(p.floors) ? p.floors.length : 0,
    rooms: Array.isArray(p.rooms) ? p.rooms.length : 0,
    address: p.address ?? null,
  };
}

async function writeProject(id, body, parsed, prevRev) {
  await fs.mkdir(PROJECT_DIR, { recursive: true });
  await backup(id);
  await writeAtomic(projectFile(id), body);
  const meta = { id, rev: prevRev + 1, savedAt: new Date().toISOString(), ...summarize(parsed) };
  await writeAtomic(metaFile(id), JSON.stringify(meta));
  return meta;
}

/** Früher gab es nur /data/projekt.json – beim Start einmalig ins Projektverzeichnis übernehmen. */
async function migrateLegacy() {
  if (!existsSync(LEGACY_FILE)) return;
  try {
    const body = await fs.readFile(LEGACY_FILE);
    const parsed = JSON.parse(body.toString('utf8'));
    const id = ID_RE.test(parsed.id ?? '') ? parsed.id : `projekt_${Date.now().toString(36)}`;
    if (!existsSync(projectFile(id))) await writeProject(id, body, { ...parsed, id }, 0);
    await fs.rename(LEGACY_FILE, `${LEGACY_FILE}.uebernommen`);
    await fs.rm(path.join(DATA_DIR, 'projekt.meta.json'), { force: true });
    console.log(`  Übernommen:   bisheriges Projekt „${parsed.name}“`);
  } catch (e) {
    console.error(`Bisheriges Projekt konnte nicht übernommen werden: ${e.message}`);
  }
}

async function listProjects() {
  if (!existsSync(PROJECT_DIR)) return [];
  const out = [];
  for (const f of await fs.readdir(PROJECT_DIR)) {
    if (!f.endsWith('.meta.json')) continue;
    const m = await readMeta(f.slice(0, -'.meta.json'.length));
    if (m) out.push(m);
  }
  return out.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

async function handleProjects(req, res, rest) {
  if (!rest) {
    if (req.method === 'GET') return send(res, 200, await listProjects(), { 'cache-control': 'no-store' });
    return send(res, 405, { error: 'Methode nicht erlaubt' });
  }
  const [id, sub] = rest.split('/');
  if (!ID_RE.test(id)) return send(res, 400, { error: 'Ungültige Projekt-ID' });
  if (sub === 'rev' && req.method === 'GET') {
    const m = await readMeta(id);
    return m ? send(res, 200, { rev: m.rev, savedAt: m.savedAt }, { 'cache-control': 'no-store' }) : send(res, 404, { error: 'Projekt nicht gefunden' });
  }
  if (sub) return send(res, 404, { error: 'Unbekannt' });
  if (req.method === 'GET') {
    const m = await readMeta(id);
    if (!m || !existsSync(projectFile(id))) return send(res, 404, { error: 'Projekt nicht gefunden' });
    const data = await fs.readFile(projectFile(id), 'utf8');
    return send(res, 200, data, { 'content-type': 'application/json; charset=utf-8', 'x-rev': String(m.rev), 'cache-control': 'no-store' });
  }
  if (req.method === 'PUT') {
    const body = await readBody(req);
    let parsed;
    try { parsed = JSON.parse(body.toString('utf8')); } catch { return send(res, 400, { error: 'Kein gültiges JSON' }); }
    if (!parsed || typeof parsed !== 'object' || !('schemaVersion' in parsed)) return send(res, 400, { error: 'Keine Elektroplaner-Projektdatei' });
    if (parsed.id !== id) return send(res, 400, { error: 'Projekt-ID passt nicht zur Adresse' });
    const baseRev = Number(req.headers['x-base-rev'] ?? -1);
    const force = req.headers['x-force'] === '1';
    return serial(async () => {
      const rev = (await readMeta(id))?.rev ?? 0;
      if (!force && baseRev !== rev) return send(res, 409, { error: 'Projekt wurde inzwischen auf einem anderen Gerät geändert', rev });
      return send(res, 200, await writeProject(id, body, parsed, rev));
    });
  }
  if (req.method === 'DELETE') {
    return serial(async () => {
      if (!existsSync(projectFile(id))) return send(res, 404, { error: 'Projekt nicht gefunden' });
      // nicht endgültig löschen: in den Papierkorb verschieben
      await fs.mkdir(TRASH_DIR, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.rename(projectFile(id), path.join(TRASH_DIR, `${id}-${stamp}.json`));
      await fs.rm(metaFile(id), { force: true });
      return send(res, 200, { ok: true });
    });
  }
  return send(res, 405, { error: 'Methode nicht erlaubt' });
}

async function handleClaude(req, res, subpath) {
  if (!API_KEY) return send(res, 503, { type: 'error', error: { type: 'not_configured', message: 'Auf dem Server ist kein ANTHROPIC_API_KEY hinterlegt.' } });
  if (req.method !== 'POST' || !/^\/v1\/messages(\?.*)?$/.test(subpath)) return send(res, 404, { error: 'Nicht unterstützt' });
  const body = await readBody(req);
  const headers = { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': req.headers['anthropic-version'] ?? '2023-06-01' };
  if (req.headers['anthropic-beta']) headers['anthropic-beta'] = req.headers['anthropic-beta'];
  let upstream;
  try {
    upstream = await fetch(`https://api.anthropic.com${subpath}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(10 * 60 * 1000) });
  } catch (e) {
    return send(res, 502, { type: 'error', error: { type: 'api_connection_error', message: `Server erreicht die Claude-API nicht: ${e.message}` } });
  }
  const out = Buffer.from(await upstream.arrayBuffer());
  const pass = {};
  for (const h of ['content-type', 'request-id', 'retry-after']) { const v = upstream.headers.get(h); if (v) pass[h] = v; }
  res.writeHead(upstream.status, pass);
  res.end(out);
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  let file = path.resolve(STATIC_DIR, '.' + rel);
  if (!file.startsWith(STATIC_DIR)) return send(res, 403, 'Verboten');
  let stat = await fs.stat(file).catch(() => null);
  if (!stat || stat.isDirectory()) { file = path.join(STATIC_DIR, 'index.html'); stat = await fs.stat(file).catch(() => null); }
  if (!stat) return send(res, 500, 'App nicht gebaut (dist/ fehlt).');
  const ext = path.extname(file);
  const immutable = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'content-length': stat.size, 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/healthz') return send(res, 200, 'ok');
    if (!authorized(req)) return send(res, 401, 'Anmeldung erforderlich', { 'www-authenticate': 'Basic realm="Elektroplaner", charset="UTF-8"' });
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    if (url.pathname === '/api/status') {
      return send(res, 200, { server: true, ai: !!API_KEY }, { 'cache-control': 'no-store' });
    }
    if (url.pathname === '/api/projekte' || url.pathname.startsWith('/api/projekte/')) return await handleProjects(req, res, url.pathname.slice('/api/projekte/'.length));
    if (url.pathname.startsWith('/api/claude/')) return await handleClaude(req, res, url.pathname.slice('/api/claude'.length) + url.search);
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Unbekannt' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Methode nicht erlaubt');
    return await serveStatic(req, res, url.pathname);
  } catch (e) {
    if (!res.headersSent) send(res, e.status ?? 500, { error: e.message });
    else res.destroy();
  }
});

/**
 * Rechte: Startet der Container als root (Standard), bekommt der Datenordner
 * PUID/PGID (Unraid: 99/100) und der Server läuft danach als dieser Benutzer.
 */
async function dropPrivileges() {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return;
  const uid = Number(process.env.PUID ?? 1000), gid = Number(process.env.PGID ?? 1000);
  await fs.mkdir(DATA_DIR, { recursive: true });
  const walk = async (p) => {
    await fs.chown(p, uid, gid).catch(() => {});
    const st = await fs.stat(p).catch(() => null);
    if (st?.isDirectory()) for (const f of await fs.readdir(p)) await walk(path.join(p, f));
  };
  await walk(DATA_DIR);
  process.setgid(gid);
  process.setuid(uid);
}

async function checkWritable() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const probe = path.join(DATA_DIR, '.schreibtest');
    await fs.writeFile(probe, 'ok');
    await fs.rm(probe);
    return true;
  } catch (e) {
    console.error(`FEHLER: In ${DATA_DIR} kann nicht geschrieben werden (${e.code}). Rechte des Datenordners prüfen (PUID/PGID).`);
    return false;
  }
}

await dropPrivileges();
const writable = await checkWritable();
if (writable) await migrateLegacy();

server.requestTimeout = 11 * 60 * 1000;
server.listen(PORT, () => {
  console.log(`Elektroplaner läuft auf Port ${PORT}`);
  console.log(`  Daten:        ${DATA_DIR} (${writable ? 'beschreibbar' : 'NICHT beschreibbar'}, Benutzer ${process.getuid?.()}:${process.getgid?.()})`);
  console.log(`  KI:           ${API_KEY ? 'eingeschaltet (Schlüssel auf dem Server)' : 'aus (ANTHROPIC_API_KEY nicht gesetzt)'}`);
  console.log(`  Passwort:     ${APP_PASSWORD ? `eingeschaltet (Benutzer „${APP_USER}“)` : 'AUS – nur im Heimnetz betreiben!'}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
