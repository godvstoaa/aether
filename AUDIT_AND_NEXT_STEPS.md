# AUDIT + PLAN MỔ XẺ — genlogin-clone (Aether)

> Mục đích: audit trung thực hiện trạng codebase và đưa ra plan chi tiết, có thứ tự ưu tiên,
> cấp độ file, kèm **tiêu chí nghiệm thu thật (không "proof theater")** để agent code tiếp.
>
> Ngày audit: 2026-06-17. Phạm vi: toàn bộ repo trừ `node_modules`.

---

## PHẦN 1 — HIỆN TRẠNG (cái gì đang có)

### 1.1 Cấu trúc
- **Electron app (local-first):**
  - `main.js` (~570 dòng): IPC, SQLite (`better-sqlite3`) bảng `profiles`, `launch-profile`, các handler sync + E2EE blob.
  - `preload.js`: cầu nối `window.Aether` / `window.genlogin`.
  - `index.html` (~590 dòng): UI khớp ảnh Genlogin (sidebar, tabs Cloud/Local/Groups, bảng profile, modal tạo, panel Sync). Tailwind qua CDN.
- **Sync server (self-hosted):** `server/index.js` — Express + JWT + bcrypt + multer: auth, teams, profile metadata, **checkout/lock**, E2EE blob storage, audit log.
- **Tài sản quý — `fingerprint-data/`:** chính là **source GenLogin 1.5.1 đã giải nén** (README xác nhận):
  - `build/fp-chrome.exe` (~81MB) + `build/fp-firefox.exe` (~81MB) = **trình duyệt anti-detect đã patch native** (động cơ thật).
  - `data-browser-profile/` = template dữ liệu fingerprint (`data.json`, `webgl.js`, `UA.js`, `front.js`...).
  - `Profile-Example/example-chronium|firefox/` = **mẫu user-data-dir** chứa các file `gen_login_*.json`
    (audio/canvas/dom-rect/font/webgl/webrtc/useragent/resolution/hardware-concurrency...) → đây là
    **schema cấu hình spoof** mà trình duyệt patch đọc.
  - `dist/` = bản build Electron gốc của GenLogin (minified) để tham khảo cách họ launch.
- **Proof scripts:** `proof-verify.js`, `proof-advanced.js`, `test-goal-completion.js` + nhiều thư mục
  `.proof-*`, `.test-sync-blob-*`.

### 1.2 Quy trình anti-detect THẬT (theo `fingerprint-data/README.md`)
1. Lấy dữ liệu fingerprint từ `data-browser-profile/`.
2. **Ghi các file `gen_login_*.json` vào thư mục profile (user-data-dir).**
3. Chạy **trình duyệt bundled đã patch** trỏ vào user-data-dir đó → nó tự spoof ở tầng native.
4. Tự động hoá bằng Selenium/Puppeteer/Playwright như bình thường.

> 👉 Đây là chìa khoá: động cơ là **fp-chrome.exe + gen_login_*.json đặt đúng chỗ**, KHÔNG phải JS inject.

---

## PHẦN 2 — MỔ XẺ: CÁI GÌ THẬT, CÁI GÌ GIẢ (đánh giá thẳng)

> Kết luận ngắn: **UI + sync server có thật và chạy được (nếu cài deps); nhưng tính năng lõi —
> anti-detect — đang GIẢ.** App chưa hề dùng động cơ `fp-chrome.exe` + `gen_login_*.json`.

### 🔴 C1 — Anti-detect là GIẢ (nghiêm trọng nhất)
- `launch-profile` (`main.js`) spawn **Chrome/Edge thường** với UA hardcode + window-size + proxy.
- Nó ghi `aether-inject.js` vào profile dir **nhưng không bao giờ nạp** (không CDP, không
  `--load-extension`, không gì đọc file đó). → Canvas/WebGL/Audio/Fonts/WebRTC/Timezone **KHÔNG hề bị spoof**.
