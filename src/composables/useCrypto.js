// 匯出暫存檔的 AES-256-GCM 加解密。
// smv2 格式：'smv2:' + base64( salt(16) + iv(12) + 密文 )，salt 隨機產生。
// 舊格式（無前綴）：base64( iv(12) + 密文 )，salt 固定 'sheet-machine-salt'，僅供匯入舊檔。
// 使用 globalThis.crypto：瀏覽器與 Node（測試環境）皆可用。

export function uint8ToBase64(bytes) {
  // 分段轉換，避免 String.fromCharCode.apply 在大資料時超出呼叫堆疊上限
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encrypt(data, password) {
  const encoder = new TextEncoder();
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    encoder.encode(JSON.stringify(data))
  );
  const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  combined.set(salt);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);
  // base64 字元集不含冒號，舊格式檔案不可能以此前綴開頭
  return 'smv2:' + uint8ToBase64(combined);
}

export async function decrypt(encryptedData, password) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let key, iv, data;
  if (encryptedData.startsWith('smv2:')) {
    const combined = Uint8Array.from(atob(encryptedData.slice(5)), (c) => c.charCodeAt(0));
    const salt = combined.slice(0, 16);
    iv = combined.slice(16, 28);
    data = combined.slice(28);
    key = await deriveKey(password, salt);
  } else {
    // 舊格式（固定 salt）：維持可解密，僅供匯入舊檔
    const combined = Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0));
    iv = combined.slice(0, 12);
    data = combined.slice(12);
    key = await deriveKey(password, encoder.encode('sheet-machine-salt'));
  }
  const decrypted = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, data);
  return JSON.parse(decoder.decode(decrypted));
}

export function useCrypto() {
  return { uint8ToBase64, deriveKey, encrypt, decrypt };
}
