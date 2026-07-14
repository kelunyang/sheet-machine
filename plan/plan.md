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

## Phase 6：問卷深連結 `?sheet=`（2026-07-09 設計定案）

### 動機與需求

管理者通知使用者填某份問卷時，只能給 web app 首頁網址，使用者得自己在列表裡找。仿照
邀請連結 `?token=xxx` 的既有模式，提供 `…/exec?sheet=<referSSID>` 直達指定問卷的登入畫面。

背景：曾討論過「拆成多張獨立網頁」，結論是 GAS 部署模型（每次換頁 = 完整 doGet 重載
1.7MB singlefile bundle + 冷啟）下不划算，維持 SPA；深連結是該討論中唯一值得做的拆頁——
它本來就有 `?token=` 前例，工程量小。

### 設計決策（2026-07-09 已確認）

| 決策 | 選擇 |
|------|------|
| URL 參數識別碼 | **refer（問卷題目試算表 ID）**——它是全系統的問卷正字標記（JWT claims.refer、暫存分頁名），且 `getQList` 本來就整包送前端，URL 曝露不增加新攻擊面（知道 ID 不代表能開試算表，Sheet 未公開分享）。列表的 `row.id` 是每次載入隨機生成的 uuid **不能用**；問卷名稱可變動又要編碼，也不用 |
| doGet 驗證 | **只做格式白名單、不查清單**——避免每次帶參數的頁面載入多花一次 `openById`；存在性/開放狀態由前端載完列表後比對。注入照抄邀請 token 的雙保險：regex 白名單 + `JSON.stringify` |
| 白名單 regex | `/^[A-Za-z0-9_-]{20,100}$/`（Drive 檔案 ID 格式，實際約 44 字元，範圍放寬防未來變動） |
| 與 `?token=` 並存 | invite 優先（沿用 onMounted 既有優先序：有邀請 token 就不載列表）；深連結為一次性旗標，受邀流程關閉補載列表時才會被消費 |
| 找不到 / 已下架 / viewDate 已過 | ElMessage 警告「找不到連結指定的問卷」+ 停在列表（getQList 只回 visible 的問卷，下架與過期在前端一律表現為「不在列表」） |
| writeAllowed = false | ElMessage 警告「問卷目前關閉中」+ 停在列表（列表本來就會顯示關閉狀態，與點按鈕 disabled 的行為一致） |

### 後端（src/Code.js）

1. `sheetParamValid_(id)`：`typeof id === "string" && /^[A-Za-z0-9_-]{20,100}$/.test(id)`，
   比照 `inviteTokenValid_` 放在 doGet 注入的第一道閘門
2. `doGet`：`e.parameter.sheet` 通過白名單才注入
   `window.__SM_SHEET_REFER__ = JSON.stringify(...)`，不合法一律當作沒帶

### 前端（src/App.vue）

1. onMounted 讀 `window.__SM_SHEET_REFER__` 存進一次性變數（不進 reactive state）
2. `loadSheet()` 載完列表後消費：以 refer 比對列表——命中且 writeAllowed →
   `openSheet(match.id)` 直達登入畫面；命中但關閉中／未命中 → ElMessage 警告留在列表；
   無論結果都清掉旗標（一次性）

### 測試

- `tests/sheetParam.test.js`（沿用 jwt.test.js 的 `new Function` stub 模式）：
  合法 44 字元 ID 通過；太短／太長／含非法字元（含 `"};alert(1);//` 注入嘗試）／
  非字串／undefined 一律拒絕
- `npm run lint`（App.vue 模板有動）＋ `npm test` ＋ `npm run build`

### 端對端驗證（實機）

- `?sheet=<合法refer>` → 直達該問卷登入畫面，步驟條、後續填答流程正常
- 亂打 ID／已下架問卷的 refer → 警告提示 + 問卷列表
- writeAllowed=否 的問卷 → 「關閉中」提示 + 問卷列表
- `?token=` 邀請連結流程不受影響；`?token=` + `?sheet=` 同時帶 → 先走受邀簽名，關閉後回列表才消費深連結
- 管理者取得連結：清單分頁 B 欄（refer）串上 exec 網址（已寫進 struct.md）

---

## Phase 7：配色語意重整 + 全站 drawer 化（2026-07-10 設計定案）

**動機**：Phase「主題系統」上線後配色語意混亂——蜜桃橘同時當按鈕色和 alert 色、
頁面奶油米底被全螢幕彈窗遮住毫無作用、el-dialog 與 el-drawer 兩種彈窗語言並存。
本 Phase 重整為單一語意分層，並統一全站彈窗為 el-drawer。

### 配色語意分層（定案）

| 色 | 角色 |
|---|---|
| 深藍（primary）＋糖果漸層 | **結構**：所有 drawer header、el-steps 底線（維持現狀） |
| 棕系（蜜桃橘/奶油米/深棕） | **提示**：el-alert 專用底色＋深棕文字，不再當按鈕色 |
| 綠（success）、灰（info） | **按鈕操作**：綠=正向（匯出/下載）、灰=次要（查看/重發/換email） |
| 珊瑚紅（danger）＋糖果漸層 | **送出/危險**：維持現狀 |

**明確不動**：el-steps、`getTagPalette`（問卷列表 tag 五色循環）、FieldTimeline 三色點、
糖果漸層（header／danger 按鈕／steps 底線）、ElMessage toast。

### 工作項目

1. **頁面底色改白**：移除 `SURFACE_COLORS.page` 奶油米（body 反正被 drawer 遮住）；
   `_theme.scss` 的 `body { background-color }` 一併清掉
2. **el-alert 棕化**：
   - type=info / warning 的 alert：底色改棕系（奶油米底或蜜桃橘底擇一，實作時比對視覺），
     文字用更深 HUE 的深棕（現有 `#4a2b12`，或再深；WCAG AA ≥ 4.5:1 實測後寫回
     colors.config.js 的 contrast 欄位）
   - type=success / error 的 alert（儲存成功/失敗、scriptError）：**保留綠/紅語意色**，
     成功失敗的顏色直覺不犧牲
3. **warning 按鈕退場**：現有 `type="warning"` 的 el-button 逐顆改語意——
   次要操作（重發授權信、換 email、匯入暫存、邀請遠端簽名、簽名有問題重發）改 `type="info"`
   灰；改完後全站按鈕只剩 藍/綠/灰/紅 四色。`.el-button--warning` 的深棕字覆寫可留
   （防未來誤用）或移除
4. **JWT 倒數條**（JwtCountdownBar.vue）：
   - label「登入時間剩…」改**純白字、拿掉 text-shadow glow**、拿掉動態 labelColor 邏輯
   - 白字的前提：**軌道底色改深色**（石墨灰 `#5b5b5d` 系），填充色全用深色版——
     success 綠 `#008000`（白字 5.1:1 ✅）、warning 改深化棕 `#a05a20`（白字對比要實測，
     不足就再加深）、danger 紅 `#c0392b`（5.4:1 ✅）；蜜桃橘淺色填充廢除
   - fill 的 pulse 透明度動畫、手機縮細條行為維持
5. **全站 el-dialog → el-drawer（兩級制）**：
   - **主流程 → `direction="btt"` `size="100%"`**（同 TempTransferDrawers 模式）：
     sheetsDialog（問卷列表）、loginDialog（登入）、columnDialog（填寫）、
     signatureDialog（簽名）、InviteeSignDialog（受邀簽名）
   - **輔助面板 → `direction="ttb"` `size="60%"` 不滿頁**（同 confirmDialog「你確定資料
     無誤」模式）：StatDialog、LatestDialog
   - 遷移注意：`fullscreen` prop 與 `.fullscreen` reactive 欄位移除；`show-close` 對應
     drawer 的同名 prop；header 樣式 `_theme.scss` 已同時涵蓋 drawer 不用改
   - **⚠️ signatureDialog 是深坑**：簽名板 canvas 的初始化時機（iPadOS 13 修過的 DOM
     時機問題）與 dialog 開啟綁定，換成 drawer 後 `nextTick`/`initSignaturePads` 的時序
     要實機重驗（含 iPad）；FieldTimeline / JwtCountdownBar 的 fixed 定位與 z-index
     （5000）在 drawer 疊層下要重確認
6. **ElMessageBox 5 處 → drawer 化**：新建 `src/components/ConfirmDrawer.vue`（單例掛
   App.vue）＋ `src/composables/useConfirmDrawer.js`，**Promise API 模擬 ElMessageBox
   介面**（`confirm(message, title, options)` / `prompt(...)`，取消時 reject）——
   useDraft / useInvites 裡的 `await ElMessageBox.confirm(...)` 幾乎原樣換 import：
   - `useDraft.js` checkOnlineDraft：載入雲端暫存確認
   - `useInvites.js` ×2：force 重發已簽名格、撤回撞簽完競態（二段確認）
   - `App.vue` ×2（prompt 型，要支援 input + `inputPattern` email 驗證）：
     inviteSlot 輸入受邀 email、changeSlotEmail 輸入新 email
   - drawer 規格：`ttb` 不滿頁（約 40%），confirm/cancel 按鈕列，型式同輔助面板

### 驗證

- `npm run lint`（模板大改，`vue/no-undef-properties` 必跑）＋ `npm test` ＋ `npm run build`
- 人工驗收：完整填答流程（列表→登入→填寫→簽名→送出確認→成功）全程無 el-dialog；
  邀請流程的 prompt/二段確認走新 ConfirmDrawer；JWT 條三態（>50%／警告／5 分鐘內）白字
  可讀；alert 四型配色；**iPad 實機簽名板**
- 所有新配色組合的 WCAG 對比度實測寫回 colors.config.js

---

## Phase 8：8-bit Loading Game（2026-07-10 設計定案，demo 已驗證）

**動機**：RPC 等待期間 user 不能看著空白畫面。用老式捲軸遊戲當 loading 畫面：
兩個林口高中制服小人在 8-bit 校園裡跑步跨欄，藏 Chrome 小恐龍式的操控彩蛋。

**已驗證的 demo**：`loading-game-demo.html`（repo 根目錄，純單檔零依賴）——使用者已玩過
定案，實作時 sprite 資料、背景段落、遊戲參數**直接從 demo 搬**，不要重新發明。
三張參考圖（maxresdefault.jpg／1711004607605902505.jpg／854112699.jpg）僅供對照，
不進 build；demo 檔整合完成後可刪。

### 技術基線（定案，不要改）

- **原生 canvas，禁用任何遊戲框架**（Phaser 等）——dist 是 vite-singlefile 單檔進 GAS，
  不能拉 CDN、不值得為 loading 動畫灌 1MB+ bundle
- 低解析度 buffer 240×80 繪製 → drawImage 放大 3 倍（720×240）→
  `imageSmoothingEnabled=false` + CSS `image-rendering: pixelated` 保像素感
- 響應式：卡片 `width: min(92vw, 560px)`、canvas `width:100%; aspect-ratio:3/1`，
  內部解析度不變，縮放交給 CSS；`touch-action: none` 防手勢捲動頁面
- 卡片浮在畫面腰部正中央（`left:50%; top:32%; translate(-50%,-50%)`），深色圓角卡＋
  「資料傳輸中…」動態點點；z-index 要壓過 el-drawer 疊層但低於 JwtCountdownBar（5000）

### 視覺規格（顏色一律對映 colors.config.js）

- 小人 12×15 側臉朝右、兩幀跑步：**男**（奶油米襯衫＋深藍領帶 primary＋石墨灰長褲 info）、
  **女**（鮑伯頭＋奶油米襯衫＋石墨灰百褶裙＋黑絲襪）；鞋 = alert 深棕 #4A2B12
- 校舍紅磚 = danger #C0392B（陰影 #8E2418）、橫帶 = 奶油米
- 遠景六段循環（總長 586px）：行政大樓（「林口高中」招牌＋門口大石）→ 樹帶 →
  教學樓（屋頂太陽能板）→ 籃球場（圍網＋籃架）→ 教學樓（圓形花圃）→ 短樹帶
- 視差四層：雲/校舍 0.35x、中景樹叢 0.8x、藍色 PU 跑道地面 1.6x

### 遊戲規格

- **隨機角色**：每次頁面載入 50/50 分配，user 的角色跑前（x=92）、電腦跑後（x=48）
- **障礙三種**：跨欄（白紅橫板，跳）45%、小黑狗（白鼻子，跳）30%、台灣藍鵲
  （黑頭紅嘴藍身長尾，飛頭部高度 GROUND_Y-17，**蹲**著鑽過）25%
- **彩蛋操控**（player）：WASD/方向鍵/空白鍵；觸控＝拖曳移動、上滑跳、下拉蹲
- **電腦 AI**：每個障礙生成時擲骰 18% 決定失誤；地面障礙每幀 15% 機率起跳、
  藍鵲提前趴下；閒時 0.2% 機率亂跳
- **判定**：地面障礙要 y<-6（跳起）、藍鵲要蹲下；成功 +1、失敗閃爍 20 幀**不罰分**
  （loading 不給挫折）
- **HUD 計分板**：右上角半透明黑板「你女 3　電腦男 2」；user 未操作前顯示「**？**」
  ——被電腦海放的分數就是發現彩蛋的鉤子，不寫操作說明

### 整合工作（新對話實作）

- [x] `src/components/LoadingGame.vue`：demo 的遊戲程式碼元件化；
      `v-if` 掛載/卸載時要正確啟停 requestAnimationFrame 與鍵盤監聽（防洩漏）
- [x] `src/composables/useLoadingGame.js`：單例狀態＋計數器式 `beginLoading(label)`
      回傳冪等收尾函數（多個 RPC 重疊等待時不閃爍，有單元測試）；label 顯示在
      「資料傳輸中」位置（如「確認身分中」）
- [x] **遊戲狀態跨顯示保留**（module 層持有）：分數與角色分配在同一次頁面 session 內延續，
      斷斷續續的 loading 拼起來像同一場比賽（卸載時分數寫回 module）
- [x] 掛載等待點（2026-07-10 迭代 2 定案五個、迭代 3 追加 sendInvite 與
      compareSheets 成**七個**）：初始 `getQList`、登入 `readRecord`（loginStatus）、
      送出 `writeRecord`（uploadStatus）、檔案上傳 `saveFile`（FileUploadDrawer）、
      進簽名 drawer 前 authMod 的 `refreshInvites`（submitChecking）、
      發送簽名邀請 `sendInvite`（useInvites，內含上雲暫存＋寄信兩支 RPC；
      已簽名格的二段確認 drawer 期間先收遊戲卡，確認後 force 重發再重開）、
      填答率統計 `compareSheets`（StatDialog，原「載入統計列表中」toast 移除）；
      ~~inviteeLogin~~ 迭代 2 移除
- [x] 原有的文字型 loading alert（「確認身分中」「上傳中」）保留與否實作時裁決——
      **裁決：全數保留並存**（alert 在 drawer 內、遊戲卡浮在上）
- [ ] 手機實測觸控手勢；確認遊戲卡不擋 JwtCountdownBar（待人工驗收）
- [ ] 完成後刪 demo 檔與參考圖——demo 以 `demoloading.html` 續存
      （原 `loading-game-demo.html`），迭代 2 已全部同步進 LoadingGame.vue，
      使用者確認實機 OK 後可刪 demo 與參考圖（library/science/teacharea/shoot/da3e8d9c）

### 迭代 2（2026-07-10 定案並已實作，demo 與 LoadingGame.vue 同步）

**視覺新增**：
- 兩棟教學樓改照 teacharea.jpg：紅瓦出簷屋頂＋柱廊開口＋白欄杆＋角樓紅字 C/D 棟、
  D 棟花圃加玻璃金字塔尖；新增圖書館（library.jpg：高塔＋紅字招牌＋門口雨遮）與
  隔壁科學館（science.jpg：弧形樓身＋柱廊＋石砌門面，頂樓補天文台圓頂＋觀測縫）；
  遠景循環六段 586px → 八段 830px

**加分物件**（隨機落地或飄在跳躍高度，誰先碰到誰拿走）：
- 書包（da3e8d9c...jpg：黑色後背包）與射擊隊外套（shoot.jpg：紅底白拉鍊）撿到會
  **穿在身上**（書包背在背側、外套把制服換紅）；競賽氣手槍（shoot.jpg）與
  天文望遠鏡（自繪，呼應天文台）純加分
- 電腦 AI：前方有空中物件時 10%/幀跳起來搶，落地物件跑過去自然吃掉

**血條式計分與遊戲結束**：
- 兩人各 100 分起跳；撞到跨欄/小黑狗/藍鵲扣隨機 10+x（x=0..9）、撿到加隨機 10+x；
  過欄不再 +1；有人歸零遊戲結束凍結，出記分板（贏家＋雙方分數＋
  「再玩一次？點畫面或按空白鍵」），任一操作重開（分數回 100、穿戴脫掉、角色分配不變）
- **事件看板**：「資料傳輸中」文字列兼即時看板，撞到（亮紅）/撿到（亮綠）訊息
  顯示約 1 秒後變回 loading 文案；訊息期間動態點點暫停

**App 整合行為（useLoadingGame 狀態機）**：
- RPC 全部結束後**強制凍結遊戲並給 2 秒看分數**（settling，記分板顯示
  「載入完成！分數保留，下次載入繼續」）再關卡片；結算中來新 RPC 則取消結算繼續玩
- 遊戲卡下方兩個 el-switch，**存 localStorage**：
  - 「載入完成也不結束遊戲」（預設關）：開啟時 loading 結束進加班模式（overtime），
    玩到自己按「關閉遊戲」鈕或把開關關掉
  - 「我不要再看到遊戲了」：遊戲卡換成極簡文字卡（label＋點點＋
    「重新顯示 loading 小遊戲」反悔連結），loading 結束直接關
- 比賽狀態（分數/穿戴/角色分配/是否操作過）存 module 層跨顯示延續；
  上一場已分出勝負則下次掛載自動開新一場

**迭代 3（2026-07-10~11）**：掛載點追加發送簽名邀請 `sendInvite` 與
填答率統計 `compareSheets`（見上方掛載等待點）；UI 文案「loading 完成/結束」
統一改口語「載入完成」；移除卡底「loading 期間陪你跑一段林口高中」提示列
（操控彩蛋維持不明示）

### 驗證

- lint/test/build 照舊（迭代 2 後 194 測試）；dist 體積增量實測約 16.7KB
  （迭代 1 約 9.4KB，功能翻倍後小幅超出原估 15KB，可接受）
- 人工：桌機鍵盤彩蛋、手機觸控彩蛋、loading 重疊（登入後立刻線上暫存詢問）不閃爍、
  兩個開關的記憶與反悔路徑、結算 2 秒與加班模式

---

## Phase 9：填問卷 drawer 按鈕收納 + JWT 倒數條 sticky 化（2026-07-10 設計定案）

**動機**：填問卷主 drawer（App.vue line 9-96）有 7 顆按鈕＋1 開關散在內容流頭尾——
暫存三顆（匯出/匯入/線上暫存，三種顏色）在頂部、送出/清除/下載在最底，中間隔著全部題目，
主次不分、填到一半想暫存要捲回頂部。另外 JwtCountdownBar 是全域
`position: fixed; top: 0; z-index: 5000`，會蓋住所有 el-drawer 的 header。

### 佈局定案

| 區域 | 內容 |
|---|---|
| 頂部 sticky 控制列 | JWT 倒數條＋「暫存 ▾」dropdown＋「下載上次結果」獨立鈕＋編輯/唯讀雙態按鈕 |
| el-drawer footer（固定底欄） | 送出修改（改 primary 藍）＋清除暫存（danger 紅）；viewOnly 換「檢視完畢」 |
| 內容流 | 只剩 el-steps、alerts、FieldTimeline、FormField，不再有按鈕 |

### 工作項目

1. **頂部 sticky 控制列**（新元件，建議 `src/components/FormToolbar.vue`）：
   - 放在填問卷 drawer body 內、el-steps 下方；`position: sticky; top: 0`。
     drawer body 是捲動容器，往下捲時控制列釘在 **drawer header 正下方**，天然不遮
     header，不需 fixed 與 z-index 5000（sticky 只需蓋過 FormField 的區域性 z-index）
   - **JWT 倒數條**嵌入控制列頂緣（元件改嵌入式，見第 3 項）
   - **「暫存 ▾」el-dropdown**：線上暫存（`draftEnabled` 才顯示項目、`!tempFound`
     disabled、`draftSaving` loading）、匯出暫存答案（`!tempFound` disabled）、
     匯入暫存答案（`!enableModify` 時 disabled 或匯入時自動開啟修改模式，實作時擇一）
   - **「下載上次結果」獨立按鈕**（`lastSubmit.length > 0` 才顯示）——語意與暫存不同
     （已送出結果 vs 未送出暫存），不收進 dropdown
   - **編輯/唯讀雙態按鈕**（`!viewOnly` 才顯示）：**不用 el-switch**——一顆按鈕按下去
     在兩種狀態間切換 `enableModify`，按鈕外觀直接反映當前狀態（例如唯讀態顯示
     「🔒 目前唯讀，點我修改問卷」、編輯態顯示「✏️ 修改中」，文案與 type 實作時定），
     避免使用者對開關費解
   - viewOnly 時控制列只剩 JWT 條＋（若有）下載鈕
2. **footer slot**（el-drawer 真 footer）：
   - **送出修改**：`type="primary"`（藍；現為 danger 紅，紅色改保留給破壞性動作）。
     按鈕文字固定「送出修改」，`checkData()` 不過時 disabled；現在塞在按鈕文字裡的長提示
     （「請確認必填欄位都已填…」）改為 footer 內按鈕上方/旁的一行 danger 小字
     （實作時定視覺）
   - **清除未送出的暫存答案**：`type="danger"`（紅，破壞性），`tempFound` 才顯示
   - viewOnly 時 footer 換成「檢視完畢」
3. **JwtCountdownBar sticky 化（全站一併處理）**：
   - `JwtCountdownBar.vue` 拿掉 `position: fixed` / `z-index: 5000`，改成可嵌入元件
     （width 100%，由外層容器給 sticky）；三態配色、pulse、點擊續約、手機縮細條行為全保留
   - App.vue 移除全域 fixed 實例（line 2-8）
   - 登入後會開啟的 btt 100% 主 drawer body 頂部各嵌一條 sticky JWT：
     columnDialog（併入控制列）、sheetsDialog、signatureDialog、TempTransferDrawers
     的匯出/匯入兩個 drawer；ttb 輔助面板（confirm/inviteCode/Stat/Latest/ConfirmDrawer）
     不放
   - InviteeSignDialog：確認受邀者 session 目前是否有餵 JwtCountdownBar，有的話同樣嵌 sticky
4. **移除項**（主 drawer 內容流）：三顆暫存按鈕的 el-row（line 42-73）、
   「我要修改問卷」el-switch（line 74，改為控制列雙態按鈕）、底部送出/清除/檢視完畢/下載
   四顆（line 87-94）——全部遷入控制列與 footer。
   FieldTimeline、alerts、el-steps、FormField、送出二次確認流程均不動。

### 驗證

- `npm run lint`（模板大改，`vue/no-undef-properties` 必跑）＋ `npm test` ＋ `npm run build`
- 人工：捲動時控制列釘在 header 下方、不遮 header；dropdown 三項功能與 disabled 條件照舊；
  JWT 三態＋警告態點擊續約在 sticky 位置可用；手機直式控制列不擠爆；
  viewOnly / enableModify / tempFound / draftEnabled 各組合的按鈕顯示正確；
  sheets/signature/TempTransfer drawer 的 JWT 條都在、不再遮 header

### 迭代 2（2026-07-10 驗收回饋）：sticky 條要升到全頁 y=0

驗收回饋：sticky 釘在 drawer header 正下方沒問題，但希望捲動時 JWT 條/控制列
一路升到**視窗最頂（y=0）**。sticky 出不了捲動容器（drawer body），所以改讓
header 本身變成會捲走的內容：

- 主流程 btt 100% drawer（columnDialog／sheetsDialog／signatureDialog／loginDialog／
  TempTransfer 匯出+匯入／InviteeSignDialog）一律 `:with-header="false"`（保留 `:title`
  供 aria），標題改渲染成 body 內第一行 `.drawer-flow-title`（_theme.scss：沿用
  `.el-drawer__header` 的糖果漸層視覺，負 margin 吃掉 body 上/左/右 padding 貼齊
  視窗頂端）。body 於是從 y=0 開始，標題跟內容一起捲走，`.drawer-sticky-top` 的
  top:0 就等於全頁 y=0。
- TempTransfer 兩個 drawer 原本靠 header 右上 ✕ 關閉，改在 `.drawer-flow-title`
  右端放 text 圓鈕 ✕（Close icon，白字）。
- loginDialog 沒有 JWT 條，但同流程的標題視覺/捲動行為保持一致，一併轉換。
- ttb 輔助面板（confirm/inviteCode/Stat/Latest/ConfirmDrawer/FileUpload/MultiSelect）
  維持原生 header 不動。

### 迭代 3（2026-07-11 驗收回饋）：sticky 條實際停在 y=20，不是 0

驗收回饋：捲動後 sticky 條頂端仍留一段空隙。headless Chromium 實測根因：
**瀏覽器把 sticky 的釘住範圍用捲動容器（`.el-drawer__body`）的 padding 內縮**——
body 有 20px padding-top，`top: 0` 的 sticky 條就永遠停在 y=20 釘不到頂
（負 margin 只影響排版位置，影響不了釘住範圍）。修法：

- 七個 `with-header=false` 的主流程 drawer 全部加 `body-class="drawer-flow-body"`，
  `_theme.scss` 對 `.el-drawer__body.drawer-flow-body` 把 **padding-top 歸零**
  （左右/下 padding 保留），sticky 釘住範圍上緣回到 body 頂 = 視窗 y=0。
- `.drawer-flow-title` 的負 margin 改成只吃左右（`margin: 0 -20px 16px`），
  上緣不再需要負 margin（body 已無 padding-top）。
- 驗證：以 playwright-core + 快取 Chromium 對 dist 實際 CSS + 相同 DOM 結構實測，
  修正前 stuck top = 20px、修正後 = 0px。
- 註：GAS /exec 頁面本身在 app iframe 上方有 Google 的防釣魚警告橫幅
  （父頁 `#warning-bar-table`，sandbox iframe 動不了），那一段不在我們的控制範圍。

---

## Phase 10：FieldTimeline 目前題目 indicator（2026-07-10 設計定案）

**動機**：FieldTimeline（右緣點線導航）只顯示各題填寫狀態，看不出「我現在捲到哪一題」。
加一個 current 指示：LoadingGame 的像素小學生**正面版縮小**當 indicator，
站在目前題目的點旁邊。

### 設計定案

- **角色**：沿用 `useLoadingGame.js` 的 `getGameSession().playerIsGirl`——跟 loading
  遊戲同一個角色（該值本來就是每次頁面 session 隨機抽的），整個 session「你」是同一個小人，
  不另寫隨機邏輯
- **正面 sprite，不搬側面圖**：遊戲是水平捲軸所以小人側臉朝右；timeline 是垂直的，
  indicator 改繪**正面朝向使用者**的新 sprite（同調色盤：髮/膚/奶油米制服/深藍領帶/
  石墨灰褲裙，女生鮑伯頭＋裙＋黑絲襪，維持男女可辨識）
- **尺寸更小**：緊湊正面 chibi，格數約 8 寬 × 10 列（實作時可微調），scale 2 顯示
  約 16×20px——**高度必須小於點距 22px**，站在點旁不壓到相鄰題目的點
- **極簡開關不連動**：「不要再看到遊戲」（hideGame）語意是 loading 時的遊戲，timeline
  小人是安靜的位置指示、不佔等待時間，極簡模式下照樣顯示
- **踏步動畫要加**：正面版的「跑步」= 原地踏步（兩幀手腳交替，~120ms 換幀），
  捲動進行中踏步、停止捲動（最後一次 scroll 事件後 ~150ms）回到立定幀

### 工作項目

1. **抽共用 sprite 模組 `src/utils/pixelSprites.js`**：
   - 從 `LoadingGame.vue` 搬出：人物調色盤 `PAL`（吃 colors.config.js，鍵 k/s/w/t/g/b/d）、
     側面 `BOY`、`GIRL`（12 寬 × 15 列、兩幀，LoadingGame 續用）、`drawSprite`
     （改成收 ctx 參數的純函數；`squashTop`/`override` 參數保留給 LoadingGame 用）
   - **新增正面兩幀 sprite**：`BOY_FRONT`、`GIRL_FRONT`（約 8×10，同 PAL 鍵，
     幀 1 立定、幀 2 踏步），給 FieldTimeline 用
   - `LoadingGame.vue` 改 import 這份；背景色（BRICK/CREAM 等）與其他道具 sprite 留在原地
   - demoloading.html 是一次性 demo，不動
2. **FieldTimeline.vue 加 indicator**：
   - 版面：容器加寬（軌道 24px 左側再加約 18px 小人欄，總寬 ~42px）；SVG 與小人 canvas
     包進同一個 `position: relative` 內層 div——timeline 自身可捲動（>70vh）時小人
     自然跟著捲
   - 小人：`<canvas>`（邏輯像素 = sprite 格數）CSS 放大 scale 2 約 16×20、
     `image-rendering: pixelated`，絕對定位、`top` 對齊目前題目的點（垂直置中對點）、
     CSS `transition: top .2s` 平滑滑動
   - 畫布重繪只在換幀/初始時發生（幾十個像素，成本可忽略）
3. **「目前題目」判定（FieldTimeline 自理，App.vue 不加 props）**：
   - scroll 不冒泡，onMounted 掛 **window 捕獲階段** listener（rAF 節流）收所有捲動
     容器的事件——不依賴 `.el-drawer__body` 內部結構；timeline 自身的跟隨捲動
     （event.target === 自己）濾掉；`onBeforeUnmount` 拆
   - 每次捲動對所有 `formfield-<tid>` 錨點 `getBoundingClientRect()`，取中心最接近
     視窗中線者為 current；初始（未捲動）也算一次
   - 點擊圓點的 `goTo` 平滑捲動會連續觸發 scroll → 小人一路跑過去，天然動畫，不需特判
4. **timeline 自捲動跟隨**：current 點超出 `.field-timeline` 可視範圍（max-height 70vh）
   時，把容器 scrollTop 捲到讓 current 點可見（`scrollIntoView` 或手算，實作時定）

### 邊界與提醒

- `prefers-reduced-motion: reduce` 時關跑步換幀與 top transition（直接跳位）
- FieldTimeline 本來就 `v-if="!viewOnly"` 且題數 >1 才渲染，條件不變；
  InviteeSignDialog 沒有用 FieldTimeline，不涉及
- 手機寬度：容器總寬約 42px、fixed 貼右緣，實測直式手機下不壓到 FormField 內容再定
  （必要時手機縮小 sprite 至 scale 1 或收窄間距）

### 驗證

- `npm run lint` + `npm test` + `npm run build`；pixelSprites 抽出後 LoadingGame
  現有測試（tests/loadingGame.test.js）須過
- 人工：捲動時小人跟著移動並原地踏步（兩幀動畫）、停止立定；點 timeline 圓點小人
  滑到該題；小人高度不壓到相鄰題目的點；
  題目多到 timeline 內捲時小人與捲動跟隨正常；hideGame 開啟時小人仍在；
  loading 遊戲抽到女生時 timeline 也是女生

---

## Phase 11：受邀簽名者 Email OTP 二段驗證（2026-07-10 設計定案，即 C 案）

> **✅ 已於 2026-07-10 實作完成（未部署）**：後端 `resolveActiveInvite_` 抽取、
> `requestInviteOtp` 新 RPC、`inviteeLogin(token, otp)` 二段化、`_invites` 擴充 L–N
> 三欄（含 11 欄舊列向下相容）、邀請信/OTP 信文案、兩步 UI、
> App.vue 名詞統一。lint／211 測試／build 全綠（invites.test.js +8、inviteRpc.test.js +9，
> 含同 OTP 二次使用、連錯 5 次作廢、重發後舊 OTP 失效、cooldown、配額 0 等攻防劇本）。
> 與計畫的差異：1) 「`history.replaceState` 洗網址」改用 **`google.script.history.replace`**
> ——GAS 沙盒 iframe（googleusercontent.com）是跨網域，原生 history API 改不了上層
> script.google.com 的網址列，GAS 專用 API 才行 2) OTP 生成用 `Utilities.getUuid()` 前
> 12 位 hex 轉十進位取 6 位（模數偏差對 16^12 可忽略）3) cooldown 不加欄位，以
> `otpExpireAt - TTL` 反推寄出時間 4) `requestInviteOtp` 對 signed 邀請也放行
> （受邀者回來查看自己的簽名，與 inviteeLogin 現行行為一致）5) cooldown 回應附
> maskedEmail（reload 後 UI 仍能顯示「已寄到 xxx」）6) 兩步 UI 不在 InviteeSignDialog
> 而在首屏「我有簽名邀請碼」drawer 內完成（確認邀請碼 → 同 drawer 出現 OTP 輸入框），
> OTP 通過才開 InviteeSignDialog（`open(inviteeLogin 回傳值)`，開啟時內容已就緒）；
> `?token=` 直連改為自動填碼開同一個 drawer（2026-07-10 與使用者確認的 UX 修正）
> 7) OTP 輸入框用自 scoringSystem-cf 移植的 PinCodeInput（一格一碼、輸入順序數字
> popIn 動畫、手機 RWD），6 碼 3-3 分組、填滿自動送出、驗證失敗清空聚焦重試；
> 移植時修掉原版 @complete 永不觸發的 bug、numeric 模式只收數字、配色改吃
> Element Plus 主題變數。
> 待辦：實機驗證（見下方端對端驗證清單）後再部署。

### 動機與威脅模型

- 現行 `inviteeLogin(token)`（Code.js:725）token 一對上就回**整份 read-only 問卷
  （含填寫者個資）＋可簽名的 session JWT**，沒有任何身分挑戰
- 64-hex 邀請 token 品質沒問題（256 bits 猜不到），但 token 會**脫離 email 上下文外流**：
  `?token=` 掛在 GET URL 上會進瀏覽器歷史（學校/家庭共用電腦）、驗證碼被截圖、貼錯聊天室
- C 案（email OTP）證明的是「**現在**持有邀請列上登記的信箱」：裸 token 外流、
  甚至整封邀請信被轉寄，撿到的人收不到 OTP 就進不來
- 前提已成立：學校網域 `app.lksh.ntpc.edu.tw` 的 SPF/DKIM/DMARC 三筆 DNS 記錄
  已於 2026-07-10 確認上線，OTP 信投遞可靠性有保障
- 名詞澄清：這是 **email OTP**（寄送式一次性碼），不是 RFC 6238 的 TOTP
  （沒有共享秘鑰與時間演算），對外文案一律稱「一次性驗證碼」

### 名詞統一（信件與 UI 文案都要改）

- **邀請碼** = 64-hex token（邀請信裡那串；現行信件文案把它叫「驗證碼」，要改掉）
- **一次性驗證碼（OTP）** = 6 位數字，登入當下即時寄到邀請列登記信箱，10 分鐘有效

### 流程（定案）

1. 受邀者貼邀請碼（首屏「我有簽名的驗證碼」入口，或 `?token=` 直連）
2. 前端呼叫**新 RPC `requestInviteOtp(inviteToken)`**：
   - 前段檢查同 `inviteeLogin` 現行邏輯（token 格式白名單 → 查列 → 表單未過期未關閉
     → 邀請未過期），這段抽成共用私有函數 `resolveActiveInvite_(token)` 兩支 RPC 共用
   - 節流：同列 60 秒內不重寄，回 `{ success:false, cooldownSeconds }`
   - `MailApp.getRemainingDailyQuota() <= 0` 回明確訊息（「今日郵件額度用盡，請稍後再試
     或聯絡填寫者」）——這是可操作的錯誤，不隱藏
   - 產 6 位數 OTP（`Utilities.getUuid()` 取數字或自組亂數，不足 6 位補零）、效期 10 分鐘
   - **只存 hash**：`otpHash = SHA-256(otp + inviteToken)`（inviteToken 當 salt），
     連同 `otpExpireAt`、`otpAttempts=0` 寫回列上新欄位（ScriptLock 內）
   - 寄信到**邀請列上登記的 email**（RPC 不收 email 參數，絕不信前端）
   - 回 `{ success:true, maskedEmail }`（沿用 `maskString`）；token 不合法一律回 `false`
     不透露原因（同 `inviteeLogin` 慣例）
