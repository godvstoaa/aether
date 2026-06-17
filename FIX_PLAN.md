# FIX PLAN HOÀN CHỈNH — genlogin-clone (Aether)

> Đây là plan để **làm lại cho đúng**. Liệt kê **toàn bộ lỗi đã phát hiện**, mổ xẻ từng lỗi
> (vị trí · nguyên nhân gốc · hậu quả · cách sửa · cách kiểm thử), chia theo **phase thực thi**,
> và **cổng nghiệm thu (Definition of Done)** yêu cầu **bằng chứng thật** — KHÔNG chấp nhận in "MET".
>
> Quy ước mức độ: 🔴 chặn/sai lõi · 🟠 nặng · 🟡 trung bình · ⚪ nhẹ/dọn dẹp.
> Quy ước verify: mỗi task chỉ được đánh ✅ khi có **lệnh chạy thật + output/ảnh** dán vào `docs/proof/`.

---

## PHẦN A — SỔ ĐĂNG KÝ LỖI (BUG REGISTRY) ĐẦY ĐỦ

### Nhóm 1 — LÕI ANTI-DETECT (giá trị cốt lõi)

#### 🔴 B1. Anti-detect hoàn toàn giả — không spoof gì
- **Vị trí:** `main.js` `launch-profile` (≈393–552), đặc biệt khối inject 483–504.
- **Nguyên nhân:** App spawn Chrome/Edge thường; ghi `aether-inject.js` ra đĩa **nhưng không hề nạp**
  (không CDP `Page.addScriptToEvaluateOnNewDocument`, không `--load-extension`). Inject chỉ có `console.log`
  + override `toDataURL` "rỗng" (gọi lại bản gốc, không thêm noise) và 2 dòng `navigator` vô nghĩa vì script không chạy.
- **Hậu quả:** Canvas/WebGL/Audio/Fonts/WebRTC/Timezone/ClientRects **không bị thay đổi** → fingerprint = máy thật → lộ 100%.
- **Sửa:** Bỏ cơ chế inject giả. Dùng đúng động cơ: ghi bộ `gen_login_*.json` vào user-data-dir rồi chạy `fp-chrome.exe` (xem B2, B4).
- **Test:** Mở 2 profile khác cấu hình → CreepJS/browserleaks cho canvas/webgl hash **khác nhau**; mở lại cùng profile → hash **giống** (ảnh trong `docs/proof/`).

#### 🔴 B2. Không dùng động cơ thật `fp-chrome.exe` + `gen_login_*.json`
- **Vị trí:** `main.js` `findChrome()` 75–90 (engine chỉ là fallback cuối), launch 393+.
- **Nguyên nhân:** Theo `fingerprint-data/README.md`, anti-detect đến từ trình duyệt patch đọc các file
  `gen_login_*.json` trong profile dir. Code không sinh, không ghi các file này; ưu tiên Chrome hệ thống.
- **Hậu quả:** Tài sản mạnh nhất (engine + schema) bị bỏ không.
- **Sửa:** Reverse cách launch của GenLogin gốc (`fingerprint-data/dist/main/index.js` + đối chiếu
  `Profile-Example/example-chronium/`) → xác định **vị trí & format** file config → tạo `FingerprintEngine`
  sinh config nhất quán → ghi vào profile dir → spawn `fp-chrome.exe` làm engine mặc định.
- **Test:** Tài liệu `docs/engine-launch.md` mô tả chính xác; demo mở `fp-chrome.exe` với config sinh ra, CreepJS pass.

#### 🔴 B3. UserAgent hardcode, bất nhất với profile
- **Vị trí:** `main.js:469` (`Chrome/126...` cứng), lặp lại ở `proof-advanced.js:90`.
- **Nguyên nhân:** UA không lấy từ `profile.platform`/version; không set Client Hints (`Sec-CH-UA`).
- **Hậu quả:** UA luôn là Win/Chrome126 dù profile khai Mac/Linux/version khác → lệch UA↔platform↔CH → cờ đỏ.
- **Sửa:** UA + `userAgentMetadata` (Client Hints) sinh từ fingerprint của profile, khớp platform/version/GPU.
- **Test:** browserleaks/Client-Hints: UA, platform, Sec-CH-UA, JS `navigator.*` **đồng bộ**.

#### 🟠 B4. WebRTC leak IP thật chưa xử lý
- **Vị trí:** chưa có code; launch không cấu hình WebRTC.
- **Hậu quả:** Dù có proxy, WebRTC lộ IP thật → liên kết tài khoản.
- **Sửa:** Trong config engine bật chế độ ép WebRTC theo IP proxy / tắt host candidate (engine GenLogin có
  `gen_login_webrtc-finger-print.json`).
- **Test:** browserleaks.com/webrtc → chỉ thấy IP proxy, không thấy IP nội bộ/thật.

### Nhóm 2 — LÕI CRUD / DATABASE (làm hỏng luồng cơ bản)

#### 🔴 B5. Tạo profile từ UI làm CRASH (thiếu named params)
- **Vị trí:** `index.html` `quickAdd` 340–359 & `createProfileFromModal` 373–393 → `saveProfiles` →
  `main.js saveProfile` 64–68.
- **Nguyên nhân:** `saveProfile` dùng SQL `@id,@name,@location,@group_name,@platform,@note,@proxy,@startup_url,
  @fingerprint_preset,@resolution,@timezone,@lang,@hardware_concurrency,@device_memory,@status,@proxy_status,
  @last_opened,@updated,@created`. Object từ UI chỉ có `{id,name,location,platform,tags,note,proxy,updated,lastOpened,status}`
  → **thiếu** `group_name, startup_url, fingerprint_preset, resolution, timezone, lang, hardware_concurrency,
  device_memory, proxy_status, last_opened, created`. `better-sqlite3` ném `Missing named parameter`.
- **Hậu quả:** **Bấm "Tạo" là lỗi** (chức năng cơ bản nhất hỏng). `lastOpened`(camel) không khớp `last_opened`.
- **Sửa:** Chuẩn hoá một **DefaultProfile factory** điền đủ field + đúng tên cột; hoặc `saveProfile` tự
  merge default cho field thiếu. Thống nhất snake_case toàn bộ.
- **Test:** Tạo profile qua modal + Thêm Nhanh → không lỗi, reload còn nguyên, đủ field.

#### 🔴 B6. `sync-pull` ném exception (schema lệch client↔server)
- **Vị trí:** `main.js sync-pull` 226–239 → `saveProfile({...sp, location:'cloud'})`.
- **Nguyên nhân:** Server trả cột `created_at/updated_at/owner_user_id/blob_updated_at/last_synced...`,
  **không có** `created/updated/status/proxy_status/last_opened/startup_url...` mà `saveProfile` đòi.
- **Hậu quả:** Pull metadata cloud **luôn lỗi**.
- **Sửa:** Viết **mapper server→local** (đổi tên cột + điền default) trước khi lưu; đừng nhồi raw row.
- **Test:** Tạo profile cloud trên server → pull về client → hiển thị đúng, không lỗi.

#### 🔴 B7. `sync-backup-cloud-profile` ném exception khi profile vắng
- **Vị trí:** `main.js` 344–359 (và restore 361–375): `const prof = loadProfiles().find(...) || {}; prof.has_blob=1; saveProfile(prof)`.
- **Nguyên nhân:** Nếu `|| {}` → `saveProfile({has_blob:1})` thiếu mọi named param → crash. `has_blob`
  **không có trong câu INSERT** nên dù có prof, cờ `has_blob` cũng bị bỏ.
- **Sửa:** Thêm cột `has_blob` vào schema + câu lệnh; không lưu object rỗng; cập nhật cờ bằng UPDATE riêng.
- **Test:** Backup/restore profile → `has_blob` lưu đúng, không crash.

