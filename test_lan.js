'use strict';
// Live tests: LAN access, character behavior, and config persistence
const http = require('http');

const BASE = 'http://127.0.0.1:8787';

function get(path, callback) {
  const u = new URL(path, BASE);
  http.get({
    hostname: u.hostname, port: u.port, path: u.pathname,
    headers: { 'accept': 'application/json' }
  }, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => callback(null, res.statusCode, JSON.parse(d)));
  }).on('error', callback);
}

function post(path, body, callback) {
  const u = new URL(path, BASE);
  const data = JSON.stringify(body);
  const req = http.request({
    hostname: u.hostname, port: u.port, path: u.pathname,
    method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
  }, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => callback(null, res.statusCode, JSON.parse(d)));
  });
  req.on('error', callback);
  req.write(data);
  req.end();
}

function getConvId(callback) {
  get('/api/conversations', (err, status, data) => {
    if (err) return callback(err);
    callback(null, data.items ? data.items[0].id : null);
  });
}

let totalPass = 0, totalFail = 0;

async function main() {
  console.log('=== Test 1: Server responds with config including bindHost and allowLAN ===');
  {
    const r = await post(BASE + '/api/config', {});
    if (r.config && r.config.bindHost !== undefined && r.config.allowLAN !== undefined) {
      console.log('PASS: Config includes bindHost and allowLAN');
      totalPass++;
    } else {
      console.log('FAIL: Missing bindHost or allowLAN in config');
      totalFail++;
    }
  }

  console.log('\n=== Test 2: Settings save and persist bindHost/allowLAN ===');
  {
    const convId = (await new Promise((resolve, reject) => {
      getConvId((err, id) => err ? reject(err) : resolve(id));
    })) || '';
    if (!convId) throw new Error('no conv');
    await post(BASE + '/api/conversations/' + convId, {
      method: 'PATCH',
      body: { persona: { age: 25, personality: 'playful' } }
    });
    await post(BASE + '/api/config', {
      body: { bindHost: '0.0.0.0', allowLAN: true }
    });
    const r = await get('/api/config', (err, status, data) => {
      if (err) throw err;
      return data;
    });
    if (r.config && r.config.bindHost === '0.0.0.0' && r.config.allowLAN === true) {
      console.log('PASS: bindHost and allowLAN persisted through settings');
      totalPass++;
    } else {
      console.log('FAIL: Settings not persisted, got:', JSON.stringify(r.config));
      totalFail++;
    }
  }

  console.log('\n=== Test 3: LAN access guard rejects 0.0.0.0 without allowLAN ===');
  {
    // First reset to loopback
    await post(BASE + '/api/config', { body: { bindHost: '127.0.0.1', allowLAN: false } });
    const r = await post(BASE + '/api/config', {
      body: { bindHost: '0.0.0.0' }  // should be rejected since allowLAN is not set
    });
    if (r.error && r.error.kind === 'config') {
      console.log('PASS: Config rejected 0.0.0.0 without allowLAN');
      totalPass++;
    } else {
      console.log('FAIL: Config should have rejected 0.0.0.0 without allowLAN, got:', JSON.stringify(r));
      totalFail++;
    }
  }

  console.log('\n=== Test 4: Personality change persistence ===');
  {
    const convId = (await new Promise((resolve, reject) => {
      getConvId((err, id) => err ? reject(err) : resolve(id));
    })) || '';
    if (!convId) throw new Error('no conv');
    // Set a specific personality
    await post(BASE + '/api/conversations/' + convId, {
      method: 'PATCH',
      body: { persona: { age: 30, personality: 'confident', mode: 'adult', length: 'short', initiative: 'proactive', style: 'edgy', creativity: 'spontaneous' } }
    });
    // Read back and verify
    const conv = await get('/api/conversations/' + convId, (err, status, data) => {
      if (err) throw err;
      return data;
    });
    const p = conv.conv?.persona || {};
    const persOk = p.personality === 'confident';
    const ageOk = p.age === 30;
    if (persOk && ageOk) {
      console.log('PASS: Personality persisted after save/load');
      totalPass++;
    } else {
      console.log('FAIL: Personality not persisted, persona:', JSON.stringify(p));
      totalFail++;
    }
  }

  console.log('\n=== Test 5: All personality presets are selectable ===');
  {
    const presets = ['playful', 'sweet', 'romantic', 'flirty', 'sarcastic', 'confident',
      'dominant', 'submissive', 'naughty', 'horny', 'bold', 'adventurous',
      'teasing', 'sensual', 'dirty', 'wild', 'threesome', 'exhibitionist',
      'passionate', 'witty', 'shybold', 'assertive', 'mischievous', 'custom'];

    for (const p of presets) {
      const convId = (await new Promise((resolve, reject) => {
        getConvId((err, id) => err ? reject(err) : resolve(id));
      })) || '';
      if (!convId) { console.log('SKIP: no conv id'); totalFail++; continue; }
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

  console.log('\n=== Test 5: All flirting intensity levels available ===');
  {
    const r = await get('/api/options', (err, status, data) => {
      if (err) throw err;
      return data;
    });
    const flirtingKeys = Object.keys(r.flirting || {});
    const hasAll = flirtingKeys.includes('subtle') && flirtingKeys.includes('playful') &&
      flirtingKeys.includes('bold') && flirtingKeys.includes('intense');
    if (hasAll) {
      console.log('PASS: All flirting intensity levels available');
      totalPass++;
    } else {
      console.log('FAIL: Missing flirting levels, got:', flirtingKeys);
      totalFail++;
    }
  }

  console.log('\n=== Test 6: All consistency levels available ===');
  {
    const r = await get('/api/options', (err, status, data) => {
      if (err) throw err;
      return data;
    });
    const consistencyKeys = Object.keys(r.consistency || {});
    const hasAll = consistencyKeys.includes('flexible') && consistencyKeys.includes('strong');
    if (hasAll) {
      console.log('PASS: All consistency levels available');
      totalPass++;
    } else {
      console.log('FAIL: Missing consistency levels, got:', consistencyKeys);
      totalFail++;
    }
  }

  console.log('\n=== Test 7: All language intensity levels available ===');
  {
    const r = await get('/api/options', (err, status, data) => {
      if (err) throw err;
      return data;
    });
    const styleKeys = Object.keys(r.styles || {});
    const hasAll = styleKeys.includes('clean') && styleKeys.includes('edgy') &&
      styleKeys.includes('profane') && styleKeys.includes('direct');
    if (hasAll) {
      console.log('PASS: All language intensity levels available');
      totalPass++;
    } else {
      console.log('FAIL: Missing language levels, got:', styleKeys);
      totalFail++;
    }
  }

  console.log('\n=== Test 8: All mode options available ===');
  {
    const r = await get('/api/options', (err, status, data) => {
      if (err) throw err;
      return data;
    });
    const modeKeys = Object.keys(r.modes || {});
    const hasAll = modeKeys.every(k => k === 'everyday' || k === 'flirtation' || k === 'romance' || k === 'adult' || k === 'roleplay' || k === 'open');
    if (hasAll && modeKeys.length >= 5) {
      console.log('PASS: All mode options available');
      totalPass++;
    } else {
      console.log('FAIL: Missing mode options, got:', modeKeys);
      totalFail++;
    }
  }

  console.log('\n=== Test 9: All length options available ===');
  {
    const r = await get('/api/options', (err, status, data) => {
      if (err) throw err;
      return data;
    });
    const lengthKeys = Object.keys(r.lengths || {});
    const hasAll = lengthKeys.includes('short') && lengthKeys.includes('medium') && lengthKeys.includes('detailed');
    if (hasAll) {
      console.log('PASS: All length options available');
      totalPass++;
    } else {
      console.log('FAIL: Missing length options, got:', lengthKeys);
      totalFail++;
    }
  }

  console.log('\n=== Test 10: All initiative options available ===');
  {
    const r = await get('/api/options', (err, status, data) => {
      if (err) throw err;
      return data;
    });
    const initiativeKeys = Object.keys(r.initiatives || {});
    const hasAll = initiativeKeys.includes('reactive') && initiativeKeys.includes('balanced') && initiativeKeys.includes('proactive');
    if (hasAll) {
      console.log('PASS: All initiative options available');
      totalPass++;
    } else {
      console.log('FAIL: Missing initiative options, got:', initiativeKeys);
      totalFail++;
    }
  }

  console.log('\n=== Test 11: All roleplay narration styles available ===');
  {
    const r = await get('/api/options', (err, status, data) => {
      if (err) throw err;
      return data;
    });
    const roleplayKeys = Object.keys(r.roleplay || {});
    const hasAll = roleplayKeys.includes('dialogue') && roleplayKeys.includes('descriptive');
    if (hasAll) {
      console.log('PASS: All roleplay narration styles available');
      totalPass++;
    } else {
      console.log('FAIL: Missing roleplay styles, got:', roleplayKeys);
      totalFail++;
    }
  }

  console.log(`\n=== Results: ${totalPass} passed, ${totalFail} failed ===`);
  process.exit(totalFail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });