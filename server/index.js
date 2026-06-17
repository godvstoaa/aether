/**
 * Aether Sync Server (Self-hosted)
 * 
 * - Simple account system for "dùng chung tài khoản" across machines
 * - Team / group sharing (Thành Viên Nhóm style)
 * - Metadata sync for cloud profiles (lightweight)
 * - Checkout/lock to prevent concurrent launch of same profile (CRITICAL safety for anti-detect)
 * - Audit log
 * - Optional placeholder for E2EE blob storage (full profile dirs)
 * 
 * Run: cd server && npm install && npm start
 * 
 * IMPORTANT: This is for your private use. Host it yourself. No telemetry.
 * For production, put behind reverse proxy + HTTPS + strong auth.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3456;
const JWT_SECRET = process.env.JWT_SECRET || 'aether-dev-secret-change-me-in-prod';
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'aether-sync.db');
const BLOBS_DIR = path.join(DATA_DIR, 'blobs');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BLOBS_DIR, { recursive: true });

const db = new Database(DB_PATH);

// Schema - simple but effective for metadata + safety
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner_user_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (owner_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS team_members (
    team_id INTEGER,
    user_id INTEGER,
    role TEXT DEFAULT 'launcher', -- owner, editor, launcher, viewer
    joined_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (team_id, user_id),
    FOREIGN KEY (team_id) REFERENCES teams(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    owner_user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    location TEXT DEFAULT 'cloud',
    group_name TEXT,
    platform TEXT DEFAULT 'Chrome',
    note TEXT,
    proxy TEXT,
    startup_url TEXT,
    fingerprint_preset TEXT,
    resolution TEXT,
    timezone TEXT,
    lang TEXT,
    hardware_concurrency INTEGER,
    device_memory INTEGER,
    version INTEGER DEFAULT 1,
    has_blob INTEGER DEFAULT 0,
    blob_updated_at TEXT,
    last_synced TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (owner_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS profile_shares (
    profile_id TEXT,
    team_id INTEGER,
    role TEXT DEFAULT 'launcher',
    granted_by_user_id INTEGER,
    granted_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (profile_id, team_id),
    FOREIGN KEY (profile_id) REFERENCES profiles(id),
    FOREIGN KEY (team_id) REFERENCES teams(id),
    FOREIGN KEY (granted_by_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS checkouts (
    profile_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    machine_id TEXT NOT NULL,
    checked_out_at TEXT DEFAULT (datetime('now')),
    last_heartbeat TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (profile_id) REFERENCES profiles(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now')),
    user_id INTEGER,
    action TEXT NOT NULL,
    profile_id TEXT,
    team_id INTEGER,
    details TEXT,
    machine_id TEXT
  );
`);

const upload = multer({ dest: BLOBS_DIR, limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB max per blob for safety

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Auth middleware
function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function logAudit(userId, action, profileId = null, teamId = null, details = '', machineId = '') {
  const stmt = db.prepare(`
    INSERT INTO audit_logs (user_id, action, profile_id, team_id, details, machine_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(userId, action, profileId, teamId, details, machineId);
}

// === Auth ===
app.post('/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });

  const hash = bcrypt.hashSync(password, 10);
  try {
    const stmt = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)');
    const info = stmt.run(email, hash);
    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(info.lastInsertRowid);
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ user, token });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ user: { id: user.id, email: user.email }, token });
});

// === Teams (simple) ===
app.post('/teams', auth, (req, res) => {
  const { name } = req.body;
  const stmt = db.prepare('INSERT INTO teams (name, owner_user_id) VALUES (?, ?)');
  const info = stmt.run(name, req.user.id);
  db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(info.lastInsertRowid, req.user.id, 'owner');
  res.json({ id: info.lastInsertRowid, name });
});

app.get('/teams', auth, (req, res) => {
  const teams = db.prepare(`
    SELECT t.*, tm.role 
    FROM teams t 
    JOIN team_members tm ON t.id = tm.team_id 
    WHERE tm.user_id = ?
  `).all(req.user.id);
  res.json(teams);
});

// Helper: role of a user in a team
function teamRole(teamId, userId) {
  const row = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, userId);
  return row ? row.role : null;
}

// Add member to team (owner/admin only). Body: { email, role }
app.post('/teams/:id/members', auth, (req, res) => {
  const teamId = req.params.id;
  const { email, role } = req.body;
  const myRole = teamRole(teamId, req.user.id);
  if (myRole !== 'owner' && myRole !== 'admin') return res.status(403).json({ error: 'Only owner/admin can add members' });
  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
  if (!user) return res.status(404).json({ error: 'User not found (họ cần đăng ký trước)' });
  try {
    db.prepare('INSERT OR REPLACE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)')
      .run(teamId, user.id, role || 'launcher');
    logAudit(req.user.id, 'add_member', null, teamId, `user:${user.id} role:${role || 'launcher'}`, req.headers['x-machine-id'] || '');
    res.json({ ok: true, member: { id: user.id, email: user.email, role: role || 'launcher' } });
  } catch (e) { res.status(500).json({ error: 'Failed to add member' }); }
});

app.get('/teams/:id/members', auth, (req, res) => {
  const teamId = req.params.id;
  if (!teamRole(teamId, req.user.id)) return res.status(403).json({ error: 'Not a team member' });
  const members = db.prepare(`
    SELECT u.id, u.email, tm.role, tm.joined_at
    FROM team_members tm JOIN users u ON tm.user_id = u.id
    WHERE tm.team_id = ?
  `).all(teamId);
  res.json(members);
});

// Share a profile to a team (only profile owner). Body: { teamId, role }
app.post('/profiles/:id/share', auth, (req, res) => {
  const profileId = req.params.id;
  const { teamId, role } = req.body;
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  if (profile.owner_user_id !== req.user.id) return res.status(403).json({ error: 'Only owner can share' });
  if (!teamRole(teamId, req.user.id)) return res.status(403).json({ error: 'You are not in that team' });
  try {
    db.prepare('INSERT OR REPLACE INTO profile_shares (profile_id, team_id, role, granted_by_user_id) VALUES (?, ?, ?, ?)')
      .run(profileId, teamId, role || 'launcher', req.user.id);
    logAudit(req.user.id, 'share_profile', profileId, teamId, `role:${role || 'launcher'}`, req.headers['x-machine-id'] || '');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to share' }); }
});

// === Profiles (metadata only for sync safety) ===
app.post('/profiles', auth, (req, res) => {
  const p = req.body;
  const machineId = req.headers['x-machine-id'] || 'unknown';
  const id = p.id || 'prof-' + Date.now();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO profiles 
    (id, owner_user_id, name, location, group_name, platform, note, proxy, startup_url, 
     fingerprint_preset, resolution, timezone, lang, hardware_concurrency, device_memory, 
     version, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT version FROM profiles WHERE id = ?), 0) + 1, datetime('now'))
  `);
  stmt.run(
    id, req.user.id, p.name, p.location || 'cloud', p.group_name || '', p.platform || 'Chrome',
    p.note || '', p.proxy || 'Local IP', p.startup_url || '',
    p.fingerprint_preset || '', p.resolution || '', p.timezone || '', p.lang || '',
    p.hardware_concurrency || 8, p.device_memory || 8, id
  );

  logAudit(req.user.id, 'profile_create_or_update', id, null, '', machineId);
  res.json({ id, version: db.prepare('SELECT version FROM profiles WHERE id = ?').get(id).version });
});

app.get('/profiles', auth, (req, res) => {
  // Return profiles owned by user OR shared via teams
  const profiles = db.prepare(`
    SELECT p.* FROM profiles p
    LEFT JOIN profile_shares ps ON p.id = ps.profile_id
    LEFT JOIN team_members tm ON ps.team_id = tm.team_id AND tm.user_id = ?
    WHERE p.owner_user_id = ? OR tm.user_id IS NOT NULL
    GROUP BY p.id
  `).all(req.user.id, req.user.id);
  res.json(profiles);
});

// === Blob sync for full profile (E2EE on client side per plan B2) ===
// Client zips user-data-dir, encrypts with user master passphrase, uploads here.
// This allows full state sync across machines for "dùng chung tài khoản".
app.post('/profiles/:id/blob', auth, upload.single('blob'), (req, res) => {
  const { id } = req.params;
  const machineId = req.headers['x-machine-id'] || 'unknown';

  // Permission check (owner or shared)
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
  if (!profile || (profile.owner_user_id !== req.user.id && !canAccessProfile(id, req.user.id))) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(403).json({ error: 'No permission for this profile' });
  }
  if (!req.file) return res.status(400).json({ error: 'No blob file' });

  const dest = path.join(BLOBS_DIR, `${id}.enc`);
  try {
    fs.renameSync(req.file.path, dest);
    db.prepare('UPDATE profiles SET has_blob = 1, blob_updated_at = datetime(\'now\'), version = version + 1 WHERE id = ?').run(id);
    logAudit(req.user.id, 'upload_blob', id, null, `size:${req.file.size}`, machineId);
    res.json({ ok: true, blob_updated_at: db.prepare('SELECT blob_updated_at FROM profiles WHERE id = ?').get(id).blob_updated_at });
  } catch (e) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Failed to store blob' });
  }
});

app.get('/profiles/:id/blob', auth, (req, res) => {
  const { id } = req.params;
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
  if (!profile || (profile.owner_user_id !== req.user.id && !canAccessProfile(id, req.user.id))) {
    return res.status(403).json({ error: 'No permission' });
  }
  const src = path.join(BLOBS_DIR, `${id}.enc`);
  if (!fs.existsSync(src)) return res.status(404).json({ error: 'No blob for this profile' });

  res.download(src, `${id}.enc`);
});

function canAccessProfile(profileId, userId) {
  const row = db.prepare(`
    SELECT 1 FROM profile_shares ps
    JOIN team_members tm ON ps.team_id = tm.team_id
    WHERE ps.profile_id = ? AND tm.user_id = ?
  `).get(profileId, userId);
  return !!row;
}

// Checkout for launch safety (PREVENTS the #1 mistake with shared accounts)
app.post('/profiles/:id/checkout', auth, (req, res) => {
  const { id } = req.params;
  const machineId = req.headers['x-machine-id'] || 'unknown';
  const force = req.body.force === true;

  const existing = db.prepare('SELECT * FROM checkouts WHERE profile_id = ?').get(id);
  if (existing && !force) {
    return res.status(409).json({ 
      error: 'Profile already checked out', 
      by: existing.user_id, 
      machine: existing.machine_id,
      since: existing.checked_out_at 
    });
  }

  if (existing && force) {
    logAudit(req.user.id, 'force_checkout', id, null, `Forced from ${existing.machine_id}`, machineId);
  }

  db.prepare(`
    INSERT OR REPLACE INTO checkouts (profile_id, user_id, machine_id, checked_out_at, last_heartbeat)
    VALUES (?, ?, ?, datetime('now'), datetime('now'))
  `).run(id, req.user.id, machineId);

  logAudit(req.user.id, 'checkout', id, null, force ? 'forced' : '', machineId);
  res.json({ ok: true, checked_out_by_you: true });
});

app.post('/profiles/:id/checkin', auth, (req, res) => {
  const { id } = req.params;
  const machineId = req.headers['x-machine-id'] || 'unknown';

  db.prepare('DELETE FROM checkouts WHERE profile_id = ? AND user_id = ?').run(id, req.user.id);
  logAudit(req.user.id, 'checkin', id, null, '', machineId);
  res.json({ ok: true });
});

// Heartbeat to keep checkout alive
app.post('/profiles/:id/heartbeat', auth, (req, res) => {
  const { id } = req.params;
  db.prepare('UPDATE checkouts SET last_heartbeat = datetime(\'now\') WHERE profile_id = ? AND user_id = ?')
    .run(id, req.user.id);
  res.json({ ok: true });
});

// Simple metadata pull for sync (client polls or on demand)
app.get('/sync/pull', auth, (req, res) => {
  const since = req.query.since || '1970-01-01';
  const profiles = db.prepare(`
    SELECT * FROM profiles 
    WHERE (owner_user_id = ? OR id IN (
      SELECT ps.profile_id FROM profile_shares ps 
      JOIN team_members tm ON ps.team_id = tm.team_id 
      WHERE tm.user_id = ?
    )) AND updated_at > ?
  `).all(req.user.id, req.user.id, since);

  const checkouts = db.prepare('SELECT * FROM checkouts').all();

  res.json({ profiles, checkouts, server_time: new Date().toISOString() });
});

// Basic audit
app.get('/audit/:profileId', auth, (req, res) => {
  const logs = db.prepare('SELECT * FROM audit_logs WHERE profile_id = ? ORDER BY timestamp DESC LIMIT 50')
    .all(req.params.profileId);
  res.json(logs);
});

app.get('/', (req, res) => res.json({ ok: true, name: 'Aether Sync Server', version: '0.1' }));

// Basic automation readiness per plan (start returns wsEndpoint for attach)
// NOTE: Real wsEndpoint comes from the *client* launchProfile response (local debugPort on the machine running the profile).
// Server cannot know the random port or the actual running instance. Client should use its returned cdpUrl.
app.get('/profiles/:id/start', auth, (req, res) => {
  const { id } = req.params;
  res.json({ ok: true, wsEndpoint: null, port: null, message: 'Client-side only: use cdpUrl/debugPort returned by local launchProfile (see B15/B19)' });
});

// TTL sweeper for stale checkouts (B14): prevents permanent lock if machine crashes mid-launch
setInterval(() => {
  try {
    const old = db.prepare(`
      SELECT profile_id, user_id, machine_id, last_heartbeat 
      FROM checkouts 
      WHERE last_heartbeat < datetime('now', '-90 seconds')
    `).all();
    if (old.length > 0) {
      db.prepare(`DELETE FROM checkouts WHERE last_heartbeat < datetime('now', '-90 seconds')`).run();
      old.forEach(o => {
        logAudit(o.user_id || 0, 'auto_release_ttl', o.profile_id, null, `auto released (no heartbeat >90s) from ${o.machine_id}`, '');
      });
      console.log('[AetherServer] Auto-released', old.length, 'stale checkouts due to TTL');
    }
  } catch (e) { /* ignore */ }
}, 30000);

app.listen(PORT, () => {
  console.log(`Aether Sync Server running on http://localhost:${PORT}`);
  console.log('IMPORTANT: Change JWT_SECRET in production and use HTTPS + reverse proxy.');
  console.log('Checkout TTL sweeper active (90s heartbeat timeout).');
});