# Aether — Anti-Detect Profile Manager

**Private, local-first anti-detect browser profile tool** (GenLogin / Dolphin Anty inspired).

Built for "dùng chung tài khoản" safely across machines with mandatory checkout/lock + full E2EE blob sync.

## Core Features (as of R2 audit)

- **Local profiles** with rich per-profile settings: fingerprint_preset, resolution, timezone, lang, hardware_concurrency, device_memory, proxy, group, tags, startup_url.
- **Real engine path** (research-backed):
  - Prefers `fingerprint-data/build/fp-chrome.exe` (Genlogin-1.5 patched browser).
  - Writes real `gen_login_*.json` configs (resolution, hardware, webrtc, webgl, etc.) into each profile's `--user-data-dir` before launch (using original templates + value patching).
- **Safe shared-account sync** (self-hosted Node server):
  - Users + teams + RBAC foundation.
  - Mandatory **checkout/lock** before launching cloud profiles (prevents concurrent use on multiple machines — critical for avoiding detection).
  - TTL + heartbeat auto-release (no permanent locks if machine crashes).
  - E2EE profile backup/restore (AES-256-GCM + per-blob random salt + auth tag). Server never sees plaintext data.
- CDP exposed on every launch (`--remote-debugging-port`) for Playwright/Puppeteer/Selenium.
- SQLite local persistence.
- Vietnamese GenLogin-like dark UI.

## Important Notes

- The `fingerprint-data/` contains research assets from public Genlogin-1.5 analysis. `fp-chrome.exe` is a 3rd-party build — use for research / personal only.
- **Anti-detect status (R2)**: Engine path + config writing implemented and tested in logic. **Visual proof via CreepJS/browserleaks screenshots still required** (see `docs/proof/phase1/R2-PROOF-CAPTURE-GUIDE.md`).
- No cloud vendor lock-in. You host your own sync server.

## Quick Start

```powershell
cd genlogin-clone

# Install client deps
npm install

# Install & run the sync server (in another terminal)
cd server
npm install
npm start
```

In the app:
- Configure Sync → register/login to your self-hosted server.
- Create "cloud" profiles for cross-machine use.
- The app will enforce checkout before launching any cloud profile.

## Development / Verification

```powershell
npm test                 # real checks (UA, engine write, 409 lock safety)
npm run verify
npm run verify-advanced
```

See `AUDIT_R2_AND_IMPROVEMENTS.md` and `AUDIT_R2_STATUS.md` for current state vs plan.

## Legal / Research

This project was built by studying public resources and reversing research data for educational and personal anti-detect workflow purposes. Do not use for fraud or violating platform terms of service.

## Next (from current audit)

- Capture real CreepJS + browserleaks screenshots for proof (highest priority).
- Proxy auth (MV3 extension).
- Full local Automation API (:35000 + WS).
- Complete UI (fingerprint editor, bulk, cookie manager).
- Envelope encryption for team-shared profiles.

---

**Status**: Actively developed following strict internal audit (FIX_PLAN + AUDIT_R2). No "proof theater".

Built for control and safety.
