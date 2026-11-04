'use strict';
/* Storage abstraction: file-based for local dev, Vercel KV for production.

   Both backends expose the same async API, so server.js works unchanged in
   either environment. KV is used automatically when the Vercel KV env vars
   are present; otherwise conversations and settings live in data/ on disk.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CONV_DIR = path.join(DATA_DIR, 'conversations');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

for (const d of [DATA_DIR, CONV_DIR]) {
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) { /* ignore */ }
}

let _kv = null;
function kv() {
  if (_kv !== undefined) return _kv;
  if (process.env.KV_REST_API_URL || process.env.KV_REST_API_TOKEN) {
    // @vercel/kv wraps Upstash Redis over REST. Its named export `kv` is a
    // proxy that lazily builds the client from KV_REST_API_URL and
    // KV_REST_API_TOKEN; the default export is the same proxy and only works
    // after awaiting, so read the named export.
    if (process.env.KV_REST_API_URL && !process.env.KV_REST_API_TOKEN) {
      const err = new Error(
        'KV configured with KV_REST_API_URL but missing KV_REST_API_TOKEN; ' +
        'persistence is NOT active (falling back to file storage)'
      );
      err.code = 'KV_MISCONFIGURED';
      _kv = err;
      return _kv;
    }
    try {
      const client = require('@vercel/kv').kv;
      if (!client) throw new Error('kv export missing');
      _kv = client;
    } catch (e) {
      // Surface a clear error instead of silently falling back to the file
      // backend and pretending Redis persistence is active.
      const err = new Error(
        'KV client unavailable: ' + (e && e.message ? e.message : String(e))
      );
      err.code = 'KV_UNAVAILABLE';
      _kv = err;
    }
  } else {
    _kv = null;
  }
  return _kv;
}

function ensureKv() {
  const k = kv();
  if (k instanceof Error) throw k;
  return k;
}

/* Test hook: inject a mock KV client (or null to force the file backend).
   Used by test/storage.test.js to exercise both code paths. */
function __setClient(client) { _kv = client; }

const CONV_PREFIX = 'conv:';
const SETTINGS_KEY = 'settings';
const CONV_INDEX_KEY = 'conv:index';

function convPath(id) { return path.join(CONV_DIR, id + '.json'); }

async function loadSettings() {
  const k = ensureKv();
  if (k) {
    const s = await k.get(SETTINGS_KEY);
    return s || null;
  }
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch (e) { return null; }
}

async function saveSettings(obj) {
  const k = ensureKv();
  if (k) { await k.set(SETTINGS_KEY, obj); return; }
  const tmp = SETTINGS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, SETTINGS_FILE);
}

async function loadConv(id) {
  const k = ensureKv();
  if (k) return await k.get(CONV_PREFIX + id) || null;
  const p = convPath(String(id).replace(/[^\w-]/g, ''));
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return null; }
}

async function saveConv(c) {
  const k = ensureKv();
  if (k) {
    await k.set(CONV_PREFIX + c.id, c);
    await k.zadd(CONV_INDEX_KEY, { score: c.updatedAt || Date.now(), member: c.id });
    return;
  }
  const p = convPath(c.id);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2));
  fs.renameSync(tmp, p);
}

async function deleteConv(id) {
  const k = ensureKv();
  if (k) {
    await k.del(CONV_PREFIX + id);
    await k.zrem(CONV_INDEX_KEY, id);
    return;
  }
  const p = convPath(id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

async function listConvs() {
  const k = ensureKv();
  if (k) {
    // @upstash/redis has no zrevrange — use zrange with the rev option instead.
    const ids = await k.zrange(CONV_INDEX_KEY, 0, -1, { rev: true });
    const result = [];
    for (const id of ids) {
      const c = await k.get(CONV_PREFIX + id);
      if (c) result.push({
        id: c.id, title: c.title || 'Untitled', updatedAt: c.updatedAt || 0,
        count: (c.messages || []).length, age: c.persona && c.persona.age
      });
    }
    return result;
  }
  return fs.readdirSync(CONV_DIR).filter(f => f.endsWith('.json')).map(f => {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(CONV_DIR, f), 'utf8'));
      return { id: c.id, title: c.title || 'Untitled', updatedAt: c.updatedAt || 0, count: (c.messages || []).length, age: c.persona && c.persona.age };
    } catch (e) { return null; }
  }).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
}

module.exports = { loadSettings, saveSettings, loadConv, saveConv, deleteConv, listConvs, convPath, __setClient };