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

### localStorage 暫存結構（Phase 20 假名化＋加密）

```javascript
// Key: id 假名（後端 HMAC 派生的 draftKeys.id，per 問卷×人一條目）
// Value: 'smd1:<g|r>:' + smv2 密文（draftCipher.sealDraft；內容為 queue 陣列）
// 解密後：
[
  { id: "欄位ID", val: "欄位值" },
  // 檔案欄位：{ id, val: fileID, url: fileURL, isFile: true }
]
```

舊結構（key=明文主鍵值、value=明文 `[{uid, queue}]` 陣列、一人一條含多問卷）已退役，
登入時 `migrateLegacyEntry` 一次性搬家並清除明文。

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
  → 逐表附掛 createdAt（問卷結構表 B 欄 refer 的 Drive 建立時間，CacheService
    快取 6 小時，失敗回 0；供前端生命週期時間軸當起點。N 欄 sheetID 只是
    前端暫存 key、不是 Drive ID）
  → 回傳 sheets 陣列
```

**問卷深連結**：`…/exec?sheet=<referSSID>` 可直達指定問卷的登入畫面。doGet 以
regex 白名單（Drive ID 格式）+ `JSON.stringify` 注入 `window.__SM_SHEET_REFER__`
（比照邀請連結 `?token=` 的雙保險），前端載完列表後以 refer 比對消費（一次性）：
命中且開放 → 直接 `openSheet`；未命中或關閉中 → 提示後留在列表。與 `?token=`
同時帶時邀請優先。管理者取得連結：清單分頁 B 欄（refer）串上 exec 網址。

### 2. 身分驗證

```
使用者輸入驗證資訊
  → authDB 更新
  → google.script.run.readRecord()
  → 【Phase 21】checkLoginThrottle_（假名冷卻中 → 回 {throttled, cooldownSeconds} 早退）
  → 後端 authRecord() 驗證
  → 【Phase 21】recordLoginAttempt_（cache 縱向/橫向計數＋_logins append 稽核）
  → 讀取 referSheet 取得欄位定義
  → 讀取使用者已填資料 (savedContent, lastInput)
  → 回傳 headers 陣列
  → 前端填充 columnDB
```

**登入防枚舉（Phase 21）**：主登入無 IP 可用，故只做不誤傷的防護。即時防線走 CacheService
（per-帳號連錯 `loginFailMax`（5）冷卻 `loginCooldownMinutes`（5 分）、成功清零），被擋回一致化
`{throttled, cooldownSeconds}`（前端純顯示倒數、不做限流判斷）；per-refer 窗口失敗過 `scanAlertThreshold`
（30）寄該問卷 M 欄管理者（`scanAlertCooldownMinutes` 節流、只給計數不列帳號），人自行翻 O 欄斷問卷。
稽核走 `_logins` 純 append 日誌（C 欄存**明文真實帳號值**、非假名——稽核價值＝知道是誰，保護靠暫存表
永不分享；cache key 才用 HMAC `deriveDraftKey_` purpose='log' 純 key 衛生；成功失敗都記）。深度分析走
`scanLoginLog()`（管理者手動掛時間觸發器、程式不自建）：游標增量掃 `_logins`、三規則（失敗總數／相異帳號數／
連錯≥3後成功＝疑似撞中）異常寄 `securityAlertEmail`（未設 fallback 觸發器擁有者，信含實際帳號值）。純函數
`analyzeLoginRows_`/`flagLoginAnomalies_` 可 vitest。

### 3. 暫存機制（Phase 20 端到端加密後）

登入成功時 `readRecord` 隨 JWT 回 `draftKeys:{id,enc}`（後端 `deriveDraftKey_` HMAC 確定性派生，
無字典；id 假名可落地當定位鍵、enc 只留前端記憶體 ref）。

```
使用者修改欄位
  → columnDB 變更
  → watch handler 觸發
  → 建立 tempQueue (過濾檔案欄位)
  → tempStorage.saveQueue：draftCipher.sealDraft(queue, enc) 加密（gzip→AES，smd1: 前綴）
  → localStorage[id 假名] = smd1 密文（寫入鏈序列化，落地順序＝觸發順序）
  → 更新 tempFound 狀態
