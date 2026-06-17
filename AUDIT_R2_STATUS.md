# AUDIT_R2 — Status after fixes (2026-06-17)

This file records what was addressed from `AUDIT_R2_AND_IMPROVEMENTS.md`.

## Critical self-inflicted issues (Ưu tiên 0) — FIXED

### N1 (🔴 UA `Aether/` token)
- `buildUA()` no longer appends `Aether/<id>`.
- Confirmed by `npm test`: "PASS: UA generation is clean (no Aether/ token)"
- In fp-engine path we also stopped passing `--user-agent` flag (see N4).

### N2 (🔴 Fake test with `|| echo`)
- `package.json` "test" now points to `node tests/run-real-checks.js` (no swallow).
- Created `tests/run-real-checks.js` that:
  - Checks UA is clean
  - Verifies fp-chrome + 12 templates exist
  - Runs real engine write (mutate-in-place) and asserts values
  - Executes the full `test-goal-completion.js` (the one with real server + 409 conflict)
- Fresh run: `npm test` → **ALL REAL CHECKS PASSED** (including 409 block + success phrase).
- Removed misleading "(Simulated launch...)" and "(Simulated E2EE...)" comments in test-goal-completion.js.

### N3 (🟠 Guessed JSON schema)
- `writeFingerprintConfigs` now loads the **original template**, parses it, and mutates fields in-place (`j.width = ...`, `j.hardware_concurrency = ...`, etc.).
- Only falls back to replacement for the useragent-plugin case (which was often `null` in the example).
- This keeps the exact structure, extra keys, and array formats that the real fp-chrome.exe expects.

### N4 (🟠 UA / resolution flag conflict with gen_login files)
- When `isFpEngine === true`, launch no longer adds `--user-agent` or `--window-size`.
- These are now controlled exclusively by the `gen_login_useragent-plugin.json` and `gen_login_resolution-plugin.json` that we write.
- Fallback (system Chrome) still gets the flags.

### N5 (🟡 .gitignore hides evidence)
- Added `node_modules/`
- Whitelisted evidence: `!docs/proof/**/*.png`, `!docs/proof/**/*.md`, `!docs/proof/**/*.log`
- Still ignores temp profile dumps and the big exe binaries.
- `docs/proof/phase1/` now has `R2-PROOF-CAPTURE-GUIDE.md` with the exact list of required CreepJS/browserleaks screenshots.

## Remaining (highest risk)

**Ưu tiên 1 — CHỨNG MINH anti-detect (I1)**
- Code path is now much cleaner (exact templates + value mutation + correct flags for fp-engine).
- **Still no PNGs** in `docs/proof/phase1/` showing actual CreepJS differences.
- Created `docs/proof/phase1/R2-PROOF-CAPTURE-GUIDE.md` with precise required files and step-by-step on a real desktop.

**Next real gate (per audit):**
Run the app on a Windows machine that can display browsers, launch two differently configured profiles using fp-chrome, capture the CreepJS + browserleaks screenshots, drop the PNGs into `docs/proof/phase1/`, then re-run `npm test`.

Only after those images exist and show the expected differences should we consider the anti-detect core "proven".

## Commands run after R2 fixes
- `npm test` → ALL REAL CHECKS PASSED (full output in `docs/proof/phase0/r2-real-checks.log`)
- UA, templates, engine write (mutate), and the real 409 lock test all verified in one go.

This addresses the "cấm tuyệt đối đánh dấu 'xong' khi chưa có ảnh" rule from the audit.
