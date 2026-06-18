# Sheet Machine 待辦事項

## 待處理

### 1. 更新所有 Library 到最新版本

目前版本：
- Vue: 3.2.37
- Vite: 4.4.8
- Element Plus: 2.3.8
- Lodash: 4.17.21
- dayjs: 1.11.5

需檢查：
- [ ] Vue 3 最新穩定版
- [ ] Vite 5.x 或更新版本
- [ ] Element Plus 最新版
- [ ] 其他相依套件
- [ ] 測試建置與功能是否正常

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
