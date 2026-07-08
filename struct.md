# Sheet Machine 架構文件

## 概述

Sheet Machine 是一個基於 Google Apps Script 和 Vue.js 的動態表單系統，使用 Google Sheets 作為資料庫。

## 系統架構

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端 (Vue.js + Element Plus)              │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────────┐   │
│  │   sheets    │   │   authDB    │   │      columnDB       │   │
│  │  (問卷列表) │   │  (驗證欄位) │   │    (表單欄位資料)    │   │
│  └─────────────┘   └─────────────┘   └─────────────────────┘   │
│         │                 │                    │                │
│         │                 │                    ▼                │
│         │                 │          ┌─────────────────┐        │
│         │                 │          │  watch handler  │        │
│         │                 │          │  (監聽變更)      │        │
│         │                 │          └────────┬────────┘        │
│         │                 │                   │                 │
│         │                 │                   ▼                 │
│         │                 │          ┌─────────────────┐        │
│         │                 │          │  localStorage   │        │
│         │                 │          │  (暫存答案)      │        │
│         │                 │          └─────────────────┘        │
│         │                 │                   │                 │
│         │                 │       ┌───────────┼───────────┐     │
│         │                 │       ▼                       ▼     │
│         │                 │  ┌─────────┐           ┌─────────┐  │
│         │                 │  │ 匯出     │           │ 匯入     │  │
│         │                 │  │ .smtemp │           │ .smtemp │  │
│         │                 │  └─────────┘           └─────────┘  │
└─────────┼─────────────────┼─────────────────────────────────────┘
          │                 │
          │  google.script.run
          ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                   後端 (Google Apps Script)                      │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────────┐   │
│  │  getQList   │   │ authRecord  │   │    readRecord       │   │
│  │  取得問卷列表│   │  驗證身分   │   │    讀取表單資料      │   │
│  └─────────────┘   └─────────────┘   └─────────────────────┘   │
│                                                                 │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────────┐   │
│  │ writeRecord │   │  saveFile   │   │   compareSheets     │   │
│  │  寫入紀錄   │   │  上傳檔案   │   │    統計填寫率        │   │
│  └─────────────┘   └─────────────┘   └─────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
          │                 │                    │
          ▼                 ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Google Sheets 資料庫                        │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────────┐   │
│  │  listSheet  │   │  referSheet │   │    recordSheet      │   │
│  │  問卷清單   │   │  欄位定義   │   │    填寫紀錄         │   │
│  └─────────────┘   └─────────────┘   └─────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 資料結構

### 欄位類型 (column.type)

| Type | 說明 | 用途 |
|------|------|------|
| P | Primary Key | 主鍵，用於身分識別（如學號、帳號） |
| A | Auth | 驗證欄位（如密碼、驗證碼） |
| F | Field | 表單輸入欄位 |
| G | Group | 群組欄位 |
| C | Calculated | 計算/顯示欄位（唯讀） |
| O | Output | 輸出欄位 |

### 欄位格式 (column.format)

| Format | 說明 | 驗證規則 |
|--------|------|----------|
| T | Text | 純文字，可用 RegExp 驗證 |
| N | Number | 數字，可指定位數 |
| P | Padded | 補零數字 |
| I | ID | 身分證字號 (台灣) |
| E | Email | 電子郵件 |
| M | Mobile | 手機號碼 (09xxxxxxxx) |
| S | Select | 單選下拉選單 |
| U | Multi-select | 多選（分號分隔） |
| L | Slider | 數字滑桿 (min;max;step) |
| F | File | 檔案上傳 |
| G | Google | Google 帳號登入 |
| X | Textarea | 多行文字框 |

### columnDB 結構

