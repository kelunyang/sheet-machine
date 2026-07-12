# Sheet Machine — Google 試算表動態問卷系統

以 **Google Apps Script + Vue 3** 打造、拿 **Google 試算表當後端資料庫**的動態表單系統。
目的在「限定名冊內的人填寫、並讓填寫者對照既有資料修正」，比 Google 表單更有邏輯：

- 名冊登入驗證（自訂認證欄位，或同機構 Google 帳號登入）
- 對照既有資料、只改要改的欄位
- 手寫簽名、看得到進度的檔案上傳、Markdown 描述、加總（記帳）欄位
- 線上暫存（端到端加密）、遠端多方簽名邀請（Email 一次性驗證碼）
- 匯出檔 AES-256-GCM 加密、登入防枚舉

> 這份 README 是**安裝與維運入口**。深入的設計規格、資料格式、踩過的坑，見 [`plan/`](#九文件導覽) 目錄。

---

## 一、系統怎麼運作（三張表 + 一張暫存表）

1. **問卷列表試算表**（`listSheetID`）：一列一份問卷，記問卷標題、主鍵欄、認證欄、截止時間、
   管理者信箱、是否開放等。是整個系統的總目錄。
2. **對照表單（結構表）**：每份問卷一張，定義欄位（題型、選項、預設值）與匯入的既有資料。
3. **紀錄表（填入表）**：每份問卷一張，使用者送出的結果寫進這裡。
4. **暫存試算表**（`draftSheetID`，選配）：全系統共用一張，內含 `_draft`（線上暫存）、
   `_invites`（簽名邀請）、`_logins`（登入稽核）三個分頁。**永不對外分享**（見安全說明）。

資料格式的欄列語意見 [`plan/dataformat.md`](plan/dataformat.md)。

---

## 二、技術棧

| 層 | 用的東西 |
|----|----------|
| 前端 | Vue 3（`<script setup>` + composables）、Element Plus、Lodash、dayjs、marked+DOMPurify、signature_pad、uuid |
| 後端 | Google Apps Script（`src/Code.js`，非 ES module） |
| 建置 | Vite + `vite-plugin-singlefile`（app 程式碼＋樣式內聯成單一 `dist/index.html`；vendor library 走 CDN import map） |
| 品質 | Vitest、ESLint（flat config）、Prettier |
| 部署 | clasp（Google Apps Script CLI） |

---

## 三、安裝與部署

### 0. 前置需求

- Node.js（建議 18+）與 npm
- [`clasp`](https://github.com/google/clasp)（`npm install` 已含在 devDependencies）
- 一個 Google 帳號（建議用機構工作帳號部署）

### 1. 安裝相依、建置

```bash
npm install
npm run build      # 產生 dist/index.html（GAS 部署格式）
```

### 2. 準備兩個 GAS 專案

本系統有**兩個各自獨立**的 Apps Script 專案（各有自己的 ScriptProperties，互不相通）：

**(A) Web app 專案** — 就是這個 repo 用 clasp 推的（`appscript/`，掛 LodashGS 函式庫）：

```bash
npm run glogin           # clasp 登入（用要部署的帳號）
# 沿用現有專案：改 .clasp.json 的 scriptId 指到你的專案
# 或全新建立：
npm run gcreate          # clasp create，會寫入新的 scriptId
npm run gpush            # 複製 Code.js + dist/index.html 到 appscript/ 並 clasp push
```

推上去後，在 Apps Script 編輯器「部署 → 新增部署 → 網頁應用程式」，
執行身分 = 部署者、存取權 = 任何人（匿名），拿到 web app 網址。
（設定已寫在 `appscript/appsscript.json`：`executeAs: USER_DEPLOYING`、`access: ANYONE_ANONYMOUS`。）

**(B) 問卷列表容器綁定專案** — 管理者建卷/改卷/匯出的工具，程式碼在 [`tools/export.js`](tools/export.js)：
把該檔內容手動貼進「問卷列表試算表」的「擴充功能 → Apps Script」，存檔後重整試算表，
會多一個「問卷管理」選單。**這個專案不隨 clasp 部署**（見 [`tools/README.md`](tools/README.md)）。

### 3. 設定 ScriptProperties（見下方第四節）

兩個專案都要各自設。設完就能用；改參數即時生效、**不必重新部署**。

### 常用指令

```bash
npm run dev        # 本機開發（Vite，從 node_modules 解析、不注入 CDN import map）
npm run build      # 建置到 dist/
npm run gpush      # 複製檔案 + clasp push 到 web app 專案
npm run lint       # ESLint（含 vue/no-undef-properties 模板綁定檢查）
npm test           # Vitest 純函數測試（可離線）
```

> ⚠️ 改元件模板後**務必 `npm run lint`**：`<script setup>` 下模板綁定錯誤建置不會報錯，
> 只有 `vue/no-undef-properties` 擋得住。

---

## 四、ScriptProperties 完整清單

### 4-A. Web app 專案（`appscript/` 這個專案）

**必填 / 核心**

| Property | 說明 |
|----------|------|
| `listSheetID` | **問卷列表試算表 ID**。沒有它整個系統無法運作。 |
| `systemTitle` | 系統標題：瀏覽器分頁標題、寄出信件的主旨前綴。 |

**機密（首次使用自動生成，勿手動設、勿刪、勿改）**

| Property | 說明 | 動了會怎樣 |
|----------|------|-----------|
| `jwtSecret` | 登入 JWT 簽章密鑰 | 輪替＝已發 token 全失效，使用者重登即可（傷害小） |
| `draftEncSecret` | 暫存加密的 HMAC 派生密鑰 | **輪替/遺失＝所有暫存（雲端＋裝置＋匯出檔）解不開**，視同暫存全歸零。沒有極端理由別動 |

**功能開關 / 選配**（未設 = 該功能停用，其餘照常）

| Property | 說明 |
|----------|------|
| `draftSheetID` | 暫存試算表 ID。開啟「線上暫存 + 遠端簽名邀請 + `_logins` 登入稽核」。未設＝三者停用（登入冷卻防線仍運作）。**此表永不對外分享** |
| `emailLog` | 寄信記錄試算表 ID（記錄系統寄出的每封信） |
| `universalStorageID` | 檔案上傳欄位的**預設** Drive 資料夾 ID（欄位可各自覆寫） |
| `postCodeAPI` | 地址/郵遞區號查詢 API 的前綴 URL（地址型欄位呼叫，會接 `encodeURIComponent(地址)`） |
| `announcement` | 問卷列表頁的重要公告（Markdown）；有設才顯示 |
| `inviteTtlMinutes` | 邀請碼有效期（**分鐘**），未設＝7 天（10080）；實際到期不晚於問卷截止 |
| `draftBackupFolderID` | 離線重建暫存表（`rebuildDraftSpreadsheet()`）的備份資料夾 ID；未設不重建 |
| `draftRebuildMinRows` | 離線重建的列數門檻（正整數），低於此不重建 |

**登入防枚舉（Phase 21，全部有預設、只吃正整數、改了即時生效）**

一般只需**設 `securityAlertEmail`**，其餘用預設即可。完整調參建議、警報信判讀、
維運手冊見 **[`plan/security.md`](plan/security.md)**。快速版：

| Property | 預設 | 一句話 |
|----------|------|--------|
| `securityAlertEmail` | （未設寄觸發器擁有者） | **設成你的信箱**——唯一建議明確設定的 |
| `loginFailMax` | 5 | 同帳號連錯幾次進冷卻（大批通知前調大 `99999` 等於暫停鎖定） |
| `loginCooldownMinutes` | 5 | 冷卻幾分鐘（自癒，不建議 >10） |
| `scanAlertThreshold` | 30 | 10 分窗口失敗幾次寄即時警示信（純偵測不擋人） |
| `scanAlertWindowMinutes` | 10 | 警示窗口長度 |
| `scanAlertCooldownMinutes` | 60 | 同問卷警示信重寄間隔 |
| `loginScanFailThreshold` | 20 | 定時掃描的失敗總數閾值 |
| `loginScanDistinctThreshold` | 10 | 定時掃描的相異失敗帳號數閾值 |
| `loginScanCursor` | — | **系統自動維護**的掃描游標，別手動改 |

> 定時掃描 `scanLoginLog()` 需管理者自己在編輯器掛時間觸發器（程式不自建），建議每小時或每日、離峰。

### 4-B. 問卷列表容器綁定專案（`tools/export.js` 那個）

| Property | 必要性 | 說明 |
|----------|--------|------|
| `exportStorage` | **必填** | 問卷匯出檔的存放資料夾 ID |
| `referStorage` | 選填 | 新建「結構表」的存放資料夾（設了會共享檢視權給執行帳號，之後自動繼承） |
| `recordStorage` | 選填 | 新建「填入表」的存放資料夾（設了會共享編輯權給執行帳號） |
| `webAppAccount` | 選填 | web app 的執行帳號 email，供新建填入表自動 protect（僅擁有者＋此帳號可編輯） |

---

## 五、Loading 小遊戲：改主題或關掉

首屏與 RPC 等待時會跳一個 8-bit 小遊戲（`src/components/LoadingGame.vue`，
獨立預覽檔 `demoloading.html`）。**目前主題是「林口高中」專屬**——校舍/圖書館/科學館建築、
制服小人、射擊隊外套、天文望遠鏡等，別的單位拿去多半要改或關掉。使用者已有兩個內建開關
（遊戲卡上的「我不要再看到遊戲了」「載入完成也不結束遊戲」，存 localStorage），
但那是**每個使用者自己選**；下面是**部署者**層級的改法。

> ⚠️ **本系統大量使用「像素小人」元素，不只在 loading 遊戲裡**——同一套小人 sprite
> （`src/utils/pixelSprites.js` 匯出的 `BOY`/`GIRL` 側面、`BOY_FRONT`/`GIRL_FRONT` 正面）
> 還被以下元件共用：
> - `LoadingGame.vue`：跑酷的兩個側面小人
> - `FieldTimeline.vue`：填答進度軌道上**正面小人**踩著目前題目、原地踏步
> - `LifecycleTimeline.vue`：問卷/邀請生命週期時間軸上小人踩著當前時間點
>
> 而且**選哪個小人（男/女）是跨元件同步的**（`getGameSession().playerIsGirl`，「你」在遊戲、
> 進度條、時間軸都是同一個人）。所以**只改 `LoadingGame.vue` 不夠**：小人造型要一起改就得動
> `pixelSprites.js`，否則進度條/時間軸還是舊小人。給 LLM 改主題時務必把這點講清楚（見選項 B）。

### 選項 A：直接關掉遊戲，只留單純載入提示

最小改動——編輯 `src/App.vue`，把

```vue
<LoadingGame v-if="loadingGameVisible" />
```

換成一個單純的 loading 疊層（例如 Element Plus 的 `v-loading` 或一個置中的 spinner + 「載入中…」），
並移除上方的 `import LoadingGame from './components/LoadingGame.vue';`。
`useLoadingGame()` 的 `loadingGameVisible` / `beginLoading` 計數邏輯照用不動，只是換掉 UI。
改完 `npm run build && npm run gpush`。

### 選項 B：換成你自己的主題（丟給 LLM 改）

`LoadingGame.vue` 的畫面全是純函數 canvas 繪圖（像素 sprite 字串 + `SEGMENTS` 背景段），
很適合請 LLM 重畫。可以把整個 `src/components/LoadingGame.vue` 和 `src/utils/pixelSprites.js`
餵給你的 LLM，附上這段提示：

> 這是一個 Vue 3 `<script setup>` 元件，用 canvas 畫一個 8-bit 橫向跑酷 loading 小遊戲，
> 目前主題是「林口高中」（校園建築、制服小人、跨欄/小黑狗/台灣藍鵲障礙、書包/外套/氣手槍/
> 天文望遠鏡加分物件）。請把**美術主題**換成「_（填你的單位／情境，例如某公司、某活動）_」，
> 保留所有遊戲機制、輸入操控（WASD／方向鍵／觸控）、計分與生命週期啟停邏輯不變。具體要換：
> 1. `SEGMENTS` 陣列裡的背景建築段（改成你的地標，`draw(x)` 內用 `ctx.fillRect` 畫像素方塊）；
> 2. 障礙物 `DOG`/`BIRD` 與加分物件 `PICKUP_DEFS`（`BAG`/`JACKET`/`PISTOL`/`SCOPE`）的
>    sprite 字串（`.` = 透明，其餘字母對應 `*_PAL` 調色盤）與名稱；
> 3. **`src/utils/pixelSprites.js` 裡的「小人」sprite**——這是**全系統共用的角色**，
>    匯出四個造型：`BOY`/`GIRL`（側面，用於遊戲）、`BOY_FRONT`/`GIRL_FRONT`（正面，用於進度條
>    與時間軸）。**這個檔案一改，除了 loading 遊戲，`FieldTimeline.vue`（填答進度軌道上的正面小人）
>    和 `LifecycleTimeline.vue`（生命週期時間軸上的小人）也會一起換掉**——這正是重點，四個造型要
>    一致地換成你的新角色（別只改側面忘了正面），否則進度條/時間軸會跟遊戲對不起來。男女造型的選擇
>    跨元件同步（`getGameSession().playerIsGirl`），改造型時兩性都要有對應的側面＋正面版本。
> 調色盤盡量沿用 `src/theme/colors.config.js` 匯出的 `THEME_COLORS`/`SURFACE_COLORS`，
> 不要憑空寫死 hex（純黑純白例外）。改完 `demoloading.html` 是可獨立開啟的預覽檔，可同步更新。

> 註 1：**像素小人是本系統的招牌元素、出現在三個元件**（loading 遊戲、`FieldTimeline`、
> `LifecycleTimeline`），全部吃 `src/utils/pixelSprites.js` 這一份 sprite。要換角色風格記得三處一起看。
>
> 註 2：`demoloading.html` 是**同一個遊戲的獨立 HTML 預覽版**（不依賴建置），方便單獨開來看效果；
> 若你改了元件，記得對照更新它（或直接刪掉，它不影響系統運作）。

---

## 六、安全重點（部署前務必知道）

- **`draftSheetID` 暫存試算表永不對外分享**：`_logins` 分頁存**明文真實登入帳號**（稽核用）、
  `_invites` 存明文主鍵，保護完全靠存取控制（管理者責任）。
- 暫存內容（`_draft` 與使用者 localStorage）**端到端加密**，能開表的人看不到誰、也看不到內容。
- 匯出檔 AES-256-GCM 加密；跨裝置匯入需以同一身分登入同一問卷才能解密。
- 登入採 JWT，認證個資不重複傳輸；主鍵值一律伺服器端判定，不信前端傳值。
- 完整機制、誠實邊界（防什麼、不防什麼）、維運手冊見 **[`plan/security.md`](plan/security.md)**。

---

## 七、個資與測試資料原則

- **絕不把真實個資寫進程式碼**（含 mock/測試/範例/註解）。範例一律用明顯虛構值
  （如 `A123456789`、`王小明`）。
- 真實憑證與 Sheet ID 一律走 ScriptProperties，不進 repo；確認已被 `.gitignore` 排除。
- `npm test` 為離線純函數測試；端對端測試需有效的 Google Sheets 設定並在 GAS 環境執行。

---

## 八、開發規範速記

- 前端一律 `<script setup>`；有狀態進 `composables/`、純函數進 `utils/`。
- UI 圖示走 **FontAwesome CDN**，不用 emoji、不用 `@element-plus/icons-vue`。
- 配色一律引用 `src/theme/colors.config.js`（唯一來源），不憑空寫死 hex。
- 彈窗全站零 `el-dialog`、禁用 `ElMessageBox`（改用 `useConfirmDrawer`）。
- **Sheets 寫入禁止 `deleteRow`/`deleteRows`/`deleteColumn`**：失效資料保留、用 timestamp/狀態欄
  當場推導，需作廢就 append 終態列；量大做離線重建。
- 時間一律用毫秒 timestamp 儲存與比較。
- 動手前先看 [`plan/issue.md`](plan/issue.md)（踩過的坑與刻意設計），推翻任一條先討論。

---

## 九、文件導覽

| 文件 | 內容 |
|------|------|
| [`CLAUDE.md`](CLAUDE.md) | 專案指引（技術棧、套件規範、開發注意事項）——最完整的一份 |
| [`plan/struct.md`](plan/struct.md) | 系統架構、前端元件細節 |
| [`plan/dataformat.md`](plan/dataformat.md) | Google 試算表資料結構（欄列語意，全虛構範例） |
| [`plan/security.md`](plan/security.md) | 安全機制總覽＋ScriptProperties 建議值＋維運手冊 |
| [`plan/plan.md`](plan/plan.md) / [`plan/todo.md`](plan/todo.md) | 開發計畫（Phase 規格）與待辦簡目 |
| [`plan/issue.md`](plan/issue.md) | 已知的坑與刻意設計（改動前先看） |
| [`plan/2026-summer.md`](plan/2026-summer.md) | 資料結構凍結決策＋schema 檢查器規劃 |
| [`plan/checklist.md`](plan/checklist.md) | 收尾檢查清單 |
| [`tools/README.md`](tools/README.md) | 管理者手動工具（建卷/匯出）說明 |

---

任何問題歡迎聯絡 kelunyang@outlook.com