#### 🟠 B8. Schema drift: `version`, `tags`, `has_blob` không tồn tại nhưng bị dùng
- **Vị trí:** schema 20–42; dùng `sp.version`/`local.version` (233, 248), `p.tags` (UI 291), `prof.has_blob` (356,372).
- **Hậu quả:** Logic version (conflict resolution) vô nghĩa (luôn undefined→0); tags không bao giờ lưu.
- **Sửa:** ALTER TABLE thêm `version INTEGER DEFAULT 0`, `tags TEXT DEFAULT ''`, `has_blob INTEGER DEFAULT 0`
  + migration idempotent; đưa vào `saveProfile`.
- **Test:** Gán tag → reload còn; push 2 lần → version tăng.

#### 🟠 B9. Mở lại DB liên tục (rò handle)
- **Vị trí:** `initDb()` 18–43 gán `db = new Database(...)`; **mọi** hàm (`loadProfiles/saveProfile/deleteProfile`)
  gọi `initDb()` lại mỗi lần.
- **Hậu quả:** Mở nhiều kết nối SQLite tới cùng file, rò file handle, race tiềm ẩn.
- **Sửa:** Mở DB **một lần** lúc `app.whenReady` (singleton); các hàm dùng `db` đã mở. Bật `PRAGMA journal_mode=WAL`.
- **Test:** Thao tác 100 lần → không tăng handle bất thường; không lỗi "database is locked".

### Nhóm 3 — LÕI CLOUD / SYNC / E2EE / LOCK

#### 🔴 B10. Server không chạy được (thiếu deps & package.json)
- **Vị trí:** `server/index.js` require express/cors/helmet/jsonwebtoken/bcrypt/multer — **không khai báo,
  không cài, không có `server/package.json`**.
- **Hậu quả:** `cd server && npm start` fail → mọi tính năng cloud chết; test goal không thể pass thật.
- **Sửa:** Tạo `server/package.json` + deps + script; `npm i`.
- **Test:** `npm start` log "running on :3456"; `curl localhost:3456/` → `{ok:true}`.

#### 🔴 B11. E2EE yếu: AES-256-CBC không xác thực
- **Vị trí:** `main.js` 305–318 (`createCipheriv('aes-256-cbc'...)`), bản test 211–222.
- **Hậu quả:** Không có integrity/authentication (malleable); sai chuẩn plan (yêu cầu GCM).
- **Sửa:** Chuyển **AES-256-GCM** (lưu iv + authTag), verify tag khi giải mã.
- **Test:** Sửa 1 byte ciphertext → giải mã ném lỗi auth tag (không trả rác).

#### 🟠 B12. KDF dùng salt tĩnh dùng chung
- **Vị trí:** `main.js deriveKey` 301–303 salt `'aether-e2e-v1'` cố định cho mọi user/profile.
- **Hậu quả:** Cùng passphrase = cùng key; rainbow-table; không cô lập theo user/profile.
- **Sửa:** **Salt ngẫu nhiên/profile** lưu kèm blob header; tăng tham số scrypt (hoặc Argon2id).
- **Test:** 2 profile cùng passphrase → key/ciphertext khác; restore vẫn đúng nhờ salt lưu kèm.

#### 🟠 B13. Không có envelope encryption / chia khoá team → share mã hoá không hoạt động
- **Vị trí:** thiếu (plan B2.2).
- **Hậu quả:** Tính năng "team dùng chung profile mã hoá" trên thực tế không chạy cross-user.
- **Sửa:** Data Key/profile (random) bọc bằng khoá user/team; chia sẻ qua public key thành viên.
- **Test:** User A backup → user B cùng team restore mở được; user ngoài team **không** giải mã được.

#### 🟠 B14. Checkout lock: code chết + lock vĩnh viễn
- **Vị trí:** `main.js launch-profile` 408–457 (dòng `ipcMain.emit('sync-checkout',...)` vô tác dụng + block fetch trùng);
  server `/heartbeat` 327–332 tồn tại nhưng **client không gửi**; **không có TTL sweeper**.
- **Hậu quả:** Máy crash giữa chừng → profile **khoá vĩnh viễn**, không ai mở được (force phải thủ công).
- **Sửa:** Tách `doCheckout()` dùng chung; client gửi **heartbeat định kỳ** khi profile đang mở; server có
  **job quét** checkout quá hạn (>90s không heartbeat) → auto release + audit. Auto check-in khi đóng (đã có khung 519–539, cần hoàn thiện).
