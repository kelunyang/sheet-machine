# Sheet Machine - Claude Code 專案指引

## 專案概述

這是一個基於 Google Apps Script + Vue.js 的動態表單系統，使用 Google Sheets 作為後端資料庫。

## 技術棧

- **前端**: Vue 3（`<script setup>` + composables）+ Element Plus + Lodash
- **後端**: Google Apps Script
- **建置工具**: Vite + vite-plugin-singlefile
- **測試/品質**: Vitest + ESLint（flat config）+ Prettier
- **部署工具**: clasp (Google Apps Script CLI)

## 使用套件（開發規範）

新需求優先用下面已裝的套件解決，不要另掛同性質的新依賴；真的需要新套件先討論。
版本以 `package.json` 為準。

### dependencies（會被打進單一 HTML）

| 套件 | 用途 / 使用規範 |
|------|----------------|
| `vue` | 前端框架，一律 `<script setup>` |
| `element-plus` | UI 元件庫（全量引入）；彈窗規範見「重要檔案」——全站零 el-dialog、禁用 ElMessageBox（改用 useConfirmDrawer） |
| `@element-plus/icons-vue` | 現僅為 element-plus 內部相依（drawer 關閉鈕、select 箭頭等自帶圖示）；**專案模板不再用它**，全域註冊已移除，UI 圖示改走 FontAwesome CDN（見下方「圖示規範」） |
| `lodash` | 陣列/物件操作（`_`） |
| `dayjs` | 日期格式化（`utils/formatters.js` 的 dateConverter、`utils/sheetFlow.js` 等） |
| `dompurify` | 所有 `v-html` 前必過的消毒層（`utils/markdown.js`） |
| `marked` | Markdown 轉 HTML 引擎（同上，輸出必過 DOMPurify） |
| `signature_pad` | 簽名板（`composables/useSignatures.js`） |
| `uuid` | 產生識別碼 |

### devDependencies

| 套件 | 用途 |
|------|------|
| `vite` + `@vitejs/plugin-vue` + `vite-plugin-singlefile` | 建置：app 程式碼＋樣式內聯成單一 `dist/index.html`（GAS 部署格式）；vendor library 外部化走 CDN（見下方「依賴策略」） |
| `sass` | SCSS 主題層（`src/styles/`，配色來源 `src/theme/colors.config.js`） |
| `vitest` | 單元測試 |
| `eslint`（flat config）+ `eslint-plugin-vue` + `eslint-config-prettier` + `@eslint/js` + `globals` | Lint（含 `vue/no-undef-properties`） |
| `prettier` | 格式化 |
| `clasp` + `@types/google-apps-script` | GAS 推送/型別 |

**依賴策略：library 走 CDN（單檔只留 app 程式碼）**——原「禁止 CDN」紅線已解除。
建置時 `vite.config.js` 把 dependencies 標成 `rollupOptions.external`，不打進 bundle，
改由注入的 **import map**（`<script type="importmap">`，`CDN_IMPORT_MAP`）於執行期解析到
**esm.sh** 的 ESM build；`element-plus` 帶 `?external=vue` 與 app 共用同一份 vue 實例。
`dist/index.html` 只內聯 app 自身程式碼（vendor 外部化後約 146 KB，原本 1.6 MB）。
外部資源（`index.html` 的 `<link>`／import map）singlefile 不 inline，原樣留在 dist、
於 GAS 沙盒 iframe 執行期載入。清單：

- **JS library**（import map → esm.sh）：vue、element-plus、lodash、dayjs、dompurify、
  marked、signature_pad、uuid。改版本要**同步改** `vite.config.js` 的 `CDN_IMPORT_MAP`
  與 `index.html` 的 element-plus CSS `<link>` 版號（兩處版本必須一致）。
- **CSS／字型／其他 `<link>`／`<script>`**：Element Plus CSS（jsDelivr）、FontAwesome
  6（cdnjs）、Noto Sans TC 黑體（Google Fonts，全域 `--el-font-family` 設在 `src/style.scss`）、
  PapaParse（cdnjs `<script>`）。
- `@element-plus/icons-vue` 未被 src 直接 import，不列 import map，由 esm.sh 的
  element-plus build 內含。

**取捨（務必知道）**：核心 library 走 CDN 後，**CDN 掛掉或被 GAS 沙盒 CSP 擋住 = 整頁
白畫面**（不再像單檔那樣自帶）。加/換 library 一律走上述 CDN 機制，不再往 bundle 塞；
dev（`npm run dev`）由 Vite 從 node_modules 解析、不注入 import map（`apply:'build'`）。

### 圖示規範：走 FontAwesome CDN，非不得已不准用 emoji

- UI 圖示**一律用 FontAwesome 6**（免費 solid + brands，cdnjs `<link>` 掛在 `index.html`），
  模板寫 `<i class="fa-solid fa-xmark"></i>` / `<i class="fa-brands fa-github"></i>`；
  按鈕內圖示沿用 `<el-icon class="el-icon--left/right">` 外殼包住 FA 的 `<i>`（保留 element-plus
  的對齊/間距），例：`<el-icon class="el-icon--right"><i class="fa-solid fa-chevron-down"></i></el-icon>`。
- **不准**在模板/字串裡放 emoji 當圖示，也不再用 `@element-plus/icons-vue`（全域註冊已移除）。
- 既有 emoji 例外（Code.js 的 📝 資料標記、pixelSprites 像素畫）維持不動——見 plan/issue.md，
  新程式不再新增 emoji 例外。

## 重要檔案

| 檔案 | 說明 |
|------|------|
| `src/App.vue` | 主元件：狀態編排、對話框流程、GAS 呼叫 |
| `src/components/` | UI 元件：FormField、SheetCard、FormToolbar、SignatureToolbar、JwtCountdownBar、FieldTimeline、LifecycleTimeline、InviteeSignDialog、PinCodeInput、MultiSelectDrawer、FileUploadDrawer、TempTransferDrawers、ConfirmDrawer、LoadingGame、Stat/LatestDialog、ErrorAlert、AppFooter（版權列單一來源）——各元件職責與彈窗規範（全站零 el-dialog、drawer 方向、`.drawer-flow-title`）見 plan/struct.md「前端元件細節」 |
| `src/composables/` | 有狀態共用邏輯：useCrypto、useGasRpc、useDraft、useInvites、useSignatures、useJwtSession、useConfirmDrawer（全站禁用 ElMessageBox）、useLoadingGame——細節見 plan/struct.md |
| `src/utils/` | 純函數：columnRules、columnPrep、tempQueue、tempStorage、draftCipher、markdown、multiSelect、formatters、jwt、timeline、sheetFlow、pixelSprites——細節見 plan/struct.md |
| `src/theme/colors.config.js` | 主題配色單一來源（含 WCAG 實測對比度）；`vite.config.js` 的插件在建置時據此生成 `src/styles/_theme-generated.scss`（gitignored），手寫樣式層在 `src/styles/_theme.scss`，改色只改 config |
| `src/Code.js` | Google Apps Script 後端程式（非 ES module，clasp 原樣推送） |
| `tests/` | Vitest 單元測試（純函數；Code.js 以 stub 全域載入測試） |
| `tools/` | 管理者手動工具，不隨 clasp 部署 |
| `plan/struct.md` | 系統架構文件 |
| `plan/issue.md` | 已知的坑與刻意設計清單（改動前先看，要推翻先討論） |
| `plan/dataformat.md` | Google Sheets 資料結構文件（問卷列表／對照表單／紀錄表的欄列語意，全虛構範例） |
| `plan/plan.md`、`plan/todo.md` | 開發計畫（Phase 規格）與待辦簡目 |
| `plan/security.md` | 安全機制總覽＋ScriptProperties 參數建議值＋維運手冊（大批通知前調參、被鎖處理、警報信判讀、候選增補發想）——動安全相關參數或防線前先看這份 |
| `plan/2026-summer.md` | 2026 暑期路線：資料結構凍結決策＋schema 檢查器規劃 |
| `plan/checklist.md` | 收尾檢查清單（每次結束前檢查 footer 版權列、圖示走 FA CDN 等） |

## 開發注意事項

**遇到「看起來像 bug」或「看起來該重構」的地方，先看 `plan/issue.md`**——那裡記錄了
踩過的坑與刻意設計（送出鈕驗證時機、過期問卷清簽名、📝 資料標記、圖示走 FA CDN 等），
要推翻任何一條先討論，不要直接修。

### 建置與部署

```bash
npm run lint     # ESLint（含 vue/no-undef-properties 模板綁定完整性檢查）
npm test         # Vitest 單元測試
npm run build    # Vite 建置 (輸出到 dist/)
npm run gpush    # 複製檔案並推送到 Google Apps Script
```

