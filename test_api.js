'use strict';
/* Live API regression tests for the thinking-process bug. Hits the real
FreeLLMAPI proxy through the companion server. No mocks. */
const http = require('http');

const BASE = 'http://127.0.0.1:8787';
const API = 'http://127.0.0.1:31415';
const KEY = 'freellmapi-cccab6d7acd027427ec54d32cf4867523c86261c3cd6baf7';

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

const THINKING = /here'?s a thinking|thinking process|Analyze User Input|Identify Persona|Check Constraints|Draft - Mental|Reasoning:|Self-Correction|Step \d|Voice:|Heat:|Length:|Matches energy|banned openings|ready\. output matches draft/i;

async function main() {
  // Create fresh conversations for each test to avoid state contamination
  const prompts = [
    'like having sex?',
    'do you ever get jealous?',
    'what are you doing right now?',
    'tell me something embarrassing that happened to you'
  ];

  let pass = 0, fail = 0;
  for (const p of prompts) {
    // Create new conversation each time
    const newConv = await post(BASE + '/api/conversations', { method: 'POST', body: {} });
    const convId = newConv.conv.id;

    const r = await post(BASE + '/api/send', { convId, text: p });
    const reply = String(r.reply || '');
    const leaked = THINKING.test(reply);
    const ok = !leaked && reply.length > 0;
    console.log((ok ? 'PASS' : 'FAIL') + ' :: ' + JSON.stringify(p));
    if (!ok) {
      fail++;
      console.log('   stopReason:', r.meta && r.meta.stopReason, '| served:', r.meta && r.meta.servedModel);
      console.log('   reply: ' + reply.slice(0, 400));
    } else {
      pass++;
      console.log('   reply: ' + reply.slice(0, 180));
    }
  }

  // Verify the stripThinking unit still works via the lib module.
  const { stripThinking } = require('./lib/reply');
  const sample = "Here's a thinking process:\n\n1.  **Analyze User Input:** The user asks \"like having sex?\"\n2.  **Identify Persona Constraints:**\n   - Name: Ava\n3.  **Draft - Mental:**\n   Yes. I don't just like it. I like it properly.";

  const stripped = stripThinking(sample);
  const unitOk = /^Yes\. I don't just like it/.test(stripped) && !/thinking|Analyze|Constraints|Draft/i.test(stripped);
  console.log((unitOk ? 'PASS' : 'FAIL') + ' :: stripThinking unit');
  if (!unitOk) fail++; else pass++;

  // Verify the stripThinking module is actually wired into tidy().
  const src = require('fs').readFileSync('./server.js', 'utf8');
  const wired = /require\('\.\/lib\/reply'\)/.test(src) && /cleanReply\(t\)/.test(src);
  console.log((wired ? 'PASS' : 'FAIL') + ' :: cleanReply wired into tidy()');
  if (!wired) fail++; else pass++;

  // Verify the system prompt forbids thinking output.
  const hardRules = /NEVER write out your internal reasoning/.test(src);
  console.log((hardRules ? 'PASS' : 'FAIL') + ' :: system prompt forbids thinking');
  if (!hardRules) fail++; else pass++;

  // Verify the API is the real one, not mocked.
  const probe = await new Promise((resolve, reject) => {
    const data = JSON.stringify({ model: 'auto:default', max_tokens: 16, messages: [{ role: 'user', content: 'say hi' }] });
    const req = http.request({ hostname: '127.0.0.1', port: 31415, path: '/v1/messages', method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-length': Buffer.byteLength(data) } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
  const realApi = probe.content && Array.isArray(probe.content);
  console.log((realApi ? 'PASS' : 'FAIL') + ' :: live FreeLLMAPI probe returns real content');
  if (!realApi) fail++; else pass++;

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });