# 已知的坑與刻意設計

改到相關區域前先看這份清單：這裡記的都是「看起來像 bug 或看起來該重構，
其實是踩過坑之後的刻意安排」。要推翻任何一條，先跟維護者討論，不要直接修。

## 送出鈕的驗證時機：只看 status，不做即時檢測

- **現象**：問卷剛打開、必填全空時，送出鈕是亮的；按一下才全部標紅、按鈕才 disable。
- **原因**：Element Plus 給不了可靠的即時驗證時機——el-input 系（I/M/N/T/E/P/X）的
  `change` 要 blur/Enter 才觸發，打字途中 status 不會更新；檔案上傳（F）與郵遞區號
  自動填入的值是程式直接塞進 `column.value`、根本不走 change。任何對 value 的即時
  disable 都會在這些題型上出現按鈕狀態與畫面對不上的情況。
- **正確流程**：按一次送出 → `authMod` 預檢對全部欄位跑 `valField` 全標紅 →
  ElMessage 報錯誤數量＋自動捲到第一個錯誤欄位 → `checkData()` 轉真、按鈕 disable。
  這個「按下去才指路」的互動是功能，不是漏寫。
- **登入鈕不是反例**：`checkAuth` 有即時空值檢查，是因為認證欄位少且都是純輸入框。
- **踩坑紀錄**：2026-07 曾改成對 value 即時檢測（countBlockingColumns），同日 revert。

## script setup 模板綁定錯誤不會讓建置失敗

- **現象**：模板引用了 script 裡不存在的識別字，`npm run build` 照樣過，
  執行期悄悄變成 undefined（按鈕沒反應、內容空白，console 也未必有錯）。
- **防線**：ESLint 的 `vue/no-undef-properties`。所以改動 `App.vue` / `FormField.vue`
  等元件模板後**務必跑 `npm run lint`**，這是唯一會抓到的地方。

## getQList 對過期問卷清空 signatures / enableModify 是刻意行為

- **位置**：`src/Code.js` 的 getQList（`outofDate[i].signatures = []`）。
- **原因**：過期問卷＝純檢視，前端據此不進簽名流程、SheetCard 也不顯示「簽名 ×n」
  chip。這不是資料遺失，不要「修好」它。

## Code.js 的 📝 emoji 是資料標記，不是 UI 圖示

- 滑桿（L 格式）欄位寫進試算表的值帶 📝 前綴，既有資料相依這個標記。
- 全站清 emoji 換 icon 時（2026-07 做過一輪）這顆**不得移除**；
  `utils/pixelSprites.js` 的像素畫屬遊戲素材，也不在清理範圍。

## 圖示走 FontAwesome CDN（2026-07 起，推翻舊「FA 沒裝」決策）

- **舊決策已作廢**：原本「FA 沒有安裝、圖示唯一來源是 @element-plus/icons-vue」的理由是
  「FA webfont/CDN 與 singlefile 全內聯建置相衝」。實測發現 **vite-plugin-singlefile 不 inline
  遠端 URL、原樣留在 `dist/index.html`**（`index.html` 一直掛著 PapaParse 的 cdnjs `<script>` 為證），
  外部 CDN 在 GAS 沙盒 iframe 執行期可載入，故改用 FA CDN。
- 現況：`index.html` `<head>` 掛 cdnjs FontAwesome 6 `all.min.css`（免費 solid+brands，帶 SRI）；
  模板用 `<i class="fa-solid fa-...">` / `<i class="fa-brands fa-github">`，按鈕內沿用
  `<el-icon>` 外殼包住 FA `<i>` 以保留 element-plus 對齊/間距。`@element-plus/icons-vue` 全域註冊
  已從 `src/index.js` 移除（套件仍為 element-plus 內部相依，其自帶 chrome 圖示不受影響）。
- **CSP 前提**：FA 是 webfont，需 GAS 沙盒 CSP 放行 cdnjs 的 style-src/font-src。已實機驗證可渲染；
  若日後 GAS 收緊 CSP 導致豆腐框 □，備案為 FA 的 SVG+JS 引法或內聯 SVG。
- **視覺混搭**：element-plus 內部 chrome 圖示（drawer 關閉、select 箭頭、表單驗證）仍是 element-plus
  自帶圖示，與我方 FA 圖示並存；兩者皆線性圖示，差異可接受，非 bug。
- 📝 資料標記（Code.js）、pixelSprites 像素畫仍是 emoji/像素例外，維持不動（見本檔上一節）。

## GAS 沙盒 iframe 裡改不了上層網址

- 受邀者 `?token=` 直連進入後要洗掉網址列參數，原生 `history.replaceState`
  在 GAS 的沙盒 iframe 動不了上層網址，必須用 `google.script.history.replace`。

## 群組「不得全空」只有前端在驗，後端沒有這條檢查

- **位置**：`src/utils/columnRules.js` 的 validateColumn 群組分支；`src/Code.js`
  的 writeRecord 只驗每欄各自的格式，**沒有**群組全空／`:U` 重複檢查。
- 竄改過的 client 理論上可送出全空群組。2026-07-11 盤點時確認為現狀，
  要不要在後端補一份是獨立議題，先討論再動；Phase 15 的「哨兵視同空值」
  群組規則因此只實作在前端（後端本來就沒有群組檢查可改）。

## 「不提供資料」是 N 欄位留空的落地哨兵（2026-07-11 改版）

- **位置**：`src/Code.js` writeRecord——`N`（可空）欄位空值送出時，伺服器把
  `data.value` 換成「不提供資料」跳過格式檢查。
- **2026-07-11 改版（同日討論定案）**：(1) 哨兵**原樣落地**進紀錄（原本寫空
  字串），管理端看得出「可空欄位留空」而不是一片空白；(2) 跳過判斷**限縮到
  nullable 欄位**——原本任何欄位（含必填）送這個字串都能跳過格式檢查寫入空值
  （竄改孔），現在非 `N` 欄位送它會走正常格式檢查被擋；(3) readRecord 回填時
  把哨兵轉回空值（`lastInput` 保留原字樣供顯示），前端完全不認識這個字串，
  不要在前端加對它的判斷。
- **舊資料**：改版前的紀錄該欄是空字串，新舊並存——下游解讀時「空字串」與
  「不提供資料」都代表可空欄位留空。
- 與 Phase 15 的「無資料」（`D` 欄位）是兩個哨兵：「無資料」＝使用者主動宣告、
  前端有按鈕、回填時原樣保留（按鈕狀態靠它）；「不提供資料」＝留空的落地形式、
  純伺服器端。

## 三個哨兵各司其職，不要「統一整理」

- **「無資料」**（D 欄位，Phase 15）＝使用者主動宣告，前端有按鈕、**原樣落地**進紀錄、
  回填時原樣保留（按鈕狀態靠它）。
- **「不提供資料」**（N 欄位，見上一節）＝可空欄位留空的**落地形式**，純伺服器端，
  前端完全不認識。
- **`__SM_REUSE_LAST_FILE__`**（檔案欄「沿用上次」，Phase 23）＝**傳輸層指令、絕不落地**：
  前端帶入舊檔時 value 設它（前端沒有傳舊 fileID 的通道），後端 writeRecord 遇到它才從該
  使用者紀錄表最後一列查出真 fileID 替換進 pureData；查無整筆擋下。刻意選機器味字串與前兩個
  中文哨兵視覺分家。常數單一來源 `src/utils/sentinels.js`（前端）＋ Code.js 同字面常數，
  兩邊字面一致由測試鎖（fieldSources.test.js 讀 Code.js 原始碼 assert）。
- 三者語意（使用者宣告／留空落地／傳輸指令）互不相通，看到「好幾個魔法字串好亂」
  想收斂前先來讀這節。

## 檔案欄的 lastInput 是「上次送出的檔案」，前端不得覆寫

