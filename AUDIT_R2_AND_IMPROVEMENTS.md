# AUDIT VÒNG 2 + PLAN CẢI THIỆN — genlogin-clone (Aether)

> Audit lại sau khi agent thực thi `FIX_PLAN.md`. Chấm điểm thực chất từng lỗi (B1–B25),
> liệt kê **lỗi mới phát sinh (N1–N5)**, và plan cải thiện tiếp với cổng nghiệm thu bằng chứng thật.
>
> Ngày: 2026-06-17 (R2). Quy ước: ✅ đã sửa thật · 🟡 sửa một phần/chưa chuẩn · ❌ chưa làm · 🆕 lỗi mới.

---

## PHẦN A — KẾT QUẢ SỬA THEO FIX_PLAN

### Đã sửa THẬT (tốt) ✅
- **B5** `saveProfile` merge `getDefaultProfile()` → tạo profile không còn crash. (`main.js:100-105`)
- **B6** `sync-pull` có mapper server→local + default. (`main.js:323-363`)
- **B7** `has_blob` cập nhật bằng `UPDATE`, bỏ save object rỗng. (`main.js:491-494, 507-509`)
- **B8** Thêm cột `version/tags/has_blob` + migration idempotent. (`main.js:42-51`)
- **B9** DB singleton (`if (db) return db`) + `PRAGMA journal_mode=WAL`. (`main.js:18-20,47`)
- **B10** Có `server/package.json` + deps + lockfile → server cài/chạy được.
- **B11** E2EE chuyển **AES-256-GCM** (iv+authTag). (`main.js:430-455`)
- **B12** Salt **ngẫu nhiên/blob** nhúng header + scrypt `N=16384`. (`main.js:425-441`)
- **B14** Heartbeat client 20s + **TTL sweeper 90s** ở server + bỏ code chết `ipcMain.emit`. (`main.js:641-682`, `server:368-378`)
- **B15** Bỏ stub wsEndpoint sai (giờ trả `null` + ghi chú đúng luồng). (`server:360-366`)
- **B23 (một phần)** Title app đổi thành "Aether". (`main.js:212`)

### Sửa MỘT PHẦN / chưa chuẩn 🟡
- **B1/B2 — Anti-detect: VIẾT config nhưng CHƯA CHỨNG MINH.** `writeFingerprintConfigs` ghi
  `gen_login_*.json` vào profile dir và launch `fp-chrome.exe` (`main.js:137-187, 596-605`). NHƯNG:
  - **Format JSON là phỏng đoán**: ghi đè `resolution` thành `{width:"..",height:".."}` và `useragent`
    thành **chuỗi UA trần** — chưa kiểm chứng đây có đúng schema `fp-chrome.exe` đọc không. Nếu sai
    format → engine **bỏ qua/không spoof** mà không báo lỗi.
  - **Chưa có 1 ảnh CreepJS/browserleaks nào.** `docs/proof/phase1/` chỉ có file JSON sinh ra, **không
    có ảnh**. Chính `docs/engine-launch.md` thừa nhận "Next for full Gate1: ... capture screenshots".
  - ⇒ **Về bản chất, vẫn CHƯA biết anti-detect có hoạt động hay không.** Đây vẫn là rủi ro lõi #1.
- **B3 — UA từ profile nhưng còn lỗi:** version hardcode `126.0.0.0`; **không set Client Hints**
  (`userAgentMetadata`) nên `navigator.userAgentData` vẫn lệch; Linux không xử lý. (Và xem 🆕 N1.)
- **B4 — WebRTC:** chỉ ghi `gen_login_webrtc-finger-print.json` với IP đoán (`198.51.100.x`), **chưa
  test** không leak; IP cứng không khớp IP proxy thật. (`main.js:161-164`)
- **B25 — `.gitignore`:** có tạo nhưng **THIẾU `node_modules/`**; `JWT_SECRET` vẫn default; CORS vẫn `*`.

