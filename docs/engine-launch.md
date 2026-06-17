# Engine Launch (fp-chrome + gen_login_*.json) — Real Anti-Detect

Per FIX_PLAN B1/B2 + AUDIT:

1. `findChrome()` now **prefers** `fingerprint-data/build/fp-chrome.exe` (79.5MB patched research build) before system Chrome/Edge.
2. Before `spawn`, if fp-chrome: `writeFingerprintConfigs(profileDir, profile)` copies + patches the 12 `gen_login_*.json` from `Profile-Example/example-chronium/` into the user-data-dir root.
3. Patches (consistent + seeded by profile.id):
   - `gen_login_resolution-plugin.json`: {width,height} from profile.resolution
   - `gen_login_hardware-concurrency.json`: from profile.hardware_concurrency
   - `gen_login_webrtc-finger-print.json`: ip_adr varied per profile (proxy-like spoof)
   - `gen_login_useragent-plugin.json`: UA built from profile (platform + seed)
   - webgl/canvas: light re-seed of random buffers using profile id hash for diff across profiles + stability on reopen
4. Other files copied verbatim (audio, fonts, dom-rect, webgl full params from real research templates).
5. fp-chrome.exe reads these on launch → applies spoof **natively** (canvas, webgl, fonts, webrtc, audio, UA, hardware, res, etc.).
6. For non-fp (system Chrome fallback): still writes light JS inject + all other isolation/proxy/CDP flags. Warn that native strength is reduced.
7. UA/CH/TZ/res/lang/hw all flow from profile fields (no more hard-coded Chrome/126).

Test evidence (this run):
- FP exe present + templates (12 gen_login)
- write test: produced patched resolution/hwc/webrtc for sample profile
- launch in verify-advanced used proxy + debug port + injected marker

Next for full Gate1: launch 2 profiles via `npm start` (or direct), open CreepJS/browserleaks in each, capture screenshots showing:
- Different canvas/webgl hashes between A/B
- Same on reopen of A
- UA/platform match, no webdriver, WebRTC only proxy IP, TZ match

See also: `fingerprint-data/README.md`, Profile-Example/, main.js:findChrome + writeFingerprintConfigs + launch-profile.

Run date: 2026-06-17