- **踩坑紀錄（2026-07-14，Phase 23 實機回報）**：`applyFileUpload` 原本把這次上傳的 URL 直接寫進
  `column.lastInput`（為了顯示「你剛剛上傳的檔案」），於是送出前的 diff 拿新檔當舊檔比——
  「從沒傳過檔的欄位這次傳了」會顯示成前後同一個檔案。
- **正確語意**：`lastInput` ＝ readRecord 給的「上次送出的檔案」（紀錄表最後一列），是 diff 與
  「你上次的」來源的基準值，**前端只讀不寫**；這次上傳的連結一律放 `column.uploadUrl`
  （暫存 queue 的 `url` 欄存的也是它）。`utils/fieldSources.js` 的 `fileUrlOfSource(column, kind)`
  是唯一該用來取「某來源指向哪個檔案」的地方，不要在元件裡自己接 lastInput。
- 同理，受邀者檢視填寫者草稿（InviteeSignDialog）也不再疊進 lastInput，改疊成 `draftOrigin`
  ＋`uploadUrl`（source='draft'）。

## FieldTimeline 桌機拖曳捲軸時小人指標亂飄（2026-07-15 修，第二輪為 log 實證後定案）

- **現象**：桌機用滑鼠拖曳捲軸時，右側 timeline 的像素小人指標會衝到條的最底再彈回中間、
  高速循環亂飄；手機 1:1 慢拖不明顯。
- **第一輪（渲染＋偵測層調整）**：回捲改 `root.scrollTo({ behavior: 'smooth' })`（reduced-motion
  用 `'auto'`）不再瞬移、遲滯加大到 `DOT_GAP*2`（44px）；current 判定改 IntersectionObserver 錨點制
  （對每個 `#formfield-<tid>` 掛 IO，`rootMargin:'-45% 0px -45% 0px'` 只留中間 10% 中線帶、threshold 0，
  交會集合挑中心最接近中線者當 current，空窗 fallback 回 `updateCurrent` 全量掃）。**改完桌機仍亂飄**。
- **實機 console log 實證的最終根因（三件事）**：
  1. **stale rect 顆粒抖動**：`intersecting` Map 存的是 `entry.boundingClientRect` **快照**，pick 時
     集合裡各筆是不同時間（有的幾秒前）存下的 rect，混在一起比距離會選錯 current，穩定下捲時
     currentIndex 也會一次跳 2~5 格再修正。
  2. **大跳是輸入端真跳、治不了**：長問卷 ~10000px、視窗 ~788px → 捲軸滑塊 ~60px，1px ≈ 13px 內容
     ≈ 一題；手抖／Windows 捲軸 snap-back 讓捲動位置單幀瞬移數千 px，currentIndex 跳 ±21 是忠實反映。
  3. **transition 放大成飛行**：`.walker { transition: top 0.2s }` 把每次大跳演成 0.2s 滑過整條軌道的
     動畫，來回大跳＝小人飛來飛去。
- **第二輪解法**：
  - **pick 改 live rect（消顆粒抖動）**：`intersecting` Map 改存 `tid -> 錨點元素`（不存 rect 快照），
    `pickCurrentFromIntersecting` 當場 `getBoundingClientRect` 量測（集合 3~7 個，成本可忽略）。
  - **rAF 統一入口（快速捲動每幀更新）**：新增 `schedulePick()`／`runPick()`，IO 回呼與 scroll 都經此
    節流；`runPick` 依集合是否為空決定走 live pick 或 `updateCurrent` 全量掃（空窗 fallback 保留）。
  - **小步平滑、大跳 snap（消飛行）**：`watch(currentIndex)` 位移 ≤ 2 個點距維持 `transition:top 0.2s`；
    超過就加 `.walker--snap`（`transition:none`）直接瞬移，位置落定後 `nextTick`＋`requestAnimationFrame`
    再移除 class 恢復平滑（watch 為 pre-flush，snap class 與新 walkerTop 同一次 render 套用＝那幀無動畫）。
    `prefers-reduced-motion`（`transition:none`）行為不動。
  - **明確否決**：小人「釘中央」方案使用者已否決——小人必須留在軌道上反映真實進度位置。