3. **`inviteeLogin(inviteToken, otp)` 增加第二參數**：
   - OTP 格式白名單 `/^\d{6}$/`；ScriptLock 內重讀列、比對 hash、檢查未過期、
     `otpAttempts < 5`
   - 比對失敗：`otpAttempts+1` 寫回，回 `{ otpFailed:true, message }`（與邀請無效的
     `false` 區分——requestInviteOtp 成功已揭露 token 有效，這裡區分不增加洩漏）；
     達 5 次即清空 OTP 欄（作廢，需重寄）
   - 比對成功：**立即清空 OTP 三欄（單次使用）**，其餘流程與回傳完全同現行
     （問卷 headers + session JWT + alreadySigned/myImage）
   - OTP 通過前不回傳任何問卷內容（結構上天然成立：挑戰與回傳在同一支 RPC）

### `_invites` 分頁 schema 擴充

- 現有 A–K 11 欄，**新增 L–N 3 欄**：`otpHash`、`otpExpireAt(ms)`、`otpAttempts`
- `inviteRowOf_` / `parseInviteRow_` 改 14 欄；**向下相容**：既有 11 欄舊列讀到
  undefined/空字串一律視為「無有效 OTP」，不做資料搬遷（讀寫時容錯即可）
- 重發（force 含）/換 email /撤回時 OTP 三欄一併清空（token 換掉 OTP 本來就對不上，
  但明確清乾淨，避免殘留）
- 所有 OTP 寫入（request 產碼、login 的 attempts+1 與作廢）都在 ScriptLock 內，
  與 submitInviteSignature/revokeInvite 同鎖，防暴力嘗試的並發繞過

### 寄信文案

- OTP 信：主旨 `systemTitle + "一次性驗證碼"`；內文純文字、**無任何網址**、
  6 位數碼、註明 10 分鐘內有效、「若非您本人操作請忽略本信」；沿用 replyEmail
- 邀請信（sendInvite）文案同步更新：64-hex 改稱「邀請碼」，並說明
  「進入網站貼上邀請碼後，系統會再寄一組 6 位數驗證碼到這個信箱，輸入後即可簽名」

### 前端

- `InviteeSignDialog.open(inviteToken)` 改**兩步**：
  1. 先打 `requestInviteOtp` → 顯示「驗證碼已寄到 {maskedEmail}」＋6 位數輸入框
     （`el-input` 大字距）＋「重寄驗證碼」按鈕（前端也做 60 秒倒數，後端節流兜底）
  2. 輸入 6 位數 → `inviteeLogin(token, otp)` → 成功進入現行 read-only 問卷＋簽名板；
     `otpFailed` 顯示可重試文案（含剩餘次數不透露，統一「驗證碼錯誤或已逾時，
     請重新輸入或按重寄」）
- `?token=` 直連：開 dialog 即自動觸發一次 `requestInviteOtp`（reload 濫發由後端
  60 秒節流擋）
- **`history.replaceState` 洗掉網址列的 `?token=`**：dialog 一開就洗，不論後續成敗，
  讓裸 token 不進瀏覽器歷史（這是當時討論「不管選哪案都該做」的便宜加固）
- 首屏貼碼入口與各處文案：「驗證碼」→「邀請碼」，並預告會再收一封驗證碼信
- session 逾時文案改為對應新流程：「請重新貼上邀請碼，系統會再寄一組驗證碼」

### renewToken（不變）

- 受邀者 session 內點倒數條續約**不需重跑 OTP**（後端本來就會重讀邀請列裁決）；
  session 過期後重進才需要完整 token→OTP 流程

### 配額影響

- 每次受邀者登入多耗 1 封 MailApp 信（Workspace 帳號 1500 封/日，夠用）；
  requestInviteOtp 與 sendInvite 共用每日額度，都檢查 `getRemainingDailyQuota()`

### 測試（tests/inviteRpc.test.js 擴充）

- requestInviteOtp：合法 token → 寄信一封＋列上寫入 hash/expire/attempts；
  60 秒內重打 → 不寄信、回 cooldownSeconds；過期/撤回邀請 → false 且不寄信；
  配額 0 → 明確訊息不寄信
- inviteeLogin：正確 OTP → 通過且 OTP 欄清空（**同一 OTP 第二次用失敗**）；
  錯誤 OTP → attempts+1、回 otpFailed；連錯 5 次 → OTP 作廢；逾期 OTP → 拒絕；
  列上無 OTP 直接猜 6 位數 → 拒絕；重發換 token 後舊 OTP 失效
- parseInviteRow_ 向下相容：11 欄舊列 parse 不炸、視為無 OTP
- 現有 186 個測試全過（sendInvite 文案改動會影響既有斷言，同步更新）

### 端對端驗證（實機）

- 貼邀請碼 → 收到 OTP 信（檢查原始郵件 SPF/DKIM/DMARC 三 PASS）→ 輸入 → 進入簽名
- 重寄按鈕 cooldown；`?token=` 直連自動寄碼；網址列 token 被 replaceState 洗掉
- outlook.com 收件者實測 OTP 信投遞（去網址化＋網域認證後的驗證機會）
- 填寫者在受邀者輸入 OTP 期間撤回/重發 → 受邀者 inviteeLogin 被拒（競態走現行防線）

---

## Phase 12：問卷生命週期時間軸（2026-07-10 設計定案）

### 動機

現有「問卷即將在 XXXX 秒後過期，屆時將無法送出！」的 el-alert（App.vue 兩處，
`expired <= 10*60` 才浮現）只在最後 10 分鐘出現、只有文字，平時使用者對「這份問卷
還能填多久」毫無感知。改用 register-dashboard 的「報到計時器」時間軸呈現：
起點—終點軌道、進度填色、進行中顯示當前時間參考線＋距結束倒數，常駐顯示。

### 設計定案（AskUserQuestion 三決策，2026-07-10）

1. **警示行為**：剩餘 <10 分鐘整條時間軸轉 warning/danger 配色、倒數文字強調，
   不另外彈 alert；已逾期轉灰/紅並顯示「已經無法填寫」。
2. **受邀簽名者畫面也放**：同元件重用，起點=邀請發出（`invite.createdAt`）、
   終點=邀請到期（`invite.expireAt`）。
3. **createdAt 來源**：`getQList_` 逐表 `DriveApp.getFileById(refer).getDateCreated()`
   ＋ CacheService 快取（上限 21600 秒；建立時間永不變，過期重讀無正確性問題）。
   **實作時勘誤（2026-07-10 實機抓到）**：Drive ID 是 **B 欄 `refer`**（問卷結構表，
   getHeaders/publicHeader/readRecord 全用它 openById）；N 欄 `sheetID` 只是問卷
   識別字串（前端 localStorage 暫存 key，實務上是「204」這種編號），拿去
   getFileById 會直接炸——首版誤用 N 欄，已修正並有回歸測試。

### 起訖語意

| 畫面 | 起點 | 終點 | 起/終點標籤 |
|------|------|------|------|
| 登入 drawer | 問卷結構表（B 欄 `refer`）建立時間 | `dueDate` | 問卷建立／問卷結束 |
| 填寫 drawer | 同上 | 同上 | 問卷建立／問卷結束 |
| InviteeSignDialog | `invite.createdAt` | `invite.expireAt` | 邀請發出／邀請到期 |

注意：重發邀請沿用原 `createdAt`（Code.js:649），起點不會因重發跳動——正確語意。

### 後端（src/Code.js）

- [ ] 新增私有函數 `sheetCreatedAt_(referSSID)`：先查
      `CacheService.getScriptCache()`（key = `"createdAt_" + referSSID`），miss 才
      `DriveApp.getFileById(referSSID).getDateCreated().getTime()` 並
      `put(key, String(ms), 21600)`；整段 try/catch，失敗回 `0`（前端退化隱藏時間軸，
      不能讓一張表壞掉拖垮整個 getQList）
- [ ] `getQList_` 的每個 sheet 物件加 `createdAt: sheetCreatedAt_(visible[i].refer)`
      （只對 visible 清單做，減少 Drive 呼叫；**是 B 欄 refer，不是 N 欄 sheetID**）
- [ ] `inviteeLogin` 的 result 加 `inviteCreatedAt: invite.createdAt`
      （expireAt 已有，起點補上即可）
- [ ] 權限：DriveApp 既有大量使用，manifest 無 explicit oauthScopes，無新授權

### 前端

**呈現定案（2026-07-10 二次討論）**：橫向比例軌道＋像素小人沿軌走，
放在「問卷狀態 el-steps」正下方；視覺語言挪用 FieldTimeline 的點線系統
（灰=未到/綠=進行/紅=逾期），register-dashboard 只搬 state/percent 邏輯、不搬樣式。

```
問卷狀態 el-steps
─────────────────────
              🚶（側面走路 sprite，依時間比例定位）
 ●━━━━━━━━━┫┈┈┈┈┈○
 問卷建立         │        問卷結束
 07/01 09:00  當前 14:32   07/15 17:00
              距結束 5天3時
```

- [ ] 新元件 `src/components/LifecycleTimeline.vue`（避免與 FieldTimeline 題目導航
      混淆）：
      - props：`startAt`/`endAt`（ms）、`startLabel`/`endLabel`、`endedText`
        （逾期中央文字，問卷用「已經無法填寫」、邀請用「邀請已過期」）
      - 結構：橫向軌道（起/終圓點＋已過時段 fill）＋小人標記當前位置＋小人下方
        「當前時間＋距結束倒數」標籤＋軌道兩端起訖標籤（`dateConverter` 格式）
      - **小人**：`pixelSprites.js` 的側面走路款 BOY/GIRL（12×15 邏輯像素兩幀，
        即 demoloading/LoadingGame 同一組素材，零新繪；遊戲 SCALE=3 畫 36×45，
        這裡縮成 scale 2 畫 24×30；FieldTimeline 垂直導航才用正面款），
        角色沿用 `getGameSession().playerIsGirl`（遊戲/FieldTimeline/這裡同一個「你」）；
        active 態兩幀慢速踏步（時間一直在走）、pending/ended 立定，
        `prefers-reduced-motion` 關動畫（同 FieldTimeline 慣例）；
        `left` 依 percent 定位加 transition 平滑移動
      - 三態 pending/active/ended ＋ **warning 態**（active 且剩 <10 分鐘）：
        軌道與倒數文字轉 warning→danger 配色、倒數加粗
      - 元件自持 1 秒 setInterval tick（onUnmounted 清除）；起訖缺值或 `endAt<=startAt`
        （含 createdAt=0、dueDate=0「不開放」）時整個不渲染（`v-if` 在元件內判）
      - 配色吃 Element Plus 主題變數／`colors.config.js`（同 PinCodeInput 慣例）；
        放內容流跟著捲動、不 sticky（sticky 位留給 JWT 條/FormToolbar）；
        手機直式軌道吃滿寬、起訖標籤縮字級
- [ ] 純函數下沉 `src/utils/timeline.js`：`timelineState(now, startAt, endAt)`
      （回 pending/active/warning/ended）、`timelinePercent(now, startAt, endAt)`
      （0–100 clamp）——供單元測試
- [ ] App.vue：
      - 移除兩處過期 el-alert（登入區 ~263、填寫 drawer ~30）；`expired` computed
        及送出封鎖邏輯保留不動
      - 登入 drawer：問卷狀態 el-steps（~246）正下方渲染
        `<LifecycleTimeline :start-at="sheet.createdAt" :end-at="sheet.dueDate" …>`
      - 填寫 drawer：問卷狀態 el-steps（~9）正下方放同一元件（同一張表的起訖）
- [ ] InviteeSignDialog.vue：`open()` 收到的 payload 取 `inviteCreatedAt`/`expireAt`
      渲染時間軸（該 drawer 無 el-steps，放 read-only 內容頂部），
      標籤「邀請發出／邀請到期」、endedText「邀請已過期」

### 測試

- [ ] `tests/timeline.test.js`：state 四態邊界（now<start、start<=now<end-10min、
      剩 <10 分、now>=end）、percent clamp（0/100/負 span）、缺值退化
- [ ] Code.js 測試（既有 stub 全域模式）：`sheetCreatedAt_` cache hit 不打 Drive、
      miss 寫入 cache、Drive 拋錯回 0；`getQList_` 物件含 createdAt
- [ ] `npm run lint`（模板綁定完整性）／`npm test`／`npm run build`

### 端對端驗證（實機）

- 登入/填寫 drawer 的 el-steps 下方時間軸顯示、小人位置與比例相符、
  active 態慢速踏步、起訖時間正確（Asia/Taipei）
- 小人角色與 loading 遊戲/FieldTimeline 同一個（playerIsGirl 一致）
- 用測試表把 dueDate 調到 10 分鐘內 → warning 配色；調到過去 → 「已經無法填寫」
  ＋小人立定
- 受邀者畫面：邀請發出/到期時間軸；重發後起點不變、終點更新
- dueDate=0 的表：時間軸不出現、無 console 錯誤
- 手機直式：軌道滿寬、起訖標籤與小人標籤不重疊

---

## Phase 13：進度指示物收斂——el-steps 退役 + LifecycleTimeline 安靜化（2026-07-10 設計定案）

### 動機

填寫 drawer 同屏已有四種進度指示物：el-steps（流程軸）、LifecycleTimeline（問卷時間軸）、
JwtCountdownBar（登入時效軸）、FieldTimeline（題目軸）。討論結論：設計語言統一是
「同一種資訊用同一種形式」，不是「所有資訊都套 timeline 形式」；只在轉場瞬間有用的
資訊不該常駐。UI 已比原始版本複雜很多，用不到的元素退役。

### 設計定案（2026-07-10 討論定案，放棄先前的 FlowTimeline 提案）

1. **el-steps 全數移除（四處：登入/填寫/簽名/送出確認 drawer），useSteps.js 退役**。
   - 「我在哪」由 `.drawer-flow-title` 承載（每個全螢幕 drawer 本身就是一個步驟）。
   - error 態不損失：步驟標紅的當下同畫面必有 ErrorAlert 講具體錯誤。
   - 唯一真價值「預告後面要簽名」搬到填寫 drawer footer 主按鈕文案：
     需簽名（`allSignNames.length > 0`）時顯示「完成填寫，前往簽名」、否則維持「送出修改」。
2. **FieldTimeline／JwtCountdownBar 保留**——前者全程有用且可互動（主角），後者可操作續約。
3. **LifecycleTimeline 降級為「安靜直到要緊」**：新增 `quiet` prop（預設 false）。
   - `quiet=true` 時只在 `warning`（剩 <10 分鐘）或 `ended` 態才渲染——回歸它所取代的
     「問卷即將過期」el-alert 的警示語意。
   - 登入 drawer 維持常駐（quiet 不設）：那是「要不要開始填」的決策點，截止資訊在此最有價值。
   - 填寫 drawer 與 InviteeSignDialog 傳 `quiet`。

### 前端

- [ ] App.vue：
  - 移除四處 `<el-steps>` 區塊（填寫 ~9、簽名 ~147、登入 ~246、送出確認 ~349）
  - 移除 `useSteps` import 與解構，清掉所有 `changeStep`/`viewStep` 呼叫
    （openSheet 內 viewStep 分支只留 `viewOnly`/`enableModify` 副作用；
    各處只包 changeStep 的 `nextTick` 整段刪除；sendMod 的 nextTick 保留
    `uploadStatus.value = false`）
  - 填寫 drawer footer 主按鈕文案改 computed（見定案 1）
  - 填寫 drawer 的 LifecycleTimeline 加 `quiet`
- [ ] 刪除 `src/composables/useSteps.js`
- [ ] useSignatures.js：`initSignaturePads(onReady)` 的 onReady 參數退役
      （唯一用途就是切步驟條狀態；App.vue 與 InviteeSignDialog 改無參呼叫）
- [ ] LifecycleTimeline.vue：加 `quiet` prop，渲染條件改
      `valid && (!quiet || state === 'warning' || state === 'ended')`；
      原本 `watch(valid)` 補畫第一幀改 watch 整個可見條件（quiet 下 warning 轉入時
      canvas 才進 DOM）
- [ ] InviteeSignDialog.vue：LifecycleTimeline 加 `quiet`
- [ ] FormToolbar.vue：註解「放在 el-steps 下方」改掉

### 測試

- [ ] `npm run lint`（模板綁定完整性——移除 stepIndicator/availableSteps 後由
      `vue/no-undef-properties` 兜底）／`npm test`／`npm run build`
- [ ] tests/timeline.test.js 純函數不受影響（quiet 判斷在元件層，不新增純函數）

### 端對端驗證（實機）

- 四個 drawer 頂部無步驟條、版面無破損；填寫 drawer 頂部剩 title＋FormToolbar
- 有簽名格的表：footer 主按鈕顯示「完成填寫，前往簽名」；無簽名格顯示「送出修改」
- 填寫 drawer 平時無 LifecycleTimeline；用測試表把 dueDate 調到 10 分鐘內 →
  時間軸以 warning 態浮現；調到過去（檢視模式）→ ended 紅字
- 登入 drawer 時間軸照常常駐
- 受邀者畫面：邀請剩 >10 分鐘不顯示時間軸、<10 分鐘 warning 浮現

---

## Phase 14：問卷列表卡片化 + 流程預覽看板串（2026-07-10 設計定案）

### 動機

