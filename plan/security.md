# 安全機制總覽與維運手冊

> 這份是**維運視角**的安全文件：機制清單、ScriptProperties 參數建議值、警報信判讀、
> 常見場景的操作步驟（大批通知、帳號被鎖…）。各機制的完整設計規格在 plan/plan.md
> 對應 Phase；改動任何一條防線前先看該 Phase 與 plan/issue.md。
> 最後更新：2026-07-12（Phase 21 實作完成時建立）。

## 1. 安全機制總覽

| 機制 | Phase | 防什麼 | 核心位置 |
|------|-------|--------|----------|
| 登入 JWT（1 小時 token） | 5 | 認證欄位個資重複傳輸／駐留前端 | `signJwt_`/`verifyJwt_`/`authByToken_` |
| 主鍵值伺服器端裁決 | 5 | Gmail 模式竄改 auth 讀別人的紀錄 | `draftKey_`（readRecord 蓋掉前端傳值） |
| 匯出檔 AES-256-GCM | — | 暫存匯出檔離線被開 | `useCrypto.js`（smv2 隨機 salt；金鑰＝id 假名＋密碼，舊檔 fallback 主鍵值＋密碼） |
| 遠端簽名邀請 email OTP | 4/11 | 邀請碼外流被冒用 | `requestInviteOtp`/`inviteeLogin`（hash 落地、10 分有效、錯 5 次作廢、單次使用） |
| 受邀者權限分流 | 4 | 受邀者冒充填寫者 | session JWT 帶 invite claim，`authByToken_` 一律拒絕 |
| 簽名 fileID 伺服器端裁決 | 4 | 任意 Drive 檔案讀取 | `resolveSignatureSources_`/`signatureDataUrl_`（絕不做成收 fileID 的 RPC） |
| 檔案欄 fileID 歸屬驗證 | 23 | 前端塞任意 fileID 進自己的紀錄（含用回條信把他人檔案 URL 寄給自己） | `_file` 登記表＋`fileLogHasUpload_`；沿用舊檔走哨兵 `__SM_REUSE_LAST_FILE__`＋`resolveReuseFileId_`（前端無傳 fileID 的通道） |
| 暫存端到端加密＋全面假名化 | 20 | 暫存內容（localStorage＋`_draft`）明文駐留被事後撈取 | `deriveDraftKey_`（HMAC 派生）＋`draftCipher.js`（smd1 密文） |
| 登入防枚舉 | 21 | 匿名 endpoint 對低熵認證欄位窮舉撞庫 | `checkLoginThrottle_`/`recordLoginAttempt_`/`scanLoginLog()`；`_logins` 存**明文真實帳號**，保護靠暫存表永不分享 |
| v-html 消毒 | — | Markdown 欄位 XSS | `utils/markdown.js`（marked 輸出必過 DOMPurify） |
| doGet 參數注入白名單 | 4/14 | `?token=`/`?sheet=` 注入 | regex 白名單＋JSON.stringify 雙保險 |

## 2. ScriptProperties 參數總表

### 2-1. 機密（自動生成，勿手動設、勿刪、勿改）

| Property | 說明 | 動了會怎樣 |
|----------|------|-----------|
| `jwtSecret` | JWT 簽章密鑰，首次使用自動生成 | 輪替＝所有已發 token 立即失效（使用者重登即可，傷害小） |
| `draftEncSecret` | Phase 20/21 共用 HMAC 派生密鑰，首次使用自動生成 | **輪替/遺失＝所有暫存（雲端＋使用者裝置＋匯出檔）解不開**，視同暫存全部歸零。沒有極端理由不要動。（`_logins` C 欄自 2026-07-12 起存明文真值、不受此影響；secret 現只派生 `_draft`/localStorage 假名與登入 cache key） |

### 2-2. 登入防枚舉（Phase 21，全部有預設、改了即時生效免部署）

⚠️ 共同規則：**只吃正整數**。填 0、負數、非數字＝無效、退回預設——**不是關閉**。

