# Sheet Machine 改善計畫

> 2026-07 健檢後的改善路線圖。npm 套件已於 2026-07-07 全面升級完成（Vite 8 / Vue 3.5 / Element Plus 2.14，漏洞 7→0，部署 @149）。
>
> **執行狀態（2026-07-07 確認開工）**：Phase 1 → Phase 2 依序執行；Phase 3 待暑假時段。
>
> **✅ Phase 1、Phase 2 已於 2026-07-07 完成並部署為 @150**。
>
> **✅ Phase 3 已於 2026-07-07 完成（未部署）**：ESLint+Prettier（flat config，含 `vue/no-undef-properties`
> 模板綁定檢查）、Vitest 48 個測試、App.vue 拆分為 `<script setup>` + composables + FormField 元件、
> 孤兒檔移入 `tools/`。與計畫的差異：測試 chunk 切割時順手把 Code.js 的切塊邏輯抽成 `chunkPayload_`；
> 另統一了重複邏輯（`findPrimaryKey`/`findGmailPrimary`/`buildQueuePayload`/`plainClone`）。
> 待辦：實機驗證完整填答流程後再部署。
>
> Phase 1、2 實作與計畫的差異：
> 1. showdown 有無修復版的 ReDoS 漏洞（GHSA-rmmh-p597-ppvv），改用 `marked`（App.vue 原本就有註解掉的 marked 呼叫），連結開新分頁改由 DOMPurify hook 處理
> 2. 檔案上傳欄位**有**納入線上暫存——檔案在選取時就已上傳 Drive，暫存的只是連結參照（與匯入暫存檔的行為一致）
> 3. 待管理者設定：ScriptProperties 新增 `draftSheetID`（暫存專用試算表的 ID，部署帳號需有編輯權），未設定前功能自動隱藏

---

## Phase 1：安全修補（半天，低風險）

### 1-1. v-html XSS 防護 + showdown 納入 bundle

**問題**：
- `HTMLConverter()`（App.vue:1113）用 showdown 轉出的 HTML 未經消毒，直接餵給 4 處 `v-html`（App.vue:20、66、309、313）
- showdown 從 unpkg CDN 裸載入（index.html:10），未鎖版本、無 SRI，upstream 改版或被污染會直接影響表單

**做法**：
1. `npm install showdown dompurify`
2. index.html 移除 unpkg 的 showdown `<script>`
3. App.vue import showdown 與 DOMPurify，`HTMLConverter` 改為 `DOMPurify.sanitize(converter.makeHtml(msg))`
4. PapaParse 維持 CDN（已鎖版本 + SRI），或順手一起打進 bundle

### 1-2. 匯出加密改用隨機 salt（保留向下相容）

**問題**：PBKDF2 salt 硬編碼 `'sheet-machine-salt'`（App.vue:737），全體使用者共用。

**做法**：
1. 加密時：`crypto.getRandomValues` 產生 16-byte salt，格式改為 `[版本旗標(1B)][salt(16B)][IV(12B)][密文]`
2. 解密時：先讀版本旗標判斷新舊格式，舊格式 fallback 到固定 salt → **舊匯出檔仍可匯入**
3. 順手修 `btoa(String.fromCharCode.apply(null, combined))`（App.vue:761）大資料堆疊風險，改為分段轉換

### 1-3. Code.js 基礎強化

- `queryPC()`（Code.js:220）對使用者輸入做 `encodeURIComponent` 再拼 URL
- 主要進入點（doGet、getQList、readRecord、writeRecord、saveFile）加 try/catch + `console.error` 記錄（Stackdriver 已啟用）
- 清掉殘留 7 處 `var`（Code.js:5、6、9、119、142、650、651）

---

## Phase 2：新功能「線上暫存」

### 需求（2026-07-07 已確認）

讓使用者把目前填寫進度存到雲端，換裝置/換瀏覽器可以還原。設計決策：

| 決策 | 選擇 |
|------|------|
| 存放位置 | **獨立的 Google Sheet**（與回答試算表分開） |
| 觸發方式 | **手動按鈕**（localStorage 自動暫存維持現狀當雙保險） |
| 加密 | **明文**（管理者本來就看得到正式回答，邏輯一致） |

### 後端（src/Code.js）

**設定**：ScriptProperties 新增 `draftSheetID`，指向管理者建立的獨立試算表。未設定時功能自動隱藏（`getQList` 回傳 `draftEnabled` 旗標）。

**暫存分頁結構**（一個問卷一個分頁，分頁名 = 問卷 ID，比照現有慣例）：

| 主鍵 | 更新時間 | chunk_1 | chunk_2 | ... |
|------|----------|---------|---------|-----|