Phase 13 拔掉 el-steps 後，「這份問卷需要簽名」這個資訊失去了載體（footer 按鈕文案
只有進場後才看得到）。定案：把資訊放到**進場前的決策點**——問卷列表。挪用
scoringSystem-cf `ProjectCard.vue` 的「階段看板串」**機制**（開始標記→階段 chips→
結束標記、箭頭串接、標記帶日期），使用者選問卷時就知道「這份要簽名幾組、
什麼時候開始/截止」。

### 設計定案（AskUserQuestion，2026-07-10）

1. **不要指示物**：問卷不是多階段專案，沒有「當前階段」可停靠——不搬 LED 開車、
   不搬 matter.js 彈跳、不用像素小人。看板串是**純靜態**的流程預覽。
2. **整列卡片化**：sheetsDialog 的 el-table 退役，每份問卷一張卡
   （名稱＋tags／看板串／進入按鈕）。
3. 甘特模式、useInViewport、使用者偏好切換——都不搬。

### 資料面（零後端改動）

`getQList` 每份問卷已帶齊：`signatures`（Code.js:208；簽名格名稱陣列）、
`createdAt`（Phase 12）、`dueDate`/`viewDate`/`writeAllowed`。
注意 Code.js:227 對過期問卷把 signatures 清空——過期只能檢視不簽名，
chip 不顯示簽名剛好語意正確，不要「修」它。

### 卡片版面（骨架照抄 ProjectCard，2026-07-10 補充定案；右上角提醒 2026-07-11 退役）

```
問卷名稱（過長 ellipsis）
[tags]
[開始]──→[填寫]──→[簽名 ×2]──→[填寫結束]
07/01                            07/15 17:00   ← 結束日期依急迫度變色
                                     [填寫&檢視表單]
```

**右上角提醒退役、急迫度改由結束節點承載（2026-07-11 定案）**：原右上角兩行
「可填寫至／可檢視至」色點提醒全數移除（剩餘時間與看板串的結束節點語意重複、
手機版擠）。「還來得及嗎」改由看板串最後的**結束節點日期文字色**表達——方框本身
維持灰框（跟全條 tone 一致），只染方框下方那行日期（`.sc-node-sub`）：

| 情境 | 結束節點 label | 日期文字色（subTone） |
|------|------|----|
| 開放填寫中、離截止 >10 分（充裕） | 填寫結束 ＋ dueDate | 灰（base 次要色，不特別染） |
| 開放填寫中、剩 ≤10 分（warning） | 填寫結束 ＋ dueDate | 橘 `--sm-warning-on-light` |
| 已截止（ended） | 查看結束 ＋ **viewDate** | 磚紅 `--el-color-danger` |
| `writeAllowed=false` / `dueDate=0` | 填寫結束 ＋ dueDate 或「不開放」 | 灰 |

結束節點語意：填寫未截止顯示「填寫結束」＋dueDate；填寫已過（`now>=dueDate`）
不再顯示填寫結束，改「查看結束」＋viewDate（剩下的只有查看期）。
卡片不自跑 1 秒 tick（列表停留短，開卡當下的 now 算一次即可；
要即時感留給進場後的 LifecycleTimeline）。

### 看板串組成（依問卷設定動態）

```
[開始]──→[填寫]──→[簽名 ×2]──→[結束]
07/01                            07/15 17:00
```

- **開始標記**：「開始」＋下方小字日期（`createdAt`；=0 不顯示日期）
- **「填寫」chip**：開放填寫中顯示「填寫」；已截止但仍可檢視（`dueDate<=now<viewDate`）
  顯示「檢視」
- **「簽名 ×n」chip**：`signatures.length > 0` 才出現，n=簽名格數——簽名需求的資訊載體
- **結束標記**：填寫未截止「填寫結束」＋`dueDate`；已截止改「查看結束」＋`viewDate`；
  `dueDate=0` 顯示「不開放」。日期文字色依急迫度（灰/橘/磚紅，見上表），方框不變色
- 箭頭用 FontAwesome（`fa-chevron-right`），配色吃色表變數（灰＋磚紅：起訖框/箭頭石墨灰、
  中段填寫/簽名 chip 珊瑚紅）；已截止整條方框轉灰；`writeAllowed=false` 整條灰
- 無任何動畫

### 前端

- [ ] 純函數 `src/utils/sheetFlow.js`：`buildFlowChips(sheet, now)` 回
      `[{ type: 'start'|'chip'|'end', label, sub?, tone, subTone? }]`
      （結束節點 `subTone`：''=充裕灰、warning=剩<10分橘、danger=已截止磚紅）
      ——組成/文案/急迫度全在純函數，供單元測試；右上角 `sheetStatus` 已退役
- [ ] 新元件 `src/components/SheetCard.vue`：props `sheet`，emit `open`；
      頂列名稱（ellipsis）、tags（沿用 tagPalette）、中段看板串、底列進入按鈕
      （沿用現行邏輯：`writeAllowed` disabled、`viewCheck` 決定「檢視」/「填寫&檢視」文案）
- [ ] App.vue sheetsDialog：el-table 換 `v-for` SheetCard；
      「我有簽名邀請碼」按鈕與 footerText 保留原位
- [ ] RWD：直式手機看板串 `overflow-x: auto` + `nowrap`（照抄 ProjectCard 直屏處理）；
      卡片間距與 drawer 內容寬一致
- [ ] 登入 drawer 的常駐 LifecycleTimeline **保留**：`?sheet=` 深連結使用者跳過列表，
      那是他們唯一看得到起訖的地方

### 測試

- [ ] `tests/sheetFlow.test.js`：有/無簽名格、開放中/已截止可檢視/已截止不可檢視/
      `dueDate=0`/`writeAllowed=false`、`createdAt=0` 的 chips 組成
- [ ] `npm run lint`／`npm test`／`npm run build`

### 端對端驗證（實機）

- 有簽名格的問卷卡出現「簽名 ×n」chip，無簽名格不出現
- 過期問卷（後端清空 signatures）：無簽名 chip、「填寫」轉「檢視」、整條灰
- `dueDate=0`：結束標記「不開放」；`writeAllowed=false`：整條灰＋按鈕 disabled
- 手機直式：看板串橫向捲動不擠壓、卡片不破版
- tags 染色與原表格一致；「我有簽名邀請碼」入口還在

---

## Phase 15：「無資料」宣告——nullable 列新增 D 註記＋一鍵填答按鈕（2026-07-11 設計定案）

> **✅ 2026-07-11 實作完成（未部署）**：lint／259 測試全綠。與規格的差異與補充：
> 1. 後端跳過機制掛在既有的「不提供資料」哨兵判斷旁（writeRecord 原本就有
>    `N` 空值→內部哨兵的逃生門，`D` 分支獨立、哨兵「無資料」會原樣落地）；
>    盤點時發現該逃生門對所有欄位生效（既有竄改孔）與「後端沒有群組驗證」
>    兩件事，均記入 plan/issue.md。**同日追加定案**：「不提供資料」哨兵改為
>    原樣落地（N 欄位留空不再存空字串）、跳過判斷限縮到 nullable 欄位（竄改孔
>    關閉）、readRecord 回填時哨兵轉回空值（前端不認識這個字串）——詳見
>    issue.md「不提供資料」條目。
> 2. 群組「哨兵視同空值」只實作前端（後端本來就沒有群組檢查）。
> 3. 新增 `columnRules.noneDeclared()` 純函數（按鈕狀態與驗證短路共用）；
>    測試為 columnRules 6 案例＋tests/noneable.test.js（getHeaders 詞彙解析）。
> **待人工驗收**（端對端清單見下）＋部署；部署前不要在對照表單標 `D`。

### 動機

「無則填無」是實務問卷的固定慣例（家長二姓名/證號/手機/Email/關係、學生手機等），
現況是出題者把內建驗證器的正則抄一遍加 `|無`（如 `^(?:09\d{8}|無)$`）、設成必填，
填寫者親手打「無」，打錯字就觸發格式錯誤。這暴露的是**組合缺口**：內建格式
（M/I/E…）無法表達「必答、但『沒有』是合法答案」。

否決的替代方案（供日後引用）：
- **跳題邏輯**（無資料就跳過 X 欄）：要新 mini-grammar＋改 writeRecord 驗證＋
  出題者學新語法，違反凍結決策（plan/2026-summer.md）。
- **regex 嗅探**（偵測正則含「無資料」就出按鈕）：治標不治本，regex 重抄問題還在。
- **掛在既有 `N` 上**：`N`（可留白）與「宣告無資料」語意不同——真實問卷的家長二
  欄位是 `M`＋regex 而**不是** `N`，出題者要的是強迫表態；且 `N` 是既有資料在用的
  旗標，重新定義＝回溯改變現存問卷行為（電話三擇一群組會被哨兵值打穿）。

### 設計定案（2026-07-11 討論）

1. **第 8 列（nullable 列）詞彙擴充**：合法值 `''`／`N`／`D`／`ND`。
   解析從 `=== "N"` 改為 `/N/.test()`＋新增 `noneable: /D/.test()`——
   既有問卷格子都是單字母，行為零變化（比照 type 欄一格多字母的既有慣例，
   屬 2026-summer「向後相容加法」豁免）。
2. **`D` 語意**：「無資料」（固定哨兵字串）是這一欄的合法答案。與 `N` 正交：
   `N`＝可以留白（漏填也沒關係）；`D`＝不能留白混過，但可以明確宣告「沒有」。
   **`M`＋`D`＝必答、但『無資料』是合法答案**——家長二的真實語意，適用所有格式
   （M/I/E/T/X…），內建正則不用再抄一遍加 `|無`。
3. **驗證規則（前後端一致）**：`noneable` 欄位 `value === '無資料'` 時跳過格式檢查、
   通過必填檢查；**群組檢查（「不得全空」與 `:U` 不重複）中「無資料」一律視同空值**
   ——群組要的是至少一筆真資料，哨兵值不得打穿它。
4. **UI＝雙態按鈕，不用 el-switch**（既有規範：switch 對填表人費解）。
   未按：「這題我沒有資料」（plain）；按下：實心＋「已填『無資料』（點此改回手動輸入）」，
   同時輸入元件 disabled。`enableModify=false`（唯讀/過期檢視）不顯示按鈕。
5. **按鈕狀態是 value 的衍生顯示，不另存旗標**：`value === '無資料'` 即為按下狀態。
   草稿載回、本機暫存疊回、匯入匯出、跨裝置全部自動正確，零額外儲存。
6. **紀錄表寫入哨兵字串「無資料」**：下游明確區分「宣告沒有」與「留白／漏填」，
   匯出端語意自明，export.js 不用動。
7. **舊問卷零影響**：不標 `D` 一切如舊；`|無` 手打慣例繼續有效。要遷移就把欄位
   改標 `D`（可順手把正則裡的 `|無` 拿掉或保留皆可）。
8. **部署順序**：先部署新 Code.js 再開始在對照表單標 `D`——舊版 web app 讀到
   `ND` 會當作非 `N`（行為退化不炸），但正確語意需要新後端。

### 實作範圍

- `src/Code.js`：`getHeaders` 的 `must`/`nullable` 改 regex test、新增
  `noneable: /D/.test(referArr[7][i])`；`writeRecord` 驗證鏈：noneable 且值＝「無資料」
  → 跳過格式檢查；群組「不得全空」檢查把「無資料」視同空值。
- `src/utils/columnRules.js`：`validateColumn` 同步上述規則（noneable 短路＋
  群組檢查的哨兵視空）；`statusDetector` 不用改（非空即已回答）。
- `src/components/FormField.vue`：`v-if="column.noneable && enableModify"` 雙態按鈕，
  點擊 toggle `column.value` 於 `'無資料'`／`''`；按下時輸入元件 `:disabled`。
- 檢查器 `tools/export.js`：第 8 列合法詞彙更新為 `''`／`N`／`D`／`ND`（其他警告）；
  `C`/`O` 型欄位標 `D` 無意義 → 警告。
- 測試：`tests/columnRules.test.js` 加 noneable 案例（M+D 必填通過、D 值哨兵跳格式、
  群組全哨兵被擋、`N` 行為不變）；Code.js 端沿用 stub 載入模式測 `getHeaders` 解析
  （`''`/`N`/`D`/`ND`/怪值）。
- 改模板必跑 `npm run lint`（vue/no-undef-properties）。

### 端對端驗證（實機）

- `M`＋`D` 的手機欄（format M、content 空）：按「這題我沒有資料」→輸入框鎖定→
  送出通過→紀錄表該欄＝「無資料」
- 同欄不按按鈕留白送出→被必填擋下（表態強制有效）
- 按下→存草稿→重新登入載回：按鈕維持按下狀態、輸入框鎖定
- 群組欄位全部宣告「無資料」→被「不得全空」擋下
- 舊問卷（第 8 列只有 `N`）行為與改版前完全一致；檢查器對第 8 列填 `X` 出警告
- 過期問卷檢視模式不出現按鈕

---

## Phase 16：`_invites` 純 append 化（deleteRow + setValues 全除；2026-07-11 設計定案）

> **✅ 2026-07-11 實作完成（未部署）**：`_invites` 已改為純 append 快照日誌——新增
> `inviteCellKey_`/`latestInvites_`/`latestInviteForCell_`/`latestInviteForToken_`（superseded 舊碼判 null）；
> 六個寫入點（sendInvite/requestInviteOtp/inviteeLogin×2/submitInviteSignature/revokeInvite/writeRecord 消耗）
> 全改 `appendRow` 快照，`revokeInvite`／`writeRecord` 兩處 `deleteRow` 移除、改 append `revoked`/`consumed`
> 終態；狀態機補兩終態，reader 全走「每格最新列」，`listInvites` 隱藏終態格。全庫 `.deleteRow(` 歸零
> （暫存 `deleteDraft` 亦於同日改 `clearContent`）。測試 273 全綠（invites/inviteRpc 兩檔改 append 語意
> ＋新增 superseded/終態/consumed 覆蓋）、lint 淨、build OK。**待實機驗證後部署**。
>
> **同日修正（使用者指正）——快照一律忠實、零清空**：初版在終態/OTP 快照裡清空了
> fileID/otpHash 等欄位，違反 append 哲學。定案原則：**append 的每一筆都是「原狀態忠實快照＋只翻
> 這次事件改變的欄位」，絕不寫空值代表失效——失效一律由讀取端判斷**。具體：撤回/消耗快照保留
> fileID/email/OTP 全欄位；OTP 連錯滿 5 次的「作廢」不落地（讀取端 `attempts >= MAX` 即作廢）；
> 單次使用＝成功快照把 `otpExpireAt` 記為使用當下（效期終止事件，hash/attempts 留存）。
> 終態列無任何 reader 會取 fileID 讀檔（已逐一核對），稽核軌跡完整。

> **決策**：使用者定調——**全系統只支持「一律 append」，資料失效與否一律在程式端過濾＋判斷，
> 不刪列（`deleteRow`）也不就地覆寫（`setValues`）**。已同步寫進 CLAUDE.md「Sheets 寫入規範」。
> 本 Phase 把 `_invites` 從「一格一列、就地 upsert」翻成**純 append 快照日誌**。
> email 邀請碼有效期改 `inviteTtlMinutes`（ScriptProperties，分鐘）已於 2026-07-11 先行完成，不在本 Phase。
> 暫存的 `deleteDraft`（另一處 `deleteRow`）於暫存相關對話另行處理，不在本 Phase。

### 核心模型翻轉

- `_invites` 每列＝一筆完整 14 欄**快照**；發邀請、寄 OTP、OTP 錯誤累加、簽名、撤回、消耗——
  每個動作都 **`appendRow` 一筆新快照**，**永不 `setValues` 舊列、永不 `deleteRow`**。
- **快照忠實原則（零清空）**：新快照＝原狀態全欄照抄＋只翻這次事件改變的欄位（status/attempts/
  otpExpireAt/updatedAt…），**任何欄位都不准寫成空值來表示失效**——失效是讀取端的判斷結果，
  不是落地的資料狀態。
- 「當前狀態」＝程式端取**每格（`referSSID|primaryValue|signName`）最新一列**（append 保序，最大 rowIndex 即最新）
  再套 `inviteStatusFor_`（timestamp + status 欄）判定。失效（expired/superseded/終態）全在讀取端過濾。

### 新增讀取 helper（純函數，可單元測試）

- `latestInviteRows_(rows)`：掃全表、依 cellKey 分組取最新 → 回「每格最新快照」清單（reader 一律先過這關）。
  **注意跳過第 1 列表頭**（`INVITE_HEADER`，2026-07-11 已導入）：表頭 cellKey 是字面字串、對真實查詢惰性，
  但 `latestInviteRows_` 做分組時應顯式從第 2 列起（或濾掉首欄 === `INVITE_HEADER[0]` 的列），避免產生無用的假分組。
- `latestInviteForToken_(rows, token)`：找**最新一列的 token 等於此 token**的那格；若該 token 只出現在
  已被後續列取代的舊快照（重發後的舊碼）→ 回 null＝**superseded 失效**（correctness 重點，必測）。
- `inviteRowIndexByCell_` / `inviteRowIndexByToken_`（現回 index 供 setValues）→ 退役，改用上面兩個。

### 寫入點逐一改（全部 `appendRow`，全部在 ScriptLock 內「讀最新 → append」）

1. **sendInvite**（發／重發／換 email）：讀最新 → 組新快照（新 token、status `pending`、清 OTP 三欄、
   `createdAt` 沿用最早值）→ append。`signed` force 分支照舊 trash 舊簽名檔，但也改 append。
2. **requestInviteOtp**：讀最新 → 複製 + 填 `otpHash`/`otpExpireAt`/`otpAttempts=0` → append。
   60 秒節流仍由最新快照的 `otpExpireAt - INVITE_OTP_TTL_MS` 反推（邏輯不變）。
3. **inviteeLogin** OTP 比對：錯 → append `otpAttempts+1` 快照（hash 原樣保留；滿
   `INVITE_OTP_MAX_ATTEMPTS` 的「作廢」**不落地**，讀取端 `attempts >= MAX` 的判斷就是作廢本身）；
   對 → append「`otpExpireAt`＝使用當下」的事實快照（單次使用＝效期於使用那一刻終止，hash/attempts
   原樣保留供稽核）後回問卷內容 + session JWT。
