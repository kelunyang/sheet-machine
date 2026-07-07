# tools/ — 管理者手動工具（不隨 clasp 部署）

這裡的檔案**不屬於**表單 web app 本體（clasp 只推送 `appscript/`），是管理者視需要手動貼進
Apps Script 編輯器執行的輔助腳本。

| 檔案 | 用途 | 注意事項 |
|------|------|----------|
| `export.js` | 問卷匯出機器人：在「清單試算表」綁定的 Apps Script 中執行，把指定問卷的回答匯出成獨立試算表（可過濾只留每人最新一筆） | ⚠️ 使用的 ScriptProperties 名稱（`listSheet`、`exportStorage`）與 `src/Code.js` 的 `listSheetID` **已分岔**，使用前需自行核對／更新屬性名稱 |
| `fileOutput.js` | 更名機器人：讀取試算表中的 Drive 檔案連結清單，複製檔案到指定資料夾並依 C 欄字串重新命名 | 與表單系統無關的獨立工具 |

> 2026-07 Phase 3 整理：原本放在專案根目錄，容易誤認為系統程式碼，故移入此處。
> 根目錄的 `appsscript.json` 亦於同次整理移除（為過時副本；實際部署設定在 `appscript/appsscript.json`，
> 內含 LodashGS 函式庫與 webapp 存取設定）。
