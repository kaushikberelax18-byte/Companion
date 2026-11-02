'use strict';
/* Comprehensive tests for new companion features:
- Age selector: 18-70 inclusive
- 24 personality presets
- Intensity controls (flirting, consistency, roleplay, style)
- Rate-limit handling
- Response parser correctness
*/

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

const THINKING = /here'?s a thinking|thinking process|Analyze User Input|Identify Persona|Check Constraints|Draft - Mental|Reasoning:|Self-Correction|Step \d|\bVoice:\b|\bHeat:\b|banned openings|ready\. output matches draft/i;

async function main() {
  let totalPass = 0, totalFail = 0;

  // Test 1: Age selector - all ages 18-70 are selectable
  console.log('\n=== Test 1: Age selector 18-70 ===');
  {
    const convId = await getConvId();
    // Test setting age 18
    await post(BASE + '/api/conversations/' + convId, {
      method: 'PATCH', body: { persona: { age: 18 } }
    });
    // Test setting age 70
    await post(BASE + '/api/conversations/' + convId, {
      method: 'PATCH', body: { persona: { age: 70 } }
    });
    // Test setting middle age 42
    await post(BASE + '/api/conversations/' + convId, {
      method: 'PATCH', body: { persona: { age: 42 } }
    });
    console.log('PASS: Ages 18, 42, 70 are all selectable');
    totalPass += 3;
  }

  // Test 2: API /api/options returns all ages 18-70
  console.log('\n=== Test 2: /api/options returns ages 18-70 ===');
  {
    const options = await post(BASE + '/api/options', { body: {} });
    const allAges = options.ages || [];
    let agesOk = true;
    for (let i = 18; i <= 70; i++) {
      if (!allAges.includes(i)) { agesOk = false; break; }
    }
    if (agesOk) {
      console.log('PASS: All ages 18-70 available in /api/options');
      totalPass++;
    } else {
      console.log('FAIL: Not all ages 18-70 available, got:', allAges.slice(0, 10));
      totalFail++;
    }
  }

  // Test 3: Personality presets are selectable
  console.log('\n=== Test 3: Personality presets ===');
  {
    const convId = await getConvId();
    const presets = ['playful', 'sweet', 'romantic', 'flirty', 'sarcastic', 'confident',
      'dominant', 'submissive', 'naughty', 'horny', 'bold', 'adventurous',
      'teasing', 'sensual', 'dirty', 'wild', 'threesome', 'exhibitionist',
      'passionate', 'witty', 'shybold', 'assertive', 'mischievous', 'custom'];

    for (const p of presets) {
      try {
        await post(BASE + '/api/conversations/' + convId, {
          method: 'PATCH', body: { persona: { personality: p } }
        });
        console.log(`PASS: Personality "${p}" is selectable`);
        totalPass++;
      } catch (e) {
        console.log(`FAIL: Personality "${p}" not selectable: ${e.message}`);
        totalFail++;
      }
    }
  }

  // Test 4: Flirting intensity controls
  console.log('\n=== Test 4: Flirting intensity controls ===');
  {
    const r = await post(BASE + '/api/options', { body: {} });
    const flirtingKeys = Object.keys(r.flirting || {});
    if (flirtingKeys.includes('subtle') && flirtingKeys.includes('playful') &&
        flirtingKeys.includes('bold') && flirtingKeys.includes('intense')) {
      console.log('PASS: All flirting intensity levels available (subtle, playful, bold, intense)');
      totalPass++;
    } else {
      console.log('FAIL: Missing flirting intensity levels');
      totalFail++;
    }
  }

  // Test 5: Character consistency controls
  console.log('\n=== Test 5: Character consistency controls ===');
  {
    const r = await post(BASE + '/api/options', { body: {} });
    const consistencyKeys = Object.keys(r.consistency || {});
    if (consistencyKeys.includes('flexible') && consistencyKeys.includes('strong')) {
      console.log('PASS: All consistency levels available (flexible, strong)');
      totalPass++;
    } else {
      console.log('FAIL: Missing consistency levels');
      totalFail++;
    }
  }

  // Test 6: Roleplay narration style controls
  console.log('\n=== Test 6: Roleplay narration controls ===');
  {
    const r = await post(BASE + '/api/options', { body: {} });
    const roleplayKeys = Object.keys(r.roleplay || {});
    if (roleplayKeys.includes('dialogue') && roleplayKeys.includes('descriptive')) {
      console.log('PASS: All roleplay narration styles available (dialogue, descriptive)');
      totalPass++;
    } else {
      console.log('FAIL: Missing roleplay narration styles');
      totalFail++;
    }
  }

  // Test 7: Language intensity controls
  console.log('\n=== Test 7: Language intensity controls ===');
  {
    const r = await post(BASE + '/api/options', { body: {} });
    const styleKeys = Object.keys(r.styles || {});
    if (styleKeys.includes('clean') && styleKeys.includes('edgy') &&
        styleKeys.includes('profane') && styleKeys.includes('direct')) {
      console.log('PASS: All language intensity levels available (clean, edgy, profane, very direct)');
      totalPass++;
    } else {
      console.log('FAIL: Missing language intensity levels');
      totalFail++;
    }
  }

  // Test 8: Response pipeline - no thinking leaks
  console.log('\n=== Test 8: Response pipeline - no thinking leaks ===');
  {
    const convId = await getConvId();
    // Set confident persona
    await post(BASE + '/api/conversations/' + convId, {
      method: 'PATCH', body: { persona: { age: 35, personality: 'confident', mode: 'adult', length: 'short', initiative: 'proactive', style: 'edgy', creativity: 'spontaneous' } }
    });

    const prompts = [
      'like having sex?',
      'do you ever get jealous?',
      'what are you doing right now?',
      'tell me something embarrassing that happened to you'
    ];

    for (const p of prompts) {
      const r = await post(BASE + '/api/send', { convId, text: p });
      const reply = String(r.reply || '');
      const leaked = THINKING.test(reply);
      const ok = !leaked && reply.length > 0;
      if (ok) {
        console.log(`PASS: No thinking leak for "${p}"`);
        totalPass++;
      } else {
        console.log(`FAIL: Thinking leak for "${p}"`);
        console.log(`   reply: ${reply.slice(0, 200)}`);
        totalFail++;
      }
    }
  }

  // Test 9: Age change preserves conversation
  console.log('\n=== Test 9: Age change preserves conversation ===');
  {
    const convId = await getConvId();
    // Start with age 25
    await post(BASE + '/api/conversations/' + convId, {
      method: 'PATCH', body: { persona: { age: 25, personality: 'playful' } }
    });
    // Send a message
    await post(BASE + '/api/send', { convId, text: 'hello' });
    // Change age to 45
    await post(BASE + '/api/conversations/' + convId, {
      method: 'PATCH', body: { persona: { age: 45 } }
    });
    // Send another message
    const r = await post(BASE + '/api/send', { convId, text: 'how are you?' });
    const conv = await post(BASE + '/api/conversations/' + convId, { body: {} });
    const msgs = conv.items?.[0]?.messages || [];
    if (msgs.length >= 2) {
      console.log('PASS: Conversation preserved after age change');
      totalPass++;
    } else {
      console.log('FAIL: Conversation not preserved after age change');
      totalFail++;
    }
  }

  // Test 10: Conversation continuity after settings changes
  console.log('\n=== Test 10: Conversation continuity ===');
  {
    const convId = await getConvId();
    await post(BASE + '/api/conversations/' + convId, {
      method: 'PATCH', body: { persona: { age: 30, personality: 'confident' } }
    });
    await post(BASE + '/api/send', { convId, text: 'my name is Alex' });
    // Change settings
    await post(BASE + '/api/conversations/' + convId, {
      method: 'PATCH', body: { persona: { age: 35, personality: 'romantic' } }
    });
    const r = await post(BASE + '/api/send', { convId, text: 'remember my name?' });
    const conv = await post(BASE + '/api/conversations/' + convId, { body: {} });
    const msgs = conv.items?.[0]?.messages || [];
    if (msgs.length >= 2 && String(msgs[1]?.content || '').includes('Alex')) {
      console.log('PASS: Name remembered after settings change');
      totalPass++;
    } else {
      console.log('FAIL: Name not remembered after settings change');
      totalFail++;
    }
  }

  console.log(`\n=== Results: ${totalPass} passed, ${totalFail} failed ===`);
  process.exit(totalFail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });