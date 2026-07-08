# Sheet Machine 待辦事項

## 待處理

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
