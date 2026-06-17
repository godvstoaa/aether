const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const { formatDistanceToNow } = require('date-fns');
const { parseProxy, proxyToServerArg, testProxy, tzToLang } = require('./src/proxy');
const { createProxyAuthExtension } = require('./src/proxy-auth-ext');
const { startLocalApi } = require('./src/local-api');

// Track running browsers: profileId -> { child, debugPort, startedAt }
const running = new Map();

let mainWindow;
const USER_DATA = app.getPath('userData');
const DB_FILE = path.join(USER_DATA, 'aether.db');
const PROFILES_DIR = path.join(USER_DATA, 'profiles');
const FINGERPRINT_DATA_DIR = path.join(__dirname, 'fingerprint-data', 'data-browser-profile');
const API_TOKEN_PATH = path.join(USER_DATA, 'api-token.json');
let apiToken = '';

fs.mkdirSync(PROFILES_DIR, { recursive: true });

// Upgrade: Use better-sqlite3 for professional persistence (rich fields) - singleton per B9
let db;
function initDb() {
  if (db) return db;
  db = new Database(DB_FILE);
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT DEFAULT 'local',
      group_name TEXT DEFAULT '',
      platform TEXT DEFAULT 'Chrome',
      note TEXT DEFAULT 'Enter note',
      proxy TEXT DEFAULT 'Local IP',
      startup_url TEXT DEFAULT '',
      fingerprint_preset TEXT DEFAULT 'genlogin-chrome-real',
      resolution TEXT DEFAULT '1920x1080',
      timezone TEXT DEFAULT 'Asia/Ho_Chi_Minh',
      lang TEXT DEFAULT 'vi-VN',
      hardware_concurrency INTEGER DEFAULT 8,
      device_memory INTEGER DEFAULT 8,
      status TEXT DEFAULT 'Ready',
      proxy_status TEXT DEFAULT '',
      last_opened TEXT,
      updated TEXT,
      created TEXT,
      version INTEGER DEFAULT 0,
      tags TEXT DEFAULT '',
      has_blob INTEGER DEFAULT 0
    );
  `);
  db.exec('PRAGMA journal_mode = WAL;');
  // Idempotent migrations for B8
  try { db.exec('ALTER TABLE profiles ADD COLUMN version INTEGER DEFAULT 0'); } catch(e) {}
  try { db.exec('ALTER TABLE profiles ADD COLUMN tags TEXT DEFAULT \'\''); } catch(e) {}
  try { db.exec('ALTER TABLE profiles ADD COLUMN has_blob INTEGER DEFAULT 0'); } catch(e) {}
  return db;
}

function getDefaultProfile() {
  const now = new Date().toISOString();
  return {
    id: '',
    name: '',
    location: 'local',
    group_name: '',
    platform: 'Chrome',
    note: 'Enter note',
    proxy: 'Local IP',
    startup_url: '',
    fingerprint_preset: 'genlogin-chrome-real',
    resolution: '1920x1080',
    timezone: 'Asia/Ho_Chi_Minh',
    lang: 'vi-VN',
    hardware_concurrency: 8,
    device_memory: 8,
    status: 'Ready',
    proxy_status: '',
    last_opened: null,
    updated: now,
    created: now,
    version: 0,
    tags: '',
    has_blob: 0
  };
}

function loadProfiles() {
  initDb(); // singleton, no re-open
  const rows = db.prepare('SELECT * FROM profiles ORDER BY updated DESC').all();
  if (rows.length === 0) {
    const seed = [
      {id:'p1',name:'x',location:'local',group_name:'Vietnam Ads',platform:'Chrome',note:'High value',proxy:'Local IP',startup_url:'https://adsmanager.facebook.com',fingerprint_preset:'genlogin-chrome-real',resolution:'1920x1080',timezone:'Asia/Ho_Chi_Minh',lang:'vi-VN',hardware_concurrency:8,device_memory:16,status:'Ready',proxy_status:'OK',last_opened:'2026-06-07',updated: getDefaultProfile().updated, created: getDefaultProfile().created, version:0, tags:'', has_blob:0},
      {id:'p2',name:'ADs gg',location:'local',group_name:'Google',platform:'Chrome',note:'Enter note',proxy:'Local IP',startup_url:'https://ipinfo.io/json',fingerprint_preset:'genlogin-chrome-real',resolution:'1366x768',timezone:'America/New_York',lang:'en-US',hardware_concurrency:4,device_memory:8,status:'Ready',proxy_status:'',last_opened:'2026-04-10',updated: getDefaultProfile().updated, created: getDefaultProfile().created, version:0, tags:'', has_blob:0},
      {id:'p3',name:'gg3',location:'local',group_name:'Tiktok',platform:'Chrome',note:'Warmup',proxy:'socks5://demo:1080',startup_url:'https://www.tiktok.com',fingerprint_preset:'genlogin-chrome-real',resolution:'1440x900',timezone:'Europe/London',lang:'en-GB',hardware_concurrency:6,device_memory:8,status:'Ready',proxy_status:'Tested OK',last_opened:'2026-05-10',updated: getDefaultProfile().updated, created: getDefaultProfile().created, version:0, tags:'', has_blob:0},
      {id:'p9',name:'fb',location:'local',group_name:'Vietnam Ads',platform:'Chrome',note:'Enter note',proxy:'Local IP',startup_url:'https://ipinfo.io/json',fingerprint_preset:'genlogin-chrome-real',resolution:'1920x1080',timezone:'Asia/Ho_Chi_Minh',lang:'vi-VN',hardware_concurrency:8,device_memory:16,status:'Ready',proxy_status:'',last_opened:'2025-10-10',updated: getDefaultProfile().updated, created: getDefaultProfile().created, version:0, tags:'', has_blob:0}
    ];
    const stmt = db.prepare(`INSERT INTO profiles (id,name,location,group_name,platform,note,proxy,startup_url,fingerprint_preset,resolution,timezone,lang,hardware_concurrency,device_memory,status,proxy_status,last_opened,updated,created,version,tags,has_blob) VALUES (@id,@name,@location,@group_name,@platform,@note,@proxy,@startup_url,@fingerprint_preset,@resolution,@timezone,@lang,@hardware_concurrency,@device_memory,@status,@proxy_status,@last_opened,@updated,@created,@version,@tags,@has_blob)`);
    seed.forEach(s => stmt.run(s));
    return seed;
  }
  return rows;
}

function saveProfile(profile) {
  initDb();
  const full = { ...getDefaultProfile(), ...profile };
  const stmt = db.prepare(`INSERT OR REPLACE INTO profiles (id,name,location,group_name,platform,note,proxy,startup_url,fingerprint_preset,resolution,timezone,lang,hardware_concurrency,device_memory,status,proxy_status,last_opened,updated,created,version,tags,has_blob) VALUES (@id,@name,@location,@group_name,@platform,@note,@proxy,@startup_url,@fingerprint_preset,@resolution,@timezone,@lang,@hardware_concurrency,@device_memory,@status,@proxy_status,@last_opened,@updated,@created,@version,@tags,@has_blob)`);
  stmt.run(full);
}

function deleteProfile(id) {
  initDb();
  db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
}

function findChrome() {
  // Prefer research anti-detect engine (fp-chrome.exe + gen_login_*.json) from Genlogin-1.5 data (B1/B2)
  const fpChrome = path.join(__dirname, 'fingerprint-data', 'build', 'fp-chrome.exe');
  if (fs.existsSync(fpChrome)) return fpChrome;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env['LOCALAPPDATA'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(process.env['LOCALAPPDATA'] || '', 'Microsoft\\Edge\\Application\\msedge.exe')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const FINGERPRINT_TEMPLATE_DIR = path.join(__dirname, 'fingerprint-data', 'Profile-Example', 'example-chronium');

function buildUA(profile) {
  // N1 fix: Never leak custom token in UA (instant bot detection). Must be standard Chrome UA.
  // Version should eventually come from engine or profile, keep conservative for now.
  const plat = (profile.platform || '').toLowerCase().includes('mac') ? 'Macintosh; Intel Mac OS X 10_15_7' : 'Windows NT 10.0; Win64; x64';
  const ver = '126.0.0.0';
  return `Mozilla/5.0 (${plat}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`;
}

function writeFingerprintConfigs(profileDir, profile) {
  // N3 fix: Always start from the **exact original template** (preserve full schema, keys, structure).
  // Only mutate values in-place. This is much safer than guessing new object shapes.
  // fp-chrome.exe from Genlogin-1.5 expects the precise structure + certain keys from Profile-Example.
  if (!fs.existsSync(FINGERPRINT_TEMPLATE_DIR)) {
    console.warn('[Aether] No fingerprint templates dir');
    return false;
  }
  const files = fs.readdirSync(FINGERPRINT_TEMPLATE_DIR).filter(f => f.startsWith('gen_login_'));
  let written = 0;
  const seed = (profile.id || 'p') + (profile.name || '');

  files.forEach(f => {
    const src = path.join(FINGERPRINT_TEMPLATE_DIR, f);
    const dest = path.join(profileDir, f);
    try {
      let raw = fs.readFileSync(src, 'utf8');
      let j;
      try { j = JSON.parse(raw); } catch { j = null; }

      if (j && typeof j === 'object') {
        if (f.includes('resolution')) {
          const [w, h] = String(profile.resolution || '1920x1080').split('x').map(n => parseInt(n,10) || 1080);
          j.width = String(w);
          j.height = String(h);
        } else if (f.includes('hardware-concurrency')) {
          j.hardware_concurrency = parseInt(profile.hardware_concurrency || 8, 10);
        } else if (f.includes('webrtc')) {
          const b = (seed.charCodeAt(0) % 200) + 10;
          j.ip_adr = `198.51.100.${b}`;
          if (!Array.isArray(j.fake_ips)) j.fake_ips = [];
        } else if (f.includes('useragent')) {
          j = buildUA(profile); // useragent-plugin in example is often null or simple string → replace is acceptable
        } else if ((f.includes('webgl') || f.includes('canvas')) && j.lst_buffer_random && Array.isArray(j.lst_buffer_random)) {
          const h = crypto.createHash('sha256').update(seed).digest();
          j.lst_buffer_random = j.lst_buffer_random.map((v, i) => ((h[i % h.length] / 255) * 0.8 + 0.1));
        }
        raw = JSON.stringify(j, null, 0); // keep compact like originals
      } else if (f.includes('useragent')) {
        raw = JSON.stringify(buildUA(profile));
      }

      fs.writeFileSync(dest, raw);
      written++;
    } catch (e) {
      console.warn('[Aether] fp config copy warn', f, e.message);
    }
  });

  fs.mkdirSync(path.join(profileDir, 'Default'), { recursive: true });
  console.log('[Aether] FingerprintEngine: wrote', written, 'gen_login_*.json (exact template + value patch, seeded by', profile.id, ') to', profileDir);
  return true;
}

function formatRelativeVN(isoOrStr) {
  if (!isoOrStr) return '-';
  // Very simple relative for demo (matches screenshot style)
  try {
    const d = new Date(isoOrStr);
    const diff = (Date.now() - d.getTime()) / (1000 * 3600 * 24);
    if (diff < 1) return 'hôm nay';
    if (diff < 7) return Math.floor(diff) + ' ngày trước';
    if (diff < 60) return Math.floor(diff / 30) + ' tháng trước';
    return Math.floor(diff / 365) + ' năm trước';
  } catch { return isoOrStr; }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 860,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'Aether — Anti-Detect Profile Manager'
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Devtools optional: mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  initDb();
  createWindow();
  // Start local automation API (B19)
  try {
    const api = startLocalApi({
      tokenPath: API_TOKEN_PATH,
      port: 35000,
      loadProfiles,
      launchProfileCore,
      stopProfileCore,
      getRunningList
    });
    apiToken = api.token;
  } catch (e) { console.warn('[Aether] Local API start failed:', e.message); }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => {
  // Best-effort: stop all running browsers we spawned
  for (const id of Array.from(running.keys())) {
    try { stopProfileCore(id); } catch (e) {}
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// IPC
ipcMain.handle('get-profiles', () => {
  const profiles = loadProfiles();
  // Add relative display (date-fns ready)
  return profiles.map(p => ({ 
    ...p, 
    lastOpenedRel: p.last_opened ? formatDistanceToNow(new Date(p.last_opened), { addSuffix: true }) : '-',
    updatedRel: p.updated ? formatDistanceToNow(new Date(p.updated), { addSuffix: true }) : '-'
  }));
});

// === SYNC / CLOUD (self-hosted server for cross-machine + shared account) ===
// This is the critical piece for "dùng chung tài khoản" across machines.
// Architecture (deep thinking):
// - Local-first is still king (no vendor lock, works offline).
// - Optional self-hosted sync server (you control it).
// - "Cloud" profiles = synced via server (metadata always, full binary on-demand or via external tool).
// - #1 safety rule for anti-detect + shared account: CHECKOUT/LOCK before launch.
//   If a cloud profile is already checked out on another machine, we BLOCK or force with heavy warning.
//   Reason: Same fingerprint + divergent cookies on two machines at once = instant detection + ban on ad platforms.
// - E2EE: Client encrypts blobs with user master key before upload (server never sees real cookies).
// - For large profile dirs: We recommend hybrid (sync metadata here + use Syncthing/Nextcloud for the actual profile folders).
// - "Chung tài khoản": Server has users + teams. Profiles can be shared to teams with roles.

let syncConfig = { serverUrl: '', token: '', machineId: '' };

function loadSyncConfig() {
  try {
    const cfgPath = path.join(USER_DATA, 'sync-config.json');
    if (fs.existsSync(cfgPath)) {
      syncConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    }
  } catch (e) {}
  if (!syncConfig.machineId) {
    syncConfig.machineId = 'm-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    saveSyncConfig();
  }
}

function saveSyncConfig() {
  try {
    fs.writeFileSync(path.join(USER_DATA, 'sync-config.json'), JSON.stringify(syncConfig, null, 2));
  } catch (e) {}
}

ipcMain.handle('get-sync-config', () => {
  loadSyncConfig();
  return { ...syncConfig, hasServer: !!syncConfig.serverUrl };
});

ipcMain.handle('save-sync-config', (_e, cfg) => {
  syncConfig = { ...syncConfig, ...cfg };
  saveSyncConfig();
  return true;
});

// Basic authenticated fetch to the sync server
async function syncFetch(path, options = {}) {
  loadSyncConfig();
  if (!syncConfig.serverUrl || !syncConfig.token) {
    throw new Error('Sync server not configured. Go to settings → Sync / Account.');
  }
  const url = syncConfig.serverUrl.replace(/\/$/, '') + path;
  const headers = {
    'Authorization': 'Bearer ' + syncConfig.token,
    'Content-Type': 'application/json',
    'x-machine-id': syncConfig.machineId,
    ...(options.headers || {})
  };
  const res = await fetch(url, {
    ...options,
    headers
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Sync server error ${res.status}: ${text}`);
  }
  return res.json();
}

