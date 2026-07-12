// 暫存內容端到端加密（Phase 20）：草稿物件 ⇄ 'smd1:<g|r>:' + useCrypto 的 smv2 密文。
// enc key 由後端 HMAC 派生（readRecord 隨 token 回傳的 draftKeys.enc），只留記憶體、絕不落地。
// 先 gzip 再加密（密文壓不動）；CompressionStream 不可用時（iPad OS 13）跳過壓縮走 r 旗標
// ——加密是必須、壓縮只是省空間，不為此引新套件。
import { encrypt, decrypt, uint8ToBase64 } from '../composables/useCrypto';

async function gzipToBase64(str) {
  const stream = new Blob([str]).stream().pipeThrough(new globalThis.CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return uint8ToBase64(new Uint8Array(buf));
}

async function gunzipFromBase64(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new globalThis.DecompressionStream('gzip'));
  return new Response(stream).text();
}

// 封存草稿：g 路徑加密的是 gzip 後的 base64 字串、r 路徑直接加密物件本身
// （useCrypto.encrypt 內建 JSON.stringify，高熵派生鍵當 password 過 PBKDF2 無害且沿用既有測試）
export async function sealDraft(data, encKey) {
  if (typeof globalThis.CompressionStream === 'function') {
    return 'smd1:g:' + (await encrypt(await gzipToBase64(JSON.stringify(data)), encKey));
  }
  return 'smd1:r:' + (await encrypt(data, encKey));
}

// 開封：自判前綴反向。非 smd1 blob、旗標不明、錯 key（AES-GCM 驗證失敗）一律 throw，
// 呼叫端自行決定 fallback（視同無草稿／改試舊格式）
export async function openDraft(blob, encKey) {
  if (typeof blob !== 'string' || blob.slice(0, 5) !== 'smd1:' || blob[6] !== ':') {
    throw new Error('不是 smd1 草稿密文');
  }
  const flag = blob[5];
  const body = blob.slice(7);
  if (flag === 'g') {
    return JSON.parse(await gunzipFromBase64(await decrypt(body, encKey)));
  }
  if (flag === 'r') {
    return decrypt(body, encKey);
  }
  throw new Error('未知的 smd1 旗標：' + flag);
}
