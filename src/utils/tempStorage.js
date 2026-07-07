// localStorage 暫存存取層。
// 儲存結構：key = 主鍵值（登入帳號），value = JSON 陣列 [{ uid: 問卷 sheetID, queue: [...] }, ...]
import _ from 'lodash';

export function getQueueAnswers(pkeyValue) {
  let raw = localStorage.getItem(pkeyValue);
  return raw === undefined || raw === null ? [] : JSON.parse(raw);
}

export function findAnsIndex(queueAnswers, uid) {
  return _.findIndex(queueAnswers, (item) => {
    return item.uid === uid;
  });
}

// 寫入（覆蓋或新增）目前問卷的 queue
export function upsertQueue(pkeyValue, uid, queue) {
  let queueAnswers = getQueueAnswers(pkeyValue);
  let currentAns = findAnsIndex(queueAnswers, uid);
  if (currentAns > -1) {
    queueAnswers[currentAns].queue = queue;
  } else {
    queueAnswers.push({ uid: uid, queue: queue });
  }
  localStorage.setItem(pkeyValue, JSON.stringify(queueAnswers));
}

// 整包覆蓋目前問卷的存檔（匯入暫存檔／還原線上暫存用）
export function replaceAns(pkeyValue, uid, queue) {
  let queueAnswers = getQueueAnswers(pkeyValue);
  let currentAnsIndex = findAnsIndex(queueAnswers, uid);
  let newAns = { uid: uid, queue: queue };
  if (currentAnsIndex > -1) {
    queueAnswers[currentAnsIndex] = newAns;
  } else {
    queueAnswers.push(newAns);
  }
  localStorage.setItem(pkeyValue, JSON.stringify(queueAnswers));
}

// 清空目前問卷的 queue；找不到存檔時回傳 false
export function clearQueue(pkeyValue, uid) {
  let queueAnswers = getQueueAnswers(pkeyValue);
  let currentAns = findAnsIndex(queueAnswers, uid);
  if (currentAns > -1) {
    queueAnswers[currentAns].queue = [];
    localStorage.setItem(pkeyValue, JSON.stringify(queueAnswers));
    return true;
  }
  return false;
}

// 正式送出成功後把整個存檔位置清成空陣列（沿用原本 sendMod 的行為）
export function clearSubmitted(pkeyValue, uid) {
  let queueAnswers = getQueueAnswers(pkeyValue);
  let currentAns = findAnsIndex(queueAnswers, uid);
  if (currentAns > -1) {
    queueAnswers[currentAns] = [];
    localStorage.setItem(pkeyValue, JSON.stringify(queueAnswers));
  }
}

// 登入時取出（或建立）目前問卷的存檔
export function loadOrCreateAns(pkeyValue, uid) {
  let currentAns = { uid: uid, queue: [] };
  let queueAnswers = getQueueAnswers(pkeyValue);
  let currentAnsIndex = findAnsIndex(queueAnswers, uid);
  if (currentAnsIndex > -1) {
    currentAns = queueAnswers[currentAnsIndex];
  } else {
    queueAnswers.push(currentAns);
  }
  localStorage.setItem(pkeyValue, JSON.stringify(queueAnswers));
  return currentAns;
}