ipcMain.handle('sync-login', async (_e, { serverUrl, email, password }) => {
  const url = serverUrl.replace(/\/$/, '') + '/login';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) throw new Error('Login failed: ' + await res.text());
  const data = await res.json();
  syncConfig.serverUrl = serverUrl;
  syncConfig.token = data.token;
  if (!syncConfig.machineId) syncConfig.machineId = 'm-' + Date.now().toString(36);
  saveSyncConfig();
  return { ok: true, user: data.user };
});

ipcMain.handle('sync-pull', async () => {
  const data = await syncFetch('/sync/pull');
  const localMap = new Map(loadProfiles().map(p => [p.id, p]));
  for (const sp of data.profiles || []) {
    const local = localMap.get(sp.id);
    const serverVersion = sp.version || 0;
    const localVersion = local ? (local.version || 0) : -1;
    if (!local || serverVersion > localVersion) {
      // Mapper server (may have created_at etc) to local snake_case + defaults
      const now = new Date().toISOString();
      const mapped = {
        ...getDefaultProfile(),
        id: sp.id,
        name: sp.name,
        location: 'cloud',
        group_name: sp.group_name || '',
        platform: sp.platform || 'Chrome',
        note: sp.note || '',
        proxy: sp.proxy || 'Local IP',
        startup_url: sp.startup_url || '',
        fingerprint_preset: sp.fingerprint_preset || 'genlogin-chrome-real',
        resolution: sp.resolution || '1920x1080',
        timezone: sp.timezone || 'Asia/Ho_Chi_Minh',
        lang: sp.lang || 'vi-VN',
        hardware_concurrency: sp.hardware_concurrency || 8,
        device_memory: sp.device_memory || 8,
        status: sp.status || 'Ready',
        proxy_status: sp.proxy_status || '',
        last_opened: sp.last_opened || sp.lastOpened || null,
        updated: sp.updated || sp.updated_at || now,
        created: sp.created || sp.created_at || now,
        version: serverVersion,
        tags: sp.tags || '',
        has_blob: sp.has_blob || 0
      };
      saveProfile(mapped);
    }
  }
  // Update checkout state (simple)
  return { ok: true, serverTime: data.server_time, checkoutCount: (data.checkouts || []).length };
});

ipcMain.handle('sync-push-profile', async (_e, profile) => {
  const body = { ...profile, location: 'cloud' };
  const result = await syncFetch('/profiles', {
    method: 'POST',
    body: JSON.stringify(body)
  });
  // Update local version
  profile.version = result.version || (profile.version || 0) + 1;
  saveProfile(profile);
  return result;
});

// Checkout before launching a cloud profile (THE safety mechanism)
ipcMain.handle('sync-checkout', async (_e, { profileId, force = false }) => {
  try {
    const res = await syncFetch(`/profiles/${profileId}/checkout`, {
      method: 'POST',
      body: JSON.stringify({ force })
    });
    return { ok: true, ...res };
  } catch (err) {
    // If 409 (already checked out), surface the info to UI for warning
    if (err.message.includes('409')) {
      return { ok: false, conflict: true, message: err.message };
    }
    throw err;
  }
});

ipcMain.handle('sync-checkin', async (_e, { profileId }) => {
  await syncFetch(`/profiles/${profileId}/checkin`, { method: 'POST' });
  return { ok: true };
});

// === Full E2EE Profile Blob Sync (for cross-machine "dùng chung tài khoản") ===
// Per the detailed PLAN: E2E encryption (client only), checkout lock for safety.
const archiver = require('archiver');
const unzipper = require('unzipper');
const crypto = require('crypto');
const { createWriteStream, createReadStream } = require('fs');
const FormData = require('form-data');