4. **submitInviteSignature**：append `status='signed'` + `fileID` 快照。
5. **revokeInvite**：**移除 `deleteRow`** → append `status='revoked'` 快照（`force` 且原 `signed` 仍 trash 簽名檔）。
6. **writeRecord 消耗清列**：**移除 `deleteRow` 迴圈** → 對該使用者這份問卷每個 active 簽名格
   append `status='consumed'` 快照（簽名 fileID 已寫進紀錄列，不動）。

### 狀態機

- 新增終態 `revoked` / `consumed`；`inviteStatusFor_` 對兩者回終態；`inviteTransition_` 矩陣補這兩欄。
- 所有 reader（`resolveActiveInvite_`、`resolveSignatureSources_`、`listInvites`、`invitesForUser_`）
  一律先 `latestInviteRows_` 取每格最新，再把 `expired`／`revoked`／`consumed`／superseded 視為非活躍。

### 競態防線（維持）

- 仍用 `LockService.getScriptLock()` 包住「讀最新快照 → append」（TOCTOU 防線不變）。
  原本「在 Lock 內重讀邀請列」的競態測試改成「在 Lock 內重讀**最新快照**」語意。

### 成長與離線壓縮

- 純 append 成長比 tombstone 更快（OTP 每次重試／錯誤都各留一列），**為刻意取捨**（換零位移風險 + 完整稽核）。
- 量大後的壓縮另立工具進 `tools/`（不隨 clasp 部署），**且壓縮本身也不得線上 `deleteRow`**：
  由維運手動把「每格最新列」重建到新分頁 / 整批覆寫，離線執行。不在本 Phase。
  （**2026-07-11 更正**：壓縮函數不能放 `tools/`——`LockService`/`ScriptProperties` 都是
  per-project，tools/ 是問卷列表 container-bound 專案，拿的鎖擋不住 web app 寫入、也讀不到
  `draftSheetID`，改放 `src/Code.js`，見 Phase 18）

### 向下相容

- 既有列（11 欄 legacy／14 欄）照 `parseInviteRow_` 解析不變；現有表本就一格一列 →「每格最新」即該列 → 無縫。
  部署後新動作才開始 append，混雜無妨。

### 測試點

- 純函數：`latestInviteRows_`（多列取最新）、`latestInviteForToken_`（最新命中／superseded 回 null）、
  `inviteStatusFor_` 對 `revoked`/`consumed`。
- RPC（`tests/inviteRpc.test.js` 改寫）：每個寫入點斷言「`getLastRow()` 增加、舊列仍在」而非覆寫；
  revoke／consume 後最新列 status 正確且原 `pending` 列仍在；superseded 舊 token 被拒；
  OTP 錯誤累加跨快照；consume 後同格再 `requestInviteOtp`/`inviteeLogin` 被擋。全數維持 ScriptLock。

### 端對端驗證（實機）

- 發 → 重發：舊邀請碼失效（superseded）、新邀請碼可用。
- 撤回後該格可重發；`_invites` 留有 `revoked` 快照、原列未被刪。
- 受邀者簽名 → 填寫者送出 → `_invites` 出現 `consumed` 快照、原列仍在、紀錄表簽名正常內嵌。
- 連錯 OTP 5 次作廢，每次錯誤各留一列。

---

## Phase 17：線上暫存純 append 化——永遠抓最新版＋payload gzip 單格化（2026-07-11 設計定案）

> **決策**：比照 Phase 16「一律 append」原則翻新線上暫存；`saveDraft` 就地 `setValues` upsert 與
> `deleteDraft` 的 `clearContent`（2026-07-11 過渡版）全數退役。設計經三輪收斂到**最簡形**：
> 草稿失效只有一種——**存新版，舊版因非最新列自動失效（superseded）**。沒有消耗/刪除概念
> （中途討論過的終態快照、獨立 `_usedDrafts` 消耗帳表兩案均否決——資料表純資料＋永遠抓最新列即可）。
> 併答「payload 編碼能否不切多格」的探索：後端 gzip+base64 讓一般草稿穩進單格；
> **50,000 字/格是 Sheets 硬限制，任何編碼只能大幅降低切塊機率、無法保證單格**，保留切塊 fallback。

### 核心模型

- 草稿分頁（一份問卷一個分頁、分頁名 = referSSID，不變）是**純 append 資料日誌**：每次暫存
  `appendRow` 一筆快照，永不 `setValues`/`deleteRow`/`clearContent`；「當前草稿」＝該主鍵**最新一列**
  （append 保序，最大 rowIndex 即最新）。
- **`deleteDraft` RPC 整支退役**；前端 `useDraft.js` 的 `deleteDraftOnline` 與 `App.vue` 送出成功後的
  呼叫點一併移除。使用者可以一直暫存，系統永遠抓最後一個。
- **送出後提示照跳**（接受此代價，由使用者自選）：`checkOnlineDraft` 的 drawerConfirm 文案加註
  **「線上暫存不代表最終結果，正式結果以已送出的紀錄為準」**。

### 分頁結構

- 第 1 列人類可讀表頭＋凍結（比照 `INVITE_HEADER` 惰性 marker 模式）：
  `DRAFT_HEADER = ['primaryKey 主鍵', 'updatedAt 存檔(ms)', 'payload 草稿(gz:base64，超長切塊)']`
  表頭首欄是字面字串、永不等於真實主鍵 → 以主鍵查列的 reader 天然跳過，不需特判。
- 資料列：A 主鍵、B updatedAt（存檔當下 ms）、C 起 payload 切塊。

### payload 編碼（gzip+base64 單格化）

- `encodeDraftPayload_(str)`：`'gz:' + Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(str)).getBytes())`。
  JSON 壓縮通常 3~6 倍、base64 回胖 4/3，淨縮 2~4 倍——一般草稿（數 KB～數十 KB）穩進單格。
- `decodeDraftPayload_(str)`：`gz:` 前綴 → base64Decode → `Utilities.ungzip` → `getDataAsString()`；
  無前綴原樣回傳（`gz:` 是自描述版本記號，非舊資料相容）。
- 編碼後仍 >45,000 字退回既有 `chunkPayload_` 切塊（函數與 `DRAFT_CHUNK_SIZE` 保留），
  讀取端 C 起串接後 decode。
- 選 GAS 端而非前端 CompressionStream：前端零改動、且 iPad OS13（Safari 16.4 以下）不支援該 API。

### 後端改動（src/Code.js）

- **退役**：`deleteDraft`（整支 RPC）、`draftRowIndex_`（就地覆寫找列用，append 模型無此需求）。
- **新增純函數**（可 vitest）：`encodeDraftPayload_`、`decodeDraftPayload_`、
  `parseDraftRow_(row)`（→ {key, updatedAt, payload=C 起串接}）、
  `latestDraftRowForKey_(rows, key)`（同主鍵後列勝出＝superseded，無則 null；表頭列天然不匹配）。
- **`draftSheet_`**：新分頁建立時補 `DRAFT_HEADER` + `setFrozenRows(1)`（比照 `inviteSheet_`）。
- **`saveDraft`**：auth（`authByToken_` 安全邊界不變）→ encode → chunk → ScriptLock 內
  `appendRow([key, now].concat(chunks))`。回傳 `{success, updatedAt: now}` 介面不變。
- **`loadDraft` / `draftPayloadByKey_`**：讀全表 → `latestDraftRowForKey_` → 無列回 null；
  有則 C 起串接、decode，回 `{updatedAt, payload}`。介面不變 → `buildReadonlyHeaders_`
  （受邀者 read-only 疊草稿）零改動。

### 前端改動（唯二）

- `src/composables/useDraft.js`：移除 `deleteDraftOnline`；`checkOnlineDraft` 的 drawerConfirm 文案
  加「線上暫存不代表最終結果，正式結果以已送出的紀錄為準」。
- `src/App.vue`：移除送出成功後的 `deleteDraftOnline(...)` 呼叫點。

### 競態與鎖

- `saveDraft` 維持 `LockService.getScriptLock()`（建分頁競態＋與 Phase 16「寫入一律在鎖內」慣例一致）；
  純 append 無 TOCTOU 讀改寫。

### 成長取捨

- 每次手動暫存／`saveDraftForInvite` 都 append 完整 payload 快照（多版並存、永不清）——刻意取捨
  （同 Phase 16：換零位移風險）；量大後離線壓縮進 `tools/`（每主鍵留最新列重建分頁），不在本 Phase。
  （**2026-07-11 更正**：同 Phase 16 的更正，壓縮函數改放 `src/Code.js`，見 Phase 18）

### 向下相容

- **無**：尚未正式上線、無現存草稿需要保護。部署前手動刪除暫存試算表既有問卷分頁
  （舊 upsert 格式；**保留 `_invites`**），新格式＋表頭自動重建。

### 測試點（tests/draftChunks.test.js 改寫＋擴充）

- encode/decode roundtrip：Utilities stub 用 node:zlib `gzipSync`/`gunzipSync` + Buffer base64
  （GAS 的 gzip 即標準 gzip 格式）；含中文 payload；無前綴原樣回傳。
- 編碼後 >45,000 字 → 切塊 → 串接 decode roundtrip；空字串。
- `latestDraftRowForKey_`：多版後列勝出（superseded）；表頭列永不匹配真實主鍵；查無回 null。
- `parseDraftRow_`：變長 chunk 列。
- 既有 `chunkPayload_` 測試保留；`draftRowIndex_` 測試隨函數退役刪除。

### 端對端驗證（實機）

- 手動暫存 → 換裝置同身分登入 → 還原；暫存兩次 → 取最新版、分頁兩列都在（舊版 superseded）。
- 正式送出 → 草稿分頁不動 → 重新登入仍跳提示、文案含「不代表最終結果」提醒 → 選「不用」正常進入。
- 送出後再暫存 → 新版正常還原。
- 受邀者 `?token=` read-only：疊最新草稿正常（`buildReadonlyHeaders_` 路徑）。
- 超大草稿（>150KB 文字）→ 多格切塊 → 還原正確。
- 暫存分頁單格內容為 `gz:` 開頭、非明文個資（base64 非加密，不宣稱保密，僅暴露面下降）。

---

## Phase 18：暫存試算表定期重建＋備份 folder——離線壓縮具體化（2026-07-11 設計定案）

> **決策**：Phase 16/17「量大後離線壓縮」具體化。維運函數 `rebuildDraftSpreadsheet()` 建新暫存
> 試算表（草稿分頁留每主鍵最新列、`_invites` 留每格最新快照），舊表整份改名搬進管理者指定的
> 備份 folder（不可變備份、稽核軌跡零丟失、不違反「不線上刪列」），最後翻 ScriptProperties
> `draftSheetID` 原子換手——`draftSheet_`/`inviteSheet_` 每次呼叫都即時 `getProperty` 再 `openById`
> （`src/Code.js:326`/`:558`），換手後所有 RPC 自動吃新表，前端零改動。
>
> **函數必須放 `src/Code.js`，不能放 `tools/`**（推翻 Phase 16/17 原註記）：`LockService` 與
> `ScriptProperties` 都是 per-project，`tools/export.js` 是貼進「問卷列表」試算表 container-bound
> 專案的另一個 script，拿的鎖擋不住 web app 的 `saveDraft`、也讀不到 web app 的 `draftSheetID`。
> 比照 `initInviteHeader` 的手動維運函數先例（waitLock(30000)、回傳訊息字串、離峰執行註解）。
>
> **觸發**：管理者在 Apps Script 編輯器手動掛時間觸發器指向 `rebuildDraftSpreadsheet`
> （**程式不自建 trigger**），亦可編輯器手動跑；建議離峰時段。

### 核心流程（全程 ScriptLock，waitLock(30000)）

1. **前置檢查**（任一不過 → return 訊息、不動任何東西，fail-safe）：`draftEnabled_()`；
   ScriptProperties `draftBackupFolderID` 已設且 `DriveApp.getFolderById` 開得起來
   （**沒有備份目的地就不重建**）。
2. **門檻檢查**：ScriptProperties `draftRebuildMinRows`（正整數；未設/非法＝0＝不跳過）——
   全表資料列數（各分頁 `getLastRow` 總和，扣表頭列）< 門檻 → return「未達門檻，未重建」
   （避免低流量期每次觸發都建一個幾乎沒縮的備份檔）。
3. **建新試算表** `SpreadsheetApp.create`（沿用舊表名；Drive 允許同名，舊表稍後改名）→
   逐分頁壓縮寫入：
   - `_invites` → 每格（referSSID+主鍵值+簽名格）留**最新一列**（重用 `latestInvites_` 的判定，
     必要時抽 rows 版純函數 `compactInviteRows_` 以利 vitest），INVITE_HEADER＋凍結首列。
     **零語意判讀**：終態（revoked/consumed）、過期、attempts 滿的列只要是該格最新列就
     **原樣保留**，不趁機丟——完整歷史在備份檔。
   - 第 1 列首欄 === `DRAFT_HEADER[0]` 的分頁 → 每主鍵留**最新一列**（新純函數
     `compactDraftRows_`），DRAFT_HEADER＋凍結；變長 chunk 列以 `''` 補齊成矩形後一次
     `setValues`（`parseDraftRow_` 已容忍尾端空格）。
   - **其他無法辨識的分頁 → 原樣整份複製**（fail-safe，不解讀未知格式）。
   - 新表是**未上線**檔案，bulk `setValues` 合法——「一律 append」保護的是線上表，
     Phase 16 已明文允許「離線重建整張表」。刪掉 `create` 的預設空白分頁
     （空佔位分頁，非資料列，不違反禁刪列）。
4. **sanity check**：逐分頁比對新表列數 === 壓縮結果預期列數；不合 → **不翻 property**、
   return 錯誤（新表留著供人工檢查）。
5. **翻 `draftSheetID`** → 新表 ID（**原子換手生效點**）。
6. 舊表 `setName` 加時間戳（含 ms）→ `moveTo` 備份資料夾；新表 `moveTo` 舊表原父資料夾
   （Drive 整潔）。
7. return 摘要字串（分頁數、壓前/壓後列數、新表 ID）。

### 競態與換手安全（2026-07-11 已對程式碼逐點驗證）

- **全部 8 個寫入點都是鎖內才 open 表**：saveDraft(:349)、sendInvite(:730)、revokeInvite(:812)、
  requestInviteOtp(:918)、inviteeLogin(:958)、submitInviteSignature(:1031)、writeRecord_ 消耗段
  (:1752)、initInviteHeader(:584)。鎖外先讀的（`resolveActiveInvite_:881`、`invitesForUser_:647`）
  進鎖後都重讀（Phase 16 慣例）→ **重建全程持 ScriptLock 即無寫入落到舊表**；換手後寫入自動進新表。
- **無鎖 reader 安全**：loadDraft/draftPayloadByKey_、buildReadonlyHeaders_、renewToken、
  listInvites、resolveActiveInvite_ 皆無鎖——重建期間寫入被鎖擋、表內容穩定；`moveTo` 不改
  file ID、openById 照讀；跨換手兩段讀（如 inviteeLogin 先讀邀請後讀草稿）邏輯一致
  （新表＝舊表最新態壓縮）。
- 寫入者等鎖 10 秒逾時會拋錯 → 前端顯示可重試錯誤（可接受，離峰跑）。
- **失敗殘局兩態皆無害、可重跑**：翻 property 前掛＝新表成孤兒檔、舊表照常；
  翻後搬移前掛＝系統已在新表、舊表原地待人工搬。
- 6 分鐘執行上限：逐分頁一次 `getValues`/一次 `setValues`，數萬列規模無虞。

### ScriptProperties 新增

- `draftBackupFolderID`（**必要**）：備份資料夾 Drive ID，未設不重建。
- `draftRebuildMinRows`（選用）：跳過門檻，未設＝永遠重建。

### 前端文案（使用者要求：線上暫存的說明得提到會被定時清理）

- `src/composables/useDraft.js` 暫存成功訊息加註：如「已線上暫存！換裝置用同一組身分登入
  即可還原（簽名需重簽）。暫存會被系統定期清理，請勿當作長期保存」。
- `checkOnlineDraft` 還原詢問 drawerConfirm 文案加同旨提醒（與既有「不代表最終結果」句併陳）。
- FormToolbar 下拉選項標籤過短不塞長句，維持原樣。
- **語意差明記**：重建實際保留每主鍵**最新一版**（最新草稿不會因重建消失），文案採
  **保守宣稱**「定期清理、不保證長期保存」——給維運日後收緊清理政策（如丟已截止問卷分頁）
  的自由度，不鎖死使用者預期。

### 測試點（tests/draftRebuild.test.js 新開）

- `compactDraftRows_`：每主鍵最新列、表頭列（首欄字面字串）跳過、變長 chunk 補 `''` 成矩形、
  空表/只有表頭。
- `compactInviteRows_`：每格最新列；終態/過期列原樣保留。
- `rebuildDraftSpreadsheet` 整合測試（fake SpreadsheetApp/DriveApp/LockService/PropertiesService，
  比照 tests/inviteRpc.test.js 的 stub 手法）：folderID 未設中止、門檻跳過、sanity 失敗不翻
  property、成功路徑翻 property＋改名搬移順序、未知分頁原樣複製。

### 端對端驗證（實機）

- 手動跑一次：新表建立、property 換手、舊表進備份夾且改名帶時間戳、暫存/邀請照常。
- 重建後暫存兩次 → 取最新版；受邀者 `?token=` 流程照常。
- 未設 `draftBackupFolderID` → 中止訊息；設門檻 → 跳過訊息。
- 掛 time trigger 離峰自動跑一次。
- 暫存成功訊息與還原詢問都含「定期清理」提醒。

---

## Phase 19：草稿分頁收斂為單一 `_draft` 分頁——referSSID 降為資料欄（2026-07-11 設計定案）