```

登入時 `migrateLegacyEntry` 先把舊版「明文主鍵值 key＋明文 JSON」條目一次性搬進假名 key
並整鍵清除（清明文個資優先），再 `loadQueue` 解密載回。

**線上暫存（`_draft` 分頁，Phase 17 純 append ＋ Phase 19 單表化 ＋ Phase 20 假名化加密）**：
draftSheetID 試算表的單一 `_draft` 分頁供全部問卷共用（referSSID 是資料欄不是分頁名）。
第 1 列人類可讀表頭 `DRAFT_HEADER`（凍結、對 reader 惰性）；資料列 A **id 假名**（後端從
JWT claims 自算，不信前端）、B updatedAt(ms)、C referSSID、D 起 payload（前端加密的
`smd1:` 密文，後端 `encodeDraftPayload_` 原樣直通、零解密需求；`gz:` 分支留防呆；超長切塊）。
每次暫存 appendRow 一筆快照，「當前草稿」＝(假名, referSSID) 複合鍵最新一列（舊版 superseded，
無刪除/消耗概念）；讀取走兩段式（先讀 A:C 定位、命中才單讀該列），且**讀取路徑不建分頁**
（建分頁權只在 saveDraft）。受邀者側：`inviteeLogin` 回草稿密文 blob＋後端重算的填寫者 enc key，
疊草稿在受邀者前端（`InviteeSignDialog` openDraft 後疊進唯讀欄位）。

### 4. 匯出暫存

```
點擊「匯出暫存答案」
  → tempStorage.loadQueue(draftKeys) 解密取出 queue
  → 組合加密金鑰 (id 假名 + 使用者密碼)
  → deriveKey() 產生 AES 金鑰
  → encrypt() 加密資料
  → 下載 .smtemp 檔案
```

### 5. 匯入暫存

```
點擊「匯入暫存答案」
  → 選擇 .smtemp 檔案
  → 輸入密碼
  → decrypt() 解密 (id 假名 + 密碼；失敗 fallback 舊格式：主鍵值 + 密碼)
  → 驗證檔案格式
  → 過濾有效欄位
  → tempStorage.saveQueue 加密存回 localStorage
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
- **受邀簽名者**（Email OTP 二段驗證，2026-07 Phase 11）：邀請信的 `?token=xxx` 連結
  （doGet regex 白名單驗證後注入 `window.__SM_INVITE_TOKEN__`；前端隨即以
  `google.script.history.replace` 洗掉網址列參數，裸邀請碼不進瀏覽器歷史）或首屏
  「我有簽名邀請碼」手動貼上 → `requestInviteOtp(token)` 即時寄 6 位數一次性驗證碼到
  **邀請列登記信箱**（10 分鐘有效、60 秒重寄節流、連錯 5 次作廢；RPC 不收 email 參數）→
  `inviteeLogin(token, otp)` 驗過才回問卷內容並換發 session JWT → 只能檢視唯讀問卷 +
  簽自己那格，session token 帶 `invite` claim，被 `authByToken_` 一律拒絕（不能冒充填寫者）。
  OTP 證明「現在持有登記信箱」：裸邀請碼外流（共用電腦歷史/截圖/信被轉寄）撿到的人
  收不到 OTP 就進不來。名詞統一：64-hex =「邀請碼」、6 位數 =「一次性驗證碼」

### `_invites` 分頁（存於 draftSheetID 試算表）

一格一列（active row）模型：upsert key =（referSSID, 主鍵值, 簽名格名稱）。
欄位 A-K：token（64 字元 hex）、referSSID、recordSSID、primaryValue、signName、
email、expireAt(ms, = min(發出後7天, dueDate))、status（pending/signed；expired 為
讀取時衍生不落地）、fileID、createdAt、updatedAt。
欄位 L-N（OTP 暫時狀態）：otpHash（SHA-256(otp+邀請碼)，列上不存明碼）、
otpExpireAt(ms)、otpAttempts；舊 11 欄列讀到空值一律視為「無有效 OTP」（不搬遷資料），
重發/換 email 時一併清空，比對成功即作廢（單次使用）。

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
| `requestInviteOtp(token)` | 邀請碼 | 驗邀請碼後寄 6 位數 OTP 到邀請列登記信箱（hash 落地、60 秒節流、配額檢查）；回 maskedEmail |
| `inviteeLogin(token, otp)` | 邀請碼 + OTP | ScriptLock 內比對 hash（計次/作廢），通過才簽發受邀者 session JWT（exp = min(1hr, 邀請到期, dueDate)）+ read-only headers（已送出紀錄）＋填寫者草稿密文 blob＋enc 派生鍵（Phase 20：疊草稿在受邀者前端解密後做）；OTP 錯誤回 `{otpFailed}` |
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

## 登入防枚舉（2026-07 Phase 21）

draftSheetID 試算表除 `_draft`／`_invites` 外，Phase 21 再加 `_logins` 稽核分頁（純 append）。

### `_logins` 分頁（存於 draftSheetID 試算表）

純 append 稽核日誌，4 欄：A `timestamp(ms)`、B `referSSID`、C `pseudonym`（HMAC 假名，
`deriveDraftKey_` purpose='log'，明文主鍵值不落地）、D `result`（成功/失敗，兩者都記）。
第 1 列人類可讀表頭 `LOGIN_HEADER`（凍結、對 reader 惰性）；建分頁權只在寫入路徑
（`appendLoginLog_`，draftSheetID 未設則靜默不記）。鐵律照舊：純 append、禁 deleteRow、
ms timestamp、快照零清空；長期成長交離線 `rebuildDraftSpreadsheet()`（對認不得的分頁原樣照抄，
`_logins` 走此 fail-safe，零特判）。

### 三層防護

1. **即時防線（CacheService，熱路徑毫秒級）**：`checkLoginThrottle_`/`recordLoginAttempt_`——
   per-假名連錯 `loginFailMax`（5）冷卻 `loginCooldownMinutes`（5 分）、成功清零；`readRecord_`
   驗證前 check、被擋回一致化 `{throttled, cooldownSeconds}`（不洩漏存在性），驗證後 record。
   check 與 append 之間不上鎖（不在登入尖峰上 ScriptLock）。
2. **橫向即時警報**：per-refer 窗口失敗過 `scanAlertThreshold`（30，TTL＝`scanAlertWindowMinutes`）
   → MailApp 寄該問卷管理者（名冊 M 欄）、`scanAlertCooldownMinutes`（60 分）節流；人自行翻
   O 欄「開放進入」斷問卷（機器只做不會誤傷的事）。**全域自動封鎖明確不做**（無 IP 必誤傷＋變 DoS 按鈕）。
3. **離線深度掃描 `scanLoginLog()`**（管理者手動掛時間觸發器、程式不自建）：`loginScanCursor`
   游標增量掃 `_logins` 新增列（純 append 保證列不位移、只前進）、`tryLock` 防重疊，純函數
   `analyzeLoginRows_`/`flagLoginAnomalies_` 三規則（失敗總數 `loginScanFailThreshold`／相異假名數
   `loginScanDistinctThreshold`／同假名連錯≥3後成功＝疑似撞中）異常寄 `securityAlertEmail`
   （未設 fallback `getEffectiveUser` 觸發器擁有者）、乾淨批次靜默。

**誠實邊界**：cache 驅逐＝計數歸零（防線暫鬆非破口、`_logins` 一筆不漏）；無 IP 下橫向枚舉只能
偵測＋人工斷；針對性鎖人以短冷卻（5 分）封頂；根治靠認證欄位的熵（管理者建名冊時的選擇）。

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
│   │   ├── JwtCountdownBar.vue    # 登入時效倒數條（sticky 嵌入各主 drawer、警告態點擊續約）
│   │   ├── FormToolbar.vue        # 填問卷 drawer 的 sticky 控制列（暫存▾/下載/編輯雙態鈕）
│   │   ├── SignatureToolbar.vue   # 簽名確認 drawer 的 sticky 控制列（下一個/清除/遠端簽名/更新邀請）
│   │   ├── CollapsibleControls.vue # 手機用可收合外殼：包住 toolbar 按鈕群，往下捲收成 handle（Phase 22）
│   │   ├── InviteeSignDialog.vue  # 受邀簽名者完整流程（read-only 問卷 + 單格簽名）
│   │   ├── PinCodeInput.vue       # 一格一碼驗證碼輸入（OTP 6 碼 3-3 分組）
│   │   ├── FieldTimeline.vue      # 右側點線導航（一題一點，點擊捲動）
│   │   ├── SheetCard.vue          # 問卷列表卡片（靜態流程看板串，急迫度靠結束節點日期色）
│   │   ├── LifecycleTimeline.vue  # 問卷/邀請生命週期橫向時間軸（像素小人標當前時間）
│   │   ├── ConfirmDrawer.vue      # ElMessageBox 的 drawer 替代品（單例掛 App.vue）
│   │   ├── LoadingGame.vue        # 8-bit loading 遊戲卡（RPC 等待時浮出）
│   │   └── AppFooter.vue          # 版權列單一來源（dayjs 自動年份、FA 愛心/github 圖示）
│   ├── composables/
│   │   ├── useCrypto.js           # 匯出檔 AES-256-GCM 加解密（smv2 + 舊格式相容）
│   │   ├── useGasRpc.js           # google.script.run 的 Promise 包裝（gasRun/plainClone）
│   │   ├── useDraft.js            # 線上暫存：save/load + saveDraftForInvite（上傳前 sealDraft、還原時 openDraft；deleteDraft 已退役）
│   │   ├── useInvites.js          # 簽名邀請：狀態查詢、發/重發/換email、撤回（含二段確認）
│   │   ├── useJwtSession.js       # JWT 倒數 tick + 手動續約守衛
│   │   ├── useConfirmDrawer.js    # drawerConfirm/drawerPrompt（全站禁用 ElMessageBox）
│   │   ├── useLoadingGame.js      # loading 遊戲單例（計數器式 beginLoading）
│   │   └── useSignatures.js       # 簽名板：SignaturePad 管理、比例檢查、旋轉重建
│   ├── utils/
│   │   ├── columnRules.js         # 欄位規則純函數：formatDetector、驗證、提示文字
│   │   ├── columnPrep.js          # 登入後欄位整理（App.vue 與 InviteeSignDialog 共用）
│   │   ├── tempQueue.js           # 暫存 queue 純邏輯：組裝、有效性判斷、還原
│   │   ├── tempStorage.js         # localStorage 暫存存取層（Phase 20：假名 key＋smd1 密文、一次性搬家）
│   │   ├── draftCipher.js         # 草稿端到端加密（sealDraft/openDraft：gzip→AES，smd1:<g|r>: 前綴）
│   │   ├── multiSelect.js         # 多選已選區排序純函數
│   │   ├── formatters.js          # dateConverter / downloadCSV
│   │   ├── jwt.js                 # 前端 JWT 解碼（僅供 UI 倒數，不驗簽）
│   │   ├── timeline.js            # 生命週期時間軸純函數（四態/百分比/倒數文字）
│   │   ├── sheetFlow.js           # 問卷卡片純函數（看板串組成＋結束節點急迫度日期色）
│   │   ├── pixelSprites.js        # 像素小人素材（LifecycleTimeline 與 LoadingGame 共用）
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

## 前端元件細節

> 2026-07 自 claude.md 搬入：claude.md 只留一行式索引，元件職責與設計決策以這裡為準。