- `fp-chrome.exe` chỉ là fallback cuối khi không thấy Chrome/Edge, và **kể cả khi chạy cũng không
  được cấp `gen_login_*.json`** trong profile dir → cũng không spoof.
- Bộ `gen_login_*.json` (cấu hình spoof thật) **hoàn toàn không được dùng**.
- UA hardcode `Chrome/126` bất kể `platform`/version của profile → **bất nhất fingerprint, lộ ngay**;
  không set Client Hints (`Sec-CH-UA`) khớp.

### 🔴 C2 — Server không chạy được như hiện trạng
- `server/index.js` require `express, cors, helmet, jsonwebtoken, bcrypt, multer` — **không có trong
  package.json nào, không có trong node_modules, không có `server/package.json`.**
- ⇒ `cd server && npm start` sẽ fail. Test `test-goal-completion.js` spawn server này → thực tế
  không thể pass thật. (Xem C9.)

### 🔴 C3 — E2EE yếu, không thật sự zero-knowledge
- Dùng **AES-256-CBC không xác thực** (không GCM/HMAC) → không có integrity, dễ bị sửa ciphertext.
  Plan B2 yêu cầu **AES-256-GCM**.
- `deriveKey` dùng **salt tĩnh** `'aether-e2e-v1'` cho mọi user/profile → cùng passphrase = cùng key,
  dễ rainbow-table, không per-user/per-profile salt.
- Không có **envelope encryption / chia khoá theo team** (plan B2.2) → "chia sẻ profile mã hoá trong
  team" thực tế **không hoạt động cross-user**.

### 🟠 C4 — Checkout/lock lỏng & có code chết
- Trong `launch-profile` có dòng `ipcMain.emit('sync-checkout', ...)` **vô tác dụng** (emit không trả
  promise), rồi lại có 1 block fetch inline trùng lặp ngay dưới.
- Client **không gửi heartbeat**; server có endpoint `/heartbeat` + cột `last_heartbeat` nhưng **không
  có cơ chế quét hết hạn (TTL sweeper)** → máy crash giữa chừng = profile **bị khoá vĩnh viễn**.

### 🟠 C5 — Không có Automation Open API thật
- Plan yêu cầu local REST/WS `start/stop/list` trả `wsEndpoint`. App Electron **không có server local** này.
- `launch-profile` trả `debugPort` http nhưng không có API để công cụ ngoài gọi; **không SDK**, không WS event.
- Server có stub `GET /profiles/:id/start` trả `ws://127.0.0.1:9222/...` **sai** (đó là máy server, port
  random mỗi lần launch ở client) → vô dụng.

### 🟠 C6 — Proxy quản lý sơ sài + lỗi auth
- Proxy chỉ là chuỗi text trên profile; **không test, không auto đồng bộ timezone/geo theo IP** (plan
  coi đây là điều kiện sống còn để không bất nhất).
- `--proxy-server=` **không truyền được user:pass** (Chrome bỏ qua credential trong flag này) → proxy có
  auth sẽ **không đăng nhập được**. Cần extension auth hoặc local relay.

### 🟠 C7 — DB schema lệch giữa client và code/UI
- Bảng `profiles` (Electron) **không có** cột `version`, `tags`, `has_blob`, nhưng:
  - `sync-pull` đọc `sp.version`/`local.version`; `launch`/blob set `prof.has_blob = 1`; UI render `p.tags`.
  - `saveProfile` dùng INSERT OR REPLACE với **danh sách cột cố định** → `version`/`has_blob`/`tags`
    bị **rớt mất** khi lưu. Bất nhất, dễ sinh bug thầm lặng.

### 🟡 C8 — UI phần lớn là stub
- Sidebar (proxy, automation, schedule, members, billing, settings...) chỉ `alert()`.
- Chỉ có: bảng Profiles + tạo/launch + panel Sync. **Không có editor fingerprint**, không group view,
  cột "Thẻ" không có dữ liệu, không bulk actions, không cookie manager.