> **決策**：Phase 17 的「一份問卷一個分頁、分頁名 = referSSID」模型退役。實際使用發現
> 暫存試算表冒出一堆亂數名（Drive file ID）分頁，人看不懂；且 `draftSheet_` 的「找不到就建」
> 副作用連 **loadDraft（讀取）都會落地只有表頭的空分頁**——開過幾份問卷就多幾個空分頁。
> 使用者點破本質：**「母表名稱不過就是一個欄位」**。比照 `_invites` 的單表模型，草稿統一
> 收進單一 **`_draft`** 分頁，referSSID 降為資料欄。

### 分頁結構（`_draft`，全問卷共用）

- 第 1 列人類可讀表頭（凍結、對 reader 惰性——A/C 欄是字面字串，永不等於真實主鍵/referSSID，
  複合比對下雙重惰性，不需特判）：
  `DRAFT_HEADER = ['primaryKey 主鍵', 'updatedAt 存檔(ms)', 'referSSID 問卷表ID', 'payload 草稿(gz:base64，超長切塊)']`
- 資料列：A 主鍵、B updatedAt(ms)、C referSSID、D 起 payload 切塊。
- 「當前草稿」＝ **(主鍵, referSSID) 複合鍵**的最新一列；純 append、`gz:` 編碼、切塊 fallback
  （Phase 17）全部不變。

### 後端改動（src/Code.js，唯一程式改動點）

- 常數：`DRAFT_SHEET_NAME = '_draft'`；`DRAFT_HEADER` 改 4 欄。
- `draftSheet_()`：去掉 referSSID 參數，開 `_draft` 分頁；「找不到就建（表頭＋凍結）」保留，
  但**建分頁權只在寫入路徑（saveDraft）**——讀取路徑一律 `getSheetByName` 自己判 null，
  修掉 loadDraft 探一下就落地空分頁的副作用。
- `parseDraftRow_`：payload 改 D 起串接；回傳補 `referSSID`。
- `latestDraftRowIndexForKey_(rows, referSSID, key)`（改造自 `latestDraftRowForKey_`）：
  複合鍵比對、回**最新匹配列的索引**（無則 -1）——配合兩段式讀取；純函數可 vitest。
- `draftPayloadByKey_`：**兩段式讀取**——先只讀 A:C 三欄定位最新一列，命中才單讀該列全寬。
  單表混所有問卷的草稿，不把所有 payload 大格搬進記憶體；純 append 保證列永不位移，
  兩段讀之間就算有人 append 也不影響已定位的列索引（無 race）。
- `compactDraftRows_`：去重鍵改 `JSON.stringify([主鍵, referSSID])` 複合鍵（比照 `inviteCellKey_`）。
- `rebuildDraftSpreadsheet_`：分頁分派**改按名稱**（`_draft`/`_invites`/其餘原樣複製），
  不做首格嗅探——Phase 19 前的舊 3 欄草稿分頁首格字串相同，嗅探會被新欄位邏輯誤壓；
  按名稱分派下舊亂數分頁只會被原樣照抄（fail-safe）。
- 前端 / RPC 介面**零改動**：`saveDraft`/`loadDraft` 簽名不變，referSSID 從「選分頁」改為
  「寫進 C 欄／參與比對」；`buildReadonlyHeaders_`（受邀者疊草稿）零改動。

### 測試（已隨實作完成）

- `tests/draftChunks.test.js`：`parseDraftRow_` 4 欄、`latestDraftRowIndexForKey_` 複合鍵/
  跨問卷同主鍵互不干擾/表頭惰性/查無回 -1。
- `tests/draftRebuild.test.js`：`compactDraftRows_` 複合鍵去重；fixture 改 `_draft` 單表＋
  舊亂數名分頁被原樣照抄的回歸測試。

### 部署注意

- 部署前手動刪除暫存試算表裡的舊 referSSID 分頁（**保留 `_invites`**）；`_draft` 由首次暫存
  自動建。未上線測試資料，不做舊格式相容（沿用 Phase 17 立場）。

## Phase 20：暫存內容端到端加密——per-(問卷×用戶) HMAC 派生金鑰（2026-07-12 設計收斂定案；同日實作完成，未部署——待端對端實機驗證）

> **收斂脈絡**：本次安全討論從「登入憑證是否留前端」（Phase 5 JWT 已解決）一路收斂到**唯一定案項**——
> 保護**暫存內容**。現況：localStorage 以「明文主鍵值（常為身分證）」當 key、
> 「明文答案 JSON」當 value；線上 `_draft` 的 A 欄是明文主鍵值、payload 只是 gzip+base64（編碼非加密）。
> 共用/公用電腦事後打開 DevTools、或能讀暫存試算表的人，都能直接讀到誰＋填了什麼（含特種個資）。
>
> **防**：暫存內容（裝置端 localStorage ＋ 雲端 `_draft`）與暫存定位鍵的明文駐留（事後撈取）。
> **不防（誠實邊界）**：即時 XSS（金鑰就在記憶體，靠 DOMPurify/CSP 那層）；Google 帳號整個被攻陷（secret 同淪陷）。
> **正式送出的 record 不在範圍**：管理者要直接在 sheet 上看結果，維持明文（其保護走試算表分享權限＝營運面）。

### 決策表（2026-07-12 收斂定案）

| 決策點 | 選擇 | 理由 |
|--------|------|------|
| 金鑰模型 | **無字典、確定性派生**：`HMAC(後端secret, [purpose, referSSID, pkey])` 每次登入當場算 | 使用者原話「一個問卷＋登入者 UID 組出對外字串」；不存任何對照表＝沒有字典可被偷；重登永遠重算出同一把 |
| 派生幾把 | **兩把**：`purpose='id'` 假名（可落地當定位鍵）＋ `purpose='enc'` 加密金鑰（**只留記憶體，絕不落地**） | 鎖與鑰匙分離——若同一把既當 localStorage key 名又當加密鑰，等於鑰匙貼在鎖上 |
| secret | 另開 `draftEncSecret`（ScriptProperties，首次自動生成，比照 `jwtSecret`） | 與 JWT secret 分離：輪替 jwtSecret 不會弄丟所有暫存 |
| 加密位置 | **前端**（兩把 key 由 `readRecord` 登入成功時隨 token 回傳） | localStorage 只有前端摸得到；線上暫存前後端共用同一坨密文 blob，後端零解密需求（GAS 也沒有 AES） |
| 加密實作 | 沿用 `useCrypto` 的 AES-256-GCM（enc key 十六進位字串當 password 走既有 PBKDF2/smv2） | 零新增密碼學程式碼；高熵輸入過 PBKDF2 雖非必要但無害且已有測試 |
| 壓縮 | **先 gzip 再加密**（密文壓不動）；前端用原生 `CompressionStream`，**不可用時跳過壓縮**（格式帶旗標） | iPad OS 13（專案明確支援）無 CompressionStream；加密是必須、壓縮只是省空間；不為此引新套件 |
| payload 格式 | 自描述前綴 `smd1:<g|r>:` ＋ useCrypto 的 `smv2:` 密文（g=gzip 過、r=原文） | 比照 `gz:` 前綴慣例；讀取端自判 |
| `_draft` 定位鍵 | A 欄改存 **id 假名**（後端從 JWT claims.pkey 自算，不信前端） | 暫存試算表全面去識別化——連「誰有草稿」都看不到明文；純 append/最新列勝出機制不變 |
| 舊資料 | `_draft`：Phase 17/19 未上線，**不做舊格式相容**（decode 的 `gz:` 分支留作防呆）；localStorage：**登入時一次性搬家**（見前端節） | localStorage 是已部署版本留在真實使用者瀏覽器裡的明文個資，搬家順手清除 |

### 金鑰派生（後端 `src/Code.js`）

1. `getDraftEncSecret_()`：ScriptProperties `draftEncSecret`，不存在時自動生成（比照 `getJwtSecret_`）。
2. `deriveDraftKey_(purpose, referSSID, pkeyValue)`：`base64url(HMAC-SHA256(secret, JSON.stringify([purpose, referSSID, pkeyValue])))`
   ——`JSON.stringify` 複合鍵防串接碰撞（比照 `inviteCellKey_`）；purpose ∈ `'id'`｜`'enc'`｜`'log'`（Phase 21 用）
   做 key separation。**跨 Phase 相依**：本函數與 `getDraftEncSecret_` 為 Phase 20/21 共用基礎——哪個 Phase
   先實作就由誰建立，後做的直接沿用。
3. `readRecord_` 登入成功回傳追加 `draftKeys: { id, enc }`（pkey 用伺服器裁決值 `draftKey_`，不信前端）。
   `renewToken` 不需重發（前端已持有、值不變）。

### 後端暫存流程改動

- `saveDraft(referSSID, token, payload)`：payload 已是前端加密好的 `smd1:` blob——後端**不再 gzip**（`encodeDraftPayload_`
  對 `smd1:` 前綴直接原樣通過），照舊 `chunkPayload_` 切塊、appendRow；**A 欄改寫 id 假名**（`deriveDraftKey_('id', …)` 自算）。
- `loadDraft`：以 id 假名定位（`latestDraftRowIndexForKey_` 機制不變），密文原樣回傳，前端解。
- `decodeDraftPayload_`：`smd1:` 原樣回傳（前端解）；`gz:` 分支保留（防呆＋受邀者舊資料）。
- **受邀簽名者（關鍵接點，已查證 Code.js:853/1184）**：`buildReadonlyHeaders_` 目前在**後端**把填寫者草稿疊進 headers，
  後端解不開新密文 → 改為：`inviteeLogin` 回傳 headers（不疊）＋草稿密文 blob ＋ **後端重算的填寫者 enc key**
  （`deriveDraftKey_('enc', referSSID, invite.primaryValue)`），**疊草稿移到受邀者前端**（解密→gunzip→疊）。
  安全邊界不變：受邀者本來就被授權看填寫內容（他要簽的就是這份），該 key 也只能解這一份問卷×這一人的暫存。
- 鐵律照舊：純 append、ms timestamp、禁 deleteRow、快照零清空；`compactDraftRows_`/rebuild 對 key 內容無感、零改動。

### 前端

1. 新增 `utils/draftCipher.js`（純函數）：`sealDraft(json, encKey)`（CompressionStream 可用→gzip→`smd1:g:`，否則 `smd1:r:`；
   再 useCrypto.encrypt）與 `openDraft(blob, encKey)`（自判前綴反向）。
2. `App.vue`：登入成功存 `draftKeys`（記憶體 ref，比照 authToken；重新整理即消失、重登重取）。
3. `tempStorage.js`：localStorage key 由明文主鍵值改 **id 假名**、value 改 `sealDraft` 密文。結構性影響：假名含 referSSID
   → 每（問卷×人）一條目（原本一人一條、內含多問卷陣列），helpers 相應簡化。
4. **一次性搬家**（登入成功當下，此時明文主鍵值仍在手）：發現舊明文 key 有資料 → `sealDraft` 寫進假名 key →
   `localStorage.removeItem(舊明文key)`——把已部署版本留在使用者瀏覽器的明文個資順手清掉。
5. `useDraft.js`：saveDraftOnline 前 `sealDraft`、還原時 `openDraft`；其餘 tokenExpired 流程不變。
6. 匯出/匯入（TempTransferDrawers）：加密金鑰組成由「主鍵值＋密碼」改「**id 假名＋密碼**」（跨裝置：另一台登入後
   拿到同一把假名，照樣解）。舊格式匯出檔 fallback：記憶體裡的主鍵值（Phase 5 決策本就保留 P 欄值）＋密碼再試一次。
7. 受邀者側（InviteeSignDialog 流程）：收 `inviteeLogin` 回的密文＋enc key，前端 `openDraft` 後疊進唯讀 headers。

### 測試

- 後端（stub 模式）：`deriveDraftKey_` 同輸入穩定／跨 purpose/refer/pkey 皆不同；`draftEncSecret` 自動生成；saveDraft
  對 `smd1:` 不重壓、A 欄落假名；loadDraft 以假名定位；inviteeLogin 回密文＋正確派生 key（不疊草稿）。
- 前端：`draftCipher` roundtrip（g 與 r 兩路）；壞前綴/錯 key 失敗不炸；tempStorage 新 key 形狀；搬家邏輯（舊條目
  轉入＋刪除、無舊條目跳過、冪等）；匯出匯入新金鑰＋舊檔 fallback。

### 端對端驗證（實機）

- 填寫→暫存→關頁→重登：localStorage 只見假名 key＋`smd1:` 密文；還原正確。跨裝置：第二台登入→線上還原/匯入檔皆解得開。
- 受邀者：邀請流程開啟後能看到填寫者草稿疊層（前端解密路徑）。
- 舊版明文暫存的瀏覽器：登入後舊明文條目消失、資料無損轉入假名條目。
- iPad OS 13（無 CompressionStream）：走 `smd1:r:` 未壓縮路徑，存/還原正常。

### 注意點

- **`draftEncSecret` 輪替/遺失 ＝ 所有既有暫存（含使用者裝置上的）解不開**——影響僅止暫存（非正式結果，文案本就聲明
  「線上暫存不代表最終結果」），可接受但要知道；輪替視同「暫存全部歸零」。
- 送出後草稿照舊不刪（append-only）；`_draft` 新列全面假名化後，暫存表對「能開表的人」既看不到誰、也看不到內容。
- localStorage 的 5MB 配額：密文 base64 約多 1/3，草稿量級下無虞。

---

## Phase 21：登入防枚舉——CacheService 即時防線 ＋ `_logins` 稽核日誌（2026-07-12 設計定案；同日實作完成，未部署——待端對端實機驗證＋管理者掛觸發器）

> **收斂脈絡**：主登入 `authRecord`（`Code.js:1512`）純比對名冊值，無失敗計數/鎖定（防暴力那套只有
> `_invites` 的 email OTP 有），web app 又是 `ANYONE_ANONYMOUS`——對認證欄位低熵的問卷可窮舉撞庫。
> 討論過程中確認 **GAS 拿不到 client IP**（doGet/`google.script.run` 事件都不含），因此逐項裁決：
> per-目標鎖定不需要 IP、可做；全域自動封鎖無 IP 必誤傷＋送攻擊者 DoS 按鈕、**明確不做**；
> 橫向掃描改「偵測＋通知管理者、人來斷」。使用者拍板：**CacheService 當即時防線、`_logins` 表當事後稽核，
> 兩個都做、各司其職**——cache 快但會被驅逐（防線暫鬆非破口），表慢但一筆不漏（不進熱路徑），互補。

> **設計修訂（2026-07-12，實作後同日）：`_logins` 改存明文真實帳號值（非 HMAC 假名）。**
> 收斂脈絡：假名化本意是「能開暫存表的人也看不到誰登入」，但討論後發現三點——(a) 同一張 draftSheetID
> 早有 `_invites` 的明文主鍵＋email，「表零個資」從來不成立；(b) 我們決定不做假名查詢工具（見誠實邊界/
> security.md §6-1），假名讓「疑似撞中」只能指到問卷、指不到人，稽核價值歸零；(c) 業界慣例是**認證/稽核
> 日誌存真實身分＋靠存取控制保護**（Linux auth.log、CloudTrail、Okta 皆然），把身分加密掉會讓事件響應報廢。
> 使用者拍板：**保護邊界＝draftSheetID 暫存試算表永不對外分享**（存取控制是對的地方，不是加密自己看不懂的欄位）。
> 與 Phase 20 不衝突：`_draft` 的 id 假名是端到端加密的**結構性必需**（前端用同一把派生鍵加解密草稿）＋內容
> 本就密文，維持不動；`_logins` 只是稽核日誌、無此相依，存真值。**cache key 仍用 HMAC 假名**（`deriveDraftKey_`
> `purpose='log'`）純為 key 長度/字元衛生（cache 腳本內部、不落任何表），與隱私無關。下方決策表「個資」列與
> schema 已按此修訂；其餘決策不變。

### 決策表（2026-07-12 定案）

| 決策點 | 選擇 | 理由 |
|--------|------|------|
| 即時防線 | **CacheService**（毫秒級，熱路徑）；`_logins` 表不參與即時判斷 | appendRow＋讀表尾要幾百 ms；擋不擋這次登入必須當場決定 |
| 稽核 | **`_logins` 分頁**（draftSheetID 試算表，與 `_invites`/`_draft` 同居），純 append | 事後鑑識/對帳；cache 被驅逐時日誌仍完整，互補 |
| 縱向防護 | per-帳號失敗計數：連錯 **5** 次冷卻 **5 分鐘**，成功清零 | 窮舉從秒級拉到小時/天級；短冷卻封頂「故意連錯鎖受害者」的 DoS（本人晚幾分鐘可重試，取捨已確認） |
| 橫向防護 | **不自動封鎖**；per-refer 失敗計數過閾值（**10 分鐘窗口 >30 次**）→ MailApp 寄該問卷管理者（列表 M 欄），同 refer **1 小時**警報節流 | 無 IP 下全域封鎖必誤傷尖峰＋變 DoS 按鈕；管理者可自行翻 O 欄「開放進入」斷問卷——機器只做不會誤傷的事，會誤傷的決定留給人 |
| 個資（**2026-07-12 修訂**） | `_logins` **存明文真實帳號值**；**cache key** 才用 HMAC 假名（`deriveDraftKey_` `purpose='log'`，純 key 衛生） | 稽核日誌價值＝知道是誰，假名化會讓事件響應報廢（業界慣例存真值＋存取控制）；保護靠 **draftSheetID 永不分享**（同表已有 `_invites` 明文主鍵）。與 Phase 20 `_draft` 加密不衝突——那是端到端加密的結構性必需，此處只是稽核日誌 |
| 訊息 | 登入失敗/冷卻文案一致化 | 不洩漏「主鍵值在不在名冊」 |
| 離線掃描 | `scanLoginLog()` 定時掃 `_logins` 新增列（游標增量），異常寄信給**系統管理者**；管理者手動掛時間觸發器（程式不自建） | 補即時層的漏（cache 驅逐、低速攻擊）＋深度規則（連錯後成功＝疑似撞中）只有回頭看日誌才判得出 |
| 常數 | `loginFailMax`／`loginCooldownMinutes`／`scanAlertThreshold`（次數與窗口）／`scanAlertCooldownMinutes`／`loginScanFailThreshold`／`loginScanDistinctThreshold`／`securityAlertEmail` 走 ScriptProperties，未設用預設 | 比照 `inviteTtlMinutes`，管理者依尖峰調 |

