import { describe, it, expect } from 'vitest';
import { uint8ToBase64, deriveKey, encrypt, decrypt } from '../src/composables/useCrypto';

describe('uint8ToBase64', () => {
  it('與 atob 互為反函數', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
    const b64 = uint8ToBase64(bytes);
    const back = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect([...back]).toEqual([...bytes]);
  });

  it('超過分段大小（0x8000）的資料不會爆呼叫堆疊且結果正確', () => {
    const big = new Uint8Array(300000);
    for (let i = 0; i < big.length; i++) {
      big[i] = i % 256;
    }
    const b64 = uint8ToBase64(big);
    const back = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(back.length).toBe(big.length);
    expect(back[0]).toBe(big[0]);
    expect(back[299999]).toBe(big[299999]);
  });
});

describe('encrypt / decrypt', () => {
  const payload = {
    version: '1.0',
    formId: 'test-form',
    data: { queue: [{ id: 'a', val: '測試生甲的答案' }] },
  };

  it('smv2 加密後可用同一組密碼解回', async () => {
    const encrypted = await encrypt(payload, 'A000000000' + 'pw123');
    expect(encrypted.startsWith('smv2:')).toBe(true);
    const decrypted = await decrypt(encrypted, 'A000000000' + 'pw123');
    expect(decrypted).toEqual(payload);
  });

  it('每次加密 salt/IV 都不同（同資料同密碼產生不同密文）', async () => {
    const a = await encrypt(payload, 'pw');
    const b = await encrypt(payload, 'pw');
    expect(a).not.toBe(b);
  });

  it('密碼錯誤時解密失敗', async () => {
    const encrypted = await encrypt(payload, 'correct');
    await expect(decrypt(encrypted, 'wrong')).rejects.toThrow();
  });

  it('舊格式（固定 salt、無前綴）仍可解密', async () => {
    // 依舊版格式手工組出密文：iv(12) + AES-GCM 密文，salt 固定 'sheet-machine-salt'
    const encoder = new TextEncoder();
    const key = await deriveKey('legacy-pw', encoder.encode('sheet-machine-salt'));
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const cipher = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encoder.encode(JSON.stringify(payload))
    );
    const combined = new Uint8Array(iv.length + cipher.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(cipher), iv.length);
    const legacyFile = uint8ToBase64(combined);

    const decrypted = await decrypt(legacyFile, 'legacy-pw');
    expect(decrypted).toEqual(payload);
  });
});