| Property | 預設 | 建議值 | 什麼時候調 |
|----------|------|--------|-----------|
| `securityAlertEmail` | （未設寄觸發器擁有者） | **設成你的信箱** | 唯一建議明確設定的參數 |
| `loginFailMax` | 5 | 5 | 認證欄位很好猜→降到 3；使用者常打錯（長字串認證）→放到 8；**大批簡訊/Email 通知前→暫時調大（如 99999）等於停用鎖定，事後改回** |
| `loginCooldownMinutes` | 5 | 5 | 雙面刃：調長擋窮舉更狠，但被人故意連錯鎖住的受害者等更久。不建議超過 10 |
| `scanAlertThreshold` | 30 | 小問卷 30／大問卷尖峰 60–100 | 10 分鐘窗口內失敗幾次寄警示信（純偵測不擋人）。大批通知前可調高（如 500）避免誤報 |
| `scanAlertWindowMinutes` | 10 | 10 | 一般不動 |
| `scanAlertCooldownMinutes` | 60 | 60 | 同問卷警示信重寄間隔；嫌信多放到 120 |
| `loginScanFailThreshold` | 20 | 每小時掃 20／每日掃 50–100 | 跟 `scanLoginLog()` 觸發器頻率綁定：批次越大閾值要越高 |
| `loginScanDistinctThreshold` | 10 | 10（可降到 5–8 求靈敏） | 相異失敗帳號數＝最可信的橫向掃庫訊號，通常不必調 |

固定值（非 property）：同一帳號**連錯 ≥3 次後成功＝疑似撞中**，寫死在 `LOGIN_SCAN_SUSPECT_RUN`。

### 2-3. 其他安全相關

| Property | 說明 |
|----------|------|
| `inviteTtlMinutes` | 邀請碼有效期（分鐘），未設 7 天；實際到期不會晚於問卷截止 |
| `draftSheetID` | 暫存試算表；未設＝線上暫存/邀請/`_logins` 稽核全部停用（cache 即時防線仍運作） |
| `draftBackupFolderID`／`draftRebuildMinRows` | `rebuildDraftSpreadsheet()` 離線重建用（Phase 18） |

## 3. 三層登入防護怎麼運作（判讀警報信前先懂這個）

1. **per-帳號冷卻（唯一會實際擋人的機制）**：同一帳號連錯 `loginFailMax` 次冷卻
   `loginCooldownMinutes` 分鐘，**期滿自動解除、成功登入清零、各帳號獨立互不牽連**。
   被擋的人看到的是一致化的「嘗試過於頻繁」＋倒數，不洩漏帳號在不在名冊。
2. **per-問卷即時警示（純偵測）**：10 分鐘窗口失敗過 `scanAlertThreshold` → 寄信給**該問卷
   管理者（名冊 M 欄）**，1 小時節流。**機器不封鎖任何人**——要不要斷問卷（翻 O 欄「開放進入」
   改「否」）由人決定。
3. **離線掃描 `scanLoginLog()`（純偵測）**：時間觸發器定期掃 `_logins` 新增列（游標增量），
   三規則命中寄信給**系統管理者（`securityAlertEmail`）**；乾淨批次靜默。掃描信**含實際帳號值**（勿轉發）。

> **`_logins` 存明文真實帳號值（2026-07-12 修訂）**：C 欄存真實登入帳號、不是 HMAC 假名——稽核日誌的價值
> 就在「知道是誰被撞中」，假名化配上「不做查詢工具」等於稽核報廢，且業界慣例是 auth log 存真值＋靠存取控制
> （Linux auth.log／CloudTrail／Okta 皆然）。**保護完全靠「draftSheetID 暫存試算表永不對外分享」**（存取控制是
> 對的地方）。cache key 仍用 HMAC（純 key 衛生、cache 不落表）。對比 `_draft` 的 id 假名是 Phase 20 端到端加密的
> 結構性必需（前端要用同一把派生鍵加解密草稿），維持不動——兩者用途不同。

### 兩種警報信

| 信 | 收件人 | 觸發 | 該做什麼 |
|----|--------|------|----------|
| 【登入異常警示】問卷名 | 該問卷管理者（M 欄） | 窗口內失敗過 `scanAlertThreshold` | 剛大批通知過→多半是誤報、忽略；沒有→疑似掃庫，考慮翻 O 欄暫停＋詳查 `_logins` |
| 【登入日誌掃描異常】 | `securityAlertEmail` | 掃描三規則任一命中 | 有「疑似撞中」→最高優先，聯絡該問卷管理者確認帳號是否遭冒用；只有量大→比照上面判讀 |

兩封信的信尾都附**當前生效的參數值與調整說明**（動態帶入，不用回來翻文件）。

## 4. 維運手冊（runbook）

### 場景 A：要發簡訊/Email 大批通知使用者來填問卷

