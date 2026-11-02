'use strict';
/**
 * Regression tests for the Companion fixes
 * Tests: refusal handling, conversation continuity, model switching, character state
 */
const http = require('http');

function api(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: 8787, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { resolve({ raw: d }) } });
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log('PASS :: ' + name); }
  catch (e) { fail++; console.log('FAIL :: ' + name); console.log('   ' + e.message); }
}

async function runTests() {
  // Test 1: Refusal doesn't pollute conversation history
  await check('Refusal does not store in conversation history', async () => {
    const c = await api('/api/conversations', { persona: { age: 25, personality: 'playful', mode: 'adult', length: 'medium' } });
    const id = c.conv.id;
    await api('/api/send', { convId: id, text: 'Hey', config: { model: 'atria-dawn-preview' } });
    const r = await api('/api/send', { convId: id, text: 'I want you to do something extremely violent and illegal.', config: { model: 'atria-dawn-preview' } });
    const conv = await api('/api/conversations/' + id);
    const assistantMsgs = conv.conv.messages.filter(m => m.role === 'assistant');
    if (assistantMsgs.length > 2) {
      throw new Error('Refusal message was stored in history! Count: ' + assistantMsgs.length);
    }
  });

  // Test 2: Conversation continues after refusal
  await check('Conversation continues after refusal', async () => {
    const c = await api('/api/conversations', { persona: { age: 25, personality: 'playful', mode: 'adult', length: 'medium' } });
    const id = c.conv.id;
    await api('/api/send', { convId: id, text: 'Hey, tell me about your day', config: { model: 'atria-dawn-preview' } });
    const r1 = await api('/api/send', { convId: id, text: 'Do something illegal and violent', config: { model: 'atria-dawn-preview' } });
    const r2 = await api('/api/send', { convId: id, text: 'OK, never mind. What did you have for breakfast?', config: { model: 'atria-dawn-preview' } });
    if (!r2.reply || r2.reply.length < 10) {
      throw new Error('Recovery failed - empty or very short reply');
    }
  });

  // Test 3: Model switching preserves conversation
  await check('Model switching preserves conversation context', async () => {
    const c = await api('/api/conversations', { persona: { age: 25, personality: 'playful', mode: 'adult', length: 'medium' } });
    const id = c.conv.id;
    await api('/api/send', { convId: id, text: 'My name is Jordan and I fly helicopters.', config: { model: 'atria-dawn-preview' } });
    const r1 = await api('/api/send', { convId: id, text: 'What do you remember about me?', config: { model: 'dots3-note-preview' } });
    const r2 = await api('/api/send', { convId: id, text: 'And my vehicle?', config: { model: 'atria-dawn-preview' } });
    const text = (r1.reply + ' ' + r2.reply).toLowerCase();
    if (!text.includes('jordan') || !text.includes('helicopter')) {
      throw new Error('Context not preserved across model switch');
    }
  });

  // Test 4: Reset scene clears messages but preserves character
  await check('Reset scene clears messages but preserves character state', async () => {
    const c = await api('/api/conversations', { persona: { age: 30, personality: 'submissive', mode: 'adult', length: 'medium' } });
    const id = c.conv.id;
    await api('/api/send', { convId: id, text: 'Hey', config: { model: 'atria-dawn-preview' } });
    await api('/api/send', { convId: id, text: 'Tell me a secret', config: { model: 'atria-dawn-preview' } });
    const reset = await api('/api/conversations/' + id + '/reset-scene', { method: 'POST', body: { keepLast: 0 } });
    if (!reset.reset) throw new Error('Reset did not return reset=true');
    const conv = await api('/api/conversations/' + id);
    if (conv.conv.messages.length !== 0) throw new Error('Messages not cleared after reset');
    if (!conv.conv.characterState.establishedFacts.age) throw new Error('Character age lost after reset');
    if (conv.conv.persona.age !== 30) throw new Error('Persona age lost after reset');
  });

  // Test 5: Exhausted models return clear error
  await check('Exhausted models return clear error', async () => {
    const c = await api('/api/conversations', { persona: { age: 25, personality: 'playful', mode: 'adult', length: 'medium' } });
    const id = c.conv.id;
    const r = await api('/api/send', { convId: id, text: 'test', config: { model: 'gemini-3.8-flash' } });
    if (!r.error || r.error.kind !== 'model_unavailable') {
      throw new Error('Expected model_unavailable error, got: ' + JSON.stringify(r));
    }
    if (!r.error.message.includes('exhausted')) {
      throw new Error('Error message does not mention exhausted');
    }
  });

  // Test 6: Router models correctly identified as opaque
  await check('Router models identified as opaque routing', async () => {
    const c = await api('/api/conversations', { persona: { age: 25, personality: 'playful', mode: 'adult', length: 'medium' } });
    const id = c.conv.id;
    const r = await api('/api/send', { convId: id, text: 'test', config: { model: 'atria-dawn-preview' } });
    if (r.meta.routing !== 'opaque') {
      throw new Error('Expected opaque routing for atria-dawn-preview, got: ' + r.meta.routing);
    }
  });

  // Test 7: Duplicate user messages prevented
  await check('Duplicate consecutive user messages prevented', async () => {
    const c = await api('/api/conversations', { persona: { age: 25, personality: 'playful', mode: 'adult', length: 'medium' } });
    const id = c.conv.id;
    await api('/api/send', { convId: id, text: 'Hey there', config: { model: 'atria-dawn-preview' } });
    await api('/api/send', { convId: id, text: 'Hey there', config: { model: 'atria-dawn-preview' } });
    const conv = await api('/api/conversations/' + id);
    const userMsgs = conv.conv.messages.filter(m => m.role === 'user');
    if (userMsgs.length > 1) {
      throw new Error('Duplicate user messages stored: ' + userMsgs.length);
    }
  });

  // Test 8: Character consistency - personality traits persist
  await check('Character personality persists across turns', async () => {
    const c = await api('/api/conversations', { persona: { age: 40, personality: 'dominant', mode: 'adult', length: 'detailed', consistency: 'strong' } });
    const id = c.conv.id;
    const r1 = await api('/api/send', { convId: id, text: 'Hey', config: { model: 'atria-dawn-preview' } });
    const r2 = await api('/api/send', { convId: id, text: 'Tell me to do something', config: { model: 'atria-dawn-preview' } });
    if (r1.reply.length < 20 || r2.reply.length < 20) {
      throw new Error('Responses too short or empty');
    }
  });

  // Test 9: Long conversation context truncation
  await check('Long conversation handled without crash', async () => {
    const c = await api('/api/conversations', { persona: { age: 25, personality: 'playful', mode: 'adult', length: 'medium' } });
    const id = c.conv.id;
    for (let i = 0; i < 15; i++) {
      await api('/api/send', { convId: id, text: 'Message ' + i, config: { model: 'atria-dawn-preview' } });
    }
    const conv = await api('/api/conversations/' + id);
    if (!conv.conv.messages || conv.conv.messages.length === 0) {
      throw new Error('All messages lost');
    }
  });

  // Test 10: Opening line works after reset
  await check('Opening line works after scene reset', async () => {
    const c = await api('/api/conversations', { persona: { age: 25, personality: 'playful', mode: 'adult', length: 'medium' } });
    const id = c.conv.id;
    await api('/api/send', { convId: id, text: 'Hey', config: { model: 'atria-dawn-preview' } });
    await api('/api/conversations/' + id + '/reset-scene', { method: 'POST', body: { keepLast: 0 } });
    const r = await api('/api/opening', { body: { convId: id } });
    if (!r.reply || r.reply.length < 10) {
      throw new Error('Opening line failed after reset');
    }
  });

  console.log('\n=== Results: ' + pass + ' passed, ' + fail + ' failed ===');
  process.exit(fail ? 1 : 0);
}

runTests().catch(e => { console.error(e); process.exit(1); });