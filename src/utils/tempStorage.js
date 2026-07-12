// localStorage 暫存存取層（Phase 20 假名化）。
// 儲存結構：key = 後端派生的 id 假名（per 問卷×人，draftKeys.id），
// value = sealDraft 的 smd1 密文（內容為 queue 陣列）——明文主鍵值與明文答案不再落地。
// draftKeys = readRecord 登入成功回傳的 { id, enc }：id 可落地當定位鍵、enc 只在記憶體。
// 舊結構（key = 明文主鍵值、value = 明文 JSON [{ uid, queue }, ...]）由 migrateLegacyEntry
// 登入時一次性搬家清除。
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

// 一次性搬家（登入成功當下，明文主鍵值仍在手）：舊版留在瀏覽器的明文條目
// 轉進假名 key 後整鍵移除。冪等：舊 key 不在就跳過；假名 key 已有資料不覆蓋（較新），
// 僅清舊明文。舊 key 內「其他問卷」的草稿沒有各自的派生鍵可封存，隨鍵一併清除是
// 刻意取捨——清掉已部署版本留下的明文個資優先於保住非正式的暫存。
// 回傳是否有轉入資料
export async function migrateLegacyEntry(plainPkeyValue, uid, draftKeys) {
  const raw = localStorage.getItem(plainPkeyValue);
  if (raw === null) {
    return false;
  }
  let migrated = false;
  try {
    const entries = JSON.parse(raw);
    const entry = Array.isArray(entries)
      ? entries.find((item) => item && item.uid === uid)
      : undefined;
    if (
      entry &&
      Array.isArray(entry.queue) &&
      entry.queue.length > 0 &&
      localStorage.getItem(draftKeys.id) === null
    ) {
      await saveQueue(draftKeys, entry.queue);
      migrated = true;
    }
  } catch {
    // 舊條目壞掉照樣往下移除（清明文個資優先）
  }
  localStorage.removeItem(plainPkeyValue);
  return migrated;
}