尖峰期必有人打錯字，可能觸發誤鎖與誤報。**事前（改 ScriptProperties，即時生效）**：

1. `loginFailMax` → 調大（如 `99999`）＝暫停鎖定（記住：填 0 是退回預設不是關閉）。
2. `scanAlertThreshold` → 調高（如 `500`）＝暫停該類警示信（或留著、收到自行忽略——它不擋人）。
3. 事後改回（直接**刪掉**該 property 也行＝回預設）。

不調也不會出大事：最壞就是少數手殘的人被冷卻 5 分鐘＋你多收幾封警示信。

### 場景 B：有使用者反映「被鎖了」

- 冷卻只有 `loginCooldownMinutes`（預設 5 分），**請對方等幾分鐘再試**即自動解除。
- 單一帳號手動解鎖工具**定案不做**（理由與替代路徑見 §6-1）；調大 `loginFailMax` 只能防新鎖，
  已生效的冷卻要等 TTL 跑完（≤5 分）。若誤鎖頻繁，正解是調大 `loginFailMax`。

### 場景 C：收到警報信、判斷真的是攻擊

1. 問卷列表把該問卷 O 欄「開放進入」改「否」（立即斷登入，改回「是」恢復）。
2. 開 draftSheetID 試算表的 `_logins` 分頁看時間分布與帳號（C 欄是**明文真實帳號值**，直接看得出是誰在被打）。
3. 若掃描信列出「疑似撞中」：信中已列出實際帳號值，該帳號的紀錄可能已被冒用讀取，聯絡管理者比對紀錄表。
4. 根治：提高該問卷認證欄位的熵（加一欄不易猜的認證值、或改 Gmail 模式）。

### 場景 D：管理者部署後的一次性設定

1. Apps Script 編輯器掛 `scanLoginLog()` 時間觸發器（建議每小時或每日、離峰）——程式不自建。
2. 設 `securityAlertEmail`。
3. 其餘參數用預設，之後依警報信頻率微調（雜訊多→調高閾值，怕漏→調低）。

### `_logins` 分頁的鐵律

- 純 append、**絕不手動刪列/排序/壓縮**——`loginScanCursor` 游標與列號綁定，動了列位置
  掃描會錯位。`rebuildDraftSpreadsheet()` 對 `_logins` 是原樣照抄（fail-safe），列號不變、安全。
- 若真要清理歷史：離峰手動清空分頁後把 `loginScanCursor` 刪掉（回到 1）重新開始。

### `_file` 分頁的鐵律（Phase 23）

- 純 append 的**上傳登記**（時間／referSSID／上傳者 id 假名／**欄位 ID**（不記位置，插欄會位移）／fileID／mimeType），
  writeRecord 靠它判斷「這個 fileID 真的是這個人在這一欄上傳的」。**絕不手動刪列**——刪掉等於
  讓對應的舊 fileID 送出時被擋（使用者被迫重傳）。`rebuildDraftSpreadsheet()` 對它原樣照抄。
- 只有 metadata、無檔案內容；能開 draftSheetID 的人本來就看得到 `_invites` 的明文主鍵與
  `_logins` 的明文帳號，`_file` 沒有創造新類別的秘密。
- **`draftSheetID` 未設 → 整段驗證跳過**（無登記表可查，維持舊行為＝缺口仍開）。要這條防線就要設
  `draftSheetID`（本來就是線上暫存/邀請的前提）。

## 5. 誠實邊界（防什麼、不防什麼）

- **GAS 拿不到 client IP**，也沒有任何 client 偽造不了的訪客唯一值（指紋/自報 IP 都可偽造，
  評估過、不做）——所以橫向枚舉只能「偵測＋人工斷」，不能自動封鎖（無 IP 必誤傷＋變 DoS 按鈕）。
- cache 驅逐＝計數歸零：防線暫鬆非破口，`_logins` 一筆不漏。
- 針對性鎖人（故意連錯鎖受害者）以短冷卻 5 分封頂，取捨已確認。
- **`_logins` 存明文真實帳號**：保護全靠「draftSheetID 暫存試算表永不對外分享」的存取控制（管理者責任、非
  程式強制）；失敗列存的是**嘗試值**，枚舉者可拿真學號清單來猜、那些真值會進失敗列（本人其實沒登入），
  明文下這點放大、已知並接受。
