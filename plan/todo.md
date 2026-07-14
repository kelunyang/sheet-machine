# Sheet Machine 待辦事項

## 待處理

### 24. 每題答案來源切換器（el-segmented）＋左側狀態邊界條＋送出前純文字 diff＋檔案「沿用上次」哨兵＋`_file` 登記表（2026-07-14 設計定案＋實作完成，規格見 plan.md Phase 23）✅

**2026-07-14 實作完成（未部署）**：前端新增 `utils/sentinels.js`（哨兵單一來源）／`fieldSources.js`
（答案來源選項導出、切換即帶入的 per-format 轉換、markUserInput）／`submitDiff.js`（diff 文字組裝、
基準取值、零差異判定、檔案對照）；新元件 `FieldValueSwitch`（**el-segmented 四選項：預設值／你上次的／
暫存／你現在填的——切換就自動帶入該來源的值**；沒值的來源不長選項，「你現在填的」在使用者動手前
disabled；使用者一動手 `markUserInput()` 存進 `column.userInput`，切走再切回不弄丟）／`DiffText`
（搬自 scoringSystem-cf 的 RankingComparison，改吃兩段純文字、手機自動切 line-by-line、輸出過
DOMPurify）／`SubmitDiffDrawer`（基準切換也用 el-segmented；footer 兩鈕各半寬比照填問卷 drawer）。
FormField 刪兩行唯讀文字與頂部 el-tag，改左側狀態邊界條（細線＋頂端 FA 狀態圖示、文字走 tooltip；兼題目邊界）＋來源切換器，唯讀展示欄
（C-T/C-F/C-S）改為直接顯示值；App.vue authMod 抽出 `proceedAfterDiff()`、前面插 `hasAnyDiff` 判斷
（零差異自動跳過）。後端 `_file` 純 append 登記表（saveFile 成功後 appendRow，A ms／B refer／
C 上傳者 id 假名／D pos／E fileID／F mime）＋`fileLogHasUpload_` 驗歸屬＋哨兵
`__SM_REUSE_LAST_FILE__` 裁決（`latestRecordRowFor_`／`resolveReuseFileId_`，絕不落地）——
補掉「前端傳任意 fileID 後端不驗」的缺口。diff／diff2html 走 CDN import map（CSS 走 index.html
`<link>`，版號兩處同步）。lint 淨、**396 測試綠**、build 174.1KB；無頭 Chromium 驗證 diff 兩種版面
＋el-segmented 切換帶入行為 ALLPASS。**待實機驗證後部署——先部署後端再換前端**（舊後端會把哨兵當
fileID 原樣落地）。

### 23. sticky 控制列手機可收合：按鈕群摺進 handle、JWT 條留著（2026-07-12 設計定案＋實作完成，規格見 plan.md Phase 22）✅

**2026-07-12 實作完成（待實機驗證後部署）**：手機直式時 FormToolbar／SignatureToolbar 的按鈕區太高、
往下填題/簽名擋畫面。學 `scoringSystem-cf` ProjectDetail 抽屜的「收合成 handle」（**不學 matter.js 物理**）：
新元件 `CollapsibleControls.vue` 包住兩條 toolbar 的按鈕群——手機（≤768px，`matchMedia`）往下捲
（`scrollTop` 遞增且 >32px）自動收合成 handle（「更多功能請點此」）、點 handle 手動展開；
**JWT 倒數條留在外層永遠可見**（只收按鈕群）。收合用 `grid-template-rows 1fr↔0fr` 手風琴；
`active` prop 防空殼長 handle（viewOnly 無鈕時 passthrough）；桌機/平板 `collapsible=false` 原樣顯示。
lint 淨、298 測試綠、build 158KB；無頭 Chromium 實測手機 ALLPASS（捲動收合 56→0、點展開 0→56）、
桌機 handle 隱藏不收合。

### 22. 登入防枚舉：CacheService 即時防線＋`_logins` 稽核日誌（2026-07-12 設計定案＋實作完成，規格見 plan.md Phase 21）✅

**2026-07-12 實作完成（未部署）**：後端 `src/Code.js` 新增即時防線＋稽核＋掃描三層：
`loginPseudonym_`（`draftKey_` 過 `deriveDraftKey_` purpose='log'，沿用 Phase 20 派生基礎）；
`checkLoginThrottle_`/`recordLoginAttempt_`（CacheService：per-假名連錯達 `loginFailMax`（5）冷卻
`loginCooldownMinutes`（5）、成功清零；per-refer 窗口失敗過 `scanAlertThreshold`（30）寄該問卷 M 欄管理者、
`scanAlertCooldownMinutes`（60）節流）；`appendLoginLog_`/`_logins` 分頁（純 append、A ms／B refer／C 假名／
D 成功失敗、表頭凍結、draftSheetID 未設則靜默不記、cache 防線照常）；`readRecord_` 開頭 check 被擋回
`{throttled, cooldownSeconds}`（一致化不洩漏存在性）、驗證後 record（success=authRecord 結果）。
定時掃描 `scanLoginLog()`（管理者手動掛觸發器、程式不自建）：`loginScanCursor` 游標增量、`tryLock` 防重疊、
純函數 `analyzeLoginRows_`/`flagLoginAnomalies_` 三規則（失敗總數 `loginScanFailThreshold`（20）／相異假名數
`loginScanDistinctThreshold`（10）／同假名連錯≥3後成功＝疑似撞中），寄 `securityAlertEmail`（未設 fallback
觸發器擁有者 `getEffectiveUser`）、乾淨批次靜默、游標只前進。前端 App.vue `loginView` 處理 throttled 分支、
`startLoginCooldown` 逐秒倒數（沿用 invite cooldown 模式）顯示一致化訊息，前端不做限流判斷（純顯示）。
測試：新開 tests/loginThrottle.test.js（20 測試，fake cache TTL+可控時鐘、MailApp、LockService tryLock、
_logins、名冊、refer P 欄——連錯鎖定/期滿解除/成功清零/常數可調、_logins 純 append 存假名、橫向警報節流、
掃描三規則邊界＋游標增量＋不重複告警＋tryLock 失敗 return＋收件人 fallback＋乾淨批次不寄信、readRecord_
被擋早退＋失敗記稽核）；inviteRpc loader 補 CacheService stub。345 測試綠、lint 淨、build 159.8KB。
**待端對端實機驗證**（plan.md Phase 21 清單）＋管理者掛 `scanLoginLog()` 時間觸發器＋選用 ScriptProperties
（`securityAlertEmail` 等，皆有預設）後部署。**跨 Phase 相依**：`getDraftEncSecret_`/`deriveDraftKey_` Phase 20
已建、本 Phase 直接沿用（purpose='log'）。