- **Test:** Máy1 checkout rồi kill app → sau TTL máy2 checkout được; log audit ghi auto-release.

#### 🟠 B15. Stub `/profiles/:id/start` trả wsEndpoint sai
- **Vị trí:** `server/index.js` 361–366 trả `ws://127.0.0.1:9222/...` cố định.
- **Hậu quả:** Sai máy (server ≠ client), sai port (random/launch ở client) → automation cloud vô dụng.
- **Sửa:** Bỏ stub; automation lấy `wsEndpoint` từ **local API của client** (xem B19), không từ server.
- **Test:** Không còn endpoint gây hiểu nhầm; tài liệu nêu rõ luồng đúng.

#### 🟡 B16. Thiếu API tạo team-member / share profile
- **Vị trí:** `server/index.js` có bảng `team_members`, `profile_shares` nhưng **không có endpoint** thêm
  thành viên / chia sẻ profile cho team.
- **Hậu quả:** RBAC chỉ tồn tại trên giấy; không cách nào set quyền thật.
- **Sửa:** Thêm `POST /teams/:id/members`, `POST /profiles/:id/share`, kiểm tra quyền owner/admin.
- **Test:** Owner mời member → member thấy profile chia sẻ qua `/profiles`.

### Nhóm 4 — PROXY

#### 🟠 B17. Proxy có auth không hoạt động
- **Vị trí:** `main.js` 473–478 (`--proxy-server=` không truyền user:pass).
- **Hậu quả:** Proxy `user:pass@host:port` **không đăng nhập được** → profile không ra net hoặc lộ IP thật.
- **Sửa:** Dùng **extension MV3 auth** (`chrome.webRequest.onAuthRequired`) nạp khi launch, hoặc **local proxy relay** chuyển auth.
- **Test:** Profile dùng proxy auth → browserleaks IP = IP proxy; trang load bình thường.

#### 🟠 B18. Không test proxy + không auto đồng bộ timezone/geo
- **Vị trí:** chưa có; proxy chỉ là text.
- **Hậu quả:** Không biết proxy sống/chết; timezone/locale lệch IP → bất nhất (cờ đỏ lớn).
- **Sửa:** `ProxyManager`: test (IP/geo/ping qua ip-api/ipinfo) + **auto set timezone/lang/geo** profile theo IP.
- **Test:** Đổi proxy quốc gia → timezone profile đổi theo; CreepJS không báo lệch timezone↔IP.

### Nhóm 5 — AUTOMATION

#### 🟠 B19. Không có Automation Open API + SDK
- **Vị trí:** thiếu trong Electron; chỉ `launch-profile` trả `debugPort`.
- **Hậu quả:** Không điều khiển được từ Selenium/Playwright/Puppeteer như mô tả; không có cổng cho công cụ ngoài.
- **Sửa:** Local API `127.0.0.1:35000` (token): `start` (trả `{port, wsEndpoint, pid}`), `stop`, `list`, `status`,
  `WS /events`; SDK Node/Python mẫu.
- **Test:** `curl start` → `connectOverCDP(wsEndpoint)` điều khiển đúng cửa sổ đã spoof; script SDK chạy.

#### 🟡 B20. Không có quản lý vòng đời tiến trình (stop / trạng thái thật)
- **Vị trí:** launch dùng `detached:true; child.unref()`; không lưu pid↔profile; UI render "Ready" cứng (index.html:296).
- **Hậu quả:** Không stop được từ app, không biết profile nào đang chạy; cột Trạng Thái sai sự thật.
- **Sửa:** Map `profileId→child`; handler `stop-profile`; cập nhật status Running/Ready realtime; concurrency pool theo RAM.
- **Test:** Mở → status Running + nút Dừng hoạt động; đóng → Ready; mở N profile có giới hạn.

### Nhóm 6 — UI