```javascript
{
  id: "欄位ID",           // 對應 Google Sheet 的欄位標題
  name: "欄位顯示名稱",
  type: "F",              // 欄位類型
  format: "T",            // 欄位格式
  group: "群組名稱",       // 可選，用於欄位分組驗證
  content: "設定內容",     // 格式相關設定
  must: true,             // 是否必填
  nullable: false,        // 是否允許清空已有資料
  value: "當前值",        // 使用者輸入的值
  savedContent: "原始值", // 從伺服器讀取的原始值
  lastInput: "上次輸入",  // 上次提交的值
  status: "",             // 驗證錯誤訊息
  tid: "uuid"             // 前端用的唯一識別碼
}
```

### localStorage 暫存結構

```javascript
// Key: 主鍵值 (如學號)
// Value:
[
  {
    uid: "問卷唯一ID",
    queue: [
      { id: "欄位ID", val: "欄位值" },
      // ...
    ]
  }
]
```

### 匯出檔案格式 (.smtemp)

AES-256-GCM 加密後的 Base64 字串，解密後：

```javascript
{
  version: "1.0",
  exportTime: "ISO 時間戳",
  formId: "問卷ID",
  data: {
    queue: [
      { id: "欄位ID", val: "欄位值" },
      // ...
    ]
  }
}
```

## 資料流程

### 1. 載入問卷列表

```
前端 mounted()
  → google.script.run.getQList()
  → 後端讀取 listSheet
  → 過濾有效問卷（未過期、已啟用）
  → 回傳 sheets 陣列
```

### 2. 身分驗證

```
使用者輸入驗證資訊
  → authDB 更新
  → google.script.run.readRecord()
  → 後端 authRecord() 驗證
  → 讀取 referSheet 取得欄位定義
  → 讀取使用者已填資料 (savedContent, lastInput)
  → 回傳 headers 陣列
  → 前端填充 columnDB
```

### 3. 暫存機制

```
使用者修改欄位
  → columnDB 變更
  → watch handler 觸發
  → 建立 tempQueue (過濾檔案欄位)
  → 存入 localStorage
  → 更新 tempFound 狀態
```

### 4. 匯出暫存

```
點擊「匯出暫存答案」
  → 讀取 localStorage 的 tempQueue
  → 組合加密金鑰 (主鍵值 + 使用者密碼)
  → deriveKey() 產生 AES 金鑰
  → encrypt() 加密資料
  → 下載 .smtemp 檔案
```

### 5. 匯入暫存

```
點擊「匯入暫存答案」
  → 選擇 .smtemp 檔案
  → 輸入密碼
  → decrypt() 解密 (使用當前主鍵值 + 密碼)
  → 驗證檔案格式
  → 過濾有效欄位
  → 儲存到 localStorage
  → 直接更新 columnDB (Vue 響應式)
  → 畫面立即更新
```

### 6. 提交表單

```
點擊「送出」
  → 前端預檢 (checkData)
  → 群組驗證
  → 簽名驗證 (如需要)
  → google.script.run.writeRecord()
  → 後端格式驗證
  → 寫入 recordSheet
  → 發送確認郵件 (如設定)
  → 回傳結果
```

## 簽名機制

### 技術棧

