'use strict';
/* End-to-end smoke test: real HTTP server + Upstash Redis-backed storage.

Run: node test/http_redis_e2e.js

Starts the companion's actual HTTP server (server.js) with an in-memory
adapter wired in through storage.__setClient, then exercises the real
/api/conversations, /api/conversations/<id> and /api/send routes so the
storage layer is validated through the same code path the deployed
frontend hits. No API key is needed: /api/send is only called up to the
"model unusable" check, which we short-circuit by setting a fake key.
*/
const http = require('http');
const { handler } = require('../server.js');
const storage = require('../lib/storage');

/* Mock @upstash/redis client - speaks the same dialect as @vercel/kv. */
function createMemoryUpstash() {
  const store = new Map();
  const index = new Map();
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async set(k, v) { store.set(k, v); },
    async del(k) { store.delete(k); index.delete(k); return 1; },
    async zadd(k, arg) {
      // @upstash/redis: zadd(key, { score, member }) or array of them
      const items = Array.isArray(arg) ? arg : [arg];
      for (const it of items) {
        if (!index.has(k)) index.set(k, []);
        const arr = index.get(k);
        const i = arr.findIndex(m => m.member === it.member);
        if (i >= 0) arr[i] = { score: it.score, member: it.member };
        else arr.push({ score: it.score, member: it.member });
        arr.sort((a, b) => a.score - b.score);
      }
    },
    async zrange(k, start, stop, opts) {
      const arr = index.get(k) || [];
      const slice = arr.slice(start, stop === -1 ? arr.length : stop + 1);
      if (opts && opts.rev) return slice.slice().reverse().map(m => m.member);
      return slice.map(m => m.member);
    },
    async zrem(k, member) {
      const arr = index.get(k) || [];
      index.set(k, arr.filter(m => m.member !== member));
    }
  };
}

function req(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({
      hostname: '127.0.0.1', port, path, method,
      headers: { 'content-type': 'application/json' }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, body: json != null ? json : data });
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  // Wire the Upstash-backed storage path through the real server.
  storage.__setClient(createMemoryUpstash());
  // Give the server a fake API key so /api/send gets past the key check and
  // exercises the storage write path (it will fail at the model check, which
  // is fine - what matters is that the conversation row was written).
  process.env.ANTHROPIC_API_KEY = 'fake-key-for-test';
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:1';

  const server = http.createServer(handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;

  const results = [];

  // 1. Create a conversation (POST /api/conversations) - must persist to Upstash.
  const created = await req(port, 'POST', '/api/conversations', {});
  results.push(['create conv', created.status, !!created.body.conv && !!created.body.conv.id]);
  const convId = created.body.conv.id;

  // 2. List conversations - must see the one we just created.
  const listed = await req(port, 'GET', '/api/conversations');
  results.push(['list convs', listed.status, listed.body?.items?.some(i => i.id === convId)]);

  // 3. Send a message - the server writes user message then fails at the model
  //    check and pops it; the conversation row itself must still exist and be
  //    loadable afterwards.
  const sent = await req(port, 'POST', '/api/send', { convId, text: 'hello there' });
  results.push(['send msg', sent.status, sent.body && sent.body.error && sent.body.error.kind === 'unreachable']);

  const after = await req(port, 'GET', '/api/conversations/' + convId);
  results.push(['load conv after send', after.status, !!after.body.conv && after.body.conv.id === convId]);

  // 4. Delete conversation - must remove from Upstash index too.
  const del = await req(port, 'DELETE', '/api/conversations/' + convId);
  const gone = await req(port, 'GET', '/api/conversations/' + convId);
  results.push(['delete conv', del.status, gone.status === 404]);

  // 5. Settings round-trip through Upstash.
  const cfg = await req(port, 'POST', '/api/config', { name: 'Testy', model: 'auto:default' });
  const cfgGet = await req(port, 'GET', '/api/config');
  results.push(['settings persist', cfgGet.status, cfgGet.body.name === 'Testy']);

  server.close();
  storage.__setClient(null);

  let ok = true;
  for (const [name, status, pass] of results) {
    const mark = pass ? 'PASS' : 'FAIL';
    if (!pass) ok = false;
    console.log(mark, '::', name, '(HTTP ' + status + ')');
  }
  if (!ok) { console.error('\nE2E FAILED'); process.exit(1); }
  console.log('\nAll HTTP + Upstash e2e checks passed.\n');
}

main().catch(e => { console.error('E2E error:', e); process.exit(1); });