async function zipDirectory(source, outPath) {
  const output = createWriteStream(outPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.directory(source, false);
  archive.pipe(output);
  await archive.finalize();
  return new Promise((res, rej) => {
    output.on('close', res);
    output.on('error', rej);
  });
}

async function extractZip(zipPath, targetDir) {
  await createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: targetDir }))
    .promise();
}

function deriveKey(passphrase, salt) {
  // Increased cost; salt is Buffer (16 random bytes per profile/blob)
  return crypto.scryptSync(passphrase, salt, 32, { N: 16384 });
}

function encryptBuffer(buf, passphrase, profileId = '') {
  // AES-256-GCM + per-encryption random salt (B11/B12 fix). Salt embedded in header.
  // Format: [16-byte salt][12-byte iv][16-byte authTag][ciphertext]
  const salt = crypto.randomBytes(16);
  const key = deriveKey(passphrase, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let ct = cipher.update(buf);
  ct = Buffer.concat([ct, cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, ct]);
}

function decryptBuffer(enc, passphrase) {
  if (enc.length < 44) throw new Error('Invalid encrypted blob (too short)');
  const salt = enc.slice(0, 16);
  const iv = enc.slice(16, 28);
  const tag = enc.slice(28, 44);
  const data = enc.slice(44);
  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let dec = decipher.update(data);
  dec = Buffer.concat([dec, decipher.final()]);
  return dec;
}

async function uploadBlob(profileId, buffer) {
  loadSyncConfig();
  const form = new FormData();
  form.append('blob', buffer, { filename: `${profileId}.enc` });
  const url = syncConfig.serverUrl.replace(/\/$/, '') + `/profiles/${profileId}/blob`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...form.getHeaders(), 'Authorization': 'Bearer ' + syncConfig.token, 'x-machine-id': syncConfig.machineId },
    body: form
  });
  if (!res.ok) throw new Error('Blob upload failed: ' + await res.text());
  return res.json();
}

