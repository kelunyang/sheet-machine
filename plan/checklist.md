# 收尾檢查清單（每次結束前跑一遍）

每次一段開發結束、要交付/部署前，逐項確認以下事項。這份清單是「刻意設計」的一部分，
要推翻任一條先討論（同 plan/issue.md 規矩）。

## 1. footer 版權列

- footer 由 `src/components/AppFooter.vue` **單一元件**渲染；App.vue 內不得再出現硬編碼版權列。
- 格式：`Developer: Kelunyang@LKSH {當年} · by claude since 2026 with ♥ · github`
  - 年份走 `dayjs().format('YYYY')` **自動取當年**——正常情況不必手改；但收尾時仍**目視確認畫面上
    年份正確、無跨年殘留**（例如快取或寫死的舊值）。
  - `since 2026` 是固定起始年，不隨當年變。
  - 愛心＝FontAwesome `fa-solid fa-heart`、github＝`fa-brands fa-github`，github 連結
    （`https://github.com/kelunyang/sheet-machine`）與 Kelunyang 的 mailto 不變。
- 確認 footer 在**問卷列表** drawer 與其它有掛 `<AppFooter />` 的地方都正常顯示。

## 2. 圖示（FontAwesome CDN）

- UI 圖示一律 FontAwesome：模板 `<i class="fa-solid fa-...">` / `<i class="fa-brands fa-github">`，
  按鈕內用 `<el-icon>` 外殼包住 FA `<i>`。**不再引 `@element-plus/icons-vue`**（全域註冊已移除）。
- 新增圖示後，收尾時**實機**確認該圖示是 FA 字符、**不是豆腐框 □**（GAS 沙盒 CSP 若擋 webfont
  會顯示豆腐框——這是 FA CDN 方案的唯一風險，見 plan/issue.md「圖示走 FontAwesome CDN」）。
- 不准在模板/字串放 emoji 當圖示（既有 📝 資料標記、pixelSprites 例外不動）。

## 3. 建置與品質關卡

- `npm run lint`（含 `vue/no-undef-properties`——改過模板一定要跑）。
- `npm test`。
- `npm run build`——順帶確認 `dist/index.html` 內仍保留 FA／PapaParse／diff2html CSS 的外部
  `<link>`/`<script>`（singlefile 不 inline 遠端 URL，掉了代表引用被誤刪），且 import map 內含
  全部 library（vue…、diff、diff2html）。CDN library 換版時 **JS（vite.config.js 的
  CDN_IMPORT_MAP）與 CSS（index.html 的 `<link>`）版號必須同步**：element-plus、diff2html 各一組。
- 部署遵守 memory 的部署原則（測試部署用 `deploy -i` 就地更新，不動其他既有部署）。

## 4. 後端維運工具（部署後手動掛時間觸發器，程式不自建）

- **Phase 18 `rebuildDraftSpreadsheet()`**：離線重建暫存試算表（需設 ScriptProperties
  `draftBackupFolderID`；選用 `draftRebuildMinRows`）。建議離峰。
- **Phase 21 `scanLoginLog()`**：定時掃 `_logins` 稽核日誌偵測撞庫（建議每小時或每日、離峰）。
  選用 ScriptProperties（皆有預設）：`securityAlertEmail`（掃描警報收件人，未設寄觸發器擁有者）、
  `loginFailMax`／`loginCooldownMinutes`／`scanAlertThreshold`／`scanAlertWindowMinutes`／
  `scanAlertCooldownMinutes`／`loginScanFailThreshold`／`loginScanDistinctThreshold`。
  `draftEncSecret`（Phase 20/21 共用 HMAC 派生 secret）首次自動生成，**輪替/遺失＝所有暫存＋登入假名重算**。
- 參數建議值、警報信判讀、大批通知/被鎖等維運場景 → 見 **plan/security.md**（維運手冊）。