改動元件模板後務必跑 `npm run lint`——script setup 下模板綁定錯誤建置不會報錯，
只有 `vue/no-undef-properties` 擋得住（詳見 plan/issue.md）。

### 資料流重點

1. **columnDB**: Vue 響應式陣列（App.vue 的 ref），儲存所有表單欄位
2. **watch handler**: 監聽 columnDB 變更，透過 `utils/tempQueue.js` + `utils/tempStorage.js` 自動存入 localStorage
3. **tempFound**: 布林值，表示是否有可匯出的暫存資料（判斷邏輯在 `tempQueue.hasFilledData`）

### 時間格式（全系統慣例）

**全系統一律用毫秒 timestamp（`Date.prototype.getTime()` 的回傳值）當時間的儲存與比較格式**——
`_invites` 的 expireAt/createdAt/updatedAt/otpExpireAt、JWT 的 iat/exp、OTP 的 TTL/cooldown
常數、email log 的時間欄、暫存的時間戳等，落地與運算都是 ms 整數，不存 Date 物件、不存字串。
時間「失效」一律由程式比對 timestamp 當場推導（如 `inviteStatusFor_` 的 expired），不落地成狀態。
`new Date()` / dayjs / `toLocaleString()` 只用在**顯示層或信件內文**的格式化，不進資料。
新程式碼要處理時間，一律沿用 ms timestamp，不要引入別種時間表示法。

### 欄位類型判斷

使用 `formatDetector(format, type, column)`（位於 `src/utils/columnRules.js`）：
```javascript
// 檢查是否為文字輸入欄位
formatDetector('T', 'F', column)  // format=T, type=F

// 檢查是否為檔案上傳欄位
formatDetector('F', 'F', column)  // format=F, type=F
```

### 暫存判斷邏輯

`src/utils/tempQueue.js` 的 `hasFilledData(queue, columns)`：值非空、非 NaN、
且與欄位原始值（savedContent）不同才算有暫存。已有單元測試覆蓋。

### 常見欄位格式

- `value = ""`: 空文字欄位
- `value = "選項1;選項2"`: 多選欄位 (U 格式)
- `value = 5`: 滑桿欄位 (L 格式)，注意 `parseInt('')` 會回傳 `NaN`

## 程式碼風格

- 前端為 `<script setup>`；共用邏輯進 composables（有狀態）或 utils（純函數）
- `src/Code.js` 與 `tools/` 是 GAS script（非 module），維持 GAS 慣例（`_` 結尾為私有函數）
- 使用 Lodash (`_`) 進行陣列/物件操作
- 使用 Element Plus 元件 (el-button, el-drawer, el-input 等)
- **配色規範**：任何 UI 配色一律參考全域配色表 `src/theme/colors.config.js`（唯一來源，
  含 hex 與 WCAG 實測對比度），執行期用它建置生成的 CSS 變數——`--el-color-*`（Element
  Plus 語義色＋色階，如 `--el-color-danger` / `--el-color-danger-dark-2` / `-light-9`）與
  `--sm-*`（主題自有：`--sm-*-text`、`--sm-*-on-light`、`--sm-alert-bg` 等）。**不要在
  元件／樣式裡憑空寫死 hex**（純黑 `#000`／純白 `#fff` 當文字反白色例外）；要客製 el 元件
  色就設 `--el-<元件>-*` 變數指向配色表變數（例：FormField 的 `.no-data-btn` 設
  `--el-button-*`）。需要現成沒有的色，先加進 `colors.config.js`（附 WCAG 對比）再用；
  `src/styles/_theme-generated.scss` 是 gitignored 的建置產物，勿手改、勿當來源。

### Sheets 寫入規範：禁止刪除列

- **全系統禁止 `deleteRow` / `deleteRows` / `deleteColumn`**（會位移其餘列、在 GAS 沙盒寫入不穩時容易刪錯列、且難以復原）。
  失效資料**一律保留**，用 timestamp 或狀態欄當場推導有效性（如 `inviteStatusFor_`），需要「作廢」就 append 一筆終態列（tombstone），
  絕不實體刪列。表長期成長是刻意取捨（換取零位移風險與稽核軌跡），量大後做**離線壓縮**（重建整張表，不在線上刪列）——
  已實作為 `rebuildDraftSpreadsheet()`（Phase 18，2026-07-11）：建新暫存試算表（`_draft` 留每 (主鍵, referSSID) 複合鍵
  最新列、`_invites` 留每格最新快照、其餘分頁按名稱認不得一律原樣複製——不做首格嗅探），舊表改名搬進備份資料夾
  （ScriptProperties `draftBackupFolderID`，未設不重建），翻
  `draftSheetID` 原子換手；全程 ScriptLock、sanity check 不過不翻 property；`draftRebuildMinRows` 門檻跳過低量重建；
  管理者手動掛時間觸發器（程式不自建 trigger）、建議離峰。規格見 plan/plan.md Phase 18。