### 🟡 C9 — "Proof" là diễn (proof theater)
- `proof-advanced.js` chỉ **in ra chuỗi lệnh** + ghi file inject, **không chạy browser thật, không đo
  fingerprint** (CreepJS/browserleaks).
- `test-goal-completion.js` **ghi thẳng blob ra đĩa** thay vì upload qua HTTP endpoint, và "simulate"
  launch. ⇒ Các câu "GOAL COMPLETE: MET" **không phải bằng chứng**.

### 🟡 C10 — Bảo mật server (chấp nhận cho local, cần siết trước khi mở)
- CORS mở toàn bộ, `JWT_SECRET` mặc định, token 30 ngày không refresh, không rate-limit, không HTTPS.

---

## PHẦN 3 — PLAN ĐÀO SÂU ĐỂ CODE TIẾP (ưu tiên + cấp độ file + nghiệm thu thật)

> Nguyên tắc: **làm cho lõi anti-detect THẬT trước** (dùng động cơ có sẵn), rồi mới hoàn thiện
> proxy/automation/cloud/UI. Mỗi task có **Acceptance** phải verify bằng bằng chứng thật.

### EPIC 0 — Sửa nền móng để chạy được (0.5–1 ngày)
- **T0.1** Tạo `server/package.json` + khai báo deps (`express, cors, helmet, jsonwebtoken, bcrypt,
  multer, better-sqlite3`) và script `start`. Cài đặt. *Acceptance:* `cd server && npm i && npm start`
  log "running on :3456"; `GET /` trả `{ok:true}`.
- **T0.2** Sửa **schema drift (C7)**: thêm cột `version INTEGER DEFAULT 0`, `tags TEXT DEFAULT ''`,
  `has_blob INTEGER DEFAULT 0` vào bảng `profiles` (Electron) + cập nhật `saveProfile` cho đủ cột +
  migration an toàn (ALTER TABLE IF NOT EXISTS pattern). *Acceptance:* tạo/sửa profile có `tags`,
  reload vẫn còn; `sync-push` tăng `version` và lưu được.
- **T0.3** Dọn code chết trong `launch-profile` (bỏ `ipcMain.emit('sync-checkout')`); tách logic
  checkout ra **một hàm dùng chung** `doCheckout(profileId, force)`.

### EPIC 1 — LÕI ANTI-DETECT THẬT (ưu tiên #1, 3–6 ngày) ⭐
Mục tiêu: dùng đúng động cơ `fp-chrome.exe` + `gen_login_*.json`.
- **T1.1 — Reverse cách launch của GenLogin gốc.** Đọc `fingerprint-data/dist/main/index.js` (minified)
  để tìm: flags khi spawn `fp-chrome.exe`, **vị trí/định dạng** các file `gen_login_*.json` mà browser
  patch đọc (trong user-data-dir? trong `Default/`? qua biến môi trường? qua switch?). Đối chiếu với
  `Profile-Example/example-chronium/` (đã có sẵn các file đó nằm ở **gốc profile dir**).
  *Acceptance:* tài liệu ngắn `docs/engine-launch.md` mô tả chính xác cách browser nạp config.
- **T1.2 — FingerprintEngine.** Module `src/fingerprint/engine.js`: sinh một bộ `gen_login_*.json`
  **nhất quán** cho mỗi profile (UA↔platform↔WebGL↔fonts↔resolution↔hardware), seed cố định theo
  `profile.id`. Dựa trên schema thật trong `Profile-Example/example-chronium/*.json` và template
  `data-browser-profile/`. *Acceptance:* gọi 2 lần cùng profile → output giống hệt; khác profile → khác;
  validate không có tổ hợp bất khả thi (vd Win + GPU Apple).