### 彈窗規範（全站零 el-dialog）

主流程彈窗一律 btt 100% drawer、輔助面板 ttb 60%；主流程 btt drawer 一律
`with-header=false` ＋ `body-class="drawer-flow-body"`（body 的 padding-top 歸零——
瀏覽器會用捲動容器 padding 內縮 sticky 釘住範圍，不歸零 sticky 條永遠停在 y=20），
標題改渲染成 body 內第一行 `.drawer-flow-title`（糖果漸層、跟內容捲走），
sticky 條（JwtCountdownBar/FormToolbar）捲動時才能越過標題升到 y=0。
確認/輸入彈窗一律走 useConfirmDrawer 的 drawerConfirm/drawerPrompt，全站禁用 ElMessageBox。

### 元件

- **FormField**：單一問卷欄位，各 format 的輸入元件 + 驗證顯示（就地改寫 column.status/value）。
- **ErrorAlert**：統一的錯誤提示 alert。
- **MultiSelectDrawer**：多選欄位的自製卡片式 transfer（手機適配，已選區可排序）。
- **FileUploadDrawer**：檔案上傳 drawer（自打 saveFile RPC）。
- **TempTransferDrawers**：匯出/匯入暫存檔的兩個 drawer。加密金鑰＝id 假名（draftKeys.id）＋
  使用者密碼（Phase 20）；匯入解密失敗自動 fallback 舊格式金鑰（主鍵值＋密碼）再試一次，
  匯入成功以 tempStorage.saveQueue 加密存回。
- **StatDialog / LatestDialog**：填答率統計、最後填寫者查詢。
- **JwtCountdownBar**：登入時效倒數條，嵌入式元件：各主 drawer body 頂部以
  `.drawer-sticky-top` sticky 釘住，捲動時升到視窗最頂 y=0、警告態點擊續約。
- **FormToolbar**：填問卷 drawer 的 sticky 控制列：JWT 條＋「暫存 ▾」dropdown
  （線上暫存/匯出/匯入，匯入自動解鎖修改模式）＋下載上次結果＋編輯/唯讀雙態按鈕。
  主 drawer 動作按鈕收斂於此與 footer（送出 primary＋清除 danger／檢視完畢 info），
  內容流零按鈕。主流程 el-steps 步驟條已退役（Phase 13）——「我在哪」由
  `.drawer-flow-title` 承載、「後面還有簽名」的預告在 footer 主按鈕文案「完成填寫，前往簽名」。
  按鈕群（JWT 條除外）包在 CollapsibleControls 內，手機可收合（見下）。
- **CollapsibleControls**（Phase 22）：手機用的可收合外殼，`<slot>` 包住 FormToolbar／SignatureToolbar
  的按鈕群那個 `__controls` div（JWT 條留外層、永遠可見）。只在**手機（≤768px，`matchMedia`）**
  啟用：進場展開，往下捲題目/簽名（`scrollTop` 遞增且 >32px，捲動容器＝`rootRef.closest('.el-drawer__body')`）
  自動收合成 handle（「更多功能請點此」），點 handle 手動展開（往上捲不動作）。收合用
  `grid-template-rows 1fr↔0fr` 手風琴（不必量內容高度）；`active` prop（父層據按鈕顯示條件傳，
  FormToolbar `!viewOnly||hasLastSubmit`、SignatureToolbar `signatureCount>0||hasInvites`）為 false
  時退化 passthrough、不長 handle；桌機/平板 `collapsible=false` 原樣顯示、無 handle。
