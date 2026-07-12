// 暫存端到端加密層（src/utils/draftCipher.js）：smd1 前綴自描述格式的封存/開封。
// Node 20+ 原生有 CompressionStream/Blob/Response，g 路徑可直接測；
// r 路徑（iPad OS 13 無 CompressionStream）以暫時移除全域類別模擬。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sealDraft, openDraft } from '../src/utils/draftCipher';

const ENC_KEY = 'a'.repeat(43); // 模擬後端 base64url HMAC 派生鍵（高熵字串）
const SAMPLE = {
  version: '1.0',
  formId: 'FORM_1',
  data: { queue: [{ id: 'q1', val: '測試答案：「你好」🙂' }, { id: 'q2', val: 5 }] },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sealDraft / openDraft roundtrip', () => {
  it('g 路徑（CompressionStream 可用）：前綴 smd1:g:，開封還原原物件', async () => {
    const blob = await sealDraft(SAMPLE, ENC_KEY);
    expect(blob.slice(0, 7)).toBe('smd1:g:');
    // 內層是 useCrypto 的 smv2 密文
    expect(blob.slice(7, 12)).toBe('smv2:');
    expect(await openDraft(blob, ENC_KEY)).toEqual(SAMPLE);
  });

  it('r 路徑（無 CompressionStream，如 iPad OS 13）：前綴 smd1:r:，照樣還原', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const blob = await sealDraft(SAMPLE, ENC_KEY);
    expect(blob.slice(0, 7)).toBe('smd1:r:');
    expect(await openDraft(blob, ENC_KEY)).toEqual(SAMPLE);
  });

  it('同輸入兩次封存密文不同（隨機 salt/iv），但都開得回來', async () => {
    const a = await sealDraft(SAMPLE, ENC_KEY);
    const b = await sealDraft(SAMPLE, ENC_KEY);
    expect(a).not.toBe(b);
    expect(await openDraft(a, ENC_KEY)).toEqual(await openDraft(b, ENC_KEY));
  });
});

describe('openDraft 失敗路徑（呼叫端據此 fallback，不炸畫面）', () => {
  it('錯 key → reject（AES-GCM 驗證失敗）', async () => {
    const blob = await sealDraft(SAMPLE, ENC_KEY);
    await expect(openDraft(blob, 'b'.repeat(43))).rejects.toThrow();
  });

  it('壞前綴／非 smd1 blob → reject', async () => {
    for (const bad of ['', 'gz:xxx', 'smv2:xxx', '{"data":1}', 'smd1xg:xxx', null, 42]) {
      await expect(openDraft(bad, ENC_KEY)).rejects.toThrow();
    }
  });

  it('未知旗標 → reject', async () => {
    await expect(openDraft('smd1:z:whatever', ENC_KEY)).rejects.toThrow(/旗標/);
  });

  it('密文被截斷 → reject 不 hang', async () => {
    const blob = await sealDraft(SAMPLE, ENC_KEY);
    await expect(openDraft(blob.slice(0, 30), ENC_KEY)).rejects.toThrow();
  });
});