- **T1.3 — Viết config vào profile dir + launch fp-chrome.exe.** Sửa `launch-profile`:
  - Ưu tiên `fp-chrome.exe` làm engine (không phải fallback). Ghi đủ `gen_login_*.json` vào đúng vị trí
    T1.1 trước khi spawn.
  - UA/lang/timezone/resolution lấy từ fingerprint của profile (bỏ UA hardcode).
  - Bỏ `aether-inject.js` vô dụng (hoặc giữ làm lớp bổ sung CHỈ khi dùng Chrome thường).
  *Acceptance (THẬT):* mở profile → vào `browserleaks.com/canvas`, `webgl-report.com`, `creepjs` →
  **chụp màn hình** cho thấy canvas/webgl hash khác giữa 2 profile và ỔN ĐỊNH khi mở lại cùng profile;
  timezone/UA khớp cấu hình. Lưu ảnh vào `docs/proof/`.
- **T1.4 — Chrome thường = chế độ "đã biết hạn chế".** Nếu user không có fp-chrome, cho phép chạy Chrome
  hệ thống nhưng **cảnh báo rõ** là không spoof native (chỉ JS injection cơ bản qua CDP nếu làm thêm).

### EPIC 2 — Proxy thật (2–3 ngày)
- **T2.1** ProxyManager `src/proxy/manager.js`: parse `http/https/socks5(+auth)`, **test** (live, IP, ping),
  **lookup IP→geo/timezone** (ipinfo/ip-api). *Acceptance:* nhập proxy auth → test trả IP + country thật.
- **T2.2** Truyền proxy có auth đúng cách: dùng **local auth relay** hoặc extension MV3 nền tảng
  `chrome.webRequest.onAuthRequired` (vì `--proxy-server` không nhận creds). *Acceptance:* profile dùng
  proxy auth mở được trang qua đúng IP proxy (browserleaks IP = IP proxy).
- **T2.3** **Auto đồng bộ** timezone/geo/`Accept-Language` của profile theo IP proxy khi gán. *Acceptance:*
  đổi proxy quốc gia khác → timezone profile tự đổi; CreepJS không báo lệch timezone↔IP.

### EPIC 3 — Cloud/Sync làm cho đúng (2–4 ngày)
- **T3.1** Nâng **E2EE → AES-256-GCM** + **salt ngẫu nhiên/profile** (lưu salt kèm blob), tăng vòng KDF
  (scrypt N cao hoặc Argon2). *Acceptance:* sửa 1 byte ciphertext → giải mã báo lỗi auth tag.
- **T3.2** **Envelope encryption + team key** (B2.2): Data Key/profile bọc bằng khoá user/team; chia sẻ
  trong team qua public key thành viên. *Acceptance:* user A backup, user B (cùng team) restore & mở được;
  user ngoài team không giải mã được.
- **T3.3** **Lock TTL + heartbeat**: client gửi heartbeat định kỳ khi profile đang mở; server có job quét
  checkout quá hạn (vd > 90s không heartbeat) → tự release. *Acceptance:* kill app giữa chừng → sau TTL,
  máy khác checkout được; có log audit.
- **T3.4** Hoàn thiện luồng blob upload qua **HTTP thật** từ client (đang có `uploadBlob` nhưng test lại
  ghi thẳng đĩa) + UI tiến độ. *Acceptance:* backup/restore cross-machine qua server thật, không ghi tắt.

### EPIC 4 — Automation Open API + SDK (3–4 ngày)
- **T4.1** Local API server trong Electron (`src/api/local-server.js`) `127.0.0.1:35000` token-protected:
  `POST /v1/profiles/:id/start` (trả `{port, wsEndpoint, pid}`), `stop`, `list`, `status`, `WS /v1/events`.
  *Acceptance:* `curl` start một profile → nhận `wsEndpoint`; Playwright `connectOverCDP(wsEndpoint)`
  điều khiển được đúng cửa sổ đã spoof.
- **T4.2** SDK mẫu `sdk/aether-node` + `sdk/aether-python` (gọi API trên, trả sẵn page). *Acceptance:*
  script mẫu login + screenshot chạy được.