- **SignatureToolbar**：簽名確認 drawer 的 sticky 控制列（比照 FormToolbar）：JWT 條＋
  「下一個簽名（n／m）／清除簽名／遠端簽名」＋「更新邀請狀態」（有邀請卡才出現，全格共用），
  前三顆作用於當前輪播格（簽誰由 body 的警告 alert 說明），本機沒有待簽格也沒邀請時
  只剩 JWT 條。按鈕群同樣包在 CollapsibleControls 內、手機可收合（見上）。
  主行動「送出簽名」與「回去修改」同樣收斂到 drawer footer（.formFooter），
  內容流零動作按鈕——邀請卡的格別操作放在卡片 header 右側（.inviteCardHeader__actions）：
  pending/expired 攤平主行動「重發授權信」＋「更多 ▾」dropdown（更換Email／撤回授權）；
  signed 只有 2 顆（作廢重發／撤回重簽，走 useInvites 的二段確認 force 流程）故都攤平、
  不做單項 dropdown。已簽名格的「撤回」補齊了狀態機「[已簽名] →撤回→ [未邀請]」
  原本只有競態路徑才走得到的 UI 入口。
- **InviteeSignDialog**：受邀簽名者的簽名畫面：邀請碼＋OTP 二段驗證在 App.vue 的
  邀請碼 drawer（ttb）完成，`open(inviteeLogin 回傳值)` 開啟時內容已就緒；
  read-only 問卷 + 單格簽名，自建 useSignatures 實例。填寫者草稿疊層（Phase 20）：
  收 inviteeLogin 回的密文 blob＋enc key，前端 openDraft 解密後疊進唯讀欄位
  （value＋lastInput），解不開退回已送出的 savedContent。
- **PinCodeInput**：一格一碼驗證碼輸入，自 scoringSystem-cf 移植去 TS 化：
  空格逐格 popIn 浮出輸入順序數字、貼上整組自動填、RWD 三段；配色吃 Element Plus
  主題變數，OTP 用 6 碼 3-3 分組 numeric，填滿 @complete 自動送出。
- **FieldTimeline**：右側固定點線導航，一題一點：灰=未填/綠=已填/紅=格式錯，
  點擊捲動到 formfield-&lt;tid&gt; 錨點；自 scoringSystem StageTimeline 移植的無動畫精簡版。
- **SheetCard**：問卷列表卡片，取代舊 el-table（Phase 14）：版面骨架挪用
  scoringSystem-cf ProjectCard——標題＋靜態流程看板串「開始(建立日期)→填寫/檢視→
  簽名×n(有簽名格才出現)→結束」，起訖日期掛在格子外下方。看板串走灰＋磚紅（起訖框/
  箭頭石墨灰、中段 chip 珊瑚紅），hover 底色淡黃（--sm-alert-bg）。右上角提醒已退役
  （2026-07-11）：急迫度改由**結束節點日期文字色**表達——方框維持灰、只染下方日期
  （充裕灰／剩<10分橘 --sm-warning-on-light／已截止磚紅 --el-color-danger）；結束節點
  語意填寫未截止「填寫結束」＋dueDate、已截止改「查看結束」＋viewDate。問卷沒有「當前
  階段」所以不搬 LED/matter.js/小人，開卡算一次不自跑 tick；組成純函數在 utils/sheetFlow.js。
- **LifecycleTimeline**：問卷/邀請生命週期橫向時間軸，取代舊「問卷即將過期」el-alert：
  登入 drawer 常駐顯示「問卷建立（getQList 帶回的 Drive 建立時間）→問卷結束（dueDate）」；
  填寫 drawer 與受邀者畫面（「邀請發出→邀請到期」）走 `quiet` 模式，平時不渲染、
  warning/ended 才浮現。側面像素小人（pixelSprites 12×15、scale 2，與遊戲同素材同角色）
  依時間比例沿軌道走、active 一秒一步踏步標當前時間＋距結束倒數，剩 <10 分鐘轉 warning
  配色、逾期紅字 endedText＋立定；起訖無效（createdAt=0/dueDate=0）整個不渲染；
  四態/百分比/倒數純函數在 utils/timeline.js。
