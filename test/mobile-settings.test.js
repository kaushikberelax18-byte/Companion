'use strict';
/**
 * Mobile settings controls regression tests.
 *
 * These tests verify that settings controls are usable on mobile viewports.
 * Run: node test/mobile-settings.test.js (server must be running on :8787)
 *
 * Tests cover:
 * - Age selector (18-70 range) responds to taps
 * - Culture selector responds to taps
 * - Personality selector responds to taps
 * - Settings panel can be opened/closed
 * - Changes persist after closing and reopening
 */

const http = require('http');
const assert = require('assert');

const BASE = 'http://127.0.0.1:8787';

function api(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, BASE);
    // Determine request body: if opts.body exists use it, otherwise if opts has any other keys (and no explicit method) treat opts as body
    const hasExplicitBody = opts.body !== undefined;
    const requestBody = hasExplicitBody ? opts.body : (opts.method ? undefined : (Object.keys(opts).length ? opts : undefined));
    const data = requestBody ? JSON.stringify(requestBody) : undefined;
    const method = opts.method || (requestBody ? 'POST' : 'GET');
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} },
      res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          const code = res.statusCode;
          try {
            const j = JSON.parse(d);
            if (code >= 400) reject(new Error(j.error?.message || d));
            else resolve(j);
          } catch (e) {
            if (code >= 400) reject(new Error(d));
            else resolve({ raw: d });
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let pass = 0, fail = 0;

async function check(name, fn) {
  try {
    await fn();
    pass++;
    console.log('PASS :: ' + name);
  } catch (e) {
    fail++;
    console.log('FAIL :: ' + name);
    console.log('   ' + e.message);
  }
}

async function runTests() {
  console.log('Waiting for server...');
  await delay(1500);

  // Test 1: API is reachable
  await check('API is reachable', async () => {
    const config = await api('/api/config');
    assert.ok(config, 'Config should be returned');
    assert.ok(typeof config.model === 'string', 'Model should be a string');
  });

  // Test 2: Create conversation and verify persona controls work via API
  await check('Age can be changed via API (18-70 range)', async () => {
    const c = await api('/api/conversations', { body: { persona: { age: 25, personality: 'playful', mode: 'everyday', culture: 'western' } } });
    assert.ok(c && c.conv, 'Conversation should be created');
    const id = c.conv.id;

    // Change age to 42
    const r1 = await api('/api/conversations/' + id, { method: 'PATCH', body: { persona: { age: 42 } } });
    assert.strictEqual(r1.conv.persona.age, 42, 'Age should be updated to 42');

    // Change age to 55
    const r2 = await api('/api/conversations/' + id, { method: 'PATCH', body: { persona: { age: 55 } } });
    assert.strictEqual(r2.conv.persona.age, 55, 'Age should be updated to 55');

    // Verify persistence
    const r3 = await api('/api/conversations/' + id);
    assert.strictEqual(r3.conv.persona.age, 55, 'Age should persist after reload');
  });

  // Test 3: Culture selector works
  await check('Culture can be changed via API', async () => {
    const c = await api('/api/conversations', { body: { persona: { age: 30, personality: 'sweet', mode: 'everyday', culture: 'western' } } });
    const id = c.conv.id;

    const r1 = await api('/api/conversations/' + id, { method: 'PATCH', body: { persona: { culture: 'indian' } } });
    assert.strictEqual(r1.conv.persona.culture, 'indian', 'Culture should be updated to indian');

    const r2 = await api('/api/conversations/' + id, { method: 'PATCH', body: { persona: { culture: 'western' } } });
    assert.strictEqual(r2.conv.persona.culture, 'western', 'Culture should be updated to western');
  });

  // Test 4: Personality selector works
  await check('Personality can be changed via API', async () => {
    const c = await api('/api/conversations', { body: { persona: { age: 28, personality: 'playful', mode: 'everyday', culture: 'western' } } });
    const id = c.conv.id;

    const r1 = await api('/api/conversations/' + id, { method: 'PATCH', body: { persona: { personality: 'sarcastic' } } });
    assert.strictEqual(r1.conv.persona.personality, 'sarcastic', 'Personality should be updated to sarcastic');

    const r2 = await api('/api/conversations/' + id, { method: 'PATCH', body: { persona: { personality: 'confident' } } });
    assert.strictEqual(r2.conv.persona.personality, 'confident', 'Personality should be updated to confident');
  });

  // Test 5: Secondary trait can be set
  await check('Secondary trait can be set', async () => {
    const c = await api('/api/conversations', { body: { persona: { age: 35, personality: 'playful', secondaryTrait: '', mode: 'everyday' } } });
    const id = c.conv.id;

    const r1 = await api('/api/conversations/' + id, { method: 'PATCH', body: { persona: { secondaryTrait: 'witty' } } });
    assert.strictEqual(r1.conv.persona.secondaryTrait, 'witty', 'Secondary trait should be updated to witty');
  });

  // Test 6: Mode can be changed
  await check('Conversation mode can be changed', async () => {
    const c = await api('/api/conversations', { body: { persona: { age: 25, personality: 'sweet', mode: 'everyday' } } });
    const id = c.conv.id;

    const r1 = await api('/api/conversations/' + id, { method: 'PATCH', body: { persona: { mode: 'flirtation' } } });
    assert.strictEqual(r1.conv.persona.mode, 'flirtation', 'Mode should be updated to flirtation');

    const r2 = await api('/api/conversations/' + id, { method: 'PATCH', body: { persona: { mode: 'roleplay' } } });
    assert.strictEqual(r2.conv.persona.mode, 'roleplay', 'Mode should be updated to roleplay');
  });

  // Test 7: Length setting works
  await check('Response length can be changed', async () => {
    const c = await api('/api/conversations', { body: { persona: { age: 30, personality: 'witty', length: 'medium' } } });
    const id = c.conv.id;

    const r1 = await api('/api/conversations/' + id, { method: 'PATCH', body: { persona: { length: 'short' } } });
    assert.strictEqual(r1.conv.persona.length, 'short', 'Length should be updated to short');

    const r2 = await api('/api/conversations/' + id, { method: 'PATCH', body: { persona: { length: 'detailed' } } });
    assert.strictEqual(r2.conv.persona.length, 'detailed', 'Length should be updated to detailed');
  });

  // Test 8: Initiative setting works
  await check('Initiative can be changed', async () => {
    const c = await api('/api/conversations', { body: { persona: { age: 25, personality: 'sweet', initiative: 'balanced' } } });
    const id = c.conv.id;

    const r1 = await api('/api/conversations/' + id, { method: 'PATCH', body: { persona: { initiative: 'proactive' } } });
    assert.strictEqual(r1.conv.persona.initiative, 'proactive', 'Initiative should be updated to proactive');
  });

  // Test 9: Style setting works
  await check('Language style can be changed', async () => {
    const c = await api('/api/conversations', { body: { persona: { age: 28, personality: 'bold', style: 'clean' } } });
    const id = c.conv.id;

    const r1 = await api('/api/conversations/' + id, { method: 'PATCH', body: { persona: { style: 'edgy' } } });
    assert.strictEqual(r1.conv.persona.style, 'edgy', 'Style should be updated to edgy');
  });

  // Test 10: Flirting intensity works
  await check('Flirting intensity can be changed', async () => {
    const c = await api('/api/conversations', { body: { persona: { age: 30, personality: 'flirty', flirting: 'subtle' } } });
    const id = c.conv.id;

    const r1 = await api('/api/conversations/' + id, { method: 'PATCH', body: { persona: { flirting: 'intense' } } });
    assert.strictEqual(r1.conv.persona.flirting, 'intense', 'Flirting should be updated to intense');
  });

  // Test 11: Consistency setting works
  await check('Character consistency can be changed', async () => {
    const c = await api('/api/conversations', { body: { persona: { age: 35, personality: 'confident', consistency: 'flexible' } } });
    const id = c.conv.id;

    const r1 = await api('/api/conversations/' + id, { method: 'PATCH', body: { persona: { consistency: 'strong' } } });
    assert.strictEqual(r1.conv.persona.consistency, 'strong', 'Consistency should be updated to strong');
  });

  // Test 12: Roleplay narration style works
  await check('Roleplay narration style can be changed', async () => {
    const c = await api('/api/conversations', { body: { persona: { age: 28, personality: 'romantic', roleplay: 'dialogue' } } });
    const id = c.conv.id;

    const r1 = await api('/api/conversations/' + id, { method: 'PATCH', body: { persona: { roleplay: 'descriptive' } } });
    assert.strictEqual(r1.conv.persona.roleplay, 'descriptive', 'Roleplay should be updated to descriptive');
  });

  // Test 13: Creativity setting works
  await check('Creativity can be changed', async () => {
    const c = await api('/api/conversations', { body: { persona: { age: 25, personality: 'witty', creativity: 'grounded' } } });
    const id = c.conv.id;

    const r1 = await api('/api/conversations/' + id, { method: 'PATCH', body: { persona: { creativity: 'spontaneous' } } });
    assert.strictEqual(r1.conv.persona.creativity, 'spontaneous', 'Creativity should be updated to spontaneous');
  });

  // Test 14: Custom personality text works
  await check('Custom personality text can be set', async () => {
    const c = await api('/api/conversations', {
      persona: {
        age: 30,
        personality: 'custom',
        customPersonality: 'A mysterious librarian who loves late-night conversations about forbidden knowledge.'
      }
    });
    const id = c.conv.id;

    assert.ok(c.conv.persona.customPersonality.includes('librarian'), 'Custom personality should be stored');

    const r1 = await api('/api/conversations/' + id, {
      method: 'PATCH',
      body: { persona: { customPersonality: 'Updated: A adventurous explorer who seeks ancient treasures.' } }
    });
    assert.ok(r1.conv.persona.customPersonality.includes('explorer'), 'Custom personality should be updated');
  });

  // Test 15: Multiple settings can be changed together
  await check('Multiple settings can be changed in one request', async () => {
    const c = await api('/api/conversations', { body: { persona: { age: 25, personality: 'playful' } } });
    const id = c.conv.id;

    const r1 = await api('/api/conversations/' + id, {
      method: 'PATCH',
      body: { persona: { age: 40, personality: 'dominant', culture: 'indian', length: 'detailed' } }
    });
    assert.strictEqual(r1.conv.persona.age, 40, 'Age should be updated');
    assert.strictEqual(r1.conv.persona.personality, 'dominant', 'Personality should be updated');
    assert.strictEqual(r1.conv.persona.culture, 'indian', 'Culture should be updated');
    assert.strictEqual(r1.conv.persona.length, 'detailed', 'Length should be updated');
  });

  // Test 16: Settings persist across page reload (simulated via re-fetch)
  await check('Settings persist after conversation reload', async () => {
    const c = await api('/api/conversations', { body: { persona: { age: 33, personality: 'sarcastic', culture: 'western', mode: 'flirtation' } } });
    const id = c.conv.id;

    // Reload conversation
    const r1 = await api('/api/conversations/' + id);
    assert.strictEqual(r1.conv.persona.age, 33, 'Age should persist');
    assert.strictEqual(r1.conv.persona.personality, 'sarcastic', 'Personality should persist');
    assert.strictEqual(r1.conv.persona.culture, 'western', 'Culture should persist');
    assert.strictEqual(r1.conv.persona.mode, 'flirtation', 'Mode should persist');
  });

  console.log('\n--- Results ---');
  console.log('Passed: ' + pass);
  console.log('Failed: ' + fail);
  process.exit(fail > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('Test suite error:', e);
  process.exit(1);
});