// localStorage 暫存存取層（Phase 20 假名化）：假名 key＋smd1 密文的載入/寫入/清除，
// 與舊版明文條目的一次性搬家。Node 無 localStorage，以最小 stub 模擬。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadQueue, saveQueue, removeQueue, migrateLegacyEntry } from '../src/utils/tempStorage';
import { openDraft } from '../src/utils/draftCipher';

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

describe('migrateLegacyEntry（舊明文條目一次性搬家）', () => {
  const PKEY = 'A123456789'; // 明顯虛構的佔位主鍵值
  const UID = 'SHEET_UID_1';
  const legacy = JSON.stringify([
    { uid: UID, queue: QUEUE },
    { uid: 'SHEET_UID_2', queue: [{ id: 'z', val: '其他問卷' }] },
  ]);

  it('舊條目轉入假名 key（加密）＋整鍵移除明文', async () => {
    storeMap.set(PKEY, legacy);
    expect(await migrateLegacyEntry(PKEY, UID, KEYS)).toBe(true);
    expect(storeMap.has(PKEY)).toBe(false); // 明文個資清除（含其他問卷條目，刻意取捨）
    expect(await openDraft(storeMap.get(KEYS.id), KEYS.enc)).toEqual(QUEUE);
  });

  it('冪等：無舊條目直接跳過', async () => {
    expect(await migrateLegacyEntry(PKEY, UID, KEYS)).toBe(false);
    expect(storeMap.size).toBe(0);
  });

  it('假名 key 已有資料（較新）→ 不覆蓋、僅清舊明文', async () => {
    await saveQueue(KEYS, [{ id: 'q1', val: '較新的' }]);
    storeMap.set(PKEY, legacy);
    expect(await migrateLegacyEntry(PKEY, UID, KEYS)).toBe(false);
    expect(storeMap.has(PKEY)).toBe(false);
    expect(await loadQueue(KEYS)).toEqual([{ id: 'q1', val: '較新的' }]);
  });

  it('舊條目壞掉（非 JSON）→ 照樣移除、不 throw', async () => {
    storeMap.set(PKEY, '{{{not json');
    expect(await migrateLegacyEntry(PKEY, UID, KEYS)).toBe(false);
    expect(storeMap.has(PKEY)).toBe(false);
  });

  it('舊條目有其他問卷但沒有目前問卷 → 不轉入、仍清明文', async () => {
    storeMap.set(PKEY, JSON.stringify([{ uid: 'SHEET_UID_2', queue: QUEUE }]));
    expect(await migrateLegacyEntry(PKEY, UID, KEYS)).toBe(false);
    expect(storeMap.has(PKEY)).toBe(false);
    expect(await loadQueue(KEYS)).toBe(null);
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
