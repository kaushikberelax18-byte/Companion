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

async function test() {
  // Create conversation with exact settings from bug report
  const r = await post('/api/conversations', {
    persona: {
      age: 55,
      personality: 'horny',
      secondaryTrait: 'submissive',
      mode: 'open',
      length: 'medium',
      initiative: 'balanced',
      style: 'edgy',
      flirting: 'bold',
      consistency: 'flexible',
      roleplay: 'dialogue',
      creativity: 'grounded'
    }
  });
  console.log('Conv created:', r.conv.id);

  // Test provocative message
  const resp = await post('/api/send', { convId: r.conv.id, text: 'I want to tie you up and use you all night' });
  console.log('REPLY 1:', resp.reply);
  console.log('---');

  // Another test
  const resp2 = await post('/api/send', { convId: r.conv.id, text: "You are such a good girl, aren't you?" });
  console.log('REPLY 2:', resp2.reply);
  console.log('---');

  // More test
  const resp3 = await post('/api/send', { convId: r.conv.id, text: 'Tell me what you want' });
  console.log('REPLY 3:', resp3.reply);
  console.log('---');

  // Test with more explicit content
  const resp4 = await post('/api/send', { convId: r.conv.id, text: 'Get on your knees' });
  console.log('REPLY 4:', resp4.reply);
}

test().catch(console.error);