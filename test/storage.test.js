'use strict';
/* Storage backend tests - Redis and file backend.

Run: node test/storage.test.js
*/

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const storage = require('../lib/storage');

// Cleanup test conversations from data/conversations
function cleanupTestConversations() {
  const convDir = path.join(__dirname, '..', 'data', 'conversations');
  if (fs.existsSync(convDir)) {
    const files = fs.readdirSync(convDir);
    for (const f of files) {
      if (f.startsWith('test_')) {
        fs.unlinkSync(path.join(convDir, f));
      }
    }
  }
}

// Mock KV client for Redis backend tests
function createMockKv() {
  const data = new Map();
  const index = new Map();
  return {
    data,
    index,
    async get(key) { return data.get(key) ?? null; },
    async set(key, value) { data.set(key, value); },
    async del(key) { data.delete(key); },
    async zadd(key, arg) {
      // @upstash/redis signature: zadd(key, {score, member})
      // storage.js calls: await k.zadd(CONV_INDEX_KEY, { score: c.updatedAt || Date.now(), member: c.id });
      const { score, member } = arg;
      if (!index.has(key)) index.set(key, []);
      const arr = index.get(key);
      if (typeof score === 'number' && typeof member === 'string') {
        const idx = arr.findIndex(m => m.member === member);
        if (idx >= 0) arr[idx] = { score, member };
        else arr.push({ score, member });
        arr.sort((a, b) => a.score - b.score);
      }
    },
    async zrange(key, start, stop, opts) {
      const arr = index.get(key) || [];
      const sliced = arr.slice(start, stop === -1 ? arr.length : stop + 1);
      if (opts?.rev) return sliced.reverse().map(m => m.member);
      return sliced.map(m => m.member);
    },
    async zrem(key, member) {
      const arr = index.get(key) || [];
      const idx = arr.findIndex(m => m.member === member);
      if (idx >= 0) arr.splice(idx, 1);
    }
  };
}

// Cleanup before tests
cleanupTestConversations();

test('File backend: save and load settings', async () => {
  storage.__setClient(null);
  const testSettings = { test: 'file_value', foo: 123 };
  await storage.saveSettings(testSettings);
  const loaded = await storage.loadSettings();
  assert.strictEqual(loaded.test, 'file_value');
  assert.strictEqual(loaded.foo, 123);
});

test('File backend: save and load conversation', async () => {
  storage.__setClient(null);
  const conv = {
    id: 'test_file_conv',
    title: 'File Test',
    messages: [{ role: 'user', content: 'Hi' }],
    updatedAt: Date.now(),
    persona: { age: 25, personality: 'playful' }
  };
  await storage.saveConv(conv);
  const loaded = await storage.loadConv('test_file_conv');
  assert.strictEqual(loaded.id, 'test_file_conv');
  assert.strictEqual(loaded.title, 'File Test');
  assert.strictEqual(loaded.messages.length, 1);
  assert.strictEqual(loaded.persona.age, 25);
});

test('File backend: list conversations sorted by updatedAt', async () => {
  storage.__setClient(null);
  // Create two conversations
  const conv1 = { id: 'test_a', title: 'A', updatedAt: 1000, persona: { age: 25 }, messages: [] };
  const conv2 = { id: 'test_b', title: 'B', updatedAt: 2000, persona: { age: 30 }, messages: [] };
  await storage.saveConv(conv1);
  await storage.saveConv(conv2);
  const list = await storage.listConvs();
  // Should be sorted descending by updatedAt
  assert.ok(list[0].updatedAt >= list[1].updatedAt);
});

test('File backend: delete conversation', async () => {
  storage.__setClient(null);
  const conv = { id: 'test_to_delete', title: 'Delete Me', updatedAt: Date.now(), persona: { age: 25 }, messages: [] };
  await storage.saveConv(conv);
  let loaded = await storage.loadConv('test_to_delete');
  assert.ok(loaded);
  await storage.deleteConv('test_to_delete');
  loaded = await storage.loadConv('test_to_delete');
  assert.strictEqual(loaded, null);
});

test('Redis backend: zadd uses correct {score, member} signature', async () => {
  const mockKv = createMockKv();
  storage.__setClient(mockKv);

  // This is the exact call from storage.js saveConv
  await mockKv.zadd('test:index', { score: 1234567890, member: 'conv_abc' });

  const arr = mockKv.index.get('test:index');
  assert.strictEqual(arr.length, 1);
  assert.strictEqual(arr[0].score, 1234567890);
  assert.strictEqual(arr[0].member, 'conv_abc');
});

test('Redis backend: save and load settings', async () => {
  const mockKv = createMockKv();
  storage.__setClient(mockKv);

  await storage.saveSettings({ redis: 'test', count: 42 });
  const loaded = await storage.loadSettings();
  assert.strictEqual(loaded.redis, 'test');
  assert.strictEqual(loaded.count, 42);
});

test('Redis backend: save and load conversation', async () => {
  const mockKv = createMockKv();
  storage.__setClient(mockKv);

  const conv = {
    id: 'test_redis_conv',
    title: 'Redis Test',
    messages: [{ role: 'assistant', content: 'Hello' }],
    updatedAt: Date.now(),
    persona: { age: 30, personality: 'confident' }
  };
  await storage.saveConv(conv);
  const loaded = await storage.loadConv('test_redis_conv');
  assert.strictEqual(loaded.id, 'test_redis_conv');
  assert.strictEqual(loaded.title, 'Redis Test');
  assert.strictEqual(loaded.messages[0].role, 'assistant');
});

test('Redis backend: zadd tracks conversation index correctly', async () => {
  const mockKv = createMockKv();
  storage.__setClient(mockKv);

  // Save multiple conversations - they should be indexed by score
  await storage.saveConv({ id: 'test_c1', title: 'C1', updatedAt: 1000, persona: { age: 25 }, messages: [] });
  await storage.saveConv({ id: 'test_c2', title: 'C2', updatedAt: 3000, persona: { age: 30 }, messages: [] });
  await storage.saveConv({ id: 'test_c3', title: 'C3', updatedAt: 2000, persona: { age: 35 }, messages: [] });

  const list = await storage.listConvs();
  // Should be sorted by updatedAt descending (rev: true)
  assert.strictEqual(list.length, 3);
  assert.strictEqual(list[0].updatedAt, 3000);
  assert.strictEqual(list[1].updatedAt, 2000);
  assert.strictEqual(list[2].updatedAt, 1000);
});

test('Redis backend: delete removes from index', async () => {
  const mockKv = createMockKv();
  storage.__setClient(mockKv);

  await storage.saveConv({ id: 'test_del', title: 'Delete', updatedAt: 1000, persona: { age: 25 }, messages: [] });
  let list = await storage.listConvs();
  assert.strictEqual(list.length, 1);

  await storage.deleteConv('test_del');
  list = await storage.listConvs();
  assert.strictEqual(list.length, 0);
});

test('Redis backend: zrange with rev option works', async () => {
  const mockKv = createMockKv();

  // Add items
  await mockKv.zadd('idx', { score: 100, member: 'first' });
  await mockKv.zadd('idx', { score: 300, member: 'third' });
  await mockKv.zadd('idx', { score: 200, member: 'second' });

  // Normal order
  const normal = await mockKv.zrange('idx', 0, -1);
  assert.deepStrictEqual(normal, ['first', 'second', 'third']);

  // Reverse order
  const reversed = await mockKv.zrange('idx', 0, -1, { rev: true });
  assert.deepStrictEqual(reversed, ['third', 'second', 'first']);
});

test('Error handling: KV_MISCONFIGURED error thrown', async () => {
  const err = Object.assign(new Error('KV configured with URL but missing token'), { code: 'KV_MISCONFIGURED' });
  storage.__setClient(err);

  await assert.rejects(
    async () => storage.loadSettings(),
    (e) => e.code === 'KV_MISCONFIGURED'
  );
});

test('Error handling: KV_UNAVAILABLE error thrown', async () => {
  const err = Object.assign(new Error('KV client unavailable'), { code: 'KV_UNAVAILABLE' });
  storage.__setClient(err);

  await assert.rejects(
    async () => storage.loadSettings(),
    (e) => e.code === 'KV_UNAVAILABLE'
  );
});

test('Conversation metadata preserved', async () => {
  storage.__setClient(null);
  const conv = {
    id: 'test_meta',
    title: 'Metadata Test',
    createdAt: 1000000,
    updatedAt: 2000000,
    persona: { age: 28, personality: 'romantic', mode: 'adult', culture: 'indian' },
    messages: [
      { role: 'user', content: 'Hello', at: 1500000 },
      { role: 'assistant', content: 'Hi there', at: 1600000 }
    ],
    memory: 'Previous context',
    recent: { openers: ['hi'], moves: ['tease'], endearments: ['babe'] }
  };
  await storage.saveConv(conv);
  const loaded = await storage.loadConv('test_meta');
  assert.strictEqual(loaded.createdAt, 1000000);
  assert.strictEqual(loaded.updatedAt, 2000000);
  assert.strictEqual(loaded.persona.age, 28);
  assert.strictEqual(loaded.persona.culture, 'indian');
  assert.strictEqual(loaded.messages.length, 2);
  assert.strictEqual(loaded.memory, 'Previous context');
});

// Cleanup after tests
process.on('exit', () => {
  cleanupTestConversations();
});

console.log('\nAll storage tests completed.\n');