### 21. 暫存內容端到端加密：per-(問卷×用戶) HMAC 派生金鑰（2026-07-12 設計收斂定案＋實作完成，規格見 plan.md Phase 20）✅

**2026-07-12 實作完成（未部署）**：後端 `getDraftEncSecret_`（ScriptProperties 自動生成，與 jwtSecret
分離）＋`deriveDraftKey_(purpose, referSSID, pkey)`（base64url HMAC，purpose=id/enc/log 做 key
separation，log 給 Phase 21 沿用）；`readRecord_` 隨 token 回 `draftKeys:{id,enc}`；`saveDraft` A 欄改落
id 假名（後端自算不信前端）、`encodeDraftPayload_`/`decodeDraftPayload_` 對 `smd1:` 原樣直通（不重壓，
`gz:` 分支留防呆）；`buildReadonlyHeaders_` 不再疊草稿，`inviteeLogin` 改回密文 blob＋後端重算的填寫者
enc key（無草稿不外流 key）。前端新增 `utils/draftCipher.js`（sealDraft/openDraft：CompressionStream
gzip→`smd1:g:`、不可用走 `smd1:r:`，內層沿用 useCrypto smv2）；`tempStorage.js` 全面改寫（key=假名、
value=密文、每問卷×人一條目、寫入鏈序列化、`migrateLegacyEntry` 一次性搬家清明文——舊 key 內其他問卷
條目隨鍵清除是刻意取捨）；App.vue 持 `draftKeys` 記憶體 ref；useDraft 上傳前 seal／還原時 open；
匯出匯入金鑰改「id 假名＋密碼」＋舊檔 fallback（主鍵值＋密碼）；InviteeSignDialog 前端解密疊草稿。
測試：inviteRpc 擴充（派生鍵穩定性/分離、saveDraft 假名＋不重壓、loadDraft 假名定位、readRecord
draftKeys、inviteeLogin 密文含無草稿不外流）＋新開 draftCipher.test.js（g/r roundtrip、錯 key/壞前綴/
截斷）＋tempStorage.test.js（roundtrip、搬家冪等/不覆蓋/壞 JSON、匯出檔新舊金鑰）；draftRebuild 門檻
fixture 隨 DRAFT_HEADER 文案更新調整（舊亂數分頁表頭列改計為資料，保守方向）。325 測試綠、lint 淨、
build 159KB。**待實機驗證**（plan.md Phase 20 端對端清單：假名 key＋密文、跨裝置、受邀者疊層、舊明文
搬家、iPad OS 13 r 路徑）後部署；`draftEncSecret` 輪替＝暫存全部歸零（plan.md 注意點）。

原定案摘要：接續 Phase 5（JWT，登入個資不留前端）的下一步——保護**暫存內容**：
原況 localStorage 是「明文主鍵值當 key＋明文答案 JSON」、線上 `_draft` 是「明文主鍵值＋gzip 編碼（非加密）」。
定案機制：後端以 `HMAC(draftEncSecret, [purpose, referSSID, pkey])` **確定性派生兩把 key**（id 假名可落地
當定位鍵、enc 金鑰只留記憶體），登入時隨 JWT 回傳，**無字典不落地、重登重算同一把**；前端 gzip
（CompressionStream，iPad OS13 無則跳過、格式帶旗標）→ AES 加密（沿用 useCrypto）→ localStorage 與
`_draft` 都只落 `smd1:` 密文＋假名 key（暫存表全面去識別化）。受邀者疊草稿改前端解密（後端回密文＋派生
key）；localStorage 舊明文條目登入時一次性搬家清除；record（正式結果）不在範圍（管理者要直接看 sheet）。

### 20. 草稿分頁收斂為單一 `_draft` 分頁：referSSID 降為資料欄（2026-07-11 設計定案＋實作完成，規格見 plan.md Phase 19）✅

**2026-07-11 實作完成（未部署）**：Phase 17 的「一份問卷一個亂數名分頁」退役——實際使用
發現 loadDraft 的建分頁副作用會落地一堆只有表頭的空分頁。改比照 `_invites` 單表模型：
全問卷共用 `_draft` 分頁，4 欄（A 主鍵、B updatedAt、C referSSID、D 起 payload 切塊），
「當前草稿」＝(主鍵, referSSID) 複合鍵最新一列。`draftPayloadByKey_` 改兩段式讀取
（先讀 A:C 定位、命中才單讀該列全寬，不搬全表 payload）且**讀取路徑不再建分頁**；
`compactDraftRows_` 改複合鍵去重；rebuild 分頁分派改按名稱（不做首格嗅探，舊亂數分頁
原樣照抄 fail-safe）。前端/RPC 介面零改動。測試改寫（draftChunks＋draftRebuild，
含跨問卷同主鍵隔離、舊分頁照抄回歸）。全庫 298 測試綠、lint 淨。
**部署前手動刪暫存試算表舊 referSSID 分頁（保留 `_invites`）**；待實機驗證後部署。

### 19. 暫存試算表定期重建＋備份 folder（2026-07-11 設計定案＋實作完成，規格見 plan.md Phase 18）✅

