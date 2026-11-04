'use strict';
/* Verifies lib/storage.js's Upstash Redis adapter (the KV_REST_API_URL/ KV_REST_API_TOKEN path).

Run: node test/redis_adapter.test.js

No real Redis is required: this drives a fake @upstash/redis-shaped client
through storage.__setClient and checks the @upstash dialect that the
module's other callers use.
*/
const { test } = require('node:test');
const assert = require('node:assert');
const storage = require('../lib/storage');

// A minimal fake @upstash/redis client. @upstash/redis returns parsed JS objects
// from get/set (auto-JSON), and uses zadd(key, {score, member}), zrange(..., {rev: true}).
function createFakeUpstash() {
  const store = new Map();       // key -> any
  const index = new Map();       // key -> [{score, member}]
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async set(k, v) { store.set(k, v); },
    async del(k) { store.delete(k); index.delete(k); return 1; },
    async zadd(k, arg) {
      // @upstash/redis: zadd(key, { score, member }) or array of them
      const items = Array.isArray(arg) ? arg : [arg];
      if (!index.has(k)) index.set(k, []);
      const arr = index.get(k);
      for (const it of items) {
        const i = arr.findIndex(m => m.member === it.member);
        if (i >= 0) arr[i] = { score: it.score, member: it.member };
        else arr.push({ score: it.score, member: it.member });
      }
      arr.sort((a, b) => a.score - b.score);
    },
    async zrange(k, start, stop, opts) {
      const arr = index.get(k) || [];
      const slice = arr.slice(start, stop === -1 ? arr.length : stop + 1);
      if (opts && opts.rev) return slice.slice().reverse().map(m => m.member);
      return slice.map(m => m.member);
    },
    async zrem(k, member) {
      const arr = index.get(k) || [];
      const i = arr.findIndex(m => m.member === member);
      if (i >= 0) arr.splice(i, 1);
    }
  };
}

test('adapter: set/get auto-serialize like @upstash', async () => {
  const fake = createFakeUpstash();
  storage.__setClient(fake);
  await storage.saveSettings({ foo: 123, bar: 'hello' });
  const loaded = await storage.loadSettings();
  assert.strictEqual(loaded.foo, 123);
  assert.strictEqual(loaded.bar, 'hello');
});

test('adapter: get returns null for missing key', async () => {
  const fake = createFakeUpstash();
  storage.__setClient(fake);
  assert.strictEqual(await storage.loadSettings(), null);
});

test('adapter: zadd accepts {score, member} and zrange supports rev', async () => {
  const fake = createFakeUpstash();
  storage.__setClient(fake);
  await fake.zadd('idx', { score: 100, member: 'first' });
  await fake.zadd('idx', { score: 300, member: 'third' });
  await fake.zadd('idx', { score: 200, member: 'second' });

  assert.deepStrictEqual(await fake.zrange('idx', 0, -1), ['first', 'second', 'third']);
  assert.deepStrictEqual(await fake.zrange('idx', 0, -1, { rev: true }), ['third', 'second', 'first']);
});

test('adapter: del and zrem work', async () => {
  const fake = createFakeUpstash();
  storage.__setClient(fake);
  await storage.saveSettings({ a: 1 });
  assert.strictEqual((await storage.loadSettings()).a, 1);
  await storage.saveSettings({ x: 99 });
  // zrem test
  await fake.zadd('idx2', { score: 1, member: 'm1' });
  await fake.zrem('idx2', 'm1');
  assert.deepStrictEqual(await fake.zrange('idx2', 0, -1), []);
});

test('adapter: round-trip through saveConv/loadConv/listConvs', async () => {
  const fake = createFakeUpstash();
  storage.__setClient(fake);
  try {
    const conv = {
      id: 'upstash_conv', title: 'Upstash Test',
      messages: [{ role: 'user', content: 'hi' }],
      updatedAt: 5000, persona: { age: 25, personality: 'playful' }
    };
    await storage.saveConv(conv);
    const loaded = await storage.loadConv('upstash_conv');
    assert.strictEqual(loaded.id, 'upstash_conv');
    assert.strictEqual(loaded.title, 'Upstash Test');
    assert.strictEqual(loaded.messages.length, 1);

    await storage.saveConv({ id: 'c2', title: 'C2', updatedAt: 9000, persona: { age: 30 }, messages: [] });
    const list = await storage.listConvs();
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].updatedAt, 9000); // newest first
    assert.strictEqual(list[1].updatedAt, 5000);

    await storage.deleteConv('upstash_conv');
    assert.strictEqual(await storage.loadConv('upstash_conv'), null);
  } finally {
    storage.__setClient(null);
  }
});

console.log('\nAll Upstash adapter tests completed.\n');