#### 🟡 B21. Phần lớn sidebar là `alert()` stub
- **Vị trí:** `index.html setActiveView` 437–459.
- **Hậu quả:** Proxy/Automation/Schedule/Members/Settings... không có chức năng thật.
- **Sửa:** Dần thay bằng view thật (ưu tiên: Profile Editor fingerprint, Proxy manager, Settings engine path).
- **Test:** Mỗi view có thao tác thật, không alert.

#### 🟡 B22. Thiếu Profile Editor (fingerprint/proxy), bulk, group, cookie manager
- **Hậu quả:** Không chỉnh được fingerprint chi tiết, không thao tác hàng loạt.
- **Sửa:** Editor đa tab + Random/Lock fingerprint; bulk actions; group view; cookie import/export.
- **Test:** Sửa từng vector fingerprint → áp dụng khi launch (đối chiếu CreepJS).

#### ⚪ B23. Thiếu CSP, tiêu đề app sai, phụ thuộc CDN
- **Vị trí:** `index.html` (Tailwind/FontAwesome CDN, không CSP); `main.js:115` title "GenLogin Clone".
- **Sửa:** Thêm CSP; cân nhắc bundle Tailwind offline; đổi title "Aether".

### Nhóm 7 — KIỂM THỬ & REPO

#### 🟡 B24. "Proof" là diễn (proof theater)
- **Vị trí:** `proof-verify.js` (dùng JSON file riêng, simulate launch, in "MET"), `proof-advanced.js`
  (chỉ in chuỗi lệnh), `test-goal-completion.js` (ghi blob thẳng đĩa thay vì HTTP, "simulate" launch).
- **Hậu quả:** Tuyên bố "hoàn thành" **không có giá trị**; che giấu việc lõi chưa chạy.
- **Sửa:** Thay bằng test thật (Playwright + CreepJS/browserleaks; sync round-trip qua HTTP thật).
- **Test:** Test **fail** nếu fingerprint không đổi giữa profile hoặc lệch timezone↔IP.

#### ⚪ B25. Repo bẩn / nhị phân lớn / bí mật mặc định
- **Vị trí:** `.proof-*`, `.test-sync-blob-*`, `*.db` lẫn trong repo; `fp-*.exe` 81MB; `JWT_SECRET` default; CORS `*`.
- **Sửa:** `.gitignore` đầy đủ; engine exe để ngoài repo hoặc Git LFS; `JWT_SECRET` qua env; siết CORS/rate-limit/HTTPS.

---

## PHẦN B — KẾ HOẠCH THỰC THI THEO PHASE

> Mỗi phase kết thúc bằng **Gate** (cổng nghiệm thu) ở Phần C. Không qua Gate → không sang phase sau.

### PHASE 0 — Nền móng & sửa lỗi chặn (B5, B6, B7, B8, B9, B10)
Mục tiêu: app + server chạy được, CRUD/sync không crash.
1. `server/package.json` + deps + `npm i` (B10).
2. DB singleton + WAL (B9).
3. Migration thêm cột `version/tags/has_blob` (B8) + DefaultProfile factory + chuẩn hoá snake_case (B5).
4. Mapper server→local cho `sync-pull` (B6); sửa backup/restore (B7).
**Gate 0:** xem C-Gate0.

### PHASE 1 — LÕI ANTI-DETECT THẬT (B1, B2, B3, B4) ⭐ quan trọng nhất
1. Reverse engine launch → `docs/engine-launch.md` (B2).
2. `FingerprintEngine` sinh `gen_login_*.json` nhất quán, seed theo profile.id (B2, B3).
3. Sửa `launch-profile`: ghi config + chạy `fp-chrome.exe`; UA/CH/TZ/res từ profile (B1, B3).
4. WebRTC theo IP proxy (B4).
**Gate 1:** xem C-Gate1 (CreepJS/browserleaks bằng ảnh).

### PHASE 2 — PROXY THẬT (B17, B18)
1. ProxyManager parse/test/geo.
2. Auth qua extension MV3 / relay.
3. Auto đồng bộ timezone/lang/geo theo IP.
**Gate 2:** C-Gate2.