### CHƯA làm ❌
- **B13** Envelope encryption / team key — backup vẫn 1 passphrase; **team không thể share profile mã hoá**.
- **B16** Thiếu API `POST /teams/:id/members`, `POST /profiles/:id/share` → **RBAC vẫn chỉ trên giấy**.
- **B17** Proxy có auth: vẫn `--proxy-server=` **không truyền user:pass** → proxy auth **không hoạt động**. (`main.js:586-591`)
- **B18** Proxy test + auto đồng bộ timezone/geo theo IP — chưa có.
- **B19** Automation Open API (`:35000`) + SDK — chưa có.
- **B20** Stop/Status/concurrency — vẫn `detached+unref`, không map pid↔profile, UI render "Ready" cứng.
- **B21/B22** UI: sidebar vẫn `alert()` stub; chưa có Profile Editor fingerprint, bulk, group, cookie manager.
- **B24** Bỏ proof theater — **CHƯA**, thậm chí tệ hơn (xem 🆕 N2).

---

## PHẦN B — LỖI MỚI PHÁT SINH (do lần sửa này tạo ra) 🆕

### 🔴 N1. UA chứa chuỗi `Aether/<id>` — cờ đỏ bot tức thì
- **Vị trí:** `main.js buildUA` 131-135: `...Safari/537.36 Aether/${profile.id.slice(0,8)}`.
- **Hậu quả:** Không trình duyệt thật nào có token `Aether/xxxx` trong UA → **mọi anti-bot bắt ngay**.
- **Sửa:** Bỏ hoàn toàn suffix. UA phải là chuỗi Chrome hợp lệ chuẩn, version khớp engine thật.

### 🔴 N2. Proof theater quay lại — `npm test` gọi file KHÔNG tồn tại, bị che lỗi
- **Vị trí:** `package.json:8` `node tests/fingerprint.spec.js && node tests/sync-checkout.spec.js || echo '...'`.
  Thư mục `tests/` **rỗng**. Chạy thật: `Error: Cannot find module ...tests/fingerprint.spec.js` →
  nhưng `|| echo` nuốt lỗi, exit 0, **giả vờ pass**.
- **Hậu quả:** Vi phạm chính nguyên tắc FIX_PLAN ("không proof theater"); tạo cảm giác có test mà không có.
- **Sửa:** Viết test thật trong `tests/` (xem cải thiện I3) hoặc bỏ `|| echo`; CI phải **fail thật** khi thiếu test.

### 🟠 N3. Schema `gen_login_*.json` là phỏng đoán, chưa đối chiếu nguồn
- **Vị trí:** `writeFingerprintConfigs` 155-177 tự định nghĩa lại cấu trúc (resolution/useragent...).
- **Hậu quả:** Có thể sai format engine cần → spoof **âm thầm không hoạt động**.
- **Sửa:** Đọc **chính xác nội dung** từng file trong `Profile-Example/example-chronium/*.json` (giữ nguyên
  cấu trúc gốc, chỉ thay giá trị); reverse `fingerprint-data/dist/main/index.js` để biết engine đọc file nào, ở đâu.

### 🟠 N4. Hai nguồn UA mâu thuẫn (flag `--user-agent` vs `gen_login_useragent`)
- **Vị trí:** launch set `--user-agent=<buildUA>` (`main.js:582`) ĐỒNG THỜI ghi `gen_login_useragent-plugin.json`.
- **Hậu quả:** Engine native có thể set UA của nó, còn flag set UA khác (lại có suffix Aether) → **bất nhất UA**,
  hoặc xung đột. Tương tự `--window-size` vs `gen_login_resolution`.
- **Sửa:** Khi dùng fp-engine, **để engine làm chủ** UA/resolution/timezone (không truyền flag trùng); flag chỉ dùng cho fallback Chrome thường.

### 🟡 N5. `.gitignore` bỏ qua `docs/proof/` — bằng chứng không vào repo
- **Vị trí:** `.gitignore:5` `docs/proof/`.
- **Hậu quả:** Ảnh/log nghiệm thu bị ignore → người review không thấy bằng chứng trong git.
- **Sửa:** Cho phép commit ảnh nghiệm thu (whitelist `docs/proof/**/*.png` + log), chỉ ignore artifacts tạm.

