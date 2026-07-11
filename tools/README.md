# tools/ — 管理者手動工具（不隨 clasp 部署）

這裡的檔案**不屬於**表單 web app 本體（clasp 只推送 `appscript/`），是管理者視需要手動貼進
Apps Script 編輯器執行的輔助腳本。

| 檔案 | 用途 | 注意事項 |
|------|------|----------|
| `export.js` | 「問卷列表」試算表 container-bound GAS 的原始碼（手動貼上該試算表的 Apps Script 專案）。onOpen 建「問卷管理」選單七項：**新增問卷**（貼對照表單 ID → 格式檢查 → 建填入表＋列表新列）、**建立新問卷骨架**（從零建結構表示範欄＋填入表＋列表列）、**欄位輔助精靈**（勾選題型生成 8 格欄位設定「EXIF」，過檢查器驗證後複製直貼或直接寫入）、**修改問卷設定**（點選列開對話框：截止時間 datetime-local 日曆選、布林下拉、四個說明欄有輕量 markdown 編輯器＋預覽；B/C/N 唯讀）、**修改問卷內容**（開結構表連結＋有紀錄警語＋改完跑檢查）、**輸出問卷**（匯出點選列，取代舊「輸出主控台」分頁）、**檢查問卷格式**（完整檢查，規則見 `plan/2026-summer.md`） | ScriptProperties：`exportStorage`（匯出資料夾，必要）＋選填 `referStorage`（結構表資料夾）、`recordStorage`（寫入表資料夾）、`webAppAccount`（web app 執行帳號，供填入表保護編輯者）。**兩個資料夾各共享一次給執行帳號（結構表夾檢視權、寫入表夾編輯權），之後建的表自動繼承，免逐卷共享**。填入表建立時自動 protect（僅擁有者＋webAppAccount 可編輯）。「輸出主控台」分頁可刪、「執行紀錄」分頁必須保留。⚠️ 對話框按鈕（google.script.run）以瀏覽器**預設帳號**執行——多帳號登入時若預設非管理員帳號會 PERMISSION_DENIED，請用只登管理員帳號的視窗（無痕/獨立 profile）操作；onOpen 有 alert 提醒 |
| `fileOutput.js` | 更名機器人：讀取試算表中的 Drive 檔案連結清單，複製檔案到指定資料夾並依 C 欄字串重新命名 | 與表單系統無關的獨立工具 |

> 2026-07 Phase 3 整理：原本放在專案根目錄，容易誤認為系統程式碼，故移入此處。
> 根目錄的 `appsscript.json` 亦於同次整理移除（為過時副本；實際部署設定在 `appscript/appsscript.json`，
> 內含 LodashGS 函式庫與 webapp 存取設定）。