- **快照忠實原則（零清空）**：append 的每一筆都是「原狀態忠實快照＋只翻這次事件改變的欄位」，
  **絕不把欄位寫成空值來表示失效**——失效是讀取端的判斷結果（timestamp 比對、attempts 上限、非最新列…），
  不是落地的資料狀態。
- `clearContent`（就地清固定列、不位移）與 `setTrashed`（Drive 檔案，非 Sheet 列）不在此限。
- 線上暫存已純 append 化（Phase 17）＋單表化（Phase 19，2026-07-11 實作完成）：全問卷共用單一 **`_draft`** 分頁
  （referSSID 是資料欄不是分頁名——Phase 17 的「一份問卷一個亂數名分頁」已退役），純 append 資料日誌，每次暫存
  `appendRow([主鍵, updatedAt(ms), referSSID, payload...])` 一筆快照，永不 `setValues`/`clearContent`/`deleteRow`；
  「當前草稿」＝(主鍵假名, referSSID) 複合鍵最新一列（`latestDraftRowIndexForKey_`，後列勝出＝舊版 superseded），
  無刪除/消耗概念，`deleteDraft` RPC 與 `draftRowIndex_` 已整支退役。第 1 列為人類可讀表頭 `DRAFT_HEADER`
  （凍結、對 reader 惰性——A/C 欄字面字串永不等於真實假名/referSSID）。**建分頁權只在寫入路徑（saveDraft）**，
  讀取路徑 `getSheetByName` 自己判 null（loadDraft 探一下就落地空分頁的副作用已修）；`draftPayloadByKey_` 走
  兩段式讀取（先讀 A:C 定位、命中才單讀該列全寬——純 append 保證列不位移，兩段讀無 race）。
  **端到端加密後（Phase 20，2026-07-12 實作完成）A 欄存 id 假名、payload 為前端加密的 `smd1:` 密文**——
  `encodeDraftPayload_` 對 `smd1:` 原樣直通（密文壓不動、後端零解密需求），後端 gzip+base64 的 `gz:`
  分支留作防呆（正常路徑不再產生）；50000 字/格為 Sheets 硬限制，超長仍由 `chunkPayload_` 切塊、
  讀取端 D 起串接後回前端 decode。
  送出後草稿不刪、重新登入仍跳暫存提示（文案含「線上暫存不代表最終結果，正式結果以已送出的紀錄為準」）。

## 測試注意事項

- `npm test` 可離線跑純函數測試（columnRules、tempQueue、useCrypto、Code.js 的 chunk 切割）
- 端對端測試仍需有效的 Google Sheets 設定、在 Google Apps Script 環境下執行
- localStorage 暫存需在同一瀏覽器/同一網域下才能存取

## 安全提醒

- 匯出檔案使用 AES-256-GCM 加密（`src/composables/useCrypto.js`；smv2 隨機 salt，舊格式相容）
- 加密金鑰 = id 假名（`draftKeys.id`）+ 使用者設定的密碼（Phase 20 起；舊檔 fallback = 主鍵值 + 密碼）
- 跨裝置匯入需要以同一組身分登入同一問卷（拿到同一把假名）才能解密
- **暫存內容端到端加密（Phase 20，2026-07-12 實作完成，規格見 plan/plan.md Phase 20）**：後端
  `deriveDraftKey_(purpose, referSSID, pkey)` = base64url(HMAC-SHA256(`draftEncSecret`, JSON.stringify 複合鍵))，
  secret 存 ScriptProperties `draftEncSecret`（首次自動生成，與 jwtSecret 分離——**輪替/遺失＝所有既有暫存
  解不開，視同暫存全部歸零**）；purpose 做 key separation：`id` 假名可落地（`_draft` A 欄、localStorage key、
  匯出檔金鑰料）、`enc` 只在前端記憶體加解密草稿（`readRecord` 隨 token 回 `draftKeys:{id,enc}`，絕不落地）、
  `log` 保留給 Phase 21。無字典、確定性派生：不存對照表、重登重算同一把。前端 `utils/draftCipher.js`
  （`sealDraft`/`openDraft`）：gzip（CompressionStream，iPad OS 13 不可用時跳過）→ useCrypto AES-256-GCM，
  格式 `smd1:<g|r>:` + smv2 密文；localStorage 與 `_draft` 都只落假名 key＋密文（暫存表全面去識別化——
  能開表的人既看不到誰、也看不到內容），舊明文 localStorage 條目登入時 `migrateLegacyEntry` 一次性搬家清除。
  受邀者疊草稿改前端解密（`inviteeLogin` 回密文 blob＋後端重算的填寫者 enc key；後端 `buildReadonlyHeaders_`
  不再疊）。**防**暫存內容明文駐留（事後撈取）；**不防**即時 XSS 與 Google 帳號整體淪陷；**正式送出的
  record 不在範圍**（管理者要直接看 sheet，保護走分享權限）