async function downloadBlob(profileId) {
  loadSyncConfig();
  const url = syncConfig.serverUrl.replace(/\/$/, '') + `/profiles/${profileId}/blob`;
  const res = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + syncConfig.token, 'x-machine-id': syncConfig.machineId }
  });
  if (!res.ok) throw new Error('Blob download failed');
  return Buffer.from(await res.arrayBuffer());
}

ipcMain.handle('sync-backup-cloud-profile', async (_e, { profileId, masterPass }) => {
  if (!masterPass) throw new Error('Master passphrase required for E2EE');
  const dir = path.join(PROFILES_DIR, profileId);
  if (!fs.existsSync(dir)) throw new Error('No local profile data');
  const tempZip = path.join(USER_DATA, `aether-tmp-${profileId}.zip`);
  await zipDirectory(dir, tempZip);
  const zipBuf = fs.readFileSync(tempZip);
  fs.unlinkSync(tempZip);
  const enc = encryptBuffer(zipBuf, masterPass);
  await uploadBlob(profileId, enc);
  // Use UPDATE for has_blob per plan B7, avoid empty save
  initDb();
  db.prepare('UPDATE profiles SET has_blob = 1, updated = ? WHERE id = ?').run(new Date().toISOString(), profileId);
  return { ok: true };
});