### 後端（src/Code.js）

1. cache key 的 HMAC 假名沿用 Phase 20 的 `deriveDraftKey_`（`purpose='log'`）。**跨 Phase 相依**
   （見 Phase 20 金鑰派生節）：哪個 Phase 先實作就由誰建 `getDraftEncSecret_`＋`deriveDraftKey_`，後做的直接沿用。
   實作時 `readRecord_` 同時算 `loginId = draftKey_(...)`（真值，落 `_logins`）與 `pseudonym`（HMAC，當 cache key）。
2. `checkLoginThrottle_(refer, pseudonym, nowMs)` → `{allowed, cooldownRemainMs}`：讀 cache 的 per-帳號失敗計數/冷卻旗標。
3. `recordLoginAttempt_(refer, pseudonym, loginId, success, nowMs)`：
   - cache（key 用 pseudonym）：失敗＝per-帳號計數 +1（達上限設冷卻 TTL）、per-refer 窗口計數 +1；成功＝清除該帳號計數。
   - `appendLoginLog_(refer, loginId, success, nowMs)` appendRow 一筆，C 欄存**真值**（成功失敗都記——掃描若命中，
     長相是一次成功，稽核要看得到是誰）。
   - per-refer 計數過 `scanAlertThreshold` 且無警報節流旗標 → MailApp 寄該問卷管理者（M 欄）＋設節流旗標
     （1 小時），信中附窗口內失敗次數與建議動作（可翻 O 欄「開放進入」暫停問卷）。**即時警報只給計數、不列帳號**
     （收件人可能是老師，信任層級較低）。
4. `readRecord_` 整合：`authRecord` 前先 `checkLoginThrottle_`，被擋直接回一致化「稍後再試」＋冷卻秒數
   （不區分「被鎖」與其他失敗細節）；驗證後呼叫 `recordLoginAttempt_`。失敗計數的 cache key 用**嘗試的主鍵值**
   過 HMAC、`_logins` 存該主鍵值明文（失敗時沒有伺服器裁決值可用；Gmail 模式取 Session email）。
5. `_logins` schema：A `timestamp(ms)`、B `referSSID`、C **`帳號（明文真實主鍵值）`**、D `成功/失敗`。第 1 列凍結
   人類可讀表頭（比照 `DRAFT_HEADER`/`INVITE_HEADER`，對 reader 惰性）。鐵律照舊：純 append、禁 `deleteRow`、
   ms timestamp、快照零清空；長期成長交離線重建（rebuild 對不認得的分頁原樣照抄，fail-safe 已保證）。
6. check 與 append 之間**不上鎖**：並發下攻擊者多擠一兩次嘗試，可接受；不在登入尖峰上 ScriptLock。

### 定時掃描 `scanLoginLog()`——管理者手動掛時間觸發器（2026-07-12 增補）

即時警報（cache）的補漏層＋深度分析層：cache 被驅逐、或攻擊節奏刻意壓在即時閾值以下時即時層會漏，
且「連錯多次後突然成功」（疑似撞中）這種模式只有回頭看日誌才看得出來。

