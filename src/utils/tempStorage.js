// localStorage 暫存存取層（Phase 20 假名化）。
// 儲存結構：key = 後端派生的 id 假名（per 問卷×人，draftKeys.id），
// value = sealDraft 的 smd1 密文（內容為 queue 陣列）——明文主鍵值與明文答案不再落地。
// draftKeys = readRecord 登入成功回傳的 { id, enc }：id 可落地當定位鍵、enc 只在記憶體。
// 舊結構（key = 明文主鍵值、value = 明文 JSON [{ uid, queue }, ...]）由 purgeLegacyEntry
// 登入時一次性清除。
import { sealDraft, openDraft } from './draftCipher';

// 寫入序列化：columnDB 的 watch 每次變動都觸發非同步加密寫入，鏈起來保證
// 落地順序＝觸發順序（避免慢的舊寫入蓋掉快的新寫入）
let writeChain = Promise.resolve();
function enqueueWrite(fn) {
  writeChain = writeChain.then(fn).catch((err) => {
    console.error('tempStorage 寫入失敗', err);
  });
  return writeChain;
}

// 登入時載入目前問卷的 queue：無條目回 null；解不開（draftEncSecret 已輪替／資料損毀）
// 視同無暫存回 null——暫存非正式結果，解不開不擋登入
export async function loadQueue(draftKeys) {
  const raw = localStorage.getItem(draftKeys.id);
  if (raw === null) {
    return null;
  }
  try {
    const queue = await openDraft(raw, draftKeys.enc);
    return Array.isArray(queue) ? queue : null;
  } catch {
    return null;
  }
}

// 寫入（覆蓋）目前問卷的 queue；回傳落地完成的 promise
export function saveQueue(draftKeys, queue) {
  return enqueueWrite(async () => {
    localStorage.setItem(draftKeys.id, await sealDraft(queue, draftKeys.enc));
  });
}

// 清除目前問卷的暫存（清除按鈕／正式送出成功後）；resolve 原本是否有條目。
// 走同一條寫入鏈，保證不被還在路上的加密寫入蓋回來
export function removeQueue(draftKeys) {
  const existed = localStorage.getItem(draftKeys.id) !== null;
  return enqueueWrite(() => {
    localStorage.removeItem(draftKeys.id);
  }).then(() => existed);
}

// 一次性清除（登入成功當下，明文主鍵值仍在手）：Phase 20 前的版本用明文主鍵值當 key、
// 明文 JSON 當 value，把殘留在瀏覽器的這種條目整鍵移除。
// 原本這裡會先把舊 queue 搬進假名 key 再清，但搬家得靠條目裡的 uid（＝問卷列表 N 欄
// 固定ID）認出「這一筆是哪份問卷的」；該欄已於 2026-07-31 整欄刪除，搬家隨之拿掉，
// 只留清除——舊表都已退役、無人依賴那批暫存，但明文個資該清還是要清。
// 冪等：舊 key 不在就跳過。回傳是否真的清掉了東西。
export function purgeLegacyEntry(plainPkeyValue) {
  if (localStorage.getItem(plainPkeyValue) === null) {
    return false;
  }
  localStorage.removeItem(plainPkeyValue);
  return true;
}
