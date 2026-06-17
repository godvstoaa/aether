// Proxy utilities: parse, test (IP/geo/timezone), build Chrome arg, auth detection.
// Uses optional agents (https-proxy-agent / socks-proxy-agent). Falls back to TCP-only test if missing.
const https = require('https');
const net = require('net');

let HttpsProxyAgent, SocksProxyAgent;
try { ({ HttpsProxyAgent } = require('https-proxy-agent')); } catch (e) { /* optional */ }
try { ({ SocksProxyAgent } = require('socks-proxy-agent')); } catch (e) { /* optional */ }

// Accepts:
//   scheme://user:pass@host:port
//   scheme://host:port
//   host:port
//   host:port:user:pass
//   user:pass@host:port
function parseProxy(str) {
  if (!str) return null;
  let s = String(str).trim();
  if (!s || s.toLowerCase() === 'local ip' || s === '-') return null;

  let scheme = 'http';
  const schemeMatch = s.match(/^(https?|socks5h?|socks4):\/\//i);
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase();
    s = s.slice(schemeMatch[0].length);
  }

  let username, password;
  if (s.includes('@')) {
    const [cred, rest] = s.split('@');
    const ci = cred.indexOf(':');
    if (ci >= 0) { username = cred.slice(0, ci); password = cred.slice(ci + 1); }
    else username = cred;
    s = rest;
  }

  const parts = s.split(':');
  let host, port;
  if (parts.length === 2) { [host, port] = parts; }
  else if (parts.length === 4) { [host, port, username, password] = parts; } // host:port:user:pass
  else if (parts.length === 1) { host = parts[0]; port = '80'; }
  else { host = parts[0]; port = parts[1]; }

  if (!host || !port) return null;
  const isSocks = scheme.startsWith('socks');
  return {
    scheme: isSocks ? (scheme === 'socks4' ? 'socks4' : 'socks5') : scheme,
    host: host.trim(),
    port: parseInt(port, 10),
    username: username || '',
    password: password || '',
    isSocks,
    hasAuth: !!(username && password)
  };
}

// Chrome --proxy-server value (NO credentials — Chrome ignores them; auth handled by extension)
function proxyToServerArg(p) {
  if (!p) return null;
  const scheme = p.isSocks ? (p.scheme === 'socks4' ? 'socks4' : 'socks5') : p.scheme;
  return `${scheme}://${p.host}:${p.port}`;
}

function buildAgent(p) {
  const auth = p.hasAuth ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password)}@` : '';
  if (p.isSocks && SocksProxyAgent) {
    return new SocksProxyAgent(`socks5://${auth}${p.host}:${p.port}`);
  }
  if (!p.isSocks && HttpsProxyAgent) {
    return new HttpsProxyAgent(`http://${auth}${p.host}:${p.port}`);
  }
  return null;
}

// Test proxy: returns { alive, ip, country, city, timezone, ping, error }
function testProxy(str, timeoutMs = 12000) {
  const p = parseProxy(str);
  if (!p) return Promise.resolve({ alive: false, error: 'Proxy không hợp lệ' });

  const agent = buildAgent(p);
  if (!agent) {
    // No agent lib → TCP liveness only
    return tcpPing(p, timeoutMs).then(r => ({ ...r, note: 'Chỉ kiểm tra kết nối (thiếu thư viện proxy-agent để lấy IP/geo)' }));
  }

  return new Promise((resolve) => {
    const start = Date.now();
    const req = https.get('https://ipwho.is/', { agent, timeout: timeoutMs }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j && j.success !== false && j.ip) {
            resolve({
              alive: true,
              ip: j.ip,
              country: j.country,
              countryCode: j.country_code,
              city: j.city,
              timezone: j.timezone && (j.timezone.id || j.timezone),
              ping: Date.now() - start
            });
          } else {
            resolve({ alive: false, error: 'Proxy phản hồi nhưng không lấy được IP' });
          }
        } catch (e) {
          resolve({ alive: false, error: 'Phản hồi không hợp lệ từ dịch vụ geo' });
        }
      });
    });
    req.on('error', e => resolve({ alive: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ alive: false, error: 'Timeout' }); });
  });
}

function tcpPing(p, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = net.connect({ host: p.host, port: p.port });
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => { const ping = Date.now() - start; sock.destroy(); resolve({ alive: true, ping }); });
    sock.on('error', e => resolve({ alive: false, error: e.message }));
    sock.on('timeout', () => { sock.destroy(); resolve({ alive: false, error: 'Timeout' }); });
  });
}

// Map IANA timezone → reasonable locale (best-effort, extend as needed)
const TZ_LANG = {
  'Asia/Ho_Chi_Minh': 'vi-VN', 'Asia/Bangkok': 'th-TH', 'Asia/Tokyo': 'ja-JP',
  'Asia/Seoul': 'ko-KR', 'Asia/Shanghai': 'zh-CN', 'Asia/Singapore': 'en-SG',
  'Asia/Jakarta': 'id-ID', 'Asia/Manila': 'en-PH', 'Asia/Kolkata': 'en-IN',
  'America/New_York': 'en-US', 'America/Chicago': 'en-US', 'America/Los_Angeles': 'en-US',
  'America/Sao_Paulo': 'pt-BR', 'Europe/London': 'en-GB', 'Europe/Paris': 'fr-FR',
  'Europe/Berlin': 'de-DE', 'Europe/Madrid': 'es-ES', 'Europe/Moscow': 'ru-RU',
  'Australia/Sydney': 'en-AU'
};
function tzToLang(tz) { return TZ_LANG[tz] || 'en-US'; }

module.exports = { parseProxy, proxyToServerArg, testProxy, tzToLang };
