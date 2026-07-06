# Sheet Machine 改善計畫

> 2026-07 健檢後的改善路線圖。npm 套件已於 2026-07-07 全面升級完成（Vite 8 / Vue 3.5 / Element Plus 2.14，漏洞 7→0，部署 @149）。
>
> **執行狀態（2026-07-07 確認開工）**：Phase 1 → Phase 2 依序執行；Phase 3 待暑假時段。
>
> **✅ Phase 1、Phase 2 已於 2026-07-07 完成並部署為 @150**。實作與計畫的差異：
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

## 部署原則（每次都適用）

- clasp 用工作帳號登入（`npx clasp show-authorized-user` 先確認）
- 只建新部署：`npx clasp deploy -d "說明"`，**永遠不帶 `-i`**，不動既有部署版本
- 已知 @HEAD 測試部署會隨 push 更新（已確認可接受）
