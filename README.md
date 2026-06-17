# Aether

**Professional, local-first anti-detect browser profile manager** with safe cross-machine sharing.

Inspired by GenLogin and Dolphin Anty workflows, built as **your own private tool** — no subscriptions, full control, research-backed.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Electron-blue)](https://github.com/godvstoaa/aether)

## Why Aether?

- **True isolation** using patched research engines (`fp-chrome.exe` + real `gen_login_*.json` configs)
- **Safe "dùng chung tài khoản"** (shared accounts): Mandatory checkout/lock + heartbeat + TTL to prevent concurrent launches on multiple machines — the #1 cause of detection/bans
- **End-to-end encrypted sync**: Self-hosted server. Full profile state (cookies, local storage, etc.) is zipped + AES-256-GCM encrypted client-side before upload. Server never sees plaintext data.
- **Automation ready**: Every profile exposes a real CDP endpoint (`--remote-debugging-port`) for Playwright, Puppeteer, Selenium, or your own synchronizer.
- **Rich per-profile control**: Resolution, timezone, language, hardware concurrency, device memory, proxy (with health), fingerprint presets, groups/tags, startup URL.
- Beautiful Vietnamese GenLogin-style dark UI.

## Key Features

### Fingerprint & Engine
- Prefers real research anti-detect browser (`fingerprint-data/build/fp-chrome.exe`)
- Writes authentic `gen_login_*.json` (resolution, webrtc, webgl, hardware, user-agent, etc.) into each profile directory using original templates from GenLogin 1.5 research data
- Consistent, seedable fingerprints per profile ID

### Safe Shared Account Sync (Self-hosted)
- Users, teams, basic RBAC
- **Checkout/lock enforcement** before launching cloud profiles (HTTP 409 on conflict)
- Heartbeat + automatic TTL release (no permanent locks on crash)
- Client-side E2EE (AES-256-GCM + random per-blob salt + auth tag)
- Metadata sync + full encrypted blob (profile directory) roundtrip

### Developer Experience
- SQLite persistence (professional, fast)
- Exposed CDP on every launch
- Proxy support (http/socks)
- Groups, tags, bulk operations foundation
- Detailed audit logs on server

## Quick Start

### 1. Install client

```powershell
cd genlogin-clone
npm install
```

### 2. (Recommended) Run the self-hosted sync server

```powershell
cd server
npm install
npm start
# Server runs on http://localhost:3456 by default
```

### 3. Launch the app

```powershell
npm start   # from project root
```

In the app:
1. Go to **Đồng Bộ Hóa** (Sync) panel
2. Configure your self-hosted server URL + register/login
3. Create profiles as "Đám Mây" (Cloud) for cross-machine use
4. The app will **automatically checkout** before launching any cloud profile

## Development & Verification

```powershell
npm test                 # Real checks (UA cleanliness, engine config writing, 409 lock safety)
npm run verify
npm run verify-advanced
```

See `AUDIT_R2_AND_IMPROVEMENTS.md` and `AUDIT_R2_STATUS.md` for current implementation status vs. plan.

## Architecture

- **Electron** desktop app (vanilla + better-sqlite3)
- **Self-hosted Node/Express** sync server (JWT auth, teams, checkout table, multer for blobs)
- **Research engine integration**: `fp-chrome.exe` + `gen_login_*.json` written to `--user-data-dir`
- **E2EE**: Client-only (archiver + crypto scrypt + AES-GCM)
- **Safety first**: Distributed lock (checkout) is mandatory for any cloud/shared profile

## Research & Credits

This project started from deep analysis of public resources:

- GenLogin 1.5 research data (templates, engine behavior)
- Public patterns from CloakBrowser-Manager, GoLogin, Dolphin Anty
- Emphasis on real safety mechanisms for shared accounts instead of just "more spoof fields"

`fingerprint-data/` contains analyzed research assets (not the original proprietary software).

## Legal & Responsible Use

**This software is provided for research and educational purposes.**

- Do not use it to violate any website/platform Terms of Service.
- Do not use it for fraud, scraping at scale, or any illegal activity.
- The included research browser build (`fp-chrome.exe`) is a third-party artifact — respect its original licensing and intended use.
- You are fully responsible for how you use this tool.

See the full [LICENSE](LICENSE) and the disclaimer section.

## Current Status (R2 Audit)

Core safety and engine features are implemented:
- Real fp-chrome + gen_login config writing
- Strong E2EE (GCM + salt)
- Mandatory distributed checkout/lock + TTL
- Working self-hosted sync with blob support

**Highest remaining item**: Visual proof with CreepJS / browserleaks screenshots (see `docs/proof/phase1/R2-PROOF-CAPTURE-GUIDE.md`).

Full roadmap and open items are tracked in `AUDIT_R2_AND_IMPROVEMENTS.md`.

## Contributing

Pull requests and serious research contributions are welcome.

Before contributing:
- Read the audits (`FIX_PLAN.md`, `AUDIT_R2_AND_IMPROVEMENTS.md`)
- Focus on verifiable improvements (tests, real measurements, clean architecture)
- Respect the "no proof theater" rule — everything must be backed by actual command output or screenshots in `docs/proof/`

## License

MIT License — see [LICENSE](LICENSE) file.

**Additional research-use disclaimer applies** (see top of LICENSE and README).

---

Built with focus on **real safety** for people who actually need to manage profiles across machines without getting banned.

If you find this useful for legitimate work, star the repo and consider contributing improvements.