- **ConfirmDrawer**：ElMessageBox 的 drawer 替代品，單例掛 App.vue，狀態在 useConfirmDrawer。
- **LoadingGame**：8-bit loading 遊戲卡：RPC 等待時浮出畫面腰部，兩個制服小人在校園
  跑步跨欄＋WASD/觸控彩蛋；血條式計分 100 起跳、加分物件可穿戴、歸零出記分板、
  「資料傳輸中」兼事件看板；卡下兩個 el-switch 存 localStorage——loading 結束不關遊戲
  （加班模式）/不要再看到遊戲（極簡文字卡）；原生 canvas 零依賴，顏色對映
  colors.config.js，狀態在 useLoadingGame。
- **AppFooter**：版權列單一來源（原 App.vue 兩處硬編碼合一）：`Developer: Kelunyang@LKSH {年}
  · by claude since 2026 with ♥ · github`，年份 `dayjs().format('YYYY')` 自動取當年、跨年不必手改，
  愛心與 github 走 FontAwesome（`fa-solid fa-heart`／`fa-brands fa-github`，github 連結不變），
  沿用全域 `.footerText`/`.cleanLink` 樣式。收尾檢查見 plan/checklist.md。

### composables 細節

- **useCrypto**：匯出檔 AES-256-GCM 加解密（smv2 隨機 salt + 舊格式相容）。
- **useGasRpc**：google.script.run 的 Promise 包裝（gasRun/plainClone）。
- **useDraft**：線上暫存 save/load + saveDraftForInvite（deleteDraft 隨 Phase 17 純 append 化退役）。
  Phase 20 起上傳前 draftCipher.sealDraft 加密（雲端只落 smd1 密文）、還原時 openDraft 解密，
  金鑰對 draftKeys 由 App.vue 注入（登入時隨 token 取得、只留記憶體）。
- **useInvites**：簽名邀請：查狀態/發/重發/換email/撤回；已簽名格不可本機重簽，
  重發＝force 作廢舊簽名請對方重簽，與撤回競態同走二段確認。
- **useSignatures**：簽名板（SignaturePad 管理、比例檢查、旋轉重建）。
- **useJwtSession**：JWT 倒數 tick + 續約守衛。
- **useConfirmDrawer**：drawerConfirm/drawerPrompt：Promise API 模擬 ElMessageBox，
  取消時 reject('cancel')。
- **useLoadingGame**：loading 遊戲單例：計數器式 beginLoading(label) 回傳冪等收尾函數，
  重疊 RPC 不閃爍；RPC 全結束後 settling 2 秒看分數再關，keepPlaying 開啟改進 overtime
  加班模式；兩開關存 localStorage；比賽狀態存 module 層跨顯示延續。

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
4. **匯出加密**: AES-256-GCM 加密，金鑰 = id 假名（draftKeys.id）+ 使用者密碼
   （Phase 20；舊檔 fallback = 主鍵值 + 密碼）
5. **跨裝置匯入**: 需以同一組身分登入同一問卷（取得同一把假名）+ 正確密碼才能解密
5-1. **暫存端到端加密（Phase 20）**: localStorage 與雲端 `_draft` 只落「HMAC id 假名 key ＋
   smd1 密文」；enc 金鑰登入時隨 token 取得、只留記憶體；後端 `draftEncSecret` 與 jwtSecret
   分離（輪替＝暫存全部歸零）；受邀者疊草稿改前端解密。防明文駐留（事後撈取），
   不防即時 XSS；正式送出的 record 不在範圍
6. **簽名邀請**: 邀請碼為 64 字元 hex（doGet 注入走 regex 白名單 +
   JSON.stringify 雙保險）；受邀者登入須過 email OTP 二段驗證（6 位數一次性驗證碼
   寄邀請列登記信箱，列上只存 hash、10 分鐘有效、單次使用、連錯 5 次作廢），
   OTP 通過前不回傳任何問卷內容；受邀者 session JWT 帶 invite claim、不能打填寫者側
   RPC；簽名送出與撤回都在 ScriptLock 內重讀 `_invites` 列；簽名圖讀取只走伺服器端
   查出的 fileID（無任意檔案讀取面）；`?token=` 直連進入後立即洗掉網址列參數