- 暫存內容為 JSON 字串（沿用 localStorage 暫存的 queue 格式：`[{id, val}, ...]`）
- **簽名天生不在暫存範圍**：簽名不是欄位，是問卷層級設定（清單分頁 G 欄，Code.js:33），存在獨立的 `signatures` 陣列、不進 columnDB；暫存只序列化 columnDB，所以還原後使用者本來就必須**重簽**，無需額外排除邏輯（2026-07-07 確認此為期望行為）
- 檔案上傳欄位（F-F）不納入暫存 — 檔案本體只在正式送出時上傳 Drive
- payload 通常只有幾 KB 文字，但多行文字欄位（X 類型）理論上可能撐大 → 保留簡單的 45,000 字元切塊機制當保險（Google Sheet 單一儲存格上限 50,000 字元）

**新增三個 RPC 函數**：

1. `saveDraft(userInfo, payload)` — **先跑與 `authRecord()`（Code.js:299）相同的驗證**（主鍵 + 驗證欄位），通過才 upsert（同主鍵覆寫舊列）。用 `LockService.getScriptLock()` 防止並寫。
2. `loadDraft(userInfo)` — 同樣先驗證；回傳 `{updatedAt, payload}` 或 `null`。⚠️ web app 是 ANYONE_ANONYMOUS，**沒有這層驗證的話，任何知道別人學號的人都能撈到他的暫存**，這是本功能最重要的安全邊界。
3. `deleteDraft(userInfo)` — 正式送出成功（`writeRecord` 完成）後由前端呼叫，清掉暫存列。

### 前端（src/App.vue）

1. 登入成功後呼叫 `loadDraft`：
   - 有線上暫存 → 與 localStorage 暫存比較 `updatedAt`，用 ElMessageBox 詢問要還原哪一份（顯示兩者的時間）
   - 還原邏輯**重用現有的 localStorage 還原路徑**（同一個 queue 格式，餵進同一個還原函數）
2. 新增「線上暫存」按鈕（登入後、`draftEnabled` 為真才顯示），呼叫 `saveDraft`，成功/失敗用 ElMessage 回饋，儲存中顯示 loading 防連點
3. 送出成功後呼叫 `deleteDraft`（失敗不阻斷流程，只 console 記錄）

### 管理者設定步驟（寫進 README/struct.md）

1. 建立一個新的空白 Google Sheet（暫存專用）
2. 把試算表 ID 填入 Apps Script 的 ScriptProperties：`draftSheetID`
3. 部署帳號（USER_DEPLOYING）需對該試算表有編輯權限

### 驗證方式

- 裝置 A 填一半 → 按線上暫存 → 裝置 B（無痕視窗）登入同主鍵 → 應詢問還原 → 內容一致（含簽名）
- 用錯誤的驗證欄位呼叫 `loadDraft` → 必須拿不到資料
- 簽名板畫滿讓 payload 超過 50k 字元 → 存取都正常（chunk 機制）
- 正式送出後 → 暫存分頁該列已刪除
- 未設定 `draftSheetID` 的部署 → 按鈕不出現、其他功能不受影響

---

## Phase 3：工程體質（長期，找沒人用系統的時段）

1. **ESLint + Prettier**：先上 lint 擋低級錯誤
2. **Vitest 單元測試**：從純函數開始（formatDetector、暫存判斷邏輯、加密 encode/decode、chunk 切割）
3. **App.vue 拆分**：2503 行 Options API → `<script setup>` + composables（useCrypto、useDraft、useGasRpc、欄位元件）。拆分不影響執行架構——vite-plugin-singlefile 照樣打成單一 index.html，仍是 SPA，**不會**變成多頁、不會增加 GAS 往返
4. **清理孤兒檔**：根目錄 `export.js`（property 名稱已與 Code.js 分岔）、`fileOutput.js`（無關的更名工具）、冗餘的根目錄 `appsscript.json` — 搬進 `tools/` 標明用途或淘汰

---

## Phase 4：遠端多方簽名邀請機制（todo.md 第 3 點；2026-07-08 設計定案）

> **✅ 已於 2026-07-08 實作完成（未部署）**：9 個步驟全數完成，含 Phase 5 整合小節
> （受邀者 session JWT 化，`inviteeLogin` 直接簽發 session token、`submitInviteSignature`
> 收 session JWT）。lint／181 測試／build 全綠；競態防線與 writeRecord 混合裁決有
> 單元測試（tests/invites.test.js 純函數 73 例、tests/inviteRpc.test.js RPC 層 35 例、
> tests/columnPrep.test.js 10 例）。
> 與計畫的差異：1) `authByToken_` 增加「拒絕帶 invite claim 的 session token」防線——
> 受邀者 session 的 pkey/refer 都合法，不擋會讓受邀者能冒充填寫者打 writeRecord/暫存/邀請
> 2) `buildReadonlyHeaders_` 的草稿值疊進 `lastInput`（不只 value）——read-only FormField
> 顯示走 savedContent/lastInput，只疊 value 受邀者會看到舊資料 3) writeRecord 簽名段改成
> 「先整批檢查再建檔」，避免部分格被 pending 擋下時留下孤兒簽名檔（測試抓到）
> 4) `renewToken` 入口從 authByToken_ 改為 verifyJwt_ + refer 比對（兩種 token 共用）。
> 待辦：實機驗證（見下方端對端驗證清單）後再部署。