- **放 `src/Code.js`、不放 tools/**（tools/ 不隨 clasp 部署，時間觸發器掛不到）；**程式不自建 trigger**
  （沿用 Phase 18 慣例）——系統管理者自行在 Apps Script 編輯器掛時間觸發器（建議每小時或每日、離峰）。
- **游標增量掃描**：ScriptProperties `loginScanCursor` 記上次處理到的列號，本次只讀 `cursor+1 ~ lastRow`
  （純 append 保證列永不位移，游標定位絕對可靠——與兩段式讀取同一個立足點），掃完更新游標。
  不重複分析、不重複告警，表再長掃描成本也只跟新增量成正比。
- **判定規則**（對新增列按 refer 分組）：
  1. 失敗總數 ≥ `loginScanFailThreshold`（預設 20）；
  2. 失敗的**相異帳號數** ≥ `loginScanDistinctThreshold`（預設 10）——橫向掃描特徵；
  3. **同一帳號連錯 ≥ 3 次後出現成功**——疑似撞庫命中，單獨列出（最高優先級）。
- **收件人**：ScriptProperties `securityAlertEmail`，未設寄給觸發器擁有者（`Session.getEffectiveUser()`，
  時間觸發器以安裝者身分執行）——即系統管理者本人；與即時警報（寄該問卷 M 欄管理者）分工。
- **只在有異常時寄信**（乾淨就靜默）；信內容：各 refer 的嘗試/失敗統計、相異帳號數、疑似命中清單
  （**含實際帳號值**，只寄系統管理者、信中註明勿轉發）、建議動作（翻 O 欄暫停、比對 `_logins` 詳查）。
- `ScriptLock` `tryLock` 開頭防重疊執行（上一輪還在跑就直接 return，下一輪游標會補上）；
  游標只前進不回退，鐵律照舊（不動 `_logins` 任何一列）。

### 前端

1. 被冷卻時顯示「嘗試過於頻繁，請稍後再試」＋冷卻倒數（沿用 `loginfailTip`/步驟條 error 機制）。
2. 前端不做任何限流判斷（純顯示）——安全邊界在後端。

### 測試（tests/，stub 模式比照 jwt.test.js；CacheService／MailApp 用 fake）

- per-帳號連錯達上限 → `checkLoginThrottle_` 回 `allowed:false`；冷卻期滿（fake 時間推進）自動解除；成功清零。
- 掃描閾值觸發寄信一次；節流期內再觸發不重寄；節流期滿可再寄。
- `_logins` 只 append、成功失敗都落地、**C 欄存明文真實帳號值（非假名）**；即時警報只給計數不列帳號。
- cache key 假名同輸入穩定、跨 purpose/refer/pkey 皆不同。
- `scanLoginLog()`：游標增量（只讀新列、掃完前進、重跑不重複告警）；三條判定規則各自觸發／不觸發的
  邊界案例（含「連錯 3 次後成功」被標記、連錯 2 次後成功不標）；乾淨批次不寄信；tryLock 失敗直接 return；
  收件人 fallback（`securityAlertEmail` 未設 → 觸發器擁有者）。
- 被擋回應與一般登入失敗的結構/文案一致化，不洩漏存在性。

### 端對端驗證（實機）

- 正常登入完全不受影響（含開放填寫尖峰）。
- 同一主鍵值連錯 5 次 → 被冷卻、訊息含倒數；5 分鐘後可再試；成功登入後計數歸零。
- 高速打失敗（模擬掃描）→ 管理者收到警報信一封，一小時內不重複；`_logins` 出現對應列且無明文。
- cache 驅逐（隔天再看）後防線自動重建，`_logins` 日誌完整無缺。
- `scanLoginLog()`：手動跑一次乾淨批次 → 不寄信、游標前進；製造連錯後成功 → 收到含「疑似命中」的
  警報信；再跑一次 → 不重複告警；掛上時間觸發器後確認以安裝者身分寄達（或 `securityAlertEmail`）。

### 管理者設定（實作後寫進文件）

- 掛 `scanLoginLog()` 時間觸發器（Apps Script 編輯器手動，建議每小時或每日、離峰）。
- 選用 ScriptProperties：`securityAlertEmail`（掃描警報收件人，未設寄觸發器擁有者）、
  `loginFailMax`／`loginCooldownMinutes`／`scanAlertThreshold`／`scanAlertCooldownMinutes`／
  `loginScanFailThreshold`／`loginScanDistinctThreshold`（皆有預設）。

### 誠實邊界

- cache 驅逐＝計數歸零（防線暫鬆，非破口，`_logins` 一筆不漏）。
- 無 IP → 橫向枚舉只能「偵測＋人工斷」，不能自動擋；根治靠該問卷認證欄位的熵（管理者建名冊時的選擇，文件層面建議）。
- 針對性鎖人（故意連錯鎖受害者）以短冷卻（5 分）封頂，取捨已與使用者確認。
- timing side-channel 不處理（GAS 延遲噪音大，不值得做固定延遲）。
- 警報信吃 MailApp 每日配額，已用 1 小時節流封頂（每問卷每天最多 24 封，實際遠低於此）。
- **`_logins` 存明文真實帳號（2026-07-12 修訂）**：保護完全靠「draftSheetID 暫存試算表永不對外分享」的存取控制
  ——管理者責任，非程式強制。失敗列存的是**嘗試值**，枚舉攻擊者可拿真學號清單來猜，那些真值會進失敗列（本人
  其實沒登入）——明文下這點會放大，已知並接受。假名查詢工具（把假名反查回人）**定案不做**（見 security.md §6-1），
  因為存真值後稽核直接可讀、不需要它，且少一個去匿名化 oracle。

---

## Phase 22：sticky 控制列手機可收合——按鈕群摺進 handle、JWT 條留著（2026-07-12 設計定案，已實作）

### 動機

Phase 9 的 sticky 控制列（FormToolbar／SignatureToolbar）在 PC／平板上排開一列剛好，
但**手機直式**會把按鈕撐滿整寬、上方按鈕區太高，往下填題/簽名時擋掉太多畫面。
參考 `scoringSystem-cf` 的 `ProjectDetail` 抽屜（`PhysicsDrawerContainer`）——
**不學它的 matter.js 物理模擬**，只學「收合成一條 handle」這件事：手機往上拉
（往下捲內容）後，控制列縮到只剩 handle（寫「更多功能請點此」），畫面讓出來。

### 定案表

| 決策點 | 選擇 |
|---|---|
| 收合觸發 | 進場預設展開 → 明顯往下捲題目/簽名（`scrollTop` 遞增 >6px 且離頂 >32px）**自動收合**成 handle；**捲回頂端（`scrollTop`≤32px，含 top:0）自動彈開**；也可隨時點 handle 手動展開／收合 |
| 保留什麼 | 摺疊後 **JWT 倒數條永遠留著**（效期時間敏感），只有按鈕群收進 handle 後面 |
| 螢幕範圍 | **只手機（≤768px，`matchMedia`）**；PC／平板 `collapsible=false`，原樣顯示、無 handle、無收合 |
| 套用範圍 | **FormToolbar**（暫存▾／下載上次結果／編輯唯讀雙態鈕）＋ **SignatureToolbar**（下一個簽名／清除簽名／遠端簽名／更新邀請狀態）兩條。匯出/匯入暫存、受邀簽名那兩條 sticky 只有 JWT 條、內容短，不套 |
| 收合動畫 | `grid-template-rows: 1fr↔0fr`（不必量內容高度，按鈕會換行、高度不定，這是穩解），0.25s ease |
| 空殼保護 | `active` prop：父層據按鈕顯示條件傳入（FormToolbar `!viewOnly || hasLastSubmit`、SignatureToolbar `signatureCount>0 || hasInvites`），無按鈕時退化為 passthrough、不長 handle |

### 工作項目

- 新元件 **`src/components/CollapsibleControls.vue`**：`<slot>` 包住按鈕群那個 `__controls` div；
  props `active`／`collapsedText`（預設「更多功能請點此」）／`expandedText`（預設「收合功能列」）。
  `collapsible = isMobile && active`（computed）；`onMounted` 建 `matchMedia('(max-width:768px)')`
  監聽（`addEventListener` 有 fallback `addListener` 給 Safari <14）＋以 `rootRef.closest('.el-drawer__body')`
  取所在 drawer 的捲動容器、掛 passive scroll listener；`onBeforeUnmount` 全數移除。
- `FormToolbar.vue`／`SignatureToolbar.vue`：把 `__controls` div 包進 `<CollapsibleControls :active="…">`，
  JWT 條留在外層不動。兩條共用同一元件、不重複寫收合邏輯。
- 色彩走主題語意變數（`--el-border-color-lighter`／`--el-fill-color-light`／`--el-text-color-secondary`），
  不寫死 hex；圖示走 FontAwesome（handle 用 `fa-chevron-up/down`）。

### 驗證

- `npm run lint`（模板改動，`vue/no-undef-properties` 必跑）＋ `npm test`（298 通過）＋ `npm run build`（158 KB）——全綠。
- 無頭 Chromium 實測（headless shell，repro 搬同一套 grid 手風琴＋捲動收合＋closest 邏輯）：
  - 手機視窗（400px）：`closest` 找到容器、handle 顯示、往下捲 200px → 自動收合（body 高 56→0）、
    handle 文字「更多功能請點此」、點 handle → 展開（0→56）、文字「收合功能列」。**ALLPASS**。
  - 桌機視窗（1200px）：`isMobile=false`、handle 隱藏（display none）、往下捲不收合（高度恆 56）。**符合預期**。
- 人工（實機）：手機填問卷/簽名往下捲，控制列縮成 handle、JWT 條仍在；點 handle 展開按鈕群；
  PC/平板維持完整列不受影響。

### 修正（2026-07-12，實機回報兩個 bug）

- **收合後點 handle 不彈開**：手機上點 handle 展開的當下，慣性捲動（momentum scroll）會立刻
  觸發一個「往下捲」事件把它收回去，看起來像「按了沒反應」。修法：`toggle()` 手動展開時設
  `EXPAND_GRACE_MS`（350ms）寬限期，`onScroll` 於寬限期內不自動收合；並把自動收合門檻從「遞增即收」
  改為「遞增 >`SCROLL_DELTA`（6px）才收」，濾掉頂端輕微抖動。
- **捲回頂端自動彈開**（新需求）：`onScroll` 加一條 `scrollTop ≤ COLLAPSE_THRESHOLD → expanded=true`，
  回到 top:0 附近就自動展開，不必再點 handle。原「往上捲不動作」規則作廢。
- 無頭 Chromium 重測：往下捲收合 → 點 handle 展開 → 寬限期內慣性捲（+5／+40）不被收回 →
  寬限期後真往下捲才收 → 捲回 top:0 自動彈開，**ALLPASS**；345 測試綠、build 通過。
- **簽名列收合保留「下一個簽名」**（實機回報：只剩 handle 使用者不知能換下一位）：
  CollapsibleControls 新增具名插槽 `#peek`——收合（`collapsible && !expanded`）時露出的主要動作，
  展開態/桌機隱藏（本尊由預設 slot 負責，不重複觸發）。SignatureToolbar 把「下一個簽名」
  （`signatureCount > 1`）放進 `#peek`，收合後 = JWT 條＋下一個簽名＋handle。FormToolbar 不設 peek、
  全收合。無頭驗證：手機展開/再展開 peek 隱藏、收合露出（ALLPASS），桌機 peek 從不顯示。

### 誠實邊界

- 收合狀態不跨 drawer 重開記憶（el-drawer 預設 `destroy-on-close=false`，元件不重掛，
  重開會保留上次收合狀態）——無害，未特別重置。
- 旋轉裝置在桌機↔手機間切換時收合態沿用，屬邊角、不處理。

---

## Phase 23：每題答案來源切換器（el-segmented）＋左側狀態邊界條＋送出前純文字 diff＋檔案「沿用上次」哨兵裁決＋`_file` 上傳登記表（2026-07-14 設計定案；同日實作完成，未部署——待端對端實機驗證）

### 動機

每題其實有四個答案狀態：系統儲存值（`savedContent`←名冊母表該人該欄）、上次送出值
（`lastInput`←紀錄表該主鍵最後一列，`pos+5` 偏移）、正在填的值（`value`）、
localStorage／線上 `_draft` 草稿備份（登入時疊回 `value`）。現況六個問題：

1. **FormField 兩行唯讀佔版面**（FormField.vue:23-61）：每題永遠顯示「[系統原本儲存的答案]」
   「[你上次輸入的答案]」兩行，空值也掛標籤，三十題就是六十行重複文字。
2. **草稿疊回是隱形的**：優先權最高的狀態（暫存 queue 蓋 `value`）反而沒有任何視覺標示，
   使用者分不清輸入框裡的值是自己剛打的還是草稿還原的。
3. **送出前無差異確認**：使用者親簽前看不到「這次送出跟上次差在哪」。
4. **檔案欄重登被迫重傳**：readRecord 對檔案欄硬設 `value=""`（Code.js:1664），writeRecord
   對空值反而擋（nullable「原本有資料不可清除」1948-1963、must「必需要有值」1965-1968），
   沒有沿用舊檔的通道，使用者反映擾民。
5. **安全缺口**：檔案欄 fileID 由前端傳、後端原樣落地無歸屬驗證（Code.js:1988→2212），
   與簽名的 `resolveSignatureSources_` 伺服器裁決模型相反。根因＝上傳的 fileID 從來沒地方登記、
   後端無從驗證。本 Phase 用 **`_file` 上傳登記表**補掉：「沿用舊檔」走哨兵＋伺服器裁決、
   「新上傳」writeRecord 時對照登記表驗歸屬。
6. **頂部格式狀態 el-tag 太吵**（FormField.vue:8-10）：一題一個「已回答／未回答」，
   且長問卷裡題與題的視覺邊界不清。

### 定案表

| 決策點 | 選擇 |
|---|---|
| UI 骨架 | 每題一條**答案來源 `el-segmented`**（FieldValueSwitch）：預設值／你上次的／暫存／你現在填的，**切換即自動帶入該來源的值**；沒有值的來源不長出選項；「你現在填的」永遠列出但使用者真的動手前 disabled；現有兩行唯讀文字移除（唯讀展示欄 C-T/C-F/C-S 改為直接顯示值，不進切換器） |
| 「你現在填的」怎麼記 | `markUserInput()`：使用者一動手（打字/選單/滑桿/上傳/多選/郵遞區號/「無資料」鈕）就把當下的值存進 `column.userInput`、`column.source='user'`——**切去看預設值再切回來不會弄丟自己填的東西** |
| 格式狀態標籤 | 頂部 el-tag 移除，改每題**左側狀態邊界條**：一條狀態色細線（撐滿題高＝題與題的視覺界線）＋頂端一組 FA 標記圖示（填答狀態＋「與上次送出不同」`fa-pen`），文字說明走 tooltip 不佔版面 |
| diff 元件 | 從 scoringSystem-cf 搬 `RankingComparison.vue` 改造成 `DiffText.vue`（`diff@9` createTwoFilesPatch ＋ `diff2html@3.4.56`），手機 <768px 自動切 line-by-line、桌機 side-by-side |
| diff 基準 | 預設「你上次的」（無紀錄自動退回預設值），可切「預設值」；切換用 **el-segmented**（與題目上的來源切換器同一種控制項，不用 el-switch） |
| diff footer | 兩顆按鈕**各半寬**，比照填問卷 drawer 的 `.formFooter__buttons`（次要「回去修改」靠前、主要「繼續下一步」靠後） |
| diff 流程 | authMod 驗證通過後、簽名/確認 drawer 之前**必經**；**零差異自動跳過**不打擾 |
| 沿用舊檔 | **哨兵＋伺服器裁決**：前端只送哨兵常數（絕不傳舊 fileID），後端從該使用者（claims.pkey）紀錄表最後一列查 fileID；**不 fallback 名冊**（名冊存檔名片段非 fileID，模糊搜歸屬無保證）；查無整筆擋下報錯 |
| `_file` 登記表 | draftSheetID 試算表新增 `_file` 分頁（比照 `_logins`/`_draft`：純 append、凍結人類可讀表頭、對 reader 惰性、永不刪列）；saveFile 成功後 appendRow 登記；writeRecord 收到新上傳 fileID 時驗歸屬，驗不過整筆擋下 |
| 暫存來源 | `column.draftOrigin={val,source}`（columnPrep／tempQueue 疊回時標，值是**格式轉換之後**的最終形式；同時 `column.source='draft'` ＝登入後切換器一進場停在「暫存」）——切回「暫存」拿得到原本疊回的值 |

### 工作項目

**新增檔案**

- `src/utils/sentinels.js`：哨兵常數 `REUSE_LAST_FILE = '__SM_REUSE_LAST_FILE__'`（獨立檔避免
  columnRules／fieldChips／tempQueue 循環 import）。機器味字串，與會落地的中文哨兵
  「無資料」「不提供資料」語意分家：此哨兵是**傳輸層指令、絕不落地**，進 pureData 前必被
  替換成真 fileID（另見 issue.md「三哨兵關係」）。
- `src/utils/fieldSources.js`：答案來源的選項導出與帶入——`buildSourceOptions(column)`
  （沒值的來源不長選項；'user' 永遠列出、`hasUserInput` 為 false 時 `disabled`）、
  `currentSource(column)`（以 `column.source` 為準；沒切過時值＝savedContent 回推 'saved'、
  否則 'user'）、`applySource(column, kind)`（**切換即帶入**：檔案欄的 last 寫哨兵、draft 寫暫存
  當時記下的決定；其餘走 `coerceSourceValue`）、`markUserInput(column)`（把當下的值存進
  `column.userInput`、`source='user'`）。`coerceSourceValue` 的 per-format 轉換：
  T/I/M/N/E/P/X 直塞＋`replace(/^📝/,'')` 防呆（savedContent 來自名冊可能殘留前綴）；
  S 直塞交給 validateColumn 標紅（不吞掉，讓使用者看見不合法）；U 走選項交集過濾（把
  columnPrep 該段抽成 `filterMultiValue(column, raw)` 共用，columnPrep 改呼叫它）；
  L `parseInt`（轉不出數字的來源不長選項）。帶入後一律 `validateColumn(column, columnDb)`。
- `src/utils/submitDiff.js`：`buildDiffText(columns, mode)`（一題【題名】＋值行；X 多行原樣逐行、
  U 每選項一行、L `String()`、空值輸出「（未填）」佔位讓「有值→清空」在 diff 可見）、
  `baselineValue(column, mode)`（mode='last' 時 `lastInput === undefined` 退回 savedContent）、
  `hasAnyDiff(columns, mode)`（文字側逐欄 normalize 比對＋檔案側「有新上傳（value 非空非哨兵）」
  算差異、哨兵不算；只收 F-type 非檔案欄進文字 diff，C/G 排除——沿用 authMod 的 ignoreCDB 過濾）、
  `buildFileComparison(columns)`（前後檔案 URL 對照清單）。
- `src/components/FieldValueSwitch.vue`：答案來源切換器。props `column`/`columnDb`/`enableModify`；
  `el-segmented` 的 `v-model` 綁 computed（get＝`currentSource`、set＝`applySource`＋`validateColumn`），
  `:options` 綁 `buildSourceOptions`（含 disabled）；**只有一個選項時整條不顯示**（沒有版本可切）。
  旁邊掛「與上次送出不同」warning tag（`differsFromLast`，唯讀時不顯示）。
  檔案欄：值進不了輸入框，切換器下方直接顯示該來源的檔案連結（沿用上次／你這次上傳的／你上次提供的）；
  「暫存」來源另附一行說明（本機暫存／雲端暫存／匯入的暫存檔＋「線上暫存不代表最終結果」）。
- `src/components/DiffText.vue`：RankingComparison.vue 搬移改造——props 改
  `oldText/newText/oldTitle/newTitle` 兩段純文字，刪 rankingsToText 與 TS 註記；
  `outputFormat` 依 matchMedia 768px 切換（監聽比照 CollapsibleControls：addEventListener
  ＋Safari <14 fallback addListener、onBeforeUnmount 移除）；刪
  `import 'diff2html/.../diff2html.min.css'` 改 index.html `<link>`；原元件寫死的
  `#d4edda/#f8d7da` 換配色表變數（`--el-color-success-light-9`/`--el-color-danger-light-9`，
  不足先加 colors.config.js）；**diffHtml 輸出過 DOMPurify 再 v-html**（全站紅線）。
- `src/components/SubmitDiffDrawer.vue`：主流程一步——btt、size 100%、`with-header=false`、
  `body-class="drawer-flow-body"`、`.drawer-flow-title`「送出前確認」；比對基準用 **el-segmented**
  （「你上次的」／「預設值」，value 對應 submitDiff 的 mode）；檔案對照區在文字 diff 下方
  （前＝基準 URL el-link；後＝新上傳 URL／「沿用上次的檔案」＋同 URL／「（無檔案）」）；
  `<template #footer>` 的 `.formFooter__buttons` **兩顆各半寬**（比照填問卷 drawer：
  info「有地方要改，回去修改」emit back＋primary「我核對過了，繼續下一步」emit confirm；
  App.vue 的 `.formFooter__buttons` 樣式是 scoped，本元件自帶一份同規格的）。

**修改檔案**

- `src/components/FormField.vue`：
  - 刪 23-61 兩行唯讀區；**唯讀展示欄（type=C）改為直接顯示值**（C-S 計算結果／C-T 名冊文字／
    C-F 檔案連結）——它們沒有「答案來源」可切，不進切換器。作答欄（type=F）掛
    `<FieldValueSwitch>`；檔案上傳鈕三態文案（`value===哨兵`→「(沿用上次檔案)」／非空→
    「(已上傳)」／空→「(無上傳)」）。
  - 使用者動手的入口一律 `markUserInput()`：輸入元件的 `@change`（走 `validate()`）與
    「無資料」雙態鈕（`toggleNoData`）。App.vue 的三個程式塞值路徑同理——`applyFileUpload`
    （新上傳）、`applyMultiSelection`（多選）、`queryPC`（郵遞區號按鈕）。
  - **刪頂部狀態 el-tag（8-10 行）**，根容器改左右兩欄 flex：左欄＝狀態邊界條（窄條 ~18px：
    頂端 FA 圖示依 statusDetector 的 status 對應 `fa-circle-check`／`fa-circle-exclamation`／
    `fa-circle-half-stroke`／`fa-circle-dot`，下接一條 3px 細線 `flex:1` 撐滿題高、
    `background: currentColor` 與圖示同色；顏色走配色表變數如 `--el-color-success-dark-2`，
    不寫死 hex；狀態文字掛 el-tooltip＋`aria-label`）；右欄＝原有內容。M-C 說明欄與 G 分組欄不掛
    （非作答題）；statusDetector 沿用不改（僅加哨兵一條，見 columnRules）。
- `src/App.vue`：authMod 成功分支（961-1000 的簽名/確認二分，含 refreshInvites 與
  rebuildSignatureUI）抽成 `proceedAfterDiff()`；authMod 改為驗證通過後
  `hasAnyDiff(ignoreCDB,'last')` 判斷——零差異直接 `proceedAfterDiff()`、有差異關 columnDialog
  開 `diffDrawer`（新 reactive）；SubmitDiffDrawer `@confirm`→關 diff 開 proceedAfterDiff、
  `@back`→關 diff 回 columnDialog；`handleTokenExpired` 補關 diffDrawer；
  **confirmDialog／signatureDialog 順序內容完全不動**，只在前面插一層。
- `src/utils/columnPrep.js`＋`src/utils/tempQueue.js`：疊回草稿後設
  `column.draftOrigin={val,source}`＋`column.source='draft'`（L 欄在 parseInt **之後**設，
  切回「暫存」才拿得到正確形式的值；檔案欄分支也設）；`applyQueueToColumns(queue, columns, source)`
  加第三參數（預設不傳不壞），useDraft `applyOnlineDraft` 傳 `'online'`、TempTransferDrawers 匯入傳
  `'import'`、columnPrep 登入疊回標 `'local'`；`buildTempQueue` 不收 draftOrigin/userInput/source
  （只收 id/val/url/isFile）。
- `src/utils/columnRules.js`：statusDetector 加一條 `value === REUSE_LAST_FILE → '沿用上次的檔案'`
  （常數自 sentinels.js import，無循環）。
- `src/Code.js`：
  - 頂部同字面哨兵常數 `REUSE_LAST_FILE_SENTINEL`；新私有純函數
    `latestRecordRowFor_(recordArr, pkeyValue)`（比照 readRecord 的 userRecords 邏輯取該主鍵
    最後一列）與 `resolveReuseFileId_(userRecord, pos)`（`pos+5` 取 fileID、無效回 null）；
    writeRecord_ 檔案欄分支（現 1987-1988）遇哨兵→惰性讀紀錄表一次→裁決替換成真 fileID，
    查無 `proceedWrite=false`＋錯誤「找不到你先前上傳的檔案，請重新上傳」；nullable/must 檢查
    天然放行（哨兵非空）不需改；非檔案欄被竄改送哨兵→走各 format 正常格式檢查被擋，不需特判；
    郵件 csvOutput 在替換後拿到真 fileID 天然正確。**readRecord 不改**（檔案欄 value 維持清空，
    沿用＝顯式動作，避免使用者不知情重送舊檔）。
  - **`_file` 上傳登記表**：`fileSheet_()` 惰性建分頁（比照 `_logins`，建分頁權只在寫入路徑
    ＝saveFile）；欄位記 **column.id 不記 pos**（pos 隨對照表單插欄/搬欄位移，舊登記列會對到別的
    欄位）；凍結表頭 `FILE_HEADER`（人類可讀、字面值永不等於真實假名/fileID、對 reader
    惰性）；saveFile_ 成功建檔後 appendRow：`[ms 時間, referSSID, pkey 假名
    (deriveDraftKey_('id', referSSID, pkey)，與 _draft A 欄同源、表面去識別化), 欄位 ID,
    fileID, mimeType]`——draftSheetID 未設則靜默不記（比照 `_logins`）。
  - **writeRecord_ 新上傳 fileID 驗證**：檔案欄 value 非空、非哨兵時，
    `verifyUploadedFileId_(referSSID, pkeyPseudo, pos, fileID)` 查 `_file` 有無同
    (referSSID, pkey 假名, fileID) 登記列（pos 一併核對）；查無時 fallback 比對該使用者紀錄表
    最後一列同欄 fileID（與哨兵裁決同源，涵蓋登記表上線前的舊暫存值）；兩者皆無→
    `proceedWrite=false`＋錯誤「檔案來源無法確認，請重新上傳」。draftSheetID 未設→跳過驗證
    維持現行為（誠實邊界）。讀表成本：`_file` 與紀錄表各惰性讀一次、整筆 writeRecord 共用。
- `vite.config.js`：CDN_IMPORT_MAP 加 `diff`（esm.sh diff@9）、`diff2html`（esm.sh 3.4.56）；
  external 由 imports keys 導出自動生效。
- `index.html`：加 diff2html CSS `<link>`（jsDelivr，版本與 import map 兩處同步、比照
  element-plus 註解互指；落實時 curl 驗證路徑 200）。
- `package.json`：dependencies 加 `diff`、`diff2html`（dev 模式 Vite 從 node_modules 解析必須裝；
  新套件已於 2026-07-14 討論拍板）。

**測試（Vitest）**

- 新 `tests/submitDiff.test.js`：buildDiffText 各 format（單行/X 多行/U 逐選項/L 數字/空值佔位/
  📝 剝除）、baselineValue 退回、hasAnyDiff（零差異／新上傳算差異／哨兵不算／C-G 排除）。
- 新 `tests/fieldSources.test.js`：`coerceSourceValue` 各 format（U 交集、L parseInt、📝 防呆）、
  `buildSourceOptions`（沒值的來源不長選項、'user' 沒填過 disabled、檔案欄無「預設值」選項）、
  `applySource`（切換即帶入、檔案欄寫哨兵、**切走再切回 'user' 不弄丟 userInput**）、
  `currentSource` 回推、**哨兵常數前後端字面一致**（讀 Code.js 原始碼 assert，比照 draftChunks 讀源測法）。
- 新 `tests/fileSentinel.test.js`：inviteRpc 的 new Function＋GAS stub 模式——兩個純函數
  （多列取最後、pos+5、空值/null）＋writeRecord 整合（哨兵替換落 pureData、查無擋下、非檔案欄
  送哨兵被格式檢查擋）＋`_file` 驗證（登記命中放行、fallback 紀錄表命中放行、兩者皆無擋下、
  draftSheetID 未設跳過、saveFile 登記 appendRow 內容）。
- 既有：columnPrep.test.js 補 draftOrigin＋source='draft' 斷言、tempQueue.test.js 補 source 參數與
  哨兵 case（哨兵進 localStorage 暫存是刻意：使用者做了「沿用」這個決定，hasFilledData 視為有暫存）；
  inviteRpc 不動。

**文件同步（實作時）**

plan/struct.md（新元件×3／新 utils×3／`_file` 分頁）、plan/dataformat.md（`_file` 欄列語意）、
plan/security.md（fileID 歸屬驗證防線）、CLAUDE.md（套件表加 diff/diff2html、安全提醒段補 `_file`）、
plan/issue.md（「三哨兵關係」一節）。

### 驗證（2026-07-14 實作完成）

- `npm run lint` 淨（三新元件＋FormField/App.vue 模板改動）＋`npm test` **396 綠**
  （23 檔；新增 submitDiff 14／fieldSources 18／fileSentinel 15，columnPrep／tempQueue 各補案例）＋
  `npm run build` 通過（**174.1 KB**；diff/diff2html 走 import map 未進 bundle，dist 內確認為
  `import{createTwoFilesPatch as ae}from"diff"` 的裸名 import）。
- **無頭 Chromium 實測**（headless shell，repro 頁載入與正式版同一組 CDN URL）：
  - **diff**（esm.sh 的 diff@9.0.0／diff2html@3.4.56／dompurify，jsDelivr 的 diff2html CSS）：
    桌機 `side-by-side`／手機 `line-by-line` 兩種 outputFormat 都渲染成功、增行 6／刪行 4、
    DOMPurify 後無 script 殘留、改過的行與新增的多選項都看得到。**ALLPASS**。
  - **答案來源 el-segmented**（element-plus 2.14.2）：四個選項標籤正確、「你現在填的」打字前
    `is-disabled`／打字後解鎖、登入後停在「暫存」、點「預設值」值自動帶入、切到「你上次的」再切回
    「你現在填的」**保留使用者填的內容**。**ALLPASS**。
- **待人工（實機）驗證**：
  - 來源切換器：沒值的來源不長選項、切換即帶入各 format（U 多選、L 滑桿、S 下拉）、
    手機上四個選項不撐爆版面。
  - 左側狀態邊界條：圖示隨驗證狀態變化（未答/已答/格式錯）、改過的題多一個 `fa-pen` 標記、
    tooltip 在手機可點出、題與題邊界清楚。
  - diff drawer：零差異自動跳過、基準 segmented 切換、檔案前後對照三態、footer 兩鈕各半寬。
  - 檔案欄：重登→切「你上次的」（切換器下方顯示「沿用上次上傳的檔案」）→送出成功且紀錄表落
    **真 fileID**（非哨兵）；新上傳→`_file` 出現登記列→送出放行；`_file` 分頁自動建立且表頭凍結。

### 部署順序（本 Phase 特有，寫在前面免踩雷）

**先部署後端再換前端**：舊 Code.js 會把哨兵當 fileID 原樣落地。順序＝gpush 新 Code.js →
測試部署驗證 → 再換新前端。

### 誠實邊界

- diff 只比文字不比檔案內容（檔案走前後 URL 對照區）。
- 「你現在填的」在使用者動手之前是 disabled——這是刻意的：沒動過手就沒有「自己填的版本」可回。
- `_file` 驗證只在 draftSheetID 有設時生效；未設＝維持現行為，歸屬缺口仍開（比照 `_logins`
  靜默降級）。
- 登記表上線前上傳、且不在紀錄表最後一列的 fileID 會被擋（要求重傳，一次性過渡成本）。
- CDN 風險同既有取捨：diff2html JS 掛掉 diff 區白（不擋送出流程本身）、CSS 掛掉只醜不擋功能。

---

## 部署原則（每次都適用）

- clasp 用工作帳號登入（`npx clasp show-authorized-user` 先確認）
- 測試部署 `AKfycbzpzvFOyMXQ2rGz2aQdQDNAQmo_IbvWSdJT4HJffnpURTeuhtUl_hoO8WHi5Al-f-mY`
  以 `npx clasp deploy -i <該ID>` 就地更新供實測（2026-07-10 起的常態流程）
- **其他既有部署**只建新：`npx clasp deploy -d "說明"` 不帶 `-i`，不動版本
- 已知 @HEAD 測試部署會隨 push 更新（已確認可接受）
