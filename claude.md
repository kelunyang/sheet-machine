# Sheet Machine - Claude Code 專案指引

## 專案概述

這是一個基於 Google Apps Script + Vue.js 的動態表單系統，使用 Google Sheets 作為後端資料庫。

## 技術棧

- **前端**: Vue 3 + Element Plus + Lodash
- **後端**: Google Apps Script
- **建置工具**: Vite + vite-plugin-singlefile
- **部署工具**: clasp (Google Apps Script CLI)

## 重要檔案

| 檔案 | 說明 |
|------|------|
| `src/App.vue` | 主要前端元件，包含所有 UI 和邏輯 |
| `src/Code.js` | Google Apps Script 後端程式 |
| `struct.md` | 系統架構文件 |

## 開發注意事項

### 建置與部署

```bash
npm run build    # Vite 建置 (輸出到 dist/)
npm run gpush    # 複製檔案並推送到 Google Apps Script
```

### 資料流重點

1. **columnDB**: Vue 響應式陣列，儲存所有表單欄位
2. **watch handler**: 監聽 columnDB 變更，自動存入 localStorage
3. **tempFound**: 布林值，表示是否有可匯出的暫存資料

### 欄位類型判斷

使用 `formatDetector(format, type, column)` 函數：
```javascript
// 檢查是否為文字輸入欄位
formatDetector('T', 'F', column)  // format=T, type=F

// 檢查是否為檔案上傳欄位
formatDetector('F', 'F', column)  // format=F, type=F
```

### 暫存判斷邏輯

判斷是否有有意義的暫存資料：
```javascript
let hasFilledData = queue.some(item => {
  let val = item.val;
  // 空值檢查
  if (val === '' || val === null || val === undefined) return false;
  if (typeof val === 'number' && isNaN(val)) return false;
  // 比較是否與原始值不同
  let column = columnDB.find(col => col.id === item.id);
  if (column && val === column.savedContent) return false;
  return true;
});
```

### 常見欄位格式

- `value = ""`: 空文字欄位
- `value = "選項1;選項2"`: 多選欄位 (U 格式)
- `value = 5`: 滑桿欄位 (L 格式)，注意 `parseInt('')` 會回傳 `NaN`

## 程式碼風格

- 使用 `let oriobj = this` 在回呼函數中保存 Vue instance 參考
- 使用 Lodash (`_`) 進行陣列/物件操作
- 使用 Element Plus 元件 (el-button, el-drawer, el-input 等)

## 測試注意事項

- 測試前需要有效的 Google Sheets 設定
- 需在 Google Apps Script 環境下執行
- localStorage 暫存需在同一瀏覽器/同一網域下才能存取

## 安全提醒

- 匯出檔案使用 AES-256-GCM 加密
- 加密金鑰 = 主鍵值 (登入帳號) + 使用者設定的密碼
- 跨裝置匯入需要相同的主鍵值才能解密