- **T4.3** Sửa/sửa bỏ stub `GET /profiles/:id/start` sai trên sync server (C5).

### EPIC 5 — UI hoàn thiện (song song, 4–6 ngày)
- **T5.1** **Profile Editor** đầy đủ: tab Tổng quan / Fingerprint (Basic+Advanced: UA, screen, TZ, lang,
  WebGL vendor/renderer, fonts, hardware, WebRTC mode...) / Proxy / Startup. Nút Random + Lock fingerprint.
- **T5.2** Bulk actions (chọn nhiều: xoá, đổi proxy, đổi nhóm, export), cột **Thẻ/tags** có dữ liệu, group view.
- **T5.3** Trang **Proxy manager**, **Automation/Flow**, **Scheduler**, **Members/RBAC**, **Settings**
  (đường dẫn engine, ngôn ngữ) — thay các `alert()` stub bằng UI thật.
- **T5.4** Cookie manager (import/export JSON/Netscape) per profile.

### EPIC 6 — Kiểm thử thật, bỏ proof theater (1–2 ngày)
- **T6.1** Xoá/ă thay `proof-*.js` & `test-goal-completion.js` bằng test thật:
  - **Fingerprint test:** script Playwright mở profile qua local API, vào CreepJS/browserleaks, **trích
    số liệu thật** (canvas hash, webgl vendor, timezone, webdriver flag) và assert.
  - **Sync test:** chạy server thật + 2 "máy" (machineId khác), checkout conflict, E2EE round-trip qua HTTP.
- **T6.2** CI script chạy bộ test trên + lưu ảnh `docs/proof/`. *Acceptance:* test fail nếu fingerprint
  KHÔNG đổi giữa profile hoặc lệch timezone↔IP (không cho phép in "MET" khống).

### EPIC 7 — Dọn repo & bảo mật (0.5–1 ngày)
- **T7.1** `.gitignore`: `node_modules/`, `.proof-*`, `.test-sync-blob-*`, `*.db`, `server/data/`,
  `fingerprint-data/build/*.exe` (binary lớn — cân nhắc Git LFS hoặc để ngoài repo).
- **T7.2** Server: bật rate-limit, ép đổi `JWT_SECRET` qua env, thêm refresh token, chuẩn bị HTTPS/reverse proxy.
- **T7.3** README thật: cách cài (app + server), cách lấy engine, luồng dùng.

---

## PHẦN 4 — THỨ TỰ ĐỀ XUẤT (đường tới giành "lõi thật" nhanh nhất)
1. **EPIC 0** (chạy được) → 2. **EPIC 1** (anti-detect THẬT — quan trọng nhất) → 3. **EPIC 2** (proxy + đồng bộ TZ)
→ 4. **EPIC 6** (test thật để chốt lõi) → 5. **EPIC 4** (automation) → 6. **EPIC 3** (cloud đúng) →
7. **EPIC 5** (UI) → 8. **EPIC 7** (dọn + bảo mật).

> Ghi chú định hướng: nếu mục tiêu cuối vẫn là **native patch Chromium tự build** (theo
> `../New project/PLAN_UNDETECTED_BROWSER.md` phần B), thì `fp-chrome.exe` của GenLogin là bước đệm
> tuyệt vời để có "lõi thật" ngay; việc tự build Orbita có thể làm sau ở một epic riêng.

## PHẦN 5 — RỦI RO / LƯU Ý
- `fp-chrome.exe`/`fp-firefox.exe` là build của GenLogin (bản quyền bên thứ ba) — dùng nội bộ/nghiên cứu;
  cân nhắc pháp lý nếu phân phối. Đường dài nên tự build engine (Plan phần B).
- Engine GenLogin 1.5.x có thể đã cũ → **fingerprint drift**; cần đo CreepJS để biết còn "qua" được không.
- Chỉ dùng cho mục đích hợp pháp (đa tài khoản, QA, privacy); tuân thủ ToS nền tảng.