- **附帶（fixed 條壓捲軸）**：`@media (pointer: fine)` 桌機把 `right` 加大到 20px 離開全螢幕 drawer
  右緣 ~15px 的原生捲軸帶（避免抓滑塊誤點圓點觸發 goTo），手機維持 6px 不吃版面。

## 第 8 列的 D（可宣告無資料）需要新版後端先部署

- Phase 15（2026-07-11 實作）：`getHeaders` 第 7/8 列改 regex test 並新增
  `noneable`。**部署新版 Code.js 之前不要在對照表單標 `D`**——舊版後端用
  `=== "N"` 精確比對，把既有欄位從 `N` 改成 `ND` 會讓原本的可空行為直接消失
  （電話三擇一的空欄位會開始報格式錯誤）。

## 問卷列表舊「固定ID」欄已整欄刪除，不要復活（2026-07-31）

- **原意**：給 URL 參數直接開指定問卷用的短代號（`export.js` 新增問卷時自動配「現有最大值+1」）。
- **為什麼沒用**：(1) 深連結 `?sheet=` 從頭到尾帶的是 **B 欄 refer**（Drive ID，本身就唯一，
  `Code.js` doGet 注入 `__SM_SHEET_REFER__`、前端 `item.refer === refer` 比對），固定ID 沒參與過；
  (2) 系統實際包在 Google Sites 裡，**根本沒法帶 URL 參數**，這個設計目的已不存在；
  (3) 前端列表項的 `id` 是每次載入現場 `uuidv4()` 產的，也與它無關。
- **退役前最後一個讀取點**：`App.vue` 的 `currentUID` → `tempStorage.migrateLegacyEntry` 的
  `entry.uid` 比對（Phase 20 前的明文 localStorage 搬家）。舊表已退役、無人依賴那批暫存，
  故搬家整段拿掉，只留 **`purgeLegacyEntry(明文主鍵值)`** 無條件清除舊明文條目——
  **清明文個資這件事不能一起砍**（殘留在瀏覽器的是明文個資）。
- **現況**：問卷列表是 **A~O 共 15 欄**，原 O（開放進入）、P（亂數出題）前移成 **N、O**。
  `getQList_` 的 `writeAllowed`/`randomQ` 讀 index 13/14，所有 `listRow[14] === "否"` 這類
  判斷一律改成 13。要新增讀取欄位前先確認你數的是新版欄序。
- **既有試算表的遷移**：`tools/export.js` 的一次性 `dropFixedIdColumn()`（Apps Script 編輯器
  手動跑、ScriptLock、冪等、表頭對不上就停手、刪完回頭核對）。**這是全系統唯一一處
  `deleteColumn`**——禁刪的鐵律是為了「列」（位移會錯位到別人的資料、難復原），這裡動的是
  欄、對象是每個管理者一份的設定表、人工離峰執行、前後可肉眼核對。**不要拿它當以後可以
  刪列/刪欄的先例。**
- **⚠️ 部署順序（會全站中斷）**：遷移工具與新版 `src/Code.js` **必須同時到位**。只做一邊
  欄位索引就錯開一格，後端把「開放進入」讀成別欄的值 → **所有問卷都變成無法登入填寫**
  （不是靜默錯誤，是全站擋人）。流程：挑離峰 → 跑 `dropFixedIdColumn()` → 立刻
  `npm run gpush` + 部署新版 web app → 實測一份問卷能登入。
- **不要**因為看到「有欄位沒人讀」就把它接回去或拿它當識別鍵——要識別問卷一律用 B 欄 refer。

## Loading 遊戲的蹲姿要獨立畫，不要拿站姿砍列（2026-07-31）

- **舊做法**：`drawSprite(..., squashTop)` 蹲下時砍掉站姿頂端 3 列，3D 版則是 `scale.y`
  壓扁。兩種都是**把頭削掉/擠掉**，看起來很怪（使用者回報）。
