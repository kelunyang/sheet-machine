# Sheet Machine - Claude Code 專案指引

## 專案概述

這是一個基於 Google Apps Script + Vue.js 的動態表單系統，使用 Google Sheets 作為後端資料庫。

## 技術棧

- **前端**: Vue 3（`<script setup>` + composables）+ Element Plus + Lodash
- **後端**: Google Apps Script
- **建置工具**: Vite + vite-plugin-singlefile
- **測試/品質**: Vitest + ESLint（flat config）+ Prettier
- **部署工具**: clasp (Google Apps Script CLI)

## 重要檔案

| 檔案 | 說明 |
|------|------|
| `src/App.vue` | 主元件：狀態編排、對話框流程、GAS 呼叫 |
| `src/components/FormField.vue` | 單一問卷欄位元件（各 format 的輸入 + 驗證顯示） |
| `src/components/` | 其餘抽出的對話框/抽屜：ErrorAlert、MultiSelectDrawer（自製卡片式 transfer）、FileUploadDrawer、TempTransferDrawers（匯出/匯入暫存）、StatDialog、LatestDialog、JwtCountdownBar（登入時效倒數條，fixed 頂端、點擊續約）、InviteeSignDialog（受邀簽名者流程：read-only 問卷 + 單格簽名，自建 useSignatures 實例） |
| `src/composables/` | useCrypto（匯出加密）、useGasRpc（RPC Promise 包裝）、useDraft（線上暫存 + saveDraftForInvite）、useInvites（簽名邀請：查狀態/發/重發/換email/撤回含二段確認）、useSteps（步驟條）、useSignatures（簽名板）、useJwtSession（JWT 倒數 tick + 續約守衛） |
| `src/utils/` | columnRules（欄位規則純函數）、columnPrep（登入後欄位整理，App 與 InviteeSignDialog 共用）、tempQueue（暫存 queue 邏輯）、tempStorage（localStorage 層）、markdown（HTMLConverter）、multiSelect（已選區排序運算）、formatters（dateConverter/downloadCSV）、jwt（前端 JWT 解碼，僅供 UI、不驗簽） |
| `src/theme/colors.config.js` | 主題配色單一來源（含 WCAG 實測對比度）；`vite.config.js` 的插件在建置時據此生成 `src/styles/_theme-generated.scss`（gitignored），手寫樣式層在 `src/styles/_theme.scss`，改色只改 config |
| `src/Code.js` | Google Apps Script 後端程式（非 ES module，clasp 原樣推送） |
| `tests/` | Vitest 單元測試（純函數；Code.js 以 stub 全域載入測試） |
| `tools/` | 管理者手動工具，不隨 clasp 部署 |
| `struct.md` | 系統架構文件 |

## 開發注意事項

### 建置與部署

```bash
npm run lint     # ESLint（含 vue/no-undef-properties 模板綁定完整性檢查）
npm test         # Vitest 單元測試
npm run build    # Vite 建置 (輸出到 dist/)
npm run gpush    # 複製檔案並推送到 Google Apps Script
```

改動 `App.vue` / `FormField.vue` 模板後務必跑 `npm run lint`：script setup 下模板引用未宣告
的識別字不會讓建置失敗，只會在執行期悄悄變成 undefined，靠 `vue/no-undef-properties` 擋。

### 資料流重點

1. **columnDB**: Vue 響應式陣列（App.vue 的 ref），儲存所有表單欄位
2. **watch handler**: 監聽 columnDB 變更，透過 `utils/tempQueue.js` + `utils/tempStorage.js` 自動存入 localStorage
3. **tempFound**: 布林值，表示是否有可匯出的暫存資料（判斷邏輯在 `tempQueue.hasFilledData`）

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

## 測試注意事項

- `npm test` 可離線跑純函數測試（columnRules、tempQueue、useCrypto、Code.js 的 chunk 切割）
- 端對端測試仍需有效的 Google Sheets 設定、在 Google Apps Script 環境下執行
- localStorage 暫存需在同一瀏覽器/同一網域下才能存取

## 安全提醒

- 匯出檔案使用 AES-256-GCM 加密（`src/composables/useCrypto.js`；smv2 隨機 salt，舊格式相容）
- 加密金鑰 = 主鍵值 (登入帳號) + 使用者設定的密碼
- 跨裝置匯入需要相同的主鍵值才能解密
- **登入採 JWT**（HS256，`Code.js` 的 `signJwt_`/`verifyJwt_`，secret 存 ScriptProperties `jwtSecret` 首次自動生成）：`readRecord` 驗證通過簽發 1 小時 token（claims：pkey/refer/iat/exp），之後 `writeRecord`/`saveFile`/暫存三支 RPC 只帶 token（`authByToken_`），認證欄位值（個資）不再重傳；登入成功後前端即清空非主鍵的認證欄位值
- 線上暫存的安全邊界在後端 `authByToken_()` 驗證（web app 為匿名存取）
- 主鍵值一律由伺服器端判定（`draftKey_`；Gmail 主鍵取 Session），不信前端傳來的 pkey 值
- **遠端簽名邀請**（`_invites` 分頁存於 draftSheetID 試算表，功能與線上暫存綁定）：邀請 token 為 64 字元 hex，doGet 注入走 regex 白名單 + JSON.stringify 雙保險；受邀者以 `inviteeLogin` 換 session JWT（帶 invite claim，`authByToken_` 一律拒絕，不能冒充填寫者打 writeRecord/暫存/邀請 RPC）；`submitInviteSignature`/`revokeInvite` 都在 ScriptLock 內重讀邀請列（競態防線，有測試覆蓋）；`writeRecord` 的簽名來源由 `resolveSignatureSources_` 伺服器端裁決（pending 整筆擋下、signed 用列上 fileID），前端沒有傳 fileID 的通道；簽名圖內嵌一律走 `signatureDataUrl_`（私有函數，fileID 由伺服器端查出，**絕不做成收 fileID 的 RPC**）
