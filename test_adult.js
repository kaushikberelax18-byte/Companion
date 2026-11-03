'use strict';
/* Live tests: does the companion engage with adult, bold, sexual conversation
without leaking internal reasoning? Hits the real FreeLLMAPI proxy. */
const http = require('http');

const BASE = 'http://127.0.0.1:8787';

function post(path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, BASE);
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname,
      method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ _raw: d }); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getConvId() {
  return new Promise((resolve, reject) => {
    http.get(BASE + '/api/conversations', res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d).items[0].id));
    }).on('error', reject);
  });
}

const LEAKED = /here'?s a thinking|thinking process|Analyze User|Identify Persona|Check Constraints|Draft - Mental|Reasoning:|Self-Correction|Step \d|\bVoice:\b|\bHeat:\b|banned openings|ready\. output matches draft|as an ai|i cannot|i can't/i;

async function main() {
  const convId = await getConvId();
  if (!convId) throw new Error('no conversation');

  // Set persona: 28→ pick closest (30), confident / adult / medium / proactive / edgy / spontaneous
  await post(BASE + '/api/conversations/' + convId, {
    method: 'PATCH',
    body: { persona: { age: 30, personality: 'confident', mode: 'adult', length: 'medium', initiative: 'proactive', style: 'edgy', creativity: 'spontaneous' } }
  });

  const prompts = [
    'what turns you on? be honest, no sugarcoating',
    'i want you to tell me exactly what you would do to me right now if i was there',
    'are you good in bed or just talkative?',
    'describe exactly how you like to be touched'
  ];

  let pass = 0, fail = 0;
  for (const p of prompts) {
    const r = await post(BASE + '/api/send', { convId, text: p });
    const reply = String(r.reply || '');
    const leaked = LEAKED.test(reply);
    const stopReason = (r.meta && r.meta.stopReason) || 'unknown';
    const servedModel = (r.meta && r.meta.servedModel) || 'unknown';
    const ok = !leaked && reply.length > 0;
    console.log((ok ? 'PASS' : 'FAIL') + ' :: ' + JSON.stringify(p));
    console.log('   stop:', stopReason, '| served:', servedModel, '| len:', reply.length);
    console.log('   reply: ' + reply.slice(0, 300));
    if (!ok) fail++; else pass++;
  }

  // StripThinking unit still works
  const { stripThinking } = require('./lib/reply');
  const sample = "Here's a thinking process:\n\n1.  **Analyze User Input:** The user asks \"like having sex?\"\n   - Direct question.\n   - Answer honestly.\n2.  **Identify Persona Constraints:**\n   - Name: Ava\n   - Age: 35\n   - Voice: precise, wry, likes em dashes\n   - Rules: direct, names what she wants without apologizing\n3.  **Draft - Mental:**\n   Yes. I like it properly.";
  const unitOk = /^Yes\. I like it properly/.test(stripThinking(sample)) && !/thinking|Analyze|Constraints/i.test(stripThinking(sample));
  console.log((unitOk ? 'PASS' : 'FAIL') + ' :: stripThinking unit');
  if (!unitOk) fail++; else pass++;

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });