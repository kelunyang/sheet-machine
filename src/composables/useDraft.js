import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { drawerConfirm } from './useConfirmDrawer';
import dayjs from 'dayjs';
import _ from 'lodash';
import { gasRun } from './useGasRpc';
import {
  buildTempQueue,
  buildQueuePayload,
  filterImportableQueue,
  applyQueueToColumns,
} from '../utils/tempQueue';
import { loadQueue, saveQueue } from '../utils/tempStorage';
import { sealDraft, openDraft } from '../utils/draftCipher';

// 線上暫存：把本機的 queue 上傳到雲端暫存試算表／登入後詢問還原。
// 後端 token 驗證（authByToken_）是安全邊界：沒有有效 token 就存取不到任何人的暫存。
// Phase 20 端到端加密：上傳前以 draftKeys.enc 前端 sealDraft，雲端只落 smd1 密文
// （後端零解密需求）；還原時前端 openDraft。
export function useDraft({
  sheets,
  currentSID,
  columnDB,
  tempFound,
  authToken,
  draftKeys,
  onTokenExpired,
}) {
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
    if (draftKeys.value === null) {
      ElMessage.error('找不到暫存金鑰，無法線上暫存');
      return;
    }
    let queue = await loadQueue(draftKeys.value);
    if (!queue || queue.length === 0) {
      ElMessage.error('目前沒有可以暫存的填寫內容');
      return;
    }
    // 與匯出檔相同的封裝格式，載入時走同一套驗證
    let payload = buildQueuePayload(currentSID.value, queue);
    draftSaving.value = true;
    try {
      let sealed = await sealDraft(payload, draftKeys.value.enc);
      let result = await gasRun('saveDraft', currentSheet[0].refer, authToken.value, sealed);
      if (result && result.success) {
        ElMessage.success(
          '已線上暫存！換裝置用同一組身分登入即可還原（簽名需重簽）。暫存會被系統定期清理，請勿當作長期保存'
        );
      } else if (result && result.tokenExpired) {
        onTokenExpired();
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

  // 發簽名邀請前強制上雲：以 columnDB 現值直接組 queue 上傳（繞過 hasFilledData 的
  // 空 queue 拒存——就算填寫者什麼都沒改，受邀者也要能看到 read-only 問卷內容）。
  // 回傳是否成功，邀請流程據此決定要不要繼續寄信
  async function saveDraftForInvite() {
    let currentSheet = _.filter(sheets.value, (sheet) => {
      return sheet.id === currentSID.value;
    });
    if (currentSheet.length === 0 || draftKeys.value === null) {
      return false;
    }
    let payload = buildQueuePayload(currentSID.value, buildTempQueue(columnDB.value));
    draftSaving.value = true;
    try {
      let sealed = await sealDraft(payload, draftKeys.value.enc);
      let result = await gasRun('saveDraft', currentSheet[0].refer, authToken.value, sealed);
      if (result && result.success) {
        return true;
      }
      if (result && result.tokenExpired) {
        onTokenExpired();
      }
      return false;
    } catch (err) {
      console.error('saveDraftForInvite failed', err);
      return false;
    } finally {
      draftSaving.value = false;
    }
  }

  // 登入成功後檢查雲端是否有暫存，有的話詢問是否還原
  async function checkOnlineDraft(currentSheet) {
    if (draftKeys.value === null) {
      return;
    }
    let draft;
    try {
      draft = await gasRun('loadDraft', currentSheet.refer, authToken.value);
    } catch (err) {
      // 載入暫存失敗不影響正常填寫流程
      console.error('loadDraft failed', err);
      return;
    }
    if (draft && draft.tokenExpired) {
      onTokenExpired();
      return;
    }
    if (!draft || !draft.payload) {
      return;
    }
    let importData;
    try {
      // smd1 密文前端解；非 smd1 直接當 JSON 解析（防呆，比照後端 decode 的殘留分支）。
      // 解不開（draftEncSecret 已輪替等）視同無暫存，不擋填寫流程
      importData =
        typeof draft.payload === 'string' && draft.payload.slice(0, 5) === 'smd1:'
          ? await openDraft(draft.payload, draftKeys.value.enc)
          : JSON.parse(draft.payload);
    } catch (err) {
      console.error('openDraft failed', err);
      return;
    }
    if (!importData.data || !importData.data.queue || importData.data.queue.length === 0) {
      return;
    }
    drawerConfirm(
      '雲端有你在 ' +
        dayjs(draft.updatedAt).format('YYYY/MM/DD HH:mm') +
        ' 的線上暫存，要載入嗎？載入會覆蓋目前畫面上已填的內容（簽名一律需要重簽）。' +
        '提醒：線上暫存不代表最終結果，正式結果以已送出的紀錄為準；' +
        '暫存會被系統定期清理，請勿當作長期保存',
      '發現線上暫存',
      { confirmButtonText: '載入雲端暫存', cancelButtonText: '不用，維持現狀', type: 'info' }
    )
      .then(() => {
        applyOnlineDraft(importData);
      })
      .catch(() => {});
  }

  function applyOnlineDraft(importData) {
    if (draftKeys.value === null) {
      return;
    }
    // 與匯入暫存檔相同的還原邏輯：過濾只還原存在的欄位（包含檔案欄位的 Drive 連結）
    let importedQueue = filterImportableQueue(importData.data.queue, columnDB.value);
    if (importedQueue.length === 0) {
      ElMessage.error('雲端暫存沒有任何欄位可以還原（欄位結構可能已變更）');
      return;
    }
    saveQueue(draftKeys.value, importedQueue);
    applyQueueToColumns(importedQueue, columnDB.value, 'online');
    tempFound.value = true;
    ElMessage.success('已還原 ' + importedQueue.length + ' 個欄位的雲端暫存');
  }

  // 純 append 模型（Phase 17）：草稿永不刪除，送出後由使用者自行忽略雲端暫存提示，
  // 故無 deleteDraftOnline——系統永遠抓該主鍵最新一列，舊版自動 superseded。

  return {
    draftEnabled,
    draftSaving,
    saveDraftOnline,
    saveDraftForInvite,
    checkOnlineDraft,
  };
}