### PHASE 3 — KIỂM THỬ THẬT (B24) — chốt lõi trước khi đi tiếp
1. Bỏ proof theater; viết `tests/fingerprint.spec.js` (Playwright qua local API → CreepJS) + `tests/sync.spec.js` (HTTP thật).
2. Script CI lưu ảnh `docs/proof/`.
**Gate 3:** C-Gate3.

### PHASE 4 — AUTOMATION API + SDK (B19, B20, B15)
1. Local API `:35000` + WS events.
2. Quản lý vòng đời (stop, status, concurrency).
3. Bỏ stub server sai; SDK Node/Python.
**Gate 4:** C-Gate4.

### PHASE 5 — CLOUD/E2EE/RBAC ĐÚNG (B11, B12, B13, B14, B16)
1. AES-GCM + salt/profile (B11, B12).
2. Envelope + team key (B13).
3. Lock TTL + heartbeat + sweeper (B14).
4. API team-member/share (B16).
**Gate 5:** C-Gate5.

### PHASE 6 — UI HOÀN THIỆN (B21, B22, B23)
1. Profile Editor fingerprint/proxy + Random/Lock.
2. Bulk/group/cookie manager.
3. Thay stub; CSP; title.
**Gate 6:** C-Gate6.

### PHASE 7 — DỌN REPO & BẢO MẬT (B25)
1. `.gitignore`, engine ra ngoài repo/LFS.
2. JWT env, CORS siết, rate-limit, hướng dẫn HTTPS.
**Gate 7:** C-Gate7.

---

## PHẦN C — QUY TRÌNH KIỂM THỬ & CỔNG NGHIỆM THU (bắt buộc, không proof theater)

### Nguyên tắc vàng
- **Bằng chứng > lời nói.** Mỗi Gate phải có: lệnh chạy thật + log/ảnh lưu trong `docs/proof/<phase>/`.
- **Tiêu cực test:** mỗi tính năng phải có 1 test "phải-fail-đúng-lúc" (vd fingerprint KHÔNG đổi → test fail).
- Công cụ đo fingerprint: **CreepJS** (abrahamjuliot/creepjs), `browserleaks.com` (canvas/webgl/webrtc),
  `iphey.com`, `pixelscan`; đo CDP: `rebrowser-bot-detector`; bot: `fingerprintjs/botd`.

### C-Gate0 (Nền móng) — PASS khi:
- [ ] `npm start` (app) mở UI; `cd server && npm start` log running; `curl localhost:3456/` = `{ok:true}`.
- [ ] Tạo profile qua modal **và** Thêm Nhanh: **không lỗi**, reload còn đủ field (ảnh + log).
- [ ] `sync-pull` từ server có ≥1 profile cloud: hiển thị đúng, **không exception** (log).
- [ ] Backup→restore 1 profile: không crash, `has_blob=1` (log DB).
- [ ] Chạy 200 thao tác CRUD liên tục: không "database is locked", không rò handle.

### C-Gate1 (Anti-detect lõi) — PASS khi:
- [ ] Mở Profile A và Profile B (cấu hình khác) bằng `fp-chrome.exe` qua app.
- [ ] **CreepJS:** ảnh cho thấy A và B có canvas/webgl/audio hash **khác nhau**; `trust score` đạt ngưỡng đặt ra (ghi rõ ngưỡng).
- [ ] Mở lại Profile A lần 2: hash **giống** lần 1 (tính bền vững) — ảnh so sánh.
- [ ] **browserleaks:** UA ↔ platform ↔ Sec-CH-UA ↔ navigator **đồng bộ**; timezone khớp cấu hình; `navigator.webdriver` = false.
- [ ] **WebRTC (browserleaks):** không lộ IP thật.
- [ ] Lưu toàn bộ ảnh `docs/proof/phase1/`.
> ❌ Không được đánh hoàn thành nếu chỉ có `console.log('[Aether] injected...')`.