**2026-07-11 實作完成（未部署）**：`src/Code.js` 新增 `rebuildDraftSpreadsheet()`（全程
ScriptLock(30000)：前置檢查 → 門檻 → 建新表逐分頁壓縮 → sanity check → 翻 `draftSheetID`
原子換手 → 舊表改名搬備份夾、新表搬回原資料夾）＋純函數 `compactDraftRows_`（每主鍵最新列、
變長 chunk 補 '' 成矩形）/`compactInviteRows_`（每格最新列原樣快照，零語意判讀）/
`draftRebuildMinRows_`。**函數放 src/Code.js 不放 tools/**（LockService/ScriptProperties
per-project，tools/ 的鎖擋不住 web app 寫入——推翻 Phase 16/17 原註記）；fail-safe：
`draftBackupFolderID` 未設/開不起來不重建、sanity 不過不翻 property（新表留存供人工檢查）、
認不得的分頁原樣複製、預設分頁改暫名防同名相撞。前端文案加「暫存會被系統定期清理，請勿
當作長期保存」（暫存成功訊息＋還原詢問，useDraft.js）。tests/draftRebuild.test.js 新開
（17 測試：壓縮純函數＋重建編排含中止/門檻/sanity 失敗/換手搬移順序/同名防線）。
全庫 302 測試綠、lint 淨、build OK。
**待實機驗證後部署**：手動跑一次（新表建立、換手、舊表進備份夾）、掛 time trigger 離峰跑、
管理者設 ScriptProperties `draftBackupFolderID`（必要）與 `draftRebuildMinRows`（選用）。

### 18. 線上暫存純 append 化：永遠抓最新版＋payload gzip 單格化（2026-07-11 設計定案＋實作完成，規格見 plan.md Phase 17）✅

**2026-07-11 實作完成（未部署）**：草稿分頁翻成純 append 資料日誌（DRAFT_HEADER＋凍結首列
比照 `_invites`）。後端新增純函數 `encodeDraftPayload_`/`decodeDraftPayload_`（gzip+base64、
`gz:` 前綴）、`parseDraftRow_`、`latestDraftRowForKey_`（後列勝出＝superseded）；`draftSheet_`
建分頁補表頭＋凍結；`saveDraft` 改 `appendRow` 快照；`loadDraft`/`draftPayloadByKey_` 讀全表
取最新列 decode（介面不變，`buildReadonlyHeaders_` 零改動）；`deleteDraft` RPC 與 `draftRowIndex_`
整支退役。前端移除 `deleteDraftOnline`（App.vue 送出後呼叫點一併移除）、`checkOnlineDraft`
drawerConfirm 文案加「線上暫存不代表最終結果，正式結果以已送出的紀錄為準」。
tests/draftChunks.test.js 改寫＋擴充（encode/decode roundtrip 含中文、切塊 fallback、
latest/parse 純函數，共 21 測試）；inviteRpc mock 補 draftSheet 表頭 no-op。全庫 285 測試綠、
lint 淨、build OK。**部署前手動刪暫存試算表既有問卷分頁**（舊 upsert 格式，保留 `_invites`）。
**待實機驗證**（換裝置還原、多版 superseded、送出後提示照跳、超大草稿切塊、受邀者 read-only
疊草稿；plan.md Phase 17 端對端清單）後部署。

### 17. `_invites` 純 append 化：deleteRow + setValues 全除（2026-07-11 設計定案＋實作完成，規格見 plan.md Phase 16）✅

**2026-07-11 實作完成（未部署）**：六個寫入點全改 append 快照、兩處 deleteRow 移除改 append
revoked/consumed 終態、reader 走「每格最新列」、superseded 舊碼判失效、listInvites 隱藏終態格；
全庫 deleteRow 歸零（含暫存 deleteDraft 改 clearContent）。測試 273 全綠、lint 淨、build OK。待實機驗證後部署。


使用者定調全系統只支持「一律 append」、失效與否一律程式端過濾判斷（已寫進 CLAUDE.md
Sheets 寫入規範）。`_invites` 從「一格一列就地 upsert」翻成純 append 快照日誌：每個動作
（發／重發／寄 OTP／OTP 錯誤累加／簽名／撤回／消耗）都 appendRow 新快照，永不覆寫/刪列；
當前狀態＝取「每格最新一列」+ timestamp/status 判定。核心：新增 `latestInviteRows_`／
`latestInviteForToken_`（superseded 舊碼判失效是 correctness 重點）、移除 revokeInvite 與
writeRecord 兩處 deleteRow 改 append `revoked`/`consumed` 快照、狀態機補兩終態、
ScriptLock 內「讀最新→append」。成長為刻意取捨，離線壓縮工具另立（不線上 deleteRow）。

**2026-07-11 已先行完成（不在本項）**：email 邀請碼有效期改 ScriptProperties `inviteTtlMinutes`
（分鐘，`inviteTtlMs_`，未設退回預設 7 天），264 測試綠、lint 淨。
**暫存 `deleteDraft` 的 deleteRow**：另在暫存相關對話處理，不在本項。

### 16. 問卷工具第二波：資料夾屬性＋鷹架建卷＋欄位輔助精靈（2026-07-11 設計定案，規格見 2026-summer.md）

**2026-07-11 已實作於 tools/export.js**：ScriptProperties 加 referStorage／
recordStorage／webAppAccount（資料夾共享一次給執行帳號，免逐卷共享）；填入表
建立時自動 protect（不准人工改寫入卷）；「建立新問卷骨架」從零建結構表（8 列
meta＋示範欄＋假名冊）；「欄位輔助精靈」27 種人話題型生成 8 格欄位 EXIF
（過 checkColumn_ 驗證，D 旗標已納入詞彙表），複製直貼（多行貼上自動直排）或
直接寫入下一空欄；「修改問卷內容」開結構表連結＋紀錄警語＋改完跑檢查。
明確不做：網頁式整卷編輯器（Google Sheet 就是編輯器）。
**待人工驗收**：貼上 container-bound 專案實測（node 語法與煙霧測試已過）。

### 15. 「無資料」宣告：nullable 列 D 註記＋一鍵填答按鈕（2026-07-11 設計定案，規格見 plan.md Phase 15）✅

第 8 列詞彙擴充（`''`/`N`/`D`/`ND`，解析改 regex test，向後相容加法）：`D`＝
「無資料」哨兵是合法答案，`M`+`D`＝必答但可宣告無——補掉「內建正則抄一遍加
`|無`」的組合缺口，適用所有格式。雙態按鈕（不用 el-switch）一鍵填「無資料」，
按鈕狀態＝value 衍生；群組檢查中哨兵視同空值（防打穿「不得全空」）。
跳題邏輯／regex 嗅探／重用 `N` 三案均否決（理由見 Phase 15 動機）。

**2026-07-11 實作完成（未部署）**：Code.js（getHeaders regex 解析＋noneable、
writeRecord「無資料」分支）＋columnRules（noneDeclared／群組哨兵視空）＋
FormField（雙態按鈕＋輸入鎖定）＋檢查器 D 詞彙與警告＋測試（259 全綠）。
待人工驗收與部署；**部署前不要在對照表單標 D**（issue.md 有記部署順序）。

### 14. 2026 暑期：對照表單 Schema 檢查器（2026-07-11 方向定案，紀錄見 2026-summer.md）

資料結構凍結（線上格式不動），投資改放邊界防護：在「問卷列表」試算表的
container-bound GAS（輸出主控台那個腳本專案）做上線前 schema 檢查——
type×format 非法組合、content 解析、引用欄位存在性、ID 重複、`#N/A` 殘留、
主鍵唯一、紀錄表錯位預警等。次項目：`compareSheets` 的 splice(0,7) off-by-one
統一、主登入嘗試節流。

**2026-07-11 檢查器＋選單已實作於 tools/export.js**（onOpen「問卷管理」選單：
新增問卷／修改問卷設定／輸出問卷／檢查問卷格式；退役「輸出主控台」分頁與
listSheet 屬性）。修改問卷設定＝點選列開 HtmlService 對話框，截止時間用
datetime-local 日曆選、免手算 timestamp，B/C/N（表ID/固定ID）唯讀，存檔前
比對對照表單ID 防列位移。
**待人工驗收**：貼上 container-bound 專案實測。次項目（off-by-one、登入節流）
仍待做，屬 src/Code.js 改動。

### 13. 問卷列表卡片化＋流程預覽看板串（2026-07-10 設計定案，規格見 plan.md Phase 14）✅

**已實作完成**：lint／測試／build 全綠。SheetCard.vue 取代 sheetsDialog 的 el-table
（sheet-list-table 樣式一併移除）：標題＋tags＋靜態流程看板串「開始(建立日期)→填寫/檢視
→簽名×n(有簽名格才出現)→結束」＋進入按鈕（沿用 viewCheck 語意，viewCheck 自 App.vue 退役）。
看板串走灰＋磚紅（起訖框/箭頭石墨灰、中段 chip 珊瑚紅）、hover 底色淡黃 --sm-alert-bg。
**2026-07-11 右上角提醒退役**：原兩行「可填寫至/可檢視至」色點提醒全移除（與看板串結束
節點語意重複、手機擠），急迫度改由**結束節點日期文字色**表達——方框維持灰、只染下方日期
（充裕灰／剩<10分橘 --sm-warning-on-light／已截止磚紅 --el-color-danger）；結束節點語意
填寫未截止「填寫結束」＋dueDate、已截止改「查看結束」＋viewDate。`sheetStatus` 一併退役。
純函數 utils/sheetFlow.js（buildFlowChips）＋ tests/sheetFlow.test.js（10 測試，含
充裕/快截止/已截止/暫時關閉/不開放/dueDate=0/signatures 缺值退化）；零後端改動。
**待人工驗收**：充裕卡結束灰字、快截止橘字、已截止「查看結束」磚紅字＋整條灰、
有/無簽名格、dueDate=0、手機直式看板串橫捲＋標題不被擠（plan.md Phase 14 端對端清單）。

sheetsDialog 的 el-table 退役改卡片列；每卡一條靜態看板串
「開始(建立日期)→填寫→簽名×n(有簽名格才出現)→結束(dueDate)」——挪用
scoringSystem-cf ProjectCard 的看板串機制但**不要指示物**（不搬 LED/matter.js/小人，
問卷沒有「當前階段」）；chip 組成純函數 utils/sheetFlow.js＋單元測試；
getQList 資料已齊全，零後端改動。

### 12. 進度指示物收斂（2026-07-10 設計定案，規格見 plan.md Phase 13）✅

**已於 2026-07-10 實作完成並部署測試部署 @164**：lint／236 測試／build 全綠。
el-steps 四處全移除＋useSteps.js 刪除＋useSignatures 的 initSignaturePads
onReady 參數退役；填寫 drawer footer 主按鈕改 submitButtonText computed
（有簽名格「完成填寫，前往簽名」/無「送出修改」，與 authMod 分支同吃 allSignNames）；
LifecycleTimeline 加 `quiet` prop（渲染條件 valid && (!quiet || warning/ended)，
補畫第一幀改 watch visible）。
**待人工驗收**：四 drawer 版面、按鈕文案兩態、quiet 浮現時機（plan.md Phase 13 清單）。

el-steps 四處全移除＋useSteps.js 退役（「我在哪」由 drawer-flow-title 承載、
「預告簽名」搬到填寫 drawer footer 主按鈕文案「完成填寫，前往簽名」）；
LifecycleTimeline 加 `quiet` prop——登入 drawer 常駐、填寫 drawer 與受邀者畫面
只在 warning/ended 才浮現；FieldTimeline 與 JwtCountdownBar 保留。

### 11. 問卷生命週期時間軸（2026-07-10 設計定案，規格見 plan.md Phase 12）✅

**已於 2026-07-10 實作完成（未部署）**：lint／236 測試／build 全綠。
後端 `sheetCreatedAt_`（CacheService 快取 21600s、失敗回 0 不拖垮清單）＋getQList
visible 清單附掛 createdAt＋inviteeLogin 回傳補 inviteCreatedAt；前端新元件
LifecycleTimeline（橫向軌道＋側面小人 scale 2＝24×30 沿軌走、1 秒 tick 兼踏步幀、
prefers-reduced-motion 立定）掛登入/填寫 drawer 的 el-steps 下方與 InviteeSignDialog
內容頂部，兩處舊「即將過期」el-alert 移除（`expired` computed 與送出封鎖保留）；
純函數 utils/timeline.js（timelineState/timelinePercent/remainingText）＋
tests/timeline.test.js（19 測試）＋tests/qListCreatedAt.test.js（6 測試，
cache hit 不打 Drive/miss 寫入/失敗回 0）；ESLint gasGlobals 補 CacheService。
**待人工驗收**：小人位置與比例、warning/逾期轉色、受邀者重發後起點不變、
dueDate=0 不渲染、手機直式標籤不重疊（plan.md Phase 12 端對端清單）。

拿掉兩處「問卷即將在 XXXX 秒後過期」el-alert，改為問卷狀態 el-steps 下方的橫向
生命週期時間軸（新元件 LifecycleTimeline）：點線視覺挪用 FieldTimeline 灰/綠/紅語言、
「當前時間」標記用 pixelSprites 側面走路小人沿軌道走（active 慢速踏步、同
playerIsGirl 角色），register-dashboard 只搬 state/percent 邏輯。登入/填寫 drawer 顯示
「問卷建立（B 欄 refer 的 Drive 建立時間，getQList 帶回＋CacheService 快取；
N 欄 sheetID 只是暫存 key 不是 Drive ID，首版誤用已修）→ 問卷結束
（dueDate）」，受邀者畫面顯示「邀請發出（invite.createdAt，inviteeLogin 補回傳）→
邀請到期（expireAt）」；剩 <10 分鐘轉警示色，逾期顯示已無法填寫＋小人立定；
純函數 state/percent 下沉 utils/timeline.js 配單元測試。

### 10. 受邀簽名者 Email OTP 二段驗證（2026-07-10 設計定案，規格見 plan.md Phase 11）✅

**已於 2026-07-10 實作完成（未部署）**：lint／211 測試／build 全綠。
`inviteeLogin` 從「邀請碼即通行」升級為兩段：新 RPC `requestInviteOtp(token)` 寄
6 位數一次性驗證碼到**邀請列登記信箱**（10 分鐘有效、hash 落地、60 秒節流、錯 5 次作廢、
ScriptLock 內讀寫），`inviteeLogin(token, otp)` 驗過才回問卷＋session JWT。
`_invites` 加 L–N 三欄（otpHash/otpExpireAt/otpAttempts，舊列容錯）；
兩步 UI 在首屏「我有簽名邀請碼」drawer 內完成（確認邀請碼 → 遮罩 email＋OTP 輸入＋
重寄倒數；OTP 輸入用自 scoringSystem-cf 移植的 PinCodeInput：一格一碼＋輸入順序數字
popIn 動畫＋手機 RWD，填滿自動送出），OTP 通過才開 InviteeSignDialog（開啟時內容已就緒）；
`?token=` 直連自動寄碼＋
`google.script.history.replace` 洗網址（GAS 沙盒 iframe 改不了上層網址，
不能用原生 history.replaceState）；信件文案名詞統一（64-hex=邀請碼、6 位數=驗證碼）。
前提已備：學校網域 SPF/DKIM/DMARC 三筆 DNS 已於 2026-07-10 上線。
待辦：實機驗證（plan.md Phase 11 端對端清單）後部署。

### 9. FieldTimeline 目前題目 indicator（2026-07-10 設計定案，規格見 plan.md Phase 10）✅

**已於 2026-07-10 實作完成**：lint／211 測試／build 全綠。
新增 `src/utils/pixelSprites.js`（PAL＋側面 BOY/GIRL＋新繪正面 BOY_FRONT/GIRL_FRONT
兩幀＋drawSprite 改收 ctx 純函數），LoadingGame 改 import 共用；FieldTimeline 加
walker canvas（8×10 邏輯像素 scale 2 顯示 16×20、top transition 滑動、
prefers-reduced-motion 關動畫）、current 判定掛 window 捕獲階段 scroll listener
（rAF 節流、濾掉 timeline 自身跟隨捲動）、timeline 內捲時 current 點自動帶回可視範圍。
**待人工驗收**：實機捲動踏步/停止立定、點圓點小人滑到該題、小人不壓相鄰點、
手機直式 42px 寬不壓 FormField 內容、與 loading 遊戲抽到同一角色。

timeline 點線導航加「現在看到哪一題」指示：像素小學生**正面版**（新繪 ~8×10 兩幀，
scale 2 約 16×20、高度小於點距 22px）站在 current 題目的點旁——遊戲是水平捲軸用側面圖，
垂直 timeline 改正面朝使用者；角色沿用 getGameSession().playerIsGirl（與 loading 遊戲
同角色）；捲動時原地踏步動畫、停止立定；PAL/drawSprite/側面＋正面 sprite 抽共用
`src/utils/pixelSprites.js`；current 判定由 FieldTimeline 自掛 drawer body scroll
listener（取最接近視窗中線的錨點）；極簡開關（hideGame）不連動。

### 8. 填問卷 drawer 按鈕收納 + JWT 倒數條 sticky 化（2026-07-10 設計定案，規格見 plan.md Phase 9）✅

**已於 2026-07-10 實作完成**：lint／194 測試／build 全綠。
新元件 FormToolbar（sticky 控制列：JWT 條＋「暫存 ▾」dropdown（線上暫存/匯出/匯入，
匯入自動解鎖修改模式）＋下載上次結果＋編輯/唯讀雙態按鈕）；填問卷 drawer 改真 footer
（送出改 primary 藍、未解鎖/格式錯誤時 disabled＋紅字提示，清除暫存改 danger 紅，
無暫存時檢視完畢改 info 灰）；JwtCountdownBar 去 fixed 改嵌入式，`.drawer-sticky-top`
（_theme.scss）嵌入 sheets/signature/TempTransfer×2/InviteeSign 各 drawer body 頂部。
**迭代 2（2026-07-10 驗收回饋，規格見 plan.md Phase 9 迭代 2）**：sticky 條改升到
全頁 y=0——主流程 btt drawer 全改 `with-header=false`，標題改成 body 內會捲走的
`.drawer-flow-title`（糖果漸層），TempTransfer 的 ✕ 移進標題列；lint／211 測試／build 全綠。
**迭代 3（2026-07-11 驗收回饋，規格見 plan.md Phase 9 迭代 3）**：sticky 條實際停在
y=20——瀏覽器用捲動容器 padding 內縮 sticky 釘住範圍；七個主流程 drawer 加
`body-class="drawer-flow-body"` 把 body padding-top 歸零，headless Chromium 實測
修正後 stuck top = 0；lint／249 測試／build 全綠。
**待人工驗收**：捲動時標題捲走、JWT 條/控制列升到視窗最頂 y=0、dropdown 三項功能、
JWT 警告態點擊續約、手機直式控制列與 footer 排版、TempTransfer ✕ 可關閉、
viewOnly/enableModify/tempFound/draftEnabled 各組合按鈕顯示。

填問卷主 drawer 的 7 顆按鈕＋1 開關收斂：頂部 sticky 控制列（JWT 條＋「暫存 ▾」dropdown＋
下載鈕＋編輯/唯讀雙態按鈕，捲動時升到視窗最頂 y=0）、el-drawer 真 footer
（送出改藍＋清除紅）。JwtCountdownBar 全站改 sticky 嵌入各主 drawer，解決 fixed 遮 header。

### 7. 8-bit Loading Game（2026-07-10 設計定案，規格見 plan.md Phase 8）✅

**已於 2026-07-10 實作完成（含迭代 2，規格見 plan.md Phase 8）**：lint／194 測試／build
全綠，dist 增量約 16.7KB。迭代 2 新增：圖書館＋科學館（天文台圓頂）＋教學樓 C/D 棟重繪、
四種加分物件（書包/射擊隊外套撿到會穿上、氣手槍/天文望遠鏡）、血條式計分
（100 起跳、撞扣 10+x、撿加 10+x、歸零出記分板問再玩一次）、「資料傳輸中」兼事件看板。
App 整合：七個等待點（getQList/readRecord/writeRecord/saveFile/refreshInvites/
sendInvite/compareSheets——後兩個迭代 3 追加；sendInvite 二段確認 drawer 期間先收遊戲卡，
compareSheets 原 toast 移除），
RPC 結束強制凍結給 2 秒看分數再關；遊戲卡下兩個 el-switch 存 localStorage
（「載入完成也不結束遊戲」加班模式、「我不要再看到遊戲了」極簡文字卡＋反悔連結）。
迭代 3 文案：「loading 完成/結束」統一改「載入完成」、移除卡底「陪你跑林口高中」提示列。
demo（`demoloading.html`）已全部同步進 LoadingGame.vue，實機驗收 OK 後可刪 demo＋參考圖。
**待人工驗收**：桌機鍵盤彩蛋、手機觸控手勢、loading 重疊不閃爍、遊戲卡不擋
JwtCountdownBar、兩個開關的記憶與反悔路徑、結算 2 秒與加班模式。

RPC 等待時的載入遊戲：兩個制服小人（隨機分配 user/電腦）在 8-bit 林口高中校園跑步，
跨欄/小黑狗要跳、台灣藍鵲要蹲，WASD/觸控彩蛋操控＋HUD 計分板。原生 canvas 零依賴，
demo 已驗證（`loading-game-demo.html`，sprite 與參數直接搬）。
整合點：LoadingGame.vue + useLoadingGame（計數器式 begin/end），掛 getSheets/
readRecord/writeRecord/inviteeLogin/refreshInvites 五個等待點。

### 6. 配色語意重整 + 全站 drawer 化（2026-07-10 設計定案，規格見 plan.md Phase 7）✅

**已於 2026-07-10 實作完成**：lint／186 測試／build 全綠。
藍=結構（header 漸層）、棕=el-alert info/warning 專用（奶油米底＋深棕字 9.8:1；
success/error 保留語意色）、綠灰=按鈕（4 顆 warning 按鈕併入灰）、紅=送出。
body 改白（SURFACE_COLORS.page → SURFACE_COLORS.alert）、JWT 倒數條石墨灰軌道＋
純白字去 glow（warning 填充改深化棕 5.0:1）、七個 el-dialog 全轉 el-drawer
（主流程 btt 100%／Stat/Latest ttb 60%）、ElMessageBox 5 處換自製 ConfirmDrawer
＋useConfirmDrawer（Promise API 模擬，取消 reject('cancel')，ttb 40%）。
steps／tag 色盤／FieldTimeline／糖果漸層不動。
**待人工驗收**：完整填答流程無 dialog、JWT 條三態白字、alert 四型配色、
⚠️ **iPad 實機簽名板**（drawer 化後 canvas 時序）。

### 5. 主題系統：SCSS 配色架構（參考 scoringSystem-cf，換用校徽色盤）✅

**已於 2026-07-08 完成**：lint／64 個測試／build 全綠，主題變數與漸層均已進 dist。
四層落地：`src/theme/colors.config.js`（單一配色來源 + getTagPalette/getThemeGradient）
→ `vite.config.js` 的 `generateThemeScssPlugin`（buildStart 生成
`src/styles/_theme-generated.scss`，已加入 .gitignore/.prettierignore）
→ 手寫層 `src/styles/_theme.scss`（糖果漸層：dialog/drawer 標題列＋el-steps 底線＋
danger 送出鈕；按鈕 hover 上浮微動效）→ `src/style.scss` 入口依序載入
（index.js 改為在 element-plus css **之後** import，覆寫才吃得到）。

**與計畫的差異**：
1. 校徽綠採「加深」而非配黑字：success = `#008000`（白字 5.1:1），保住 EP 按鈕預設白字
2. danger 選 `#C0392B` 珊瑚紅（白字 5.4:1）；並將 EP 的 `--el-color-error` 家族一併對齊
   danger（el-alert type="error" 吃的是 error 色系不是 danger）
3. warning 蜜桃橘另備深化色 `#A05A20`（`onLight`，對 light-9 底 5.0:1）：EP 淺色 alert 的
   文字色＝語義色本身，蜜桃橘當文字不及格，`.el-alert--warning.is-light` 改吃深化色；
   warning 按鈕文字也覆寫為深棕 `#4A2B12`（7.1:1）
4. 「模板零改動」有一處例外：el-tag 的 `color` prop 只設底色，文字色需補 style 綁定，
   問卷列表 tag 模板微調為 `tag.color.{background,text}` 物件
5. EP 變數覆寫是整組色階：插件按 theme-chalk 公式（light-N = mix(白, 主色, N×10%)、
   dark-2 = mix(黑, 主色, 20%)）生成 light-3/5/7/8/9 與 dark-2，hover/plain/disabled 才會跟著換

**待人工驗收**：`npm run dev` 或部署 @HEAD 後人工檢視配色（奶油米底、深藍標題列漸層、
tag 循環色、warning/danger 按鈕），實機驗證後再部署（比照慣例）。

**原計畫內容**：讓版面配色活潑一些。架構完全照搬
`/mnt/f/Development/scoringSystem-gas/scoringSystem-cf` 前端的主題系統，只切換配色。

**參考架構（scoringSystem-cf 的四層，已研究過 2026-07-08）**：
1. **單一配色來源** `colors.config`：每組色含 `background`/`text`/`hover`/`contrast`
   （WCAG 對比度實測值）/`gradient`（糖果漸層起迄色），並附 getter 讓 JS 元件取同一套色
2. **Vite 插件生成**（`generateThemeScssPlugin`，見該專案 `vite.config.ts`）：buildStart 時
   讀 config 生成 `_theme-generated.scss`（`:root` CSS 變數 + SCSS 變數別名），改色只改 config
3. **手寫樣式層**吃 CSS 變數：`_stage-gradients.scss`（邊緣融合糖果漸層：邊框色→亮色→深色→
   邊框色）、`_buttons.scss`（hover 上浮 1px + 陰影微動效）
4. **entry 依序全域載入**，主題變數排第一

**sheet-machine 對應設計**：
- [ ] 加 `sass` devDependency；`src/style.css` 改 `src/style.scss`（singlefile 打包不受影響）
- [ ] `src/theme/colors.config.js`（純 JS 版 config，本專案非 TS、非 monorepo）
- [ ] Vite 插件邏輯搬進 `vite.config.js`，生成 `src/styles/_theme-generated.scss`
- [ ] **關鍵差異**：本專案按鈕全是 Element Plus `type="primary/success/..."`，不引入自訂
      `.btn-*` class——改由生成的主題**覆寫 Element Plus CSS 變數**（`--el-color-primary`、
      `--el-color-success` 等），el-button/el-alert/el-tag/el-steps 一次換色，模板零改動
- [ ] 糖果漸層樣式層：落點為 dialog/drawer 標題列、el-steps 步驟條、送出按鈕等視覺重點
- [ ] 問卷列表 tag 改從主題色盤循環取色，移除 `randomcolor` 依賴

**色盤（基於 `像素化的學校logo.svg` + 補色，2026-07-08 定案）**：
- 校徽三色：`#020180` 深藍、`#00A000` 綠、`#FFFFFF` 白
- 補色三色：`#EAB88F` 蜜桃橘、`#EFE0C8` 奶油米、`#5B5B5D` 石墨灰
- Element Plus 語義色建議對應：primary=深藍、success=綠、warning=蜜桃橘、info=石墨灰、
  danger=色盤沒有紅，另補一個與蜜桃橘協調的珊瑚紅系；`#EFE0C8` 奶油米當頁面底色，
  擺脫全白背景
- **WCAG AA 注意**（照 scoringSystem 慣例每色標實測對比度，≥4.5:1）：
  - `#00A000` 配白字只有約 3.5:1 不合格——配黑字（約 6:1）或加深綠色
  - `#EAB88F`／`#EFE0C8` 是淺色，必須配深色文字
  - `#020180` 配白字、`#5B5B5D` 配白字（約 6.8:1）都合格

**與第 4 項（元件抽取）的關係**：互相獨立，CSS 變數覆寫不依賴元件結構，先後順序皆可。

**驗證**：`npm run build` 後人工檢視 dist 配色；`npm run lint` 照舊。

### 4. 重構：App.vue 元件抽取（不引入 Pinia）✅

**已於 2026-07-08 完成**：App.vue 1709 → 1075 行，lint／64 個測試／build 全綠。
抽出 ErrorAlert、MultiSelectDrawer（含介面改版）、FileUploadDrawer、TempTransferDrawers、
StatDialog、LatestDialog；`dateConverter`/`downloadCSV` 下沉 `src/utils/formatters.js`
（downloadCSV 改收 writeTick 參數）；`selectionMove` 下沉 `src/utils/multiSelect.js`
（moveItems/moveItem/reorderItem + 14 個單元測試）。

**與計畫的差異**：
1. `selectionMove` 下沉時修掉原本 `foundIndexs.sort()` 字典序排序 bug（>10 個選項時
   多選移動會亂序），改數值排序
2. LatestDialog 的查詢結果原本與登入狀態共用同一個 `requestCount` ref，抽出後改為元件
   內部 `queryResult`，不再互相污染
3. `viewStat` 原本會改寫 App 層 `writeTick`（蓋掉登入畫面顯示的寫入時間），統計匯出的
   時間戳改由 StatDialog 內部 `loadTick` 提供
4. 元件自管錯誤落實：StatDialog／LatestDialog／FileUploadDrawer 的 RPC 錯誤顯示在元件內
   ErrorAlert，不再寫 App 的 `scriptError`
5. 多選介面改版直接以 el-drawer + `defineModel('show')` 實作（未沿用 CommentRankingTransfer
   的中央全移按鈕；候選點一下即移入、已選區排名徽章＋↑↓✕＋拖曳、maxNum 上限、搜尋框、
   768px 上下堆疊皆已實作）

**待人工驗收**：手機尺寸 viewport 實測多選的點選／排序／上限／搜尋四個流程；
實機驗證完整填答流程後再部署（比照 Phase 3 慣例）。

**設計討論記錄（2026-07-08）**：
- **不引入 Pinia**：元件樹只有兩層、無路由，`useDraft` 式「ref 依賴注入」已足夠；就算
  抽元件後有共享需求，provide/inject 就能解決
- **RPC 歸屬**：抽出去的元件自己打 `gasRun`（收 sheet/authDB props、emit 結果），與
  useDraft 風格一致
- **錯誤歸屬**：抽出的元件自管錯誤；`scriptError` 留在 App.vue 服務 login/送出流程
- **開關**：drawer/dialog 的 show 用 `defineModel`（Vue 3.5）
- **不動**：LoginDialog、主問卷 columnDialog、SignatureDialog——與步驟條/載入流程/canvas
  時機深度糾纏（SignatureDialog 還有 iPadOS 13 修過的 DOM 時機問題），風險報酬比不划算

**抽取清單（依執行順序）**：
- [x] `src/components/ErrorAlert.vue`：重複的 `<el-alert title="發生錯誤">` 樣板，
      收 `message` prop（最小、立即被後續元件使用）
- [x] `src/utils/multiSelect.js` + `tests/multiSelect.test.js`：`selectionMove` 的置頂/
      置底/上下移純陣列運算下沉為純函數 + 單元測試（index 操作密集最容易藏 bug）
- [x] `src/components/MultiSelectDrawer.vue`：開啟時收 column，關閉時 emit 選好的值，
      App 回寫 columnDB + `valField`；抽取時一併改版介面（見下方「多選介面改版」）
- [x] `src/components/FileUploadDrawer.vue`：自己打 `gasRun('saveFile')`，
      成功 emit `{ columnId, fileID, fileURL }`；`uploadErrors`/上傳中狀態轉元件內部
- [x] `src/components/TempTransferDrawers.vue`：匯出+匯入兩個 drawer + 隱藏 file input；
      App 經 template ref 呼叫 `openExport()`/`openImport()`；匯入成功 emit 更新 `tempFound`
- [x] `src/components/StatDialog.vue`、`src/components/LatestDialog.vue`：收 sheet prop
      自己打 RPC、expose `open()`；App 的 `viewLatest` 改為 delegate 並維持 `defineExpose`
- [x] `dateConverter` / `downloadCSV` 下沉 `src/utils/formatters.js`（`downloadCSV`
      改收 `writeTick` 參數；`Papa` 維持引用 index.html CDN 全域）

**多選介面改版（取代 el-transfer，解決手機板障礙；2026-07-08 定案方案 A）**：

- **問題**：`el-transfer` 兩個固定寬度面板左右並排、checkbox 點擊目標小，手機上幾乎不可用；
  Element Plus 官方多年無 responsive 支援。現有「先勾選已選項、再按全域置頂/上下移按鈕」的
  兩段式排序操作在桌機上也彆扭
- **方案（2026-07-08 更新）**：**移植 scoringSystem-cf 的自製 transfer** ——
  `scoringSystem-cf/packages/frontend/src/components/common/CommentRankingTransfer.vue`
  （855 行）就是現成的 el-transfer 替代品，手機適配已完成：候選卡片點一下即移入、
  已選區排名徽章 + 每列 ↑↓✕ 按鈕、桌面加碼 HTML5 拖曳排序（觸控自動 fallback 到按鈕）、
  `maxSelections` 上限、transition-group 方向動畫、`@media (max-width: 768px)`
  左右並排轉上下堆疊
- **移植時的修改**：
  1. 砍評論專屬功能：MdPreviewWrapper、作者/時間 meta、展開摺疊、同作者唯一性限制、
     EmptyState 依賴（選項是純字串，可瘦掉大半）
  2. **補搜尋框**：它沒做 filter，sheet-machine 現有 `filterable` 需求要加回（選項清單可能很長）
  3. TS 轉純 JS；輸出接回 `;` join 的 `column.value`
  4. 參考同目錄 `DraggableRankingList.vue`（351 行）的純排序清單做法
- **規則保留**：`maxNum` 上限——達上限時候選列 disable 並提示；送出時仍以 `;` join 寫回
  `column.value`，資料格式完全不變
- **與抽取工程的關係**：`selectionMove` 下沉的純函數即每列 ↑↓ 的邏輯基礎（單元素移動是
  現有多元素移動的特例），測試照寫；MultiSelectDrawer 抽出來時直接以新介面實作，
  不再是「先搬移後改版」兩次工

**驗證要求**：
- 每抽完一個元件就跑 `npm run lint`——`vue/no-undef-properties` 是抓「模板引用了被搬走的
  識別字」的唯一防線，建置不會失敗、執行期才悄悄變 undefined
- `npm test`（既有 + 新增 multiSelect 測試）、`npm run build`
- 除多選介面改版外均為純搬移重構，不改任何邏輯；多選題驗收需在手機尺寸
  viewport 實測點選/排序/上限/搜尋四個流程

### 3. 新功能：遠端多方簽名邀請機制 ✅

**已於 2026-07-08 實作完成（未部署）**：詳細規格見 `plan.md` Phase 4、架構說明見
`struct.md`「遠端多方簽名邀請機制」。lint／181 個測試／build 全綠；兩個競態防線
（送出時 Lock 內重查列、撤回不信前端認知）都有單元測試覆蓋（tests/inviteRpc.test.js）。
前置技術修復（簽名圖 base64 內嵌）一併完成。**待實機驗證**（兩台裝置實測完整狀態機、
邀請信收發、`_invites` 分頁自動建立）後再部署。

**動機**：目前簽名流程假設所有簽名者同時同地、輪流用同一台裝置簽完全部；如果簽名者分散在不同
地方（例如學生+家長各自在不同地點），現在完全沒辦法處理——簽名只在最終送出時才轉成 PNG 傳給
後端，中途關掉分頁畫過的簽名就整組不見。

**設計討論記錄（2026-07-08）**：

登入畫面改為兩種模式（制度上的權限分流，不是單純開關）：
- 「我有簽名的驗證碼（我只是簽名者之一）」→ 只能看 read-only 問卷內容 + 簽自己那一格，不能改
  答案，畫面上有 el-alert 提示「如對問卷填答內容有異議，請使用帳號密碼登入後修改」
- 「問卷填寫登入（我是填寫者+簽名者）」→ 原本的完整登入流程

規則：
- 現有 `signatures`（Code.js `getQList_`）完全沒有「哪一格屬於誰」的機制，只是清單分頁 G 欄切出
  的名稱字串（如 `學生;家長`），所以邀請是「每一格」都能由填寫者在簽名步驟當場決定要不要發邀請，
  不是預先綁定身分
- **只有填寫者能送出問卷**；受邀簽名者簽完只會看到「你的簽名已完成，請提醒填寫者回來檢查後送出」
- 每一格簽名獨立走以下狀態機：
  ```
  [未邀請] ──發邀請──────────────→ [授權中] ──受邀者簽完──→ [已簽名]
  [授權中] ──重發授權信──────────→ [授權中]（同 email，新 token，舊的失效）
  [授權中] ──更換簽名者Email───→ [授權中]（新 email，新 token，舊的失效）
  [授權中] ──撤回授權，在這個裝置簽名──→ [未邀請 / 直接進自簽畫面]（token 立即失效）
  ```
- 一旦發出邀請，該格的 `<canvas>` 簽名板從填寫者畫面消失，換成狀態卡片；「已簽名」要載入已簽好
  的圖片預覽（吃下面「前置技術修復」提供的內嵌圖片機制）

**已知技術風險（實作時務必寫測試覆蓋，不能只靠 UI 擋）**：
- [ ] token 有效性不能只在「輸入驗證碼進頁面」時查一次，**簽名送出當下也要重查**——否則填寫者按
      撤回的同時，受邀者可能已經在畫面上準備送出，兩邊會打架，最後不知道哪個簽名算數
- [ ] 「撤回授權」動作本身要先跟伺服器核對目前真實狀態，避免把受邀者剛簽好、填寫者畫面還沒刷新
      的「已簽名」誤判成「授權中」而撤銷掉

**結構性影響**：
- [ ] 問卷答案 + 各簽名格狀態（未邀請 / 授權中含 email 與到期時間 / 已簽名含檔案 ID）必須在**正式
      送出前**就持久化——需要擴充現有線上暫存（Phase 2）機制，不能只存 columnDB
- [ ] 需要新的 token 儲存位置（暫存試算表加分頁，或另開一份），建議欄位：token、referSSID、主鍵值、
      簽名格名稱、email、到期時間、狀態
- [ ] 需要新的後端 RPC：發邀請／重發／換 Email／撤回／驗證碼登入／受邀者送出簽名

**前置技術修復（可獨立先做，也是這個功能的必要基礎建設）**：
- [ ] 簽名圖片改為後端代理內嵌顯示，不再只給 Drive 連結
  - 現況：`Code.js` 的 `file.getUrl()`（`readRecord_` 內）回傳的是 Drive 檢視器頁面網址，不是
    圖片本身，前端只能做成新分頁連結，無法內嵌 `<img>`——這是過去卡住這個功能的主因
  - 修法：後端改用 `file.getBlob()` + `Utilities.base64Encode()` 回傳
    `data:image/png;base64,...`，前端直接 `<img :src>`
  - 走既有 `google.script.run` RPC 通道，不需要更動 Drive 分享權限、不需要新的 OAuth 授權
    （`DriveApp` 現有程式碼已經在用了，`getBlob()` 跟已授權的 `getFileById()` 同一層級）
  - **安全要求**：新函式不能接受前端傳來的任意 file ID，必須跟 `readRecord_` 一樣從已驗證的主鍵
    伺服器端查出該存取哪個檔案，避免變成任意檔案讀取漏洞
  - 用途：填寫者查看自己已簽名結果、未來受邀簽名者查看其他已簽好的簽名，都吃同一支函式

### 1. 更新所有 Library 到最新版本 ✅

已於 2026-07-07 隨 Phase 1 完成（Vite 8 / Vue 3.5 / Element Plus 2.14，npm audit 漏洞 7→0），
詳見 `plan.md`。

## 已完成

### 2. 暫存機制：記住已上傳的檔案 ✅

**實作內容**：
- [x] 在 localStorage 中儲存已上傳檔案的 fileID 和 fileURL
- [x] 頁面重新載入時，自動顯示已上傳的檔案連結
- [x] 匯出/匯入包含檔案資訊（僅 metadata，非檔案本身）
- [x] 跨裝置匯入時，檔案連結仍然有效（因為檔案已存在 Google Drive）

**修改的檔案**：
- `src/App.vue`
  - watch handler: 檔案欄位也存入 tempQueue，格式 `{ id, val: fileID, url: fileURL, isFile: true }`
  - 載入邏輯: 還原 `column.value` 和 `column.lastInput`
  - 匯入邏輯: 處理檔案欄位
  - 匯出 Drawer 說明文字: 更新為包含檔案連結
