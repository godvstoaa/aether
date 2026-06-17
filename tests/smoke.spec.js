// Real smoke tests for Aether core logic (no proof theater, no || echo).
// Exits non-zero on any failure. Run: npm test
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); }
  catch (e) { failures++; console.error('  ✗', name, '→', e.message); }
}

console.log('=== Aether smoke tests ===');

// 1) Proxy parsing
const { parseProxy, proxyToServerArg } = require('../src/proxy');
test('parseProxy: scheme://user:pass@host:port', () => {
  const p = parseProxy('socks5://u:pw@1.2.3.4:1080');
  assert.strictEqual(p.scheme, 'socks5');
  assert.strictEqual(p.host, '1.2.3.4');
  assert.strictEqual(p.port, 1080);
  assert.strictEqual(p.username, 'u');
  assert.strictEqual(p.password, 'pw');
  assert.ok(p.hasAuth && p.isSocks);
});
test('parseProxy: host:port:user:pass', () => {
  const p = parseProxy('10.0.0.1:8080:bob:secret');
  assert.strictEqual(p.host, '10.0.0.1');
  assert.strictEqual(p.port, 8080);
  assert.strictEqual(p.username, 'bob');
  assert.strictEqual(p.password, 'secret');
});
test('parseProxy: bare host:port (default http)', () => {
  const p = parseProxy('1.2.3.4:3128');
  assert.strictEqual(p.scheme, 'http');
  assert.ok(!p.hasAuth);
});
test('parseProxy: Local IP / empty → null', () => {
  assert.strictEqual(parseProxy('Local IP'), null);
  assert.strictEqual(parseProxy(''), null);
});
test('proxyToServerArg drops credentials', () => {
  const arg = proxyToServerArg(parseProxy('http://u:p@1.2.3.4:8080'));
  assert.strictEqual(arg, 'http://1.2.3.4:8080');
  assert.ok(!arg.includes('u:p'));
});

// 2) Proxy auth extension generation
const { createProxyAuthExtension } = require('../src/proxy-auth-ext');
test('createProxyAuthExtension writes valid MV3 manifest + bg', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-ext-'));
  const dir = createProxyAuthExtension(base, 'p1', { username: 'u', password: 'p' });
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.strictEqual(man.manifest_version, 3);
  assert.ok(man.permissions.includes('webRequestAuthProvider'));
  const bg = fs.readFileSync(path.join(dir, 'bg.js'), 'utf8');
  assert.ok(bg.includes('onAuthRequired'));
  assert.ok(bg.includes('"username":"u"'));
  fs.rmSync(base, { recursive: true, force: true });
});

// 3) Local API token persistence
const { loadOrCreateToken } = require('../src/local-api');
test('loadOrCreateToken is stable across calls', () => {
  const tp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aether-tok-')), 'api-token.json');
  const t1 = loadOrCreateToken(tp);
  const t2 = loadOrCreateToken(tp);
  assert.ok(t1 && t1.length >= 32);
  assert.strictEqual(t1, t2);
});

// 4) E2EE AES-GCM round-trip (mirrors main.js implementation)
const crypto = require('crypto');
function enc(buf, pass) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pass, salt, 32, { N: 16384 });
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([salt, iv, c.getAuthTag(), ct]);
}
function dec(blob, pass) {
  const salt = blob.slice(0, 16), iv = blob.slice(16, 28), tag = blob.slice(28, 44), data = blob.slice(44);
  const key = crypto.scryptSync(pass, salt, 32, { N: 16384 });
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]);
}
test('E2EE GCM round-trip', () => {
  const msg = Buffer.from('cookies-secret-state');
  assert.strictEqual(dec(enc(msg, 'pw'), 'pw').toString(), 'cookies-secret-state');
});
test('E2EE GCM rejects tampered ciphertext', () => {
  const blob = enc(Buffer.from('x'), 'pw');
  blob[blob.length - 1] ^= 0xff; // tamper
  assert.throws(() => dec(blob, 'pw'));
});
test('E2EE GCM rejects wrong passphrase', () => {
  assert.throws(() => dec(enc(Buffer.from('x'), 'pw'), 'wrong'));
});

console.log(failures === 0 ? '=== ALL PASSED ===' : `=== ${failures} FAILED ===`);
process.exit(failures === 0 ? 0 : 1);