### C-Gate2 (Proxy) — PASS khi:
- [ ] Proxy **không auth**: browserleaks IP = IP proxy (ảnh).
- [ ] Proxy **có auth**: mở được, IP = IP proxy (ảnh) — chứng minh B17 đã sửa.
- [ ] Đổi proxy sang quốc gia khác → timezone/lang profile tự đổi; CreepJS không báo lệch timezone↔IP (ảnh).
- [ ] Test proxy chết → UI báo FAIL đúng.

### C-Gate3 (Test thật) — PASS khi:
- [ ] `npm test` chạy `tests/fingerprint.spec.js`: tự mở profile qua local API, vào CreepJS, **đọc giá trị thật**
  (canvas hash, webgl vendor, timezone, webdriver) và assert A≠B, A==A(reopen).
- [ ] Có **test tiêu cực**: tạm tắt spoof → test **fail** (chứng minh test có thật).
- [ ] `tests/sync.spec.js`: server thật + 2 machineId → checkout conflict 409; E2EE round-trip qua HTTP.
- [ ] Xoá sạch `proof-verify.js`/`proof-advanced.js`/`test-goal-completion.js` cũ (hoặc thay nội dung thật).

### C-Gate4 (Automation) — PASS khi:
- [ ] `curl -H token POST :35000/v1/profiles/:id/start` → trả `wsEndpoint`; Playwright `connectOverCDP` chụp màn hình trang (ảnh).
- [ ] `stop` đóng đúng tiến trình; `status` phản ánh Running/Ready thật.
- [ ] SDK Node + Python: script mẫu login+screenshot chạy (log).
- [ ] Mở N=5 profile qua API: pool giới hạn hoạt động, không treo máy.

### C-Gate5 (Cloud/E2EE/RBAC) — PASS khi:
- [ ] Sửa 1 byte ciphertext → giải mã ném lỗi auth tag (test GCM).
- [ ] 2 profile cùng passphrase → ciphertext khác (salt/profile); restore vẫn đúng.
- [ ] User A backup → user B (cùng team) restore mở được; user ngoài team **không** giải mã (test).
- [ ] Máy1 checkout rồi kill → sau TTL máy2 checkout được; audit ghi auto-release.
- [ ] Owner thêm member + share profile → member thấy qua `/profiles`.

### C-Gate6 (UI) — PASS khi:
- [ ] Profile Editor sửa được từng vector fingerprint; Random/Lock hoạt động; thay đổi phản ánh trên CreepJS.
- [ ] Bulk (đổi proxy/nhóm/xoá nhiều), group view, cookie import/export chạy thật (ảnh/clip).
- [ ] Không còn `alert()` stub ở các mục đã làm; có CSP; title "Aether".

### C-Gate7 (Dọn & bảo mật) — PASS khi:
- [ ] `git status` sạch (không `.proof-*`, `*.db`, blob, exe lớn trong tracking).
- [ ] Server chạy với `JWT_SECRET` từ env; CORS giới hạn; rate-limit bật; README hướng dẫn HTTPS.

---

## PHẦN D — CHECKLIST CHỐT "HOÀN THÀNH TOÀN DỰ ÁN"
Chỉ tuyên bố hoàn thành khi **TẤT CẢ** đúng (kèm bằng chứng `docs/proof/`):
- [ ] Tất cả Gate 0→7 PASS, ảnh/log đầy đủ.
- [ ] CreepJS: nhiều profile khác fingerprint, ổn định khi mở lại, không lệch timezone↔IP↔UA.
- [ ] Proxy auth hoạt động; không WebRTC leak.
- [ ] Automation: điều khiển qua Playwright/SDK trên profile đã spoof.
- [ ] Cloud: E2EE-GCM, lock TTL chống khoá vĩnh viễn, team share thật.
- [ ] CRUD cơ bản không còn crash; không proof theater (test thật + test tiêu cực).
- [ ] Repo sạch, bảo mật server tối thiểu đạt.

> Lưu ý pháp lý: `fp-chrome.exe`/`fp-firefox.exe` là build bên thứ ba (GenLogin) — dùng nội bộ/nghiên cứu;
> hướng bền vững là tự build engine (xem `../New project/PLAN_UNDETECTED_BROWSER.md` phần B). Chỉ dùng hợp pháp.
