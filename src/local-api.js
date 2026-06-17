// Local Automation API (B19). Plain Node http server on 127.0.0.1 — no extra deps.
// Lets external tools (Selenium/Puppeteer/Playwright via your own glue) start/stop/list
// profiles and obtain the CDP endpoint to connect to the already-spoofed browser.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadOrCreateToken(tokenPath) {
  try {
    if (fs.existsSync(tokenPath)) {
      const t = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
      if (t && t.token) return t.token;
    }
  } catch (e) {}
  const token = crypto.randomBytes(24).toString('hex');
  try { fs.writeFileSync(tokenPath, JSON.stringify({ token }, null, 2)); } catch (e) {}
  return token;
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
  });
}

// ctx: { tokenPath, port=35000, loadProfiles(), launchProfileCore(profile), stopProfileCore(id), getRunningList() }
function startLocalApi(ctx) {
  const port = ctx.port || 35000;
  const token = loadOrCreateToken(ctx.tokenPath);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const parts = url.pathname.split('/').filter(Boolean); // ['v1','profiles',':id','start']

    if (url.pathname === '/v1/health') return send(res, 200, { ok: true, name: 'Aether Local API', version: '1.0' });

    // Auth (all except health)
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${token}`) return send(res, 401, { ok: false, error: 'Unauthorized (set Authorization: Bearer <token>)' });

    try {
      if (parts[0] === 'v1' && parts[1] === 'profiles') {
        // GET /v1/profiles
        if (parts.length === 2 && req.method === 'GET') {
          return send(res, 200, { ok: true, profiles: ctx.loadProfiles() });
        }
        // /v1/profiles/:id/(start|stop|status)
        const id = parts[2];
        const action = parts[3];
        if (id && action === 'start' && req.method === 'POST') {
          const profiles = ctx.loadProfiles();
          const profile = profiles.find(p => p.id === id);
          if (!profile) return send(res, 404, { ok: false, error: 'Profile not found' });
          const result = await ctx.launchProfileCore(profile);
          return send(res, result.ok ? 200 : 500, result);
        }
        if (id && action === 'stop' && req.method === 'POST') {
          const r = ctx.stopProfileCore(id);
          return send(res, 200, r);
        }
        if (id && action === 'status' && req.method === 'GET') {
          const running = ctx.getRunningList();
          const r = running.find(x => x.id === id);
          return send(res, 200, { ok: true, status: r ? 'running' : 'idle', info: r || null });
        }
      }
    } catch (e) {
      return send(res, 500, { ok: false, error: e.message });
    }
    send(res, 404, { ok: false, error: 'Unknown endpoint' });
  });

  server.on('error', (e) => {
    console.warn('[Aether] Local API failed to start:', e.message);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`[Aether] Local Automation API on http://127.0.0.1:${port} (token in ${ctx.tokenPath})`);
  });

  return { server, token, port };
}

module.exports = { startLocalApi, loadOrCreateToken };