- **前端套件**: [signature_pad](https://github.com/szimek/signature_pad) v5.1.3
- **繪圖技術**: HTML5 Canvas + Pointer Events API
- **輸出格式**: PNG (Base64 DataURL)

### 簽名資料結構

```javascript
signatures: [
  {
    id: "uuid",              // 唯一識別碼
    name: "簽名項目名稱",     // 如「本人簽名」、「家長簽名」
    canvas: HTMLCanvasElement,
    smObject: SignaturePad,  // signature_pad 實例
    percentage: 0,           // 簽名佔比 (%)
    showWarning: false,      // 是否顯示警告
    progressStatus: ''       // 進度條狀態 ('success' | 'exception')
  }
]
```

### 簽名流程

```
1. 初始化簽名板
   前端 checkData() 通過
     → 進入簽名步驟
     → 取得 canvas 元素 (document.querySelectorAll("canvas.signaturePad"))
     → 為每個簽名項目建立 SignaturePad 實例
     → 綁定 endStroke 事件監聽器

2. 使用者簽名
   觸控/滑鼠繪製
     → SignaturePad 內部處理 Pointer Events
     → 繪製完成觸發 endStroke 事件
     → 呼叫 calculateSignatureRatio() 計算佔比

3. 簽名佔比計算
   calculateSignatureRatio(index)
     → 讀取 canvas.getContext('2d').getImageData()
     → 遍歷所有像素的 alpha 通道
     → 計算非空白像素佔比
     → 更新 percentage 和 progressStatus
     → 佔比 < 0.5% 或 > 90% 視為無效

4. 簽名驗證
   endSignature()
     → 檢查所有簽名的 isEmpty()
     → 空白簽名加入 emptySignatures 陣列
     → 全部非空才能進入確認步驟

5. 提交簽名
   submitData()
     → 遍歷 signatures 陣列
     → 呼叫 smObject.toDataURL('image/png') 取得 Base64
     → 組成 { blob: "data:image/png;base64,...", name: "簽名名稱" }
     → 傳送至後端 writeRecord()

6. 後端處理 (Code.js writeRecord)
     → 解析 Base64: signature.blob.split(",")[1]
     → Utilities.base64Decode() 解碼
     → Utilities.newBlob() 建立 Blob
     → DriveApp.getFolderById() 上傳至指定資料夾
     → 檔案 ID 寫入 Google Sheets (格式: "ID1;ID2;...")
```

### SignaturePad 設定

```javascript
new SignaturePad(canvas, {
  backgroundColor: 'rgba(255, 255, 255, 0)',  // 透明背景
  penColor: 'rgb(0, 0, 0)',                   // 黑色筆跡
  minWidth: 2,                                 // 最小筆寬
  maxWidth: 6,                                 // 最大筆寬
});
```

### 主要 API

| 方法 | 說明 |
|------|------|
| `smObject.toDataURL('image/png')` | 取得 PNG 格式 Base64 |
| `smObject.clear()` | 清除簽名 |
| `smObject.isEmpty()` | 檢查是否為空 |
| `smObject.addEventListener('endStroke', fn)` | 監聽繪製結束事件 |

### 裝置旋轉處理

```
監聽 deviceorientation 事件
  → 偵測 screen.width 變化
  → 清除現有簽名 (避免破圖)
  → 重新計算 canvas 尺寸
  → 重建 SignaturePad 實例
```

### 相關程式碼位置

| 檔案 | 說明 |
|------|------|
| src/composables/useSignatures.js | SignaturePad 初始化、calculateSignatureRatio()、clearSignature()、deviceorientation 旋轉重建（簽名板全部邏輯） |
| src/App.vue | authMod() 進入簽名流程、endSignature() 驗證、sendMod() 以 collectSignatures() 取得 PNG dataURL |
| src/Code.js | 後端簽名上傳處理（writeRecord 內） |

## 遠端多方簽名邀請機制（2026-07 Phase 4）

簽名者分散兩地時，填寫者可對任一簽名格發 email 邀請；受邀者以 token 進入
read-only 問卷、只簽自己那格（簽名即時存 Drive），填寫者回來檢查後才能正式送出。
功能與線上暫存綁定：未設定 `draftSheetID` 則整個隱藏。

### 兩種進入方式（權限分流）

- **填寫者**：帳號密碼（或 Gmail）登入 → 完整填寫流程；簽名步驟中每格可發邀請
- **受邀簽名者**：邀請信的 `?token=xxx` 連結（doGet regex 白名單驗證後注入
  `window.__SM_INVITE_TOKEN__`）或首屏「我有簽名的驗證碼」手動貼上 →
  `inviteeLogin(token)` 換發 session JWT → 只能檢視唯讀問卷 + 簽自己那格，
  session token 帶 `invite` claim，被 `authByToken_` 一律拒絕（不能冒充填寫者）

### `_invites` 分頁（存於 draftSheetID 試算表）

一格一列（active row）模型：upsert key =（referSSID, 主鍵值, 簽名格名稱）。
欄位 A-K：token（64 字元 hex）、referSSID、recordSSID、primaryValue、signName、
email、expireAt(ms, = min(發出後7天, dueDate))、status（pending/signed；expired 為
讀取時衍生不落地）、fileID、createdAt、updatedAt。

### 狀態機

```
[未邀請] ──發邀請──────────────→ [授權中] ──受邀者簽完──→ [已簽名]
[授權中] ──重發授權信──────────→ [授權中]（同 email，新 token，舊的失效）
[授權中] ──更換簽名者Email───→ [授權中]（新 email，新 token，舊的失效）
[授權中] ──撤回授權，在這個裝置簽名──→ [未邀請]（token 立即失效）
[已簽名] ──撤回（二段確認 force）──→ [未邀請]（簽名檔進垃圾桶）
```

### RPC

| RPC | 憑證 | 說明 |
|------|------|------|
| `sendInvite(refer, record, token, signName, email)` | 填寫者 JWT | 發=重發=換email 同一支（同列 upsert 新 token）；先強制 `saveDraftForInvite` 上雲 |
| `revokeInvite(refer, record, token, signName, force)` | 填寫者 JWT | 見 signed 且 !force 不刪、回最新狀態讓前端二段確認 |
| `listInvites(refer, record, token)` | 填寫者 JWT | 各格狀態；signed 附 base64 內嵌簽名圖 |
| `inviteeLogin(token)` | 邀請 token | 驗證通過簽發受邀者 session JWT（exp = min(1hr, 邀請到期, dueDate)）+ read-only headers（已送出紀錄疊線上暫存草稿） |
| `submitInviteSignature(sessionToken, blob)` | 受邀者 session JWT | Lock 內以 claims.invite 重查列後才收簽名（≤2MB PNG） |
| `renewToken(refer, record, token)` | 兩者共用 | 受邀者路徑續約前重讀邀請列，exp 同樣被封頂 |

### 競態防線（皆有單元測試覆蓋）

1. **撤回 vs 受邀者送出**：兩支 RPC 的寫入路徑都在 ScriptLock 內重讀列後才動作
2. **誤撤剛簽好的**：revoke 預設 force=false，伺服器見 signed 拒絕並回含內嵌圖的最新狀態
3. **填寫者送出 vs 受邀者同時簽**：writeRecord 送出當下以 `resolveSignatureSources_`
   重讀 invites——pending 整筆擋下、剛轉 signed 直接採用列上 fileID
4. **偽造 fileID**：前端沒有傳 fileID 的通道，resolver 只認 `_invites` 列；
   簽名圖內嵌一律走 `signatureDataUrl_`（私有函數，絕不做成收 fileID 的 RPC）

送出成功後該使用者的全部邀請列會在 Lock 內清除（token 用畢即焚）。

## 檔案結構

> 2026-07 Phase 3 拆分：App.vue 由 2600+ 行 Options API 轉為 `<script setup>` + composables。
> vite-plugin-singlefile 仍打包成單一 index.html，執行架構（SPA、GAS 往返次數）不變。

```
sheet-machine/
├── src/
│   ├── App.vue                    # 主元件（script setup）：狀態編排、對話框流程、GAS 呼叫
│   ├── components/
│   │   ├── FormField.vue          # 單一問卷欄位（各 format 的輸入元件 + 驗證顯示）
│   │   ├── ErrorAlert.vue         # 統一的錯誤提示 alert
│   │   ├── MultiSelectDrawer.vue  # 多選欄位的卡片式 transfer（手機適配）
│   │   ├── FileUploadDrawer.vue   # 檔案上傳 drawer（自打 saveFile RPC）
│   │   ├── TempTransferDrawers.vue # 匯出/匯入暫存檔 drawer
│   │   ├── StatDialog.vue         # 填答率統計
│   │   ├── LatestDialog.vue       # 最後填寫者查詢
│   │   ├── JwtCountdownBar.vue    # 登入時效倒數條（fixed 頂端、<50% 點擊續約）
│   │   └── InviteeSignDialog.vue  # 受邀簽名者完整流程（read-only 問卷 + 單格簽名）
│   ├── composables/
│   │   ├── useCrypto.js           # 匯出檔 AES-256-GCM 加解密（smv2 + 舊格式相容）
│   │   ├── useGasRpc.js           # google.script.run 的 Promise 包裝（gasRun/plainClone）
│   │   ├── useDraft.js            # 線上暫存：save/load/delete + saveDraftForInvite
│   │   ├── useInvites.js          # 簽名邀請：狀態查詢、發/重發/換email、撤回（含二段確認）
│   │   ├── useJwtSession.js       # JWT 倒數 tick + 手動續約守衛
│   │   ├── useSteps.js            # 頂部步驟條狀態機
│   │   └── useSignatures.js       # 簽名板：SignaturePad 管理、比例檢查、旋轉重建
│   ├── utils/
│   │   ├── columnRules.js         # 欄位規則純函數：formatDetector、驗證、提示文字
│   │   ├── columnPrep.js          # 登入後欄位整理（App.vue 與 InviteeSignDialog 共用）
│   │   ├── tempQueue.js           # 暫存 queue 純邏輯：組裝、有效性判斷、還原
│   │   ├── tempStorage.js         # localStorage 暫存存取層
│   │   ├── multiSelect.js         # 多選已選區排序純函數
│   │   ├── formatters.js          # dateConverter / downloadCSV
│   │   ├── jwt.js                 # 前端 JWT 解碼（僅供 UI 倒數，不驗簽）
│   │   └── markdown.js            # marked + DOMPurify（HTMLConverter）
│   ├── theme/colors.config.js     # 主題配色單一來源（改色只改這裡）
│   ├── styles/                    # _theme.scss 手寫層（_theme-generated.scss 為建置時生成）
│   ├── Code.js                    # Google Apps Script 後端
│   ├── index.js                   # Vue 進入點
│   └── style.scss                 # 樣式入口
├── tests/                         # Vitest 單元測試（純函數 + Code.js 以 stub 全域載入）
├── tools/                         # 管理者手動工具（不隨 clasp 部署，見 tools/README.md）
├── appscript/                     # clasp 部署目錄
│   ├── Code.js                    # 複製自 src/
│   ├── index.html                 # 建置後複製自 dist/
│   └── appsscript.json            # GAS 設定（含 LodashGS 函式庫、webapp 存取設定）
├── dist/                          # Vite 建置輸出
├── vite.config.js                 # Vite 設定 (singlefile)
├── vitest.config.js               # Vitest 設定
├── eslint.config.js               # ESLint flat config（Vue 前端 / GAS 後端 / Node 測試）
├── package.json                   # npm 設定
└── .clasp.json                    # clasp 設定
```

## 開發與部署流程

```bash
npm run lint           # ESLint（含 vue/no-undef-properties 模板綁定檢查）
npm test               # Vitest 單元測試
npm run build          # Vite 建置
npm run gpush          # 複製檔案 + clasp push
```

## 安全考量

1. **身分驗證**: 使用 P 類型欄位 + A 類型欄位進行多重驗證
2. **Google 帳號**: 支援 G 格式直接使用 Google 帳號驗證
3. **登入 JWT**: 驗證通過後簽發 1 小時 HS256 token，特權 RPC 只帶 token、
   個資欄位值不再重傳；主鍵值一律由伺服器端判定
4. **匯出加密**: AES-256-GCM 加密，金鑰 = 主鍵值 + 使用者密碼
5. **跨裝置匯入**: 需相同主鍵值 + 正確密碼才能解密
6. **簽名邀請**: 邀請 token 為 64 字元 hex（doGet 注入走 regex 白名單 +
   JSON.stringify 雙保險）；受邀者 session JWT 帶 invite claim、不能打填寫者側 RPC；
   簽名送出與撤回都在 ScriptLock 內重讀 `_invites` 列；簽名圖讀取只走伺服器端
   查出的 fileID（無任意檔案讀取面）