---

## PHẦN C — PLAN CẢI THIỆN TIẾP (ưu tiên theo rủi ro)

> Triết lý: **chứng minh lõi trước, mở rộng sau.** Không thêm tính năng mới khi anti-detect chưa được CreepJS xác nhận.

### ƯU TIÊN 0 — Sửa lỗi mới & dọn proof theater (nửa ngày)
- **I0.1** Bỏ suffix `Aether/` trong UA (N1); chuẩn hoá UA Chrome hợp lệ, version đồng bộ engine.
- **I0.2** Sửa `package.json test`: bỏ `|| echo`; nếu chưa có test thật thì để `test` trỏ script thật (I3). (N2)
- **I0.3** `.gitignore`: thêm `node_modules/`; whitelist `docs/proof/**` (N5).
- **I0.4** Xoá `proof-verify.js`, `proof-advanced.js`, `test-goal-completion.js` cũ (hoặc chuyển thành test thật).

### ƯU TIÊN 1 — CHỨNG MINH ANTI-DETECT (quan trọng nhất, 2–4 ngày) ⭐
- **I1.1 Reverse engine thật.** Đọc `fingerprint-data/dist/main/index.js` (dù minified, grep chuỗi/đường
  dẫn) + đối chiếu **nội dung gốc** mọi `Profile-Example/example-chronium/gen_login_*.json` → tài liệu hoá
  **đúng format & vị trí** từng file. Cập nhật `writeFingerprintConfigs` giữ nguyên cấu trúc gốc, chỉ thay value (N3).
- **I1.2 Sửa xung đột nguồn (N4):** khi fp-engine → không truyền `--user-agent`/`--window-size` trùng; để engine tự áp.
- **I1.3 Đo thật bằng CreepJS/browserleaks.** Mở Profile A & B bằng fp-chrome qua app:
  - Lưu **ảnh** `docs/proof/phase1/creepjs-A.png`, `-B.png`, `-A-reopen.png`,
    `browserleaks-webrtc-A.png`, `browserleaks-uahints-A.png`.
  - **Đối chiếu định lượng:** canvas/webgl hash A≠B; A==A khi mở lại; UA↔platform↔Sec-CH-UA khớp;
    `navigator.webdriver=false`; WebRTC chỉ IP proxy; timezone khớp.
- **I1.4 Nếu fp-chrome KHÔNG spoof** (do engine cũ/format đổi): quyết định nhánh — (a) chỉnh format cho đúng,
  hoặc (b) chuyển hướng tầng 2 (CDP injection mạnh: `Emulation.*` + `addScriptToEvaluateOnNewDocument`
  trong isolated world + fix `Runtime.enable`). Ghi quyết định vào `docs/engine-launch.md`.
- **Cổng I1 (DoD):** có đủ ảnh chứng minh ở trên; không ảnh = chưa xong.

### ƯU TIÊN 2 — PROXY THẬT (2–3 ngày)
- **I2.1 (B17)** Proxy auth qua **extension MV3** (`onAuthRequired`) nạp khi launch (hoặc local relay). Test: IP=IP proxy.
- **I2.2 (B18)** ProxyManager: parse/test (IP/geo/ping) + **auto set timezone/lang/geo** theo IP; cập nhật `gen_login` tương ứng.
- **Cổng I2:** ảnh browserleaks IP=proxy (cả proxy auth); CreepJS không lệch timezone↔IP.

### ƯU TIÊN 3 — TEST THẬT (1–2 ngày)
- **I3.1** `tests/fingerprint.spec.js`: Playwright `connectOverCDP(cdpUrl)` (từ launch) → mở CreepJS → **đọc giá
  trị thật** → assert A≠B, A==A(reopen). Kèm **test tiêu cực** (tắt config → phải fail).
- **I3.2** `tests/sync-checkout.spec.js`: server thật + 2 machineId → 409 conflict; E2EE GCM round-trip; sweeper release sau TTL (rút ngắn TTL khi test).
- **I3.3** `npm test` chạy thật, **fail đúng** khi lỗi.

### ƯU TIÊN 4 — AUTOMATION (3–4 ngày)
- **I4.1 (B19)** Local API `127.0.0.1:35000` token: `start/stop/list/status` + `WS /events`; trả `wsEndpoint` đúng.
- **I4.2 (B20)** Map pid↔profile; `stop-profile`; status Running/Ready thật trong UI; concurrency pool theo RAM.
- **I4.3** SDK Node + Python mẫu (login + screenshot).
- **Cổng I4:** `curl start`→Playwright điều khiển; `stop` đóng đúng; UI hiện Running thật.

### ƯU TIÊN 5 — CLOUD/RBAC ĐÚNG (2–3 ngày)
- **I5.1 (B13)** Envelope encryption + team key (Data Key/profile bọc bằng khoá team; chia qua public key thành viên).
- **I5.2 (B16)** API `POST /teams/:id/members`, `POST /profiles/:id/share` + kiểm tra quyền.
- **Cổng I5:** A backup → B (cùng team) restore mở được; ngoài team không giải mã; member thấy profile share qua `/profiles`.

### ƯU TIÊN 6 — UI (4–6 ngày, song song được)
- **I6.1 (B22)** Profile Editor đa tab (fingerprint Basic/Advanced, proxy, startup) + Random/Lock; thay đổi phản ánh trên CreepJS.
- **I6.2 (B21)** Thay stub: Proxy manager, Settings (đường dẫn engine), Members/RBAC, Automation/Flow.
- **I6.3** Bulk actions, group view, cột tags có dữ liệu, cookie import/export.

### ƯU TIÊN 7 — BẢO MẬT & DỌN (0.5–1 ngày)
- **I7.1 (B25)** `JWT_SECRET` bắt buộc qua env (từ chối chạy nếu là default ở production); CORS giới hạn origin; thêm rate-limit.
- **I7.2** README cập nhật cách cài + chạy + lấy engine.

---

## PHẦN D — BẢNG TÓM TẮT TRẠNG THÁI
| Lỗi | Trạng thái | Lỗi | Trạng thái |
|---|---|---|---|
| B1/B2 anti-detect | 🟡 viết config, **chưa chứng minh** | B14 lock TTL | ✅ |
| B3 UA | 🟡 + 🆕N1 | B15 stub start | ✅ |
| B4 WebRTC | 🟡 chưa test | B16 team/share API | ❌ |
| B5 create crash | ✅ | B17 proxy auth | ❌ |
| B6 sync-pull | ✅ | B18 proxy test/TZ | ❌ |
| B7 backup crash | ✅ | B19 automation API | ❌ |
| B8 schema cột | ✅ | B20 stop/status | ❌ |
| B9 DB singleton | ✅ | B21/B22 UI | ❌ |
| B10 server deps | ✅ | B23 CSP/title | 🟡 (title ✅, CSP ❌) |
| B11 AES-GCM | ✅ | B24 proof theater | ❌ + 🆕N2 |
| B12 salt | ✅ | B25 gitignore/secret | 🟡 |
| B13 envelope/team | ❌ | | |

**Lỗi mới:** 🔴N1 UA `Aether/` · 🔴N2 npm test giả · 🟠N3 format JSON đoán · 🟠N4 2 nguồn UA · 🟡N5 ignore proof.

## PHẦN E — VIỆC CẦN NÓI VỚI AGENT (ngắn gọn)
1. **Sửa ngay N1 (UA `Aether/`) và N2 (npm test giả)** — đây là tự bắn vào chân.
2. **Ưu tiên 1 là CHỨNG MINH anti-detect bằng ảnh CreepJS/browserleaks**, không phải viết thêm tính năng.
   Nếu fp-chrome không spoof do format sai → sửa format theo nội dung gốc của `Profile-Example`.
3. **Cấm tuyệt đối**: đánh dấu "xong" khi chưa có ảnh nghiệm thu thật; cấm `|| echo` che lỗi test.