ipcMain.handle('sync-restore-cloud-profile', async (_e, { profileId, masterPass }) => {
  if (!masterPass) throw new Error('Master passphrase required for E2EE');
  const enc = await downloadBlob(profileId);
  const zipBuf = decryptBuffer(enc, masterPass);
  const tempZip = path.join(USER_DATA, `aether-tmp-dl-${profileId}.zip`);
  fs.writeFileSync(tempZip, zipBuf);
  const target = path.join(PROFILES_DIR, profileId);
  fs.mkdirSync(target, { recursive: true });
  await extractZip(tempZip, target);
  fs.unlinkSync(tempZip);
  initDb();
  db.prepare('UPDATE profiles SET has_blob = 1, updated = ? WHERE id = ?').run(new Date().toISOString(), profileId);
  return { ok: true };
});


ipcMain.handle('save-profile', (_e, profile) => {
  saveProfile(profile);
  return true;
});

ipcMain.handle('save-profiles', (_e, profiles) => {
  profiles.forEach(saveProfile);
  return true;
});

ipcMain.handle('delete-profile', (_e, id) => {
  deleteProfile(id);
  return true;
});

async function launchProfileCore(profile) {
  if (running.has(profile.id)) {
    const r = running.get(profile.id);
    return { ok: false, error: 'Profile đang chạy', alreadyRunning: true, debugPort: `http://127.0.0.1:${r.debugPort}` };
  }

  const chromePath = findChrome();
  if (!chromePath) {
    return { ok: false, error: 'No Chromium found (checked Chrome/Edge + research fp-chrome.exe from Genlogin-1.5 data).' };
  }

  const profileDir = path.join(PROFILES_DIR, profile.id);
  fs.mkdirSync(profileDir, { recursive: true });

  const isFpEngine = !!(chromePath && chromePath.toLowerCase().includes('fp-chrome'));

  // === CRITICAL SAFETY FOR "DÙNG CHUNG TÀI KHOẢN" + MULTI-MACHINE ===
  // Launching the same cloud profile on two machines at once = instant account linking. Lock first.
  if (profile.location === 'cloud' && syncConfig.serverUrl && syncConfig.token) {
    try {
      loadSyncConfig();
      const url = syncConfig.serverUrl.replace(/\/$/, '') + `/profiles/${profile.id}/checkout`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + syncConfig.token, 'Content-Type': 'application/json', 'x-machine-id': syncConfig.machineId },
        body: JSON.stringify({ force: false })
      });
      if (r.status === 409) {
        const body = await r.json().catch(() => ({}));
        return { ok: false, error: 'Profile đang được mở ở máy khác', conflict: true, checkoutInfo: body };
      }
      if (!r.ok) throw new Error(await r.text());
    } catch (err) {
      return { ok: false, error: 'Cloud profile checkout required for shared account safety. Server error: ' + err.message };
    }
  }

  // Write anti-detect configs / fallback inject BEFORE building extension args
  const injectPath = path.join(profileDir, 'aether-inject.js');
  if (isFpEngine) {
    writeFingerprintConfigs(profileDir, profile);
    try { fs.writeFileSync(injectPath, `// Aether fp-engine active for ${profile.id}\n`); } catch (e) {}
  } else {
    try {
      const injectCode = `(function(){
  const orig = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(t,...a){ return orig.apply(this,[t,...a]); };
  Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>${profile.hardware_concurrency || 8}});
  Object.defineProperty(navigator,'deviceMemory',{get:()=>${profile.device_memory || 8}});
})();`;
      fs.writeFileSync(injectPath, injectCode);
    } catch (e) {}
  }

  const debugPort = 9222 + Math.floor(Math.random() * 1000);
  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${debugPort}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    `--lang=${profile.lang || 'vi-VN'}`
  ];

  // N4 fix: only force UA/window-size for system Chrome fallback; fp-engine controls these natively.
  if (!isFpEngine) {
    args.push(`--user-agent=${buildUA(profile)}`);
    args.push(`--window-size=${(profile.resolution || '1920x1080').replace('x', ',')}`);
  }

  // Proxy (B17): pass server without creds; supply credentials via MV3 extension.
  const pInfo = parseProxy(profile.proxy);
  if (pInfo) {
    args.push(`--proxy-server=${proxyToServerArg(pInfo)}`);
    if (pInfo.hasAuth) {
      try {
        const extDir = createProxyAuthExtension(USER_DATA, profile.id, pInfo);
        args.push(`--load-extension=${extDir}`);
      } catch (e) { console.warn('[Aether] proxy auth ext warn', e.message); }
    }
  }

  // URL must be last
  args.push(profile.startup_url || 'https://ipinfo.io/json');

  console.log('[Aether] Launching engine=', isFpEngine ? 'fp-chrome+gen_login' : 'system-fallback', '| proxy=', pInfo ? `${pInfo.host}:${pInfo.port}${pInfo.hasAuth ? ' (auth)' : ''}` : 'none');

  let child;
  try {
    child = spawn(chromePath, args, { detached: true, stdio: 'ignore' });
  } catch (err) {
    return { ok: false, error: String(err) };
  }
  child.unref();

  running.set(profile.id, { child, debugPort, startedAt: Date.now(), pid: child.pid });

  // Persist + mark Running
  const prof = { ...profile, last_opened: new Date().toISOString(), status: 'Running' };
  if (pInfo) prof.proxy_status = prof.proxy_status || 'OK (launched)';
  saveProfile(prof);
  notifyRunningChanged();

  let hbInterval = null;
  if (profile.location === 'cloud' && syncConfig.serverUrl && syncConfig.token) {
    hbInterval = setInterval(() => {
      (async () => {
        try {
          loadSyncConfig();
          await fetch(syncConfig.serverUrl.replace(/\/$/, '') + `/profiles/${profile.id}/heartbeat`, {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + syncConfig.token, 'x-machine-id': syncConfig.machineId }
          });
        } catch (e) {}
      })();
    }, 20000);
  }

  child.on('exit', () => {
    if (hbInterval) clearInterval(hbInterval);
    running.delete(profile.id);
    try { initDb(); db.prepare('UPDATE profiles SET status = ? WHERE id = ?').run('Ready', profile.id); } catch (e) {}
    notifyRunningChanged();
    if (profile.location === 'cloud' && syncConfig.serverUrl && syncConfig.token) {
      (async () => {
        try {
          loadSyncConfig();
          await fetch(syncConfig.serverUrl.replace(/\/$/, '') + `/profiles/${profile.id}/checkin`, {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + syncConfig.token, 'x-machine-id': syncConfig.machineId }
          });
        } catch (e) {}
      })();
    }
  });

  return { ok: true, pid: child.pid, profileDir, debugPort: `http://127.0.0.1:${debugPort}`, cdpUrl: `http://127.0.0.1:${debugPort}`, engine: isFpEngine ? 'fp-chrome' : 'system' };
}

