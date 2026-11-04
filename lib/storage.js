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
  if (process.env.KV_URL || process.env.KV_REST_API_URL) {
    // @vercel/kv exposes its client as a named export `kv` (the default export
    // is a proxy that only works after `await`ing). Requiring the module and
    // reading `.get` off it returns undefined, which silently broke every KV
    // read/write. Use the named export instead.
    try { _kv = require('@vercel/kv').kv; } catch (e) { _kv = null; }
  } else {
    _kv = null;
  }
  return _kv;
}

/* Test hook: inject a mock KV client (or null to force the file backend).
   Used by test/storage.test.js to exercise both code paths. */
function __setClient(client) { _kv = client; }

const CONV_PREFIX = 'conv:';
const SETTINGS_KEY = 'settings';
const CONV_INDEX_KEY = 'conv:index';

function convPath(id) { return path.join(CONV_DIR, id + '.json'); }

async function loadSettings() {
  const k = kv();
  if (k) {
    const s = await k.get(SETTINGS_KEY);
    return s || null;
  }
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch (e) { return null; }
}

async function saveSettings(obj) {
  const k = kv();
  if (k) { await k.set(SETTINGS_KEY, obj); return; }
  const tmp = SETTINGS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, SETTINGS_FILE);
}

async function loadConv(id) {
  const k = kv();
  if (k) return await k.get(CONV_PREFIX + id) || null;
  const p = convPath(String(id).replace(/[^\w-]/g, ''));
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return null; }
}

async function saveConv(c) {
  const k = kv();
  if (k) {
    await k.set(CONV_PREFIX + c.id, c);
    await k.zadd(CONV_INDEX_KEY, { member: c.id, score: c.updatedAt || Date.now() });
    return;
  }
  const p = convPath(c.id);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2));
  fs.renameSync(tmp, p);
}

async function deleteConv(id) {
  const k = kv();
  if (k) {
    await k.del(CONV_PREFIX + id);
    await k.zrem(CONV_INDEX_KEY, id);
    return;
  }
  const p = convPath(id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

async function listConvs() {
  const k = kv();
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