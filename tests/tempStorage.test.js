// localStorage 暫存存取層（Phase 20 假名化）：假名 key＋smd1 密文的載入/寫入/清除，
// 與舊版明文條目的一次性清除。Node 無 localStorage，以最小 stub 模擬。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadQueue, saveQueue, removeQueue, purgeLegacyEntry } from '../src/utils/tempStorage';

const KEYS = { id: 'FAKE_ID_PSEUDONYM_BASE64URL', enc: 'x'.repeat(43) };
const QUEUE = [
  { id: 'q1', val: '測試答案' },
  { id: 'q2', val: 'FILE_ID', url: 'https://drive.example/f', isFile: true },
];

let storeMap;
beforeEach(() => {
  storeMap = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key) => (storeMap.has(key) ? storeMap.get(key) : null),
    setItem: (key, value) => storeMap.set(key, String(value)),
    removeItem: (key) => storeMap.delete(key),
  });
});

describe('saveQueue / loadQueue（假名 key＋smd1 密文）', () => {
  it('roundtrip：落地的是假名 key＋smd1 密文，載回原 queue', async () => {
    await saveQueue(KEYS, QUEUE);
    expect(storeMap.has(KEYS.id)).toBe(true);
    const raw = storeMap.get(KEYS.id);
    expect(raw.slice(0, 5)).toBe('smd1:');
    expect(raw).not.toContain('測試答案'); // 明文答案不落地
    expect(await loadQueue(KEYS)).toEqual(QUEUE);
  });

  it('無條目回 null；錯 key（draftEncSecret 輪替）解不開也回 null 不 throw', async () => {
    expect(await loadQueue(KEYS)).toBe(null);
    await saveQueue(KEYS, QUEUE);
    expect(await loadQueue({ id: KEYS.id, enc: 'y'.repeat(43) })).toBe(null);
  });

  it('removeQueue：清掉條目並回報原本是否存在', async () => {
    expect(await removeQueue(KEYS)).toBe(false);
    await saveQueue(KEYS, QUEUE);
    expect(await removeQueue(KEYS)).toBe(true);
    expect(storeMap.has(KEYS.id)).toBe(false);
  });

  it('連續寫入序列化：最後一次寫入勝出（不被慢的舊寫入蓋回）', async () => {
    const last = saveQueue(KEYS, [{ id: 'q1', val: 'v3' }]);
    saveQueue(KEYS, QUEUE);
    await Promise.all([last, saveQueue(KEYS, [{ id: 'q1', val: 'final' }])]);
    expect(await loadQueue(KEYS)).toEqual([{ id: 'q1', val: 'final' }]);
  });
});

describe('purgeLegacyEntry（舊明文條目一次性清除）', () => {
  const PKEY = 'A123456789'; // 明顯虛構的佔位主鍵值
  const legacy = JSON.stringify([
    { uid: 'SHEET_UID_1', queue: QUEUE },
    { uid: 'SHEET_UID_2', queue: [{ id: 'z', val: '其他問卷' }] },
  ]);

  it('舊明文條目整鍵移除', () => {
    storeMap.set(PKEY, legacy);
    expect(purgeLegacyEntry(PKEY)).toBe(true);
    expect(storeMap.has(PKEY)).toBe(false);
  });

  it('冪等：無舊條目直接跳過', () => {
    expect(purgeLegacyEntry(PKEY)).toBe(false);
    expect(storeMap.size).toBe(0);
  });

  it('舊條目壞掉（非 JSON）→ 照樣移除、不 throw', () => {
    storeMap.set(PKEY, '{{{not json');
    expect(purgeLegacyEntry(PKEY)).toBe(true);
    expect(storeMap.has(PKEY)).toBe(false);
  });

  it('不動假名 key 的現有暫存', async () => {
    await saveQueue(KEYS, [{ id: 'q1', val: '現有的' }]);
    storeMap.set(PKEY, legacy);
    expect(purgeLegacyEntry(PKEY)).toBe(true);
    expect(await loadQueue(KEYS)).toEqual([{ id: 'q1', val: '現有的' }]);
  });
});

const PKEY_FOR_EXPORT = 'A123456789'; // 明顯虛構的佔位主鍵值

describe('匯出檔金鑰組成（Phase 20：id 假名＋密碼；舊檔 fallback 主鍵值＋密碼）', () => {
  it('新檔以假名金鑰解得開、舊金鑰解不開（TempTransferDrawers 的兩段嘗試依據）', async () => {
    const { encrypt, decrypt } = await import('../src/composables/useCrypto');
    const data = { version: '1.0', data: { queue: QUEUE } };
    const newFile = await encrypt(data, KEYS.id + 'pw123');
    const oldFile = await encrypt(data, PKEY_FOR_EXPORT + 'pw123');
    // 新檔：第一段（假名＋密碼）直接成功
    expect(await decrypt(newFile, KEYS.id + 'pw123')).toEqual(data);
    // 舊檔：第一段失敗 → fallback 第二段（主鍵值＋密碼）成功
    await expect(decrypt(oldFile, KEYS.id + 'pw123')).rejects.toThrow();
    expect(await decrypt(oldFile, PKEY_FOR_EXPORT + 'pw123')).toEqual(data);
  });
});