function stopProfileCore(id) {
  const r = running.get(id);
  if (!r) return { ok: false, error: 'Profile không chạy' };
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(r.pid), '/T', '/F']);
    } else {
      try { process.kill(-r.pid); } catch (e) { try { r.child.kill('SIGTERM'); } catch (e2) {} }
    }
  } catch (e) { /* ignore */ }
  running.delete(id);
  try { initDb(); db.prepare('UPDATE profiles SET status = ? WHERE id = ?').run('Ready', id); } catch (e) {}
  notifyRunningChanged();
  return { ok: true };
}

function getRunningList() {
  return Array.from(running.entries()).map(([id, r]) => ({ id, pid: r.pid, debugPort: r.debugPort, startedAt: r.startedAt, cdpUrl: `http://127.0.0.1:${r.debugPort}` }));
}

function notifyRunningChanged() {
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('running-changed', getRunningList()); } catch (e) {}
}

ipcMain.handle('launch-profile', (_e, profile) => launchProfileCore(profile));
ipcMain.handle('stop-profile', (_e, id) => stopProfileCore(id));
ipcMain.handle('get-running', () => getRunningList());
ipcMain.handle('test-proxy', (_e, str) => testProxy(str));
ipcMain.handle('get-api-info', () => ({ port: 35000, token: apiToken, tokenPath: API_TOKEN_PATH }));

ipcMain.handle('get-chrome-path', () => findChrome());

ipcMain.handle('open-profiles-folder', () => {
  shell.openPath(PROFILES_DIR);
  return true;
});

// Expose research credit in about
ipcMain.handle('get-research-info', () => ({
  sources: [
    'unknowbugs99/Genlogin-1.5 (fingerprint JSON templates)',
    'CloakHQ/CloakBrowser-Manager (profile launch + isolation model)',
    'gologinapp/gologin (SDK patterns)'
  ]
}));
