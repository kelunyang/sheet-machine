// 暫存 queue 的純邏輯：組裝、判斷是否有實際填寫、還原到 columnDB。
// queue 格式（localStorage／匯出檔／線上暫存共用）：[{ id, val }, ...]，
// 檔案欄位為 { id, val: fileID（或「沿用上次」哨兵）, url: 這次上傳的 fileURL, isFile: true }
// ——url 對應的是 val（這次上傳的檔案），**不是** column.lastInput（那是上次送出的檔案、
// 由 readRecord 給，前端不得覆寫，否則送出前的 diff 會拿新檔當舊檔比）

// 從 columnDB 組出要暫存的 queue（原 App.vue watch handler 的組裝段）
export function buildTempQueue(columns) {
  let tempQueue = [];
  for (let i = 0; i < columns.length; i++) {
    if (/F/.test(columns[i].type)) {
      if (/F/.test(columns[i].format)) {
        // 檔案欄位：儲存 fileID 和 fileURL（檔案本體在選取時就已上傳 Drive）
        if (columns[i].value !== '') {
          tempQueue.push({
            id: columns[i].id,
            val: columns[i].value,
            url: columns[i].uploadUrl || '',
            isFile: true,
          });
        }
      } else {
        // 非檔案欄位：只儲存值
        tempQueue.push({
          id: columns[i].id,
          val: columns[i].value,
        });
      }
    }
  }
  return tempQueue;
}

// 判斷 queue 裡是否有「有意義」的暫存資料：值非空、非 NaN、且與欄位原始值（savedContent）不同
export function hasFilledData(queue, columns) {
  return queue.some((item) => {
    let val = item.val;
    // 空值檢查：空字串、null、undefined、NaN
    if (val === '' || val === null || val === undefined) return false;
    if (typeof val === 'number' && isNaN(val)) return false;
    // 找到對應的欄位，比較是否與原始值不同
    let column = columns.find((col) => col.id === item.id);
    if (column && val === column.savedContent) return false;
    return true;
  });
}

// 匯出暫存檔與線上暫存共用的 payload 封裝
// （匯入端 importTemp / checkOnlineDraft 都驗證 version 與 data.queue，兩個產生端必須同格式）
export function buildQueuePayload(formId, queue) {
  return {
    version: '1.0',
    savedTime: new Date().toISOString(),
    formId: formId,
    data: { queue: queue },
  };
}

// 過濾出目前問卷仍存在的欄位（匯入暫存檔／還原線上暫存共用）
export function filterImportableQueue(queue, columns) {
  let validFieldIds = columns.filter((col) => /F/.test(col.type)).map((col) => col.id);
  return queue.filter((item) => {
    return validFieldIds.includes(item.id);
  });
}

// 把 queue 還原到 columnDB（就地改寫 value；檔案欄位一併還原 Drive 連結），回傳還原筆數。
// source（Phase 23）：疊回來源，落成 column.draftOrigin 供草稿 chip 導出（'online' 線上草稿、
// 'import' 匯入的暫存檔、'local' 本機 localStorage）；不傳＝不標記
export function applyQueueToColumns(queue, columns, source) {
  let applied = 0;
  for (let i = 0; i < queue.length; i++) {
    let columnIndex = columns.findIndex((col) => col.id === queue[i].id);
    if (columnIndex > -1) {
      columns[columnIndex].value = queue[i].val;
      // 檔案欄位：還原「這次上傳」的連結（uploadUrl），lastInput 維持 readRecord 給的上次送出值
      if (queue[i].isFile && queue[i].url) {
        columns[columnIndex].uploadUrl = queue[i].url;
        columns[columnIndex].status = '';
      }
      if (source) {
        columns[columnIndex].draftOrigin = { val: columns[columnIndex].value, source: source };
        columns[columnIndex].source = 'draft'; // segmented 停在「暫存」
      }
      applied++;
    }
  }
  return applied;
}