- **登入採 JWT**（HS256，`Code.js` 的 `signJwt_`/`verifyJwt_`，secret 存 ScriptProperties `jwtSecret` 首次自動生成）：`readRecord` 驗證通過簽發 1 小時 token（claims：pkey/refer/iat/exp），之後 `writeRecord`/`saveFile`/暫存三支 RPC 只帶 token（`authByToken_`），認證欄位值（個資）不再重傳；登入成功後前端即清空非主鍵的認證欄位值
- 線上暫存的安全邊界在後端 `authByToken_()` 驗證（web app 為匿名存取）
- 主鍵值一律由伺服器端判定（`draftKey_`；Gmail 主鍵取 Session），不信前端傳來的 pkey 值
- **登入防枚舉（Phase 21，2026-07-12 實作完成，規格見 plan/plan.md Phase 21）**：主登入 `authRecord` 純比對
  名冊、web app 匿名 → 低熵認證欄位可窮舉撞庫。GAS 拿不到 client IP，故只做「不會誤傷」的防護，**全域自動
  封鎖明確不做**。三層：(1) **CacheService 即時防線**（`checkLoginThrottle_`/`recordLoginAttempt_`）——
  per-假名連錯 `loginFailMax`（預設 5）次冷卻 `loginCooldownMinutes`（5 分）、成功清零；`readRecord_` 驗證前
  先 check、被擋回 `{throttled, cooldownSeconds}`（一致化，不洩漏主鍵值在不在名冊），驗證後 record。
  (2) **`_logins` 純 append 稽核日誌**（draftSheetID 試算表，A ms／B refer／C **明文真實帳號值**（**2026-07-12
  修訂：改存真值、非 HMAC 假名**——稽核價值＝知道是誰，假名化讓事件響應報廢；比照業界 auth log 存真值＋靠
  存取控制，**保護邊界＝draftSheetID 永不對外分享**，同表本就有 `_invites` 明文主鍵）／D 成功失敗；表頭凍結、
  對 reader 惰性；成功失敗都記；draftSheetID 未設則靜默不記、cache 防線照常）。**cache key 才用 HMAC 假名**
  （`deriveDraftKey_` purpose='log'，純 key 長度/字元衛生，cache 腳本內部不落表）——對比 `_draft` 的 id 假名是
  Phase 20 端到端加密的結構性必需（維持不動），`_logins` 只是稽核日誌、存真值。(3) **橫向偵測**：
  per-refer 窗口失敗過 `scanAlertThreshold`（30）→ MailApp 寄該問卷管理者（名冊 M 欄，**只給計數不列帳號**）、
  `scanAlertCooldownMinutes`（60 分）節流，人自行翻 O 欄「開放進入」斷問卷（機器只做不誤傷的事）。
  **check 與 append 之間不上鎖**（不在登入尖峰上 ScriptLock）。**定時掃描 `scanLoginLog()`**（管理者手動掛
  時間觸發器、**程式不自建**，比照 Phase 18）：`loginScanCursor` 游標增量（純 append 保證列不位移、只前進）、
  `tryLock` 防重疊、純函數 `analyzeLoginRows_`/`flagLoginAnomalies_` 三規則（失敗總數 `loginScanFailThreshold`／
  相異帳號數 `loginScanDistinctThreshold`／同帳號連錯≥3後成功＝疑似撞中），寄 `securityAlertEmail`（未設 fallback
  觸發器擁有者 `getEffectiveUser`，**信含實際帳號值、註明勿轉發**）、乾淨批次靜默。前端純顯示冷卻倒數、不做任何
  限流判斷。**誠實邊界**：cache 驅逐＝計數歸零（防線暫鬆非破口、`_logins` 一筆不漏）；`_logins` 明文保護全靠
  draftSheetID 永不分享（管理者責任）；無 IP 下橫向枚舉只能偵測＋人工斷，根治靠
  認證欄位的熵（管理者建名冊時的選擇）