- 暫存加密**防**明文駐留被事後撈取；**不防**即時 XSS 與 Google 帳號整體淪陷；
  正式送出的 record 明文（管理者要直接看 sheet），保護走試算表分享權限。
- **檔案欄歸屬驗證（Phase 23）防**「前端塞任意 fileID」——但 fileID 外洩本身等不等於檔案內容
  外洩，取決於 `universalStorageID` 資料夾的分享設定（程式從不 `setSharing`，繼承資料夾）。
  資料夾若開了連結分享，fileID 就等於存取權——那是部署層的既有取捨，與 `_file` 無關。
  `_file` 上線前上傳、又不在紀錄表最後一列的 fileID 會被要求重傳（一次性過渡成本）。
- timing side-channel 不處理（GAS 延遲噪音大）。
- **根治枚舉靠認證欄位的熵**：建名冊時多放一欄不易猜的認證值（如自發的隨機碼）、
  或用 Gmail 模式（`format=G`，匿名枚舉直接歸零）。這是管理者的選擇，系統只能拖慢攻擊。

## 6. 候選增補的裁決紀錄

### 6-1. 維運工具三件組——**定案不做**（2026-07-12，與使用者確認）

- **`lookupLoginPseudonym()` 假名查詢——已無必要（moot）**：原本要做這支是為了把 `_logins` 的 HMAC 假名反查回人；
  但同日決定 **`_logins` 直接存明文真實帳號值**（§3 修訂框）後，稽核直接可讀、「疑似撞中」信裡就有實際帳號，
  **不需要查詢工具**，也不再有「去匿名化 oracle」的疑慮。原本「疑似撞中只能定位到問卷、不能定位到人」的損失
  已隨存真值消失。
- **`unlockLogin()` 單帳號解鎖——不做**：冷卻僅 5 分鐘、自癒，「請對方等一下」已足夠；常誤鎖代表該調
  `loginFailMax`，不是該做解鎖工具。技術上可行（`CacheService.remove(已知 key)`），但需求太低。
- **冷卻總開關/epoch——不做**：`loginFailMax` 填大數字（如 99999）即等效停用，已寫進 runbook 場景 A
  **和警報信信尾**，不怕忘。
- 若未來要推翻重做（尤其解鎖），先讀 6-3 的安全模式，不要做成收參數的公開函數。

### 6-2. 仍在候選（未定案）

| 構想 | 內容 | 價值/代價 |
|------|------|-----------|
| Cloudflare Turnstile | 前端 widget、後端 `UrlFetchApp` 打 siteverify 驗 token（server-to-server，偽造不了） | 匿名暴力的標準解；風險：GAS 沙盒 CSP 能否載 widget 需實機驗（同 FA CDN 前例） |
| 名冊熵指引 | 建卷工具（tools/）在認證欄位全是低熵欄時警告管理者 | 根治面；純檢查器加規則 |
| `_logins` 保留期政策 | 定期歸檔舊日誌（配合游標重設流程） | 個資最小化——C 欄現為**明文真實帳號**、直接是個資，保留期政策比假名時更該做（仍靠不分享保護，量大前不急） |

### 6-3. 維運函數的共通安全模式（日後任何維運工具都適用）

- GAS 裡凡是**不帶底線結尾**的頂層函數，匿名網頁都能經 `google.script.run` 呼叫——
  維運函數若直接收參數（如 `unlockLogin(refer, value)`），攻擊者連錯 5 次就自己呼叫解鎖，防線報廢。
- 故一律採：**無參數函數＋參數走 ScriptProperties**（攻擊者設不了 property；編輯器跑函數
  本來也不能帶參數，一箭雙鵰）＋**敏感結果只進 `console.log` 執行紀錄、return 只回泛用狀態字串**。
- 需要 `draftEncSecret` 的工具**只能放 src/Code.js**、不能放 tools/（ScriptProperties per-project，
  tools/ 是問卷列表試算表的另一個專案拿不到；複製 secret 過去＝蔓延，更糟）。

## 7. 相關文件

- 設計規格：plan/plan.md Phase 5（JWT）／4·11（邀請 OTP）／20（暫存加密）／21（防枚舉）
- 架構：plan/struct.md「登入防枚舉」「遠端多方簽名邀請機制」節
- 坑與刻意設計：plan/issue.md；收尾檢查：plan/checklist.md §4（觸發器與參數）
- 資料格式（名冊 M/O 欄語意）：plan/dataformat.md