### 需求與決策（2026-07-08 已確認）

現況簽名假設所有簽名者同地輪流用同一台裝置、簽名只在 `writeRecord` 送出瞬間持久化；簽名者分散兩地時無法處理。本階段讓填寫者對任一簽名格發 email 邀請，受邀者以 token 連結進入 read-only 問卷、只簽自己那格，簽名即時存 Drive；填寫者回來檢查後才能正式送出。

| 決策 | 選擇 |
|------|------|
| token 與簽名格狀態存放 | `draftSheetID` 暫存試算表新增分頁；**邀請功能與線上暫存綁定**（未設定 `draftSheetID` 則整個隱藏） |
| 受邀者進入方式 | 邀請信附 `?token=xxx` 連結直接進簽名模式 + 登入首屏保留「我有簽名的驗證碼」手動貼上入口 |
| token 效期 | `min(發出後 7 天, 問卷 dueDate)` |
| 權限分流 | 受邀者只能看 read-only 問卷 + 簽自己那格；只有填寫者能送出 |
| 前置技術修復 | 簽名圖 base64 內嵌顯示，包含在本階段（步驟 1） |

### 架構決策

- **單一全域分頁 `_invites`**（非一問卷一分頁）：受邀者只帶 token，須能以 token 全域查列；`_invites` 不會與 referSSID（Drive ID）撞名
- **一格一列（active row）模型**：upsert key =（referSSID, 主鍵值, 簽名格名稱）。重發/換 email = 同列覆寫新 token（舊 token 自動失效，不需 revocation list）；撤回 = 刪列；未邀請 = 無列
- **writeRecord 信任模型**：前端只傳本地簽名 blob、不傳任何 fileID；後端對每格自行裁決來源（invites 列 signed → 用列上 fileID；pending → 整筆拒寫；無列 → 要求本地 blob）。`writeRecord` RPC 簽章不變，前端無從偽造
- 邀請 RPC 一律先 `draftEnabled_()`；填寫者側 RPC 再過 `authRecord()`，主鍵解析沿用 `draftKey_`（含 Gmail 主鍵路徑）

### `_invites` 分頁 schema

| 欄 | 名稱 | 內容 |
|---|---|---|
| A | token | 64 字元 hex（兩個 `Utilities.getUuid()` 去 dash 串接） |
| B | referSSID | 問卷結構表 ID |
| C | recordSSID | 紀錄表 ID |
| D | primaryValue | 填寫者主鍵值 |
| E | signName | 簽名格名稱（清單 G 欄之一） |
| F | email | 受邀者 email |
| G | expireAt | ms；`min(now + 7天, dueDate)` |
| H | status | `pending` / `signed`（`expired` 為讀取時衍生，不落地） |
| I | fileID | 簽名圖 Drive fileID（signed 才有） |
| J | createdAt | ms |
| K | updatedAt | ms |

### 後端（src/Code.js）

**(a) doGet token 注入**（Code.js:4-17）：`template.evaluate().getContent()` 取字串，token 過 `inviteTokenValid_`（`/^[a-f0-9]{64}$/`）才以 `content.replace('<head>', '<head><script>window.__SM_INVITE_TOKEN__=' + JSON.stringify(token) + ';</script>')` 注入，再 `HtmlService.createHtmlOutput(content)` 走原本 setTitle/addMetaTag。regex 白名單 + JSON.stringify 雙保險防注入。

**(b) 常數與純函數**（放暫存區塊後，供測試 stub 抽取）：
- `INVITE_SHEET_NAME = '_invites'`、`INVITE_TTL_DAYS = 7`、`INVITE_MAX_SIGNATURE_BYTES = 2*1024*1024`
- `inviteTokenValid_(token)`、`inviteExpireAt_(nowMs, dueDateMs, ttlDays)`、`inviteRowOf_(invite)` / `parseInviteRow_(row)`（物件⇄11 欄陣列）、`inviteStatusFor_(invite, nowMs)`、`inviteTransition_(currentStatus, action)`（狀態機矩陣）
- `resolveSignatureSources_(requiredNames, localSignatures, inviteRows, nowMs)` → `[{name, source:'local'|'invite'|'missing'|'pending', fileID?, blob?}]` — writeRecord 混合裁決 + race 防線核心，必須純函數可單測

**(c) 分頁存取**（沿用 draft 的 LockService + clear-then-set 模式，Code.js:124-166）：`newInviteToken_`、`inviteSheet_`、`inviteRowIndexByToken_`、`inviteRowIndexByCell_`、`invitesForUser_`、`signatureDataUrl_(fileID)`（`'data:image/png;base64,' + Utilities.base64Encode(getBlob().getBytes())`；私有函數，**絕不做成收 fileID 的 RPC**）

**(d) 從 loadDraft 抽 `draftPayloadByKey_(referSSID, key)`**（loadDraft 行為不變；inviteeLogin 以 token 查出的 primaryValue 呼叫）

**(e) 新 RPC**（皆 `logged_()` 包裝 + `xxx_` 私有實作）：