- **遠端簽名邀請**（`_invites` 分頁存於 draftSheetID 試算表，功能與線上暫存綁定）：邀請碼（token）為 64 字元 hex，doGet 注入走 regex 白名單 + JSON.stringify 雙保險；受邀者登入走 **email OTP 二段驗證**——`requestInviteOtp(token)` 寄 6 位數一次性驗證碼到邀請列登記信箱（RPC 不收 email 參數；列上只存 `SHA-256(otp+邀請碼)` hash、10 分鐘有效、60 秒重寄節流、連錯 5 次作廢、單次使用），`inviteeLogin(token, otp)` 在 ScriptLock 內比對通過才回問卷內容並換 session JWT（帶 invite claim，`authByToken_` 一律拒絕，不能冒充填寫者打 writeRecord/暫存/邀請 RPC）；`?token=` 直連進入後前端以 `google.script.history.replace` 洗掉網址列參數（原生 history API 在 GAS 沙盒 iframe 改不了上層網址）；`submitInviteSignature`/`revokeInvite` 都在 ScriptLock 內重讀邀請列（競態防線，有測試覆蓋）；`writeRecord` 的簽名來源由 `resolveSignatureSources_` 伺服器端裁決（pending 整筆擋下、signed 用列上 fileID），前端沒有傳 fileID 的通道；簽名圖內嵌一律走 `signatureDataUrl_`（私有函數，fileID 由伺服器端查出，**絕不做成收 fileID 的 RPC**）；名詞統一：64-hex =「邀請碼」、6 位數 =「一次性驗證碼」
  - **邀請碼有效期可設定**：由 ScriptProperties 的 `inviteTtlMinutes`（**分鐘**）決定，管理者自行設定；`inviteTtlMs_()` 讀取、未設或非正整數退回預設 `INVITE_TTL_DEFAULT_MINUTES`（7 天＝10080 分）。實際到期 = `min(發出時間 + inviteTtlMinutes, 問卷截止日)`（`inviteExpireAt_`，邀請不會活過問卷截止）
  - **`_invites` 第 1 列為人類可讀表頭**（`INVITE_HEADER`，凍結）：新表由 `inviteSheet_()` 建立時自帶；此列對所有 reader **惰性**（col A/B/D 是字面字串，永不等於真實邀請碼/referSSID/主鍵值，被既有 key 過濾），故不必改掃描邏輯。**既有舊表（資料從第 1 列開始、無表頭）**用一次性 `initInviteHeader()`（Apps Script 編輯器手動跑、ScriptLock 保護、離峰執行、冪等）補上——`insertRowBefore(1)` 下移資料不刪不覆寫
  - **`_invites` 為純 append 快照日誌（Phase 16）**：發/重發/寄OTP/OTP錯誤/簽名/撤回/消耗，每個動作都 `appendRow` 一筆完整 14 欄快照，**永不 `setValues`、永不 `deleteRow`、快照零清空**（原狀態忠實照抄＋只翻這次事件改變的欄位，呼應「Sheets 寫入規範」）。「當前狀態」＝每格（referSSID+主鍵值+簽名格）最新一列：`latestInvites_`/`latestInviteForCell_`/`latestInviteForToken_`（重發後舊邀請碼因非最新列 **superseded 失效**）；撤回/消耗 append `revoked`/`consumed` 終態（fileID/email/OTP 原樣留存供稽核，終態列無 reader 取 fileID 讀檔）；OTP 連錯滿 5 次的作廢**不落地**（讀取端 `attempts >= MAX` 即作廢）、單次使用＝成功快照把 `otpExpireAt` 記為使用當下（效期終止事件）。reader（`resolveActiveInvite_`/`resolveSignatureSources_`/`listInvites`）一律讀最新列並把終態視為非活躍。表單調成長為刻意取捨，離線壓縮已實作為 `rebuildDraftSpreadsheet()`（放 src/Code.js 非 tools/——LockService per-project，tools/ 的鎖擋不住 web app 寫入；不線上 `deleteRow`；見「Sheets 寫入規範」段與 plan/plan.md Phase 18）
