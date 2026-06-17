# R2 Proof Capture Guide — Anti-Detect Verification (I1.3)

Per AUDIT_R2_AND_IMPROVEMENTS.md, the highest priority remaining item is **actual visual proof** that the fp-chrome + gen_login_*.json path changes fingerprints in a stable, consistent way.

## Required artifacts (Cổng I1 — DoD)
Put these files in `docs/proof/phase1/`:

- `creepjs-A.png` + `creepjs-B.png` (two different profiles)
- `creepjs-A-reopen.png` (re-open profile A, must match first run)
- `browserleaks-webrtc-A.png` (or equivalent) — only proxy IP visible
- `browserleaks-uahints-A.png` (or Client Hints) — UA + platform + Sec-CH-UA consistent with profile config
- Optional: `browserleaks-canvas-A.png` etc.

Quantitative expectations:
- Canvas hash / WebGL vendor/renderer different between A and B
- Same profile reopened → identical (or extremely close) values
- `navigator.webdriver` === false
- Timezone matches the profile's `timezone` field
- WebRTC candidates only show the proxy IP (no real local IPs)

## Exact steps (on a Windows desktop with display)

1. Make sure you are on the latest code after R2 fixes (this branch/commit).
2. `cd genlogin-clone`
3. `npm start` (the Electron app)
4. In the UI:
   - Create or use two profiles with clearly different settings:
     - Profile A: resolution `1920x1080`, hardware_concurrency `8`, timezone `Asia/Ho_Chi_Minh`, proxy = some Vietnam or local
     - Profile B: resolution `1366x768`, hardware_concurrency `4`, timezone `America/New_York`, different proxy
   - Make sure both use **"genlogin-chrome-real"** or similar fingerprint_preset.
5. Launch Profile A → wait for it to fully start.
6. In the launched browser go to:
   - https://abrahamjuliot.github.io/creepjs/
   - https://browserleaks.com/webrtc
   - https://browserleaks.com/client-hints (or just `navigator.userAgentData`)
7. Take full screenshots of the key sections (canvas, webgl, webrtc, UA, timezone, hardware).
8. Close the browser completely.
9. Re-launch the **same Profile A**.
10. Repeat the CreepJS visit and screenshot (must match previous A run).
11. Repeat for Profile B.
12. Copy the PNGs + any notes into `docs/proof/phase1/`.

## How to validate without the app (quick smoke)

```powershell
cd genlogin-clone
node -e '
  const fs = require("fs");
  const p = "docs/proof/phase1/r2-check-profile";
  console.log("resolution:", fs.readFileSync(p+"/gen_login_resolution-plugin.json","utf8"));
  console.log("hw:", fs.readFileSync(p+"/gen_login_hardware-concurrency.json","utf8"));
'
```

After you have the screenshots, run:
```bash
npm test
```

This will re-execute the real safety + engine checks.

## Current status (2026-06-17 R2)
- Code writes the configs using original templates + in-place value mutation (N3 fixed).
- fp-chrome is preferred.
- UA is now clean (no Aether/ token).
- For fp-engine we no longer pass conflicting --user-agent/--window-size flags.
- Real 409 lock test + E2EE still passes via `npm test`.

**What is still missing for "thực sự xong"**: The PNGs above + confirmation that the running fp-chrome actually produces different/stable fingerprints on CreepJS.

If after real run the hashes do **not** change between A and B, we will need to:
- Either correct the exact JSON shape the engine expects (by deeper reverse of `fingerprint-data/dist/main/index.js` + real Profile-Example usage), or
- Fall back to stronger CDP injection layer.

Do not mark anything as complete until the images exist and match the expected differences.