- **現況**：`pixelSprites.js` 另外匯出 `BOY_DUCK`/`GIRL_DUCK`（12 寬 12 列，正好比站姿
  `STAND_H`=15 矮 3px，維持「站著撞頭、蹲下鑽過藍鵲」的判定不變），頭是完整的、只是壓低
  前傾、大腿/膝/小腿/鞋各一列。`drawSprite` 的 `squashTop` 參數**已移除**，簽名是
  `(ctx, rows, x, y, override)`。3D 也用同一份蹲姿 voxel，不做壓扁。
- 要改角色造型記得**站姿 4 幀＋蹲姿 2 幀＋正面 2 幀**都要有；兩個 timeline 只取側面
  frame 0/1，側面加幀不影響它們。

## Loading 遊戲隨機 2D/3D，three 是唯一動態 import 的 library（2026-07-31）

- `LoadingGame.vue` 每次掛載擲一次骰（`want3d = Math.random() < 0.5`）決定用
  `loadingScene2d.js`（像素）還是 `loadingScene3d.js`（three.js voxel，側面正交鏡頭）。
- **three 走動態 `import('three')`**，不是頂層 import——這是刻意的：其他 CDN library 掛掉
  等於整頁白畫面，而 three 掛掉只會讓這一場 loading 留在 2D（`tryStart3d` catch 住、
  `want3d = false`）。抽中 3D 時也是**先照常跑 2D**，模組到位才切，不會卡住 loading 回饋。
- 兩種 renderer 共用 `loadingArt.js` 的道具/尺寸/`SEGMENT_WIDTHS`，與同一份
  `pixelSprites.js`——3D 直接把像素圖堆成 voxel。**改美術要想到另一種模式**：段寬對不齊
  兩邊校園就會不一樣。
- 3D 的 HUD/記分板是 DOM 疊層（`.loading-game-hud3d`/`.loading-game-board3d`），不畫進
  canvas；它們自帶 `display`，所以樣式裡有一條 `.loading-game-stage [hidden] { display: none !important; }`
  ——拿掉的話隱形疊層會擋住點擊（demo 階段踩過）。
- `loadingScene3d.js` 的 `dispose()` 一定要在 `stopGame()` 叫（走訪 scene 收 geometry/
  material/貼圖 + `renderer.dispose()`）——loading 卡是反覆掛載/卸載的，不收會累積 GPU 資源。

## 匯出的表頭要跟著資料一起重排，不能照抄紀錄表（2026-07-31）

- **踩過的坑**：`tools/export.js` 的 `runExport_` 舊碼把紀錄表前 N 列**原樣貼**成輸出表頭，
  但資料列是 `injectRefer` 重排過的——固定欄的「簽名檔ID」一格被拆成 n 格簽名連結、
  對照表單沒設定的欄整欄丟掉。兩邊排法不同，**簽名格剛好 1 格時巧合對上**（拆 1 格＝原 1 格），
  這就是它一直沒被發現的原因；**2 格以上整排答案往右錯一格**，欄位名與答案都在、只是全對錯人。
- 附帶三個同源問題：少簽一格的列舊碼**往右補空字串**（該補的是中間那格，等於把錯位固定下來）；
  主鍵查不到名冊的列直接 `returnRow = row` 吐紀錄表原始排法，自成一種欄序混在輸出裡；
  `lengthMismatch` 恆為 0，所以連警告都不會亮。
- **現況**：先掃全表取最大簽名格數（`sigCount`），每列補滿（沒簽補 `無簽名`）；表頭走
  `remapHeaderRow_`、資料走 `injectRefer`，兩者共用同一組來源欄索引 `exportDataCols_`。
  輸出欄序固定為 `送出時間／有效／主鍵／分組` → `簽名檔連結1…n` → 題目欄。
- **改這段時**：表頭與資料的欄序**只能有一個來源**。要動 `injectRefer` 推欄的順序，
  `remapHeaderRow_`／`exportDataCols_` 必須同步——它們是刻意配對的，不是重複程式碼。
- 代價（已接受）：新輸出的表頭與 2026-07-31 前的舊輸出檔欄序不同（多簽名欄、固定欄少一格）。
  舊分頁留在原檔案不動，同一份問卷新舊分頁排法會不一樣。