填寫者側（`draftEnabled_()` + `authRecord()`）：
1. `sendInvite(referSSID, recordSSID, auth, signName, email)` — 發=重發=換email 同一支（upsert 新 token）。檢查 signName ∈ 清單 G 欄、email regex（沿用 writeRecord 的 pattern）、writeAllowed、dueDate、`MailApp.getRemainingDailyQuota() > 0`、既有列 signed 則拒絕。Lock 內 upsert；信含 `getScriptURL()+'?token='+token` 連結 + 純文字 token + 到期時間；appendRow 到 emailLog
2. `revokeInvite(referSSID, recordSSID, auth, signName, force)` — Lock 內重讀列：無列 → `{success:true, status:'none'}`；signed 且 !force → `{success:false, status:'signed', invite:{…含內嵌圖}}`（不刪，讓前端刷新再二段確認）；signed 且 force → 刪列 + 簽名檔 `setTrashed(true)`；pending → 刪列
3. `listInvites(referSSID, recordSSID, auth)` — 回 `[{signName, email, expireAt, status(含衍生 expired), image?}]`，signed 格附 `signatureDataUrl_`

受邀者側（token 即憑證，不走 authRecord）：
4. `inviteeLogin(token)` — 驗 token 格式→查列→驗 expireAt/dueDate/writeAllowed。回 `false` 或 `{sheetName, comment, dueDate, signName, expireAt, maskedPkey, alreadySigned, myImage?, headers: buildReadonlyHeaders_(referSSID, primaryValue)}`；`buildReadonlyHeaders_` = getHeaders + getUserRow（合成 auth）疊 savedContent + `draftPayloadByKey_` 的 queue 疊 value/lastInput（草稿優先）
5. `submitInviteSignature(token, blobDataURL)` — **Lock 內以 token 重查列**（race 防線 #1）：無列（已撤回/重發）→ 明確錯誤；過期/非 pending/問卷關閉 → 對應錯誤。驗 `^data:image/png;base64,` + 解碼 ≤ 2MB。createFile 到 universalStorageID（檔名沿用 writeRecord 模式），列更新 signed+fileID+updatedAt

**(f) 前置修復**（Code.js:255-260）：readRecord_ 的 `signatures.push(file.getUrl())` → `signatures.push(signatureDataUrl_(signs[i]))`

**(g) writeRecord_ 簽名段改造**（Code.js:794-817）：以 `resolveSignatureSources_` 裁決——pending/missing → proceedWrite=false + errorLog；invite → 直接用列上 fileID（不建新檔；csvOutput 用 getUrl 供回條）；local → 沿用現有 base64Decode + createFile。appendRow 成功後 Lock 內刪該（referSSID, primaryValue）全部 invites 列（token 用畢即焚）。

### 前端

**修改 `src/App.vue`**：
1. 受邀者 bootstrap：`inviteToken = ref(window.__SM_INVITE_TOKEN__ || '')`；`onMounted` 有 token → 不開 sheetsDialog，直接 `inviteeDialogRef.value.open(token)`
2. sheetsDialog（登入首屏）加「我有簽名的驗證碼（我只是簽名者之一）」el-input + 按鈕 → 同上 open()
3. savedSignatures 內嵌（App.vue:139-146）：el-link 換 `<img :src="sign" style="max-width:200px">`
4. signatureDialog 混合模式（App.vue:124-172）：進簽名步驟前（`authMod`，draftEnabled 且有簽名格）先 `await refreshInvites()`。每格依狀態分流：`none` → carousel 本地 canvas；`pending/expired` → 狀態卡（email、到期、重發/換Email（ElMessageBox.prompt）/撤回並本機簽/重新整理）；`signed` → `<img>` 預覽卡 + 撤回重簽。**不動 useSignatures 內部**：開對話框前 `resetSignatures(); addSignatures(localNames)`（只含 none 格），canvas 數量與 signatures.length 恆等，iPadOS 13 時機處理不碰；邀請狀態變化後重跑 reset+add+initSignaturePads
5. `endSignature()` 增加：有 pending/expired 格 → 擋下提示；localNames 空且全 signed → 直接放行
6. `sendMod` RPC 參數不變（collectSignatures 本來就只含本地格）

**新增 `src/composables/useInvites.js`**：`useInvites({ currentSheet, authDB, saveDraftForInvite })` → `{ inviteStates, inviteBusy, refreshInvites, sendInvite, revokeInvite }`。sendInvite 先 `await saveDraftForInvite()`（受邀者才看得到答案）；revokeInvite 收到 `status:'signed'` 時更新卡片並二段 confirm 才 force。

**新增 `src/components/InviteeSignDialog.vue`**：慣例 `defineExpose({open})` + 自行 gasRun + 內部自建一份 `useSignatures()` 實例（受邀模式主畫面對話框全關，canvas selector 不撞）。open(token) → inviteeLogin；頂部 el-alert「如對問卷填答內容有異議，請使用帳號密碼登入後修改」+ maskedPkey + 格名 + 到期；read-only 問卷 = headers 過濾 `/F|C|G/` + 補 tid + `prepareColumnsForDisplay` 後 `<FormField :enable-modify="false">`；單格簽名 `addSignatures([signName])` → initSignaturePads → collectSignatures → submitInviteSignature；成功/已簽 → 「你的簽名已完成，請提醒填寫者回來檢查後送出」。

