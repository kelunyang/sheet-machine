import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import dayjs from 'dayjs';
import _ from 'lodash';
import { gasRun, plainClone } from './useGasRpc';
import { findPrimaryKey } from '../utils/columnRules';
import { buildQueuePayload, filterImportableQueue, applyQueueToColumns } from '../utils/tempQueue';
import { getQueueAnswers, findAnsIndex, replaceAns } from '../utils/tempStorage';

// 線上暫存：把 localStorage 的 queue 上傳到雲端暫存試算表／登入後詢問還原。
// 後端驗證（authRecord）是安全邊界：驗證欄位不對就存取不到任何人的暫存。
export function useDraft({ sheets, currentSID, currentUID, authDB, columnDB, tempFound }) {
  const draftEnabled = ref(false);
  const draftSaving = ref(false);

  // 手動按鈕：上傳目前填寫進度
  async function saveDraftOnline() {
    if (draftSaving.value) {
      return;
    }
    let currentSheet = _.filter(sheets.value, (sheet) => {
      return sheet.id === currentSID.value;
    });
    if (currentSheet.length === 0) {
      return;
    }
    let primaryKey = findPrimaryKey(authDB.value);
    if (primaryKey === undefined) {
      ElMessage.error('找不到主鍵欄位，無法線上暫存');
      return;
    }
    let queueAnswers = getQueueAnswers(primaryKey.value);
    let currentAnsIndex = findAnsIndex(queueAnswers, currentUID.value);
    let currentAns = currentAnsIndex > -1 ? queueAnswers[currentAnsIndex] : undefined;
    if (!currentAns || !currentAns.queue || currentAns.queue.length === 0) {
      ElMessage.error('目前沒有可以暫存的填寫內容');
      return;
    }
    // 與匯出檔相同的封裝格式，載入時走同一套驗證
    let payload = buildQueuePayload(currentSID.value, currentAns.queue);
    draftSaving.value = true;
    try {
      let result = await gasRun(
        'saveDraft',
        currentSheet[0].refer,
        plainClone(authDB.value),
        JSON.stringify(payload)
      );
      if (result && result.success) {
        ElMessage.success('已線上暫存！換裝置用同一組身分登入即可還原（簽名需重簽）');
      } else {
        ElMessage.error(result && result.message ? result.message : '線上暫存失敗');
      }
    } catch (err) {
      console.error('saveDraft failed', err);
      ElMessage.error('線上暫存失敗，請稍後再試');
    } finally {
      draftSaving.value = false;
    }
  }

  // 登入成功後檢查雲端是否有暫存，有的話詢問是否還原
  async function checkOnlineDraft(currentSheet) {
    let draft;
    try {
      draft = await gasRun('loadDraft', currentSheet.refer, plainClone(authDB.value));
    } catch (err) {
      // 載入暫存失敗不影響正常填寫流程
      console.error('loadDraft failed', err);
      return;
    }
    if (!draft || !draft.payload) {
      return;
    }
    let importData;
    try {
      importData = JSON.parse(draft.payload);
    } catch {
      return;
    }
    if (!importData.data || !importData.data.queue || importData.data.queue.length === 0) {
      return;
    }
    ElMessageBox.confirm(
      '雲端有你在 ' +
        dayjs(draft.updatedAt).format('YYYY/MM/DD HH:mm') +
        ' 的線上暫存，要載入嗎？載入會覆蓋目前畫面上已填的內容（簽名一律需要重簽）',
      '發現線上暫存',
      { confirmButtonText: '載入雲端暫存', cancelButtonText: '不用，維持現狀', type: 'info' }
    )
      .then(() => {
        applyOnlineDraft(importData);
      })
      .catch(() => {});
  }

  function applyOnlineDraft(importData) {
    let primaryKey = findPrimaryKey(authDB.value);
    if (primaryKey === undefined) {
      return;
    }
    // 與匯入暫存檔相同的還原邏輯：過濾只還原存在的欄位（包含檔案欄位的 Drive 連結）
    let importedQueue = filterImportableQueue(importData.data.queue, columnDB.value);
    if (importedQueue.length === 0) {
      ElMessage.error('雲端暫存沒有任何欄位可以還原（欄位結構可能已變更）');
      return;
    }
    replaceAns(primaryKey.value, currentUID.value, importedQueue);
    applyQueueToColumns(importedQueue, columnDB.value);
    tempFound.value = true;
    ElMessage.success('已還原 ' + importedQueue.length + ' 個欄位的雲端暫存');
  }

  // 正式送出成功後清掉雲端暫存（失敗不阻斷流程）；要在 authDB 清空前呼叫
  function deleteDraftOnline(currentSheet) {
    if (!draftEnabled.value) {
      return;
    }
    gasRun('deleteDraft', currentSheet.refer, plainClone(authDB.value)).catch((err) => {
      console.error('deleteDraft failed', err);
    });
  }

  return { draftEnabled, draftSaving, saveDraftOnline, checkOnlineDraft, deleteDraftOnline };
}
