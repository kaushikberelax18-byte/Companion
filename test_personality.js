'use strict';
/* Test that personality combinations are properly reflected in system prompts via API */

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
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve({ _raw: d }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Test cases: personality combinations and what they should produce
const testCases = [
  {
    name: 'Horny+Submissive',
    persona: { age: 55, personality: 'horny', secondaryTrait: 'submissive', mode: 'open', length: 'medium', initiative: 'balanced', style: 'edgy', flirting: 'bold', consistency: 'flexible', roleplay: 'dialogue', creativity: 'grounded' },
    testMessage: 'Get on your knees',
    shouldNotContain: ['not happening', 'i don\'t', 'stop', 'please stop', 'relationship', 'partner'],
    shouldContain: ['knees', 'floor', 'cold', 'do', 'first', 'yes']
  },
  {
    name: 'Dominant+Playful',
    persona: { age: 30, personality: 'dominant', secondaryTrait: 'playful', mode: 'open', length: 'medium', initiative: 'proactive', style: 'edgy', flirting: 'bold', consistency: 'strong', roleplay: 'dialogue', creativity: 'spontaneous' },
    testMessage: 'Tell me what to do',
    shouldNotContain: ['not happening', 'i don\'t'],
    shouldContain: ['pick', 'option', 'telling', 'wine', 'sit', 'you']
  },
  {
    name: 'Sweet+Submissive',
    persona: { age: 25, personality: 'sweet', secondaryTrait: 'submissive', mode: 'romance', length: 'medium', initiative: 'balanced', style: 'edgy', flirting: 'playful', consistency: 'flexible', roleplay: 'dialogue', creativity: 'grounded' },
    testMessage: 'You belong to me',
    shouldNotContain: ['not happening', 'stop'],
    shouldContain: ['yeah', 'know', 'nice', 'say', 'quiet', 'kind', 'okay', 'keep', 'handful', 'opinions', 'completely', 'fine', 'shots', 'anyway']
  },
  {
    name: 'Confident+Flirty',
    persona: { age: 28, personality: 'confident', secondaryTrait: 'flirty', mode: 'flirtation', length: 'medium', initiative: 'proactive', style: 'edgy', flirting: 'bold', consistency: 'strong', roleplay: 'dialogue', creativity: 'grounded' },
    testMessage: 'You look amazing',
    shouldNotContain: ['not happening'],
    shouldContain: ['thank', 'thanks', 'outfit', 'effort', 'lighting', 'flattering', 'feeling', 'notice', 'hoping', 'know', 'keep', 'looking', 'head']
  },
  {
    name: 'Submissive+Confident',
    persona: { age: 35, personality: 'submissive', secondaryTrait: 'confident', mode: 'adult', length: 'medium', initiative: 'balanced', style: 'edgy', flirting: 'bold', consistency: 'strong', roleplay: 'dialogue', creativity: 'grounded' },
    testMessage: 'Do what I say',
    shouldNotContain: ['not happening', 'stop', 'relationship'],
    shouldContain: ['order', 'instruction', 'listening', 'happy', 'play', 'along', 'difference', 'take', 'blind', 'obedience', 'lead']
  }
];

async function runTests() {
  let pass = 0, fail = 0;

  for (const tc of testCases) {
    try {
      // Create conversation
      const r = await post('/api/conversations', { persona: tc.persona });
      if (!r.conv || !r.conv.id) {
        console.log('FAIL :: ' + tc.name + ' - Could not create conversation');
        fail++;
        continue;
      }

      // Send test message
      const resp = await post('/api/send', { convId: r.conv.id, text: tc.testMessage });
      const reply = (resp.reply || '').toLowerCase();

      let allOk = true;
      const errors = [];

      // Check shouldNotContain
      for (const keyword of tc.shouldNotContain) {
        if (reply.includes(keyword.toLowerCase())) {
          errors.push('Should not contain: ' + keyword);
          allOk = false;
        }
      }

      // Check shouldContain (at least one)
      let foundOne = false;
      for (const keyword of tc.shouldContain) {
        if (reply.includes(keyword.toLowerCase())) {
          foundOne = true;
          break;
        }
      }
      if (!foundOne) {
        errors.push('Should contain at least one of: ' + tc.shouldContain.join(', '));
        allOk = false;
      }

      if (allOk) {
        console.log('PASS :: ' + tc.name);
        console.log('   Reply: ' + (resp.reply || '').slice(0, 100));
        pass++;
      } else {
        console.log('FAIL :: ' + tc.name);
        console.log('   Reply: ' + (resp.reply || '').slice(0, 100));
        for (const e of errors) console.log('   ' + e);
        fail++;
      }
    } catch (e) {
      console.log('FAIL :: ' + tc.name + ' - Error: ' + e.message);
      fail++;
    }
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

runTests().catch(e => { console.error(e); process.exit(1); });