**新增 `src/utils/columnPrep.js`**：把 loginView 內欄位 massage 迴圈（group 解析、U 選項過濾、L/X content 陣列化、檔案欄 queue 還原）抽成 `prepareColumnsForDisplay(columns, currentAnsQueue)`，App.vue 與 InviteeSignDialog 共用（受邀者傳空 queue）。純搬移不改邏輯。

**修改 `src/composables/useDraft.js`**：新增 `saveDraftForInvite()`——以 `buildTempQueue(columnDB.value)` 現值直接組 payload 上傳（繞過 `hasFilledData` 的空 queue 拒存），回 success 布林。

### 實作步驟順序與驗證

| # | 步驟 | 驗證 |
|---|---|---|
| 1 | 前置修復：`signatureDataUrl_` + readRecord_ 內嵌 + App.vue `<img>` | lint、build；部署後看到內嵌圖 |
| 2 | Code.js 邀請純函數 + 分頁 helpers + `draftPayloadByKey_` 抽取 | 先寫 tests/invites.test.js 再實作，`npm test` 全綠 |
| 3 | 後端 5 支 RPC | npm test（transition/expireAt/roundtrip）；GAS 端由步驟 8 實機驗證 |
| 4 | doGet token 注入 + regex 閘門 | stub HtmlService 測試：合法有注入、非法無注入且轉義 |
| 5 | columnPrep.js 抽取 + loginView 改用 | lint（no-undef-properties 抓搬移遺漏）、test、build；手動走一般填寫流程無退步 |
| 6 | InviteeSignDialog + onMounted 分流 + 首屏 token 入口 | lint/build；dev 模式手動塞 `window.__SM_INVITE_TOKEN__` 驗證分流 |
| 7 | 填寫者混合簽名 UI（useInvites + signatureDialog 改版 + endSignature 閘門） | lint/build；手動驗證發邀請後 canvas 換卡片、撤回後 canvas 重建 |
| 8 | writeRecord_ 整合 + 送出後清 invites 列 | npm test（resolver 全矩陣）；部署後兩台裝置實測完整狀態機 |
| 9 | 文件：todo.md 勾選、struct.md/CLAUDE.md 補 `_invites` 與新 RPC | lint && test && build 全綠；**不部署** |

### 風險與對策

1. **race：撤回 vs 受邀者送出**（todo.md 風險 #1）：兩支 RPC 寫入路徑都在 ScriptLock 內重讀列後才動作。撤回先到 → submit 鎖內查無列回明確失敗；送出先到 → revoke 鎖內看到 signed 不刪、回真實狀態
2. **race：誤撤剛簽好的**（todo.md 風險 #2）：revokeInvite 預設 force=false 永不信前端認知；伺服器見 signed 拒絕並回含內嵌圖的最新狀態，前端二段 confirm 才 force=true（force 路徑仍鎖內重讀）
3. **race：填寫者送出 vs 受邀者同時簽**：writeRecord_ 送出當下重讀 invites — pending 擋下、剛轉 signed 直接採用 fileID
4. **偽造 fileID**：前端沒有傳 fileID 的通道，resolver 只認 `_invites` 列
5. **doGet XSS**：regex 白名單 + JSON.stringify
6. **useSignatures 時機炸彈**：不改內部，signatures 陣列只含本地格使 canvas 數量恆等
7. **base64 payload 大小**：PNG 約 50–200KB/張，google.script.run 承載充裕；listInvites 只對 signed 附圖

### 測試清單

- `tests/invites.test.js`（draftChunks.test.js 的 `new Function` stub 模式，額外注入 `Utilities` fake）：`inviteExpireAt_`（dueDate 早/晚/邊界）、row 物件⇄陣列 roundtrip、`inviteTokenValid_`（合法/過短/大寫/注入字串）、`inviteStatusFor_`（pending 過期→expired、signed 過期仍 signed）、`inviteTransition_` 全狀態×全動作矩陣、`resolveSignatureSources_`（全本地/全遠端/混合/pending 阻擋/invite 優先/missing/過期 pending 阻擋）、doGet 注入閘門
- `tests/columnPrep.test.js`：L/X 陣列化、U 選項過濾、group 解析、檔案欄 queue 還原
- 測試資料一律虛構（`user@example.com`、「簽名人甲」、假 40 字元 ID）

### 管理者設定

無新設定：沿用 `draftSheetID`（已設定線上暫存者自動獲得此功能）；`_invites` 分頁自動建立。寄件者為部署帳號，受 MailApp 每日配額限制。

### 端對端驗證（實機）

- 裝置 A 填一半 → 對「家長」格發邀請（輸入 `user@example.com`）→ 收到信、連結進入 → read-only 問卷內容與 A 一致、只能簽「家長」格 → 簽完顯示提醒文案
- 裝置 A 簽名步驟刷新 → 「家長」格變成已簽名 `<img>` 預覽 → 本地簽完其餘格 → 送出成功 → 紀錄列簽名 fileID 完整、`_invites` 該使用者列已清空
- 撤回 race：受邀者簽完瞬間填寫者按撤回 → 伺服器回 signed 狀態、前端刷新卡片二段確認
- token 失效：重發後舊連結進入 → 明確錯誤；過期 token → 明確錯誤；亂造 token → `inviteeLogin` 回 false
- 未設定 `draftSheetID` 的部署 → 邀請 UI 完全不出現、既有流程不受影響

### 與 Phase 5（JWT）的整合——純簽名模式 session 化（2026-07-08 追加）

Phase 5 完成後，受邀者（純簽名模式）也改用 JWT session + 倒數條，邀請 token 只當「入場券」用一次：

1. **`inviteeLogin(token)` 改為簽發 session JWT**：驗證邀請 token（流程不變）通過後，回傳值加上 `sessionToken`，payload = `{ pkey: primaryValue, refer: referSSID, signName, invite: 邀請token, iat, exp }`，**exp = min(now + 1hr, 邀請 expireAt, 問卷 dueDate)**。多出的 `signName`/`invite` claims 讓後端不用回傳信任前端的格名
2. **`submitInviteSignature(sessionToken, blobDataURL)`**：改收 session JWT，`verifyJwt_` 通過後從 claims 取 `invite` token → **Lock 內重查 `_invites` 列的 race 防線完全不變**（撤回/重發後列不在或 token 不符 → 明確錯誤）。前端不再持有裸的邀請 token 打 RPC
3. **`renewToken` 受邀者路徑**：claims 含 `invite` → 續約前重讀 `_invites` 列確認仍 pending 且未過 expireAt，新 exp 同樣被邀請 expireAt/dueDate 封頂（邀請快到期時續約的延長幅度自然縮小）
4. **InviteeSignDialog 掛同一個 `JwtCountdownBar`**：`useJwtSession` 以 inviteeLogin 回傳的 sessionToken 驅動，倒數、<50% 點擊續約、過期導回「請重新用邀請連結進入」提示，行為與填寫者側一致
5. 實作順序：此小節依賴 Phase 5 的 JWT 基礎（`signJwt_`/`verifyJwt_`/`renewToken`/`JwtCountdownBar`）。**若 Phase 4 先實作，維持原設計（裸邀請 token 直接當 RPC 憑證），Phase 5 實作時一併遷移本小節**；若 Phase 5 先完成，Phase 4 直接照本小節實作

追加驗證（實機）：受邀者進入 → 倒數條出現、exp 不超過邀請到期時間；續約成功/邀請已被撤回時續約失敗；session 過期 → 提示重新用連結進入；舊裸 token 打 `submitInviteSignature` → 被拒

---

## Phase 5：登入 JWT 化（2026-07-08 設計定案）

> **✅ 已於 2026-07-08 實作完成（未部署）**：後端 JWT（signJwt_/verifyJwt_/authByToken_/renewToken）、
> writeRecord/saveFile/暫存三支改收 token、前端 utils/jwt.js + useJwtSession + JwtCountdownBar、
> 33 個新測試（jwt.test.js / jwtFrontend.test.js），lint/test/build 全綠。
> 與計畫的差異：1) `saveFile` 原本**沒有任何身分驗證**（匿名可上傳 Drive），順手補上 token 驗證
> 2) 修掉既有漏洞：Gmail 模式下 `readRecord_` 用前端傳來的 pkey 撈紀錄，名冊內使用者可竄改讀別人的資料，
> 現改由伺服器端（`draftKey_`/Session）判定 3) 前端 atob 解碼補 UTF-8 處理（中文 pkey 會亂碼，測試抓到）
> 4) 登入成功後保留主鍵欄位值（localStorage 暫存的 key 需要它），只清空其餘認證欄位值。
> 待辦：實機驗證（含倒數條/續約/過期重登劇本）後再部署；Phase 4 實作時依整合小節接上受邀者 session。

### 問題與需求（2026-07-08 已確認）

現況「登入一次」的機制 = 使用者輸入的認證欄位值明文存在 `authDB` ref（App.vue:378）常駐記憶體整個 session，且**每次特權 RPC 整包重傳**——`readRecord`（App.vue:836）、`writeRecord`（App.vue:994）、`useDraft.js` 的 save/load/delete（:46、:66、:119）。本系統沒有帳號密碼——A 型欄位是名冊個資（學號、身分證字號等），所以 XSS 的最壞情況是**個資本體外洩**。

改為：登入驗證（`authRecord()`）通過後由後端簽發 HS256 JWT，之後所有 RPC 只帶 token。個資只在登入那一刻傳輸一次；token 被竊的最壞情況降為「1 小時內可冒填單一問卷」。

| 決策 | 選擇 |
|------|------|
| token 存放 | **記憶體（Vue ref）**——app 是 SPA，換頁/切步驟不重載，體驗同現狀（重新整理需重登）。cookie 在 GAS 沙盒 iframe（`*.googleusercontent.com`）是第三方 cookie 會被擋；exp 僅 1 小時，localStorage 落地效益低 |
| 有效期 | **1 小時** |
| payload | `{ pkey: 主鍵值, refer: referSSID, iat, exp }`——綁定單一問卷，A 問卷 token 不能打 B 問卷；`iat` 供前端算剩餘百分比與續約限制 |
| secret | Script Properties `jwtSecret`，隨機 256-bit，首次使用時自動生成寫回 |
| session 儲存 | **無狀態**（不用 CacheService，繞開 6hr 上限與驅逐）；代價是無法主動撤銷，1 小時 exp 下可接受 |
| Gmail 路徑（P+G） | 不動——本來就是 `Session.getActiveUser()` 伺服器端身分，無個資傳輸 |
| Sheet 端雜湊化 | **不做**——A 欄位是管理者自建名冊的個資、非密碼，雜湊化套錯威脅模型 |
| 舊版相容 | 一刀切（前後端綁定部署，無舊前端並存期） |
| 倒數 UI（2026-07-08 追加） | 移植 scoringSystem-cf 的 JWT 計時器機制（`packages/frontend/src/utils/jwt.ts` + `TopBarUserControls.vue` + `MainLayout.vue` 的續約守衛），**圓形改直線倒數條**：`position: fixed` 於視窗頂端、z-index 高於 Element Plus 彈窗，疊在登入填寫的 dialog/drawer 之上，登入後全程可見 |
| 續約 | **手動點擊續約、不做自動續約**——剩餘 <50% 時倒數條進入警告態（脈動、可點擊），點擊呼叫 `renewToken` 換發新 token（重設為 100%）；每個 token 限手動續約一次（以 `iat` 追蹤，續約後新 token 有新 iat，掉回 <50% 可再續）。續約時後端重驗 writeAllowed/dueDate |
| 純簽名模式 | **同一套機制**——受邀者 `inviteeLogin` 通過後也發 session JWT（exp 另受邀請 expireAt/dueDate 封頂），倒數條同樣顯示、同樣可續約（詳見 Phase 4 的整合小節） |

### 後端（src/Code.js）

1. **JWT 純函數**（供測試 stub 抽取，約 30 行）：`signJwt_(payload, secret)` / `verifyJwt_(token, secret)`——`Utilities.computeHmacSha256Signature` + `Utilities.base64EncodeWebSafe`（web-safe、去 padding，比照 JWT 標準）。`verifyJwt_` 驗：格式三段、簽章相符（重算比對）、`exp` 未過、回傳 payload 或 `false`
2. `getJwtSecret_()`：讀 ScriptProperties `jwtSecret`，不存在則生成（兩個 `Utilities.getUuid()` 去 dash 串接）寫回——零管理者設定
3. `readRecord`（登入入口）：`authRecord()` 通過後，回傳值附上 `token`（payload 的 pkey 取自 auth 中的主鍵值、refer = referSSID、iat = now、exp = now + 1hr）
4. 其餘特權入口改收 token 取代 auth 陣列：`writeRecord`、`saveDraft`、`loadDraft`、`deleteDraft`，以及 Phase 4 填寫者側的 `sendInvite`/`revokeInvite`/`listInvites`（若 Phase 4 先完成）。統一入口 `authByToken_(referSSID, token)`：`verifyJwt_` 通過 + claims.refer === referSSID → 回 pkey；**不再每次 `getUserRow` 掃 Sheet 比對**（順帶省一次 Sheet 讀取，RPC 變快）
5. 驗證失敗回傳可辨識的錯誤標記（如 `{tokenExpired: true}`），供前端導回登入
6. **新增 `renewToken(referSSID, token)` RPC**（比照 scoringSystem-cf 的 refresh-token：驗舊發新）：`verifyJwt_` 通過（**必須仍有效**，過期不能續）+ refer 相符 + 重驗 writeAllowed/dueDate → 以相同 claims 換發新 token（新 iat/exp）。受邀者 token（見 Phase 4 整合小節）額外在 Lock 外重讀 `_invites` 列確認仍 pending 且未過 expireAt，exp = min(now+1hr, 邀請 expireAt, dueDate)

### 前端

1. **App.vue**：新增 `authToken` ref；`loginView` 成功後存入後端回傳的 token，並**清空 `authDB` 各欄位的 `.value`**（識別資料不再駐留）。`tempStorage` 的 localStorage key 與 UI 需要的主鍵值，在清空前先存進既有的 primaryKey 流程（或由登入回傳附帶）
2. 所有特權 `gasRun` 呼叫處（App.vue 的 writeRecord、`useDraft.js` 三支、Phase 4 的 `useInvites`）：`plainClone(authDB.value)` → `authToken.value`
3. **token 過期處理**：收到 `tokenExpired` → 清 token、導回登入步驟（沿用 `loginfailTip` / 步驟條 error 機制），提示重新驗證；已填內容不動（columnDB 與 localStorage 暫存都在，重登後繼續）
4. 重新整理 → token 隨記憶體消失 → 重登，行為與現狀一致

### 前端倒數條（移植 scoringSystem-cf，圓形改直線；2026-07-08 追加）

1. **新增 `src/utils/jwt.js`**（純函數，從 scoringSystem-cf `packages/frontend/src/utils/jwt.ts` 移植並去 TS 化）：`decodeJwtPayload(token)`（base64url 解碼、**不驗簽、僅供 UI 顯示**——授權判斷永遠在後端）、`getTokenRemainingTime(token)`、`getSessionPercentage(token)`（用 iat/exp 算 0–100）、`isTokenExpired(token)`、`formatRemainingTime(ms)`（`59m 30s` 式）
2. **新增 `src/composables/useJwtSession.js`**：`useJwtSession({ token, onRenew, onExpired })` → `{ remainingTime, sessionPercentage, renewing, handleRenewClick }`。內含 1 秒 interval tick（元件卸載清除）；移植 MainLayout.vue 的續約守衛——`isRenewing` 防連點 + `lastManualRenewIat` 每 token 限手動續一次（`本次登入已續約過`提示）；tick 偵測過期 → 呼叫 `onExpired`（App.vue 導回登入，與 RPC 收到 `tokenExpired` 同一條路）
3. **新增 `src/components/JwtCountdownBar.vue`**：直線倒數條，`position: fixed; top: 0; left: 0; right: 0`，z-index 高於 Element Plus 彈窗層（fullscreen dialog / drawer 之上，Element Plus popup 從 2000 起跳，設 3000+ 並實測 teleport 層級）。視覺：整條寬度 = `sessionPercentage`，條內顯示剩餘時間文字；>50% 正常色、<50% 警告色 + 脈動動畫 + 可點擊（cursor/pointer + tooltip「點擊延長登入時間」）、<5 分鐘轉危險色。配色走 `src/theme/colors.config.js`（不硬編碼色票）。`v-if="authToken !== ''"` 登入後全程顯示（columnDialog 填寫、confirmDialog 送出、簽名對話框都在其下）
4. 點擊續約流程：`handleRenewClick` → `gasRun('renewToken', refer, authToken.value)` → 成功換上新 token（條重設 100%、ElMessage 成功提示）；失敗（已續過/後端拒絕）→ ElMessage 提示；token 已過期 → 走 `onExpired` 重登
5. 手機版（本專案主要使用情境）：條高度縮到不擋內容（~6–8px，點擊熱區可放大），文字改只在警告態浮出

### 測試

**tests/jwt.test.js**（後端；沿用 draftChunks.test.js 的 `new Function` stub 模式，注入 fake `Utilities`——HMAC 用 node:crypto 實作、base64EncodeWebSafe 對應）：
- sign → verify roundtrip（payload 原樣取回）
- 竄改 payload / 簽章 → verify 回 false
- exp 過期 → false；邊界（剛好到期）
- refer 不符 → `authByToken_` 拒絕
- 格式錯誤 token（兩段、空字串、非 base64）→ false 不 throw
- `renewToken`：有效 token 換發（新 exp > 舊 exp、pkey/refer 不變）、過期 token 拒續、refer 不符拒續

**tests/jwtFrontend.test.js**（前端 `src/utils/jwt.js` 純函數，一般 import 即可）：
- `decodeJwtPayload` 合法/格式錯誤/base64url 特殊字元
- `getSessionPercentage` 全新 100 / 過半 / 過期 0 / 缺 iat 的防禦
- `getTokenRemainingTime` 邊界、`formatRemainingTime` 各級距（h/m/s）

### 端對端驗證（實機）

- 登入 → 填答 → 線上暫存 → 送出全流程正常；DevTools 確認登入後的 RPC payload 只含 token、不含識別欄位值
- 竄改 token / 等過期（可暫調 exp 為 1 分鐘）→ 特權操作被拒、導回登入、重登後暫存內容仍在
- Gmail 問卷（P+G）流程不受影響
- 重新整理 → 需重登（維持現狀行為）
- **倒數條**（可暫調 exp 為 3 分鐘加速驗證）：登入後出現、蓋在填寫 dialog 與送出 drawer 之上不被遮擋；>50% 不可點；<50% 脈動可點、點擊後條回滿、DevTools 確認換發了新 token；同一 token 點第二次 → 「已續約過」提示；<5 分鐘轉危險色；放到過期 → 自動導回登入、重登後填寫內容仍在
- 手機（iPad/手機直式）：倒數條不擋標題與步驟條、點擊熱區可按

---

## 部署原則（每次都適用）

- clasp 用工作帳號登入（`npx clasp show-authorized-user` 先確認）
- 只建新部署：`npx clasp deploy -d "說明"`，**永遠不帶 `-i`**，不動既有部署版本
- 已知 @HEAD 測試部署會隨 push 更新（已確認可接受）
