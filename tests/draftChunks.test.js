// 線上暫存的 chunk 切割（src/Code.js 是 GAS 檔，非 ES module）：
// 以 new Function 載入原始碼並 stub 掉 GAS 全域，直接測試其中的純函數。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import _ from 'lodash';

const source = readFileSync(new URL('../src/Code.js', import.meta.url), 'utf8');

function loadGasFunctions() {
  const factory = new Function(
    'LodashGS',
    'PropertiesService',
    `${source}\n;return { chunkPayload_, DRAFT_CHUNK_SIZE, draftRowIndex_ };`
  );
  return factory(
    { load: () => _ },
    { getScriptProperties: () => ({ getProperty: () => null }) }
  );
}

const { chunkPayload_, DRAFT_CHUNK_SIZE, draftRowIndex_ } = loadGasFunctions();

describe('chunkPayload_（線上暫存切塊）', () => {
  it('CHUNK 大小必須低於 Google Sheet 單一儲存格上限 50000', () => {
    expect(DRAFT_CHUNK_SIZE).toBeLessThanOrEqual(50000);
  });

  it('空字串切出空陣列', () => {
    expect(chunkPayload_('')).toEqual([]);
  });

  it('小於單塊上限 → 1 塊', () => {
    expect(chunkPayload_('abc')).toEqual(['abc']);
  });

  it('剛好等於上限 → 仍是 1 塊', () => {
    const s = 'x'.repeat(DRAFT_CHUNK_SIZE);
    const chunks = chunkPayload_(s);
    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBe(DRAFT_CHUNK_SIZE);
  });

  it('超過上限 1 字元 → 2 塊，且每塊都不超過上限', () => {
    const s = 'x'.repeat(DRAFT_CHUNK_SIZE + 1);
    const chunks = chunkPayload_(s);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(DRAFT_CHUNK_SIZE);
    expect(chunks[1].length).toBe(1);
  });

  it('切塊後串回等於原字串（簽名畫滿的大 payload 情境）', () => {
    // 用非週期內容驗證切點沒有錯位
    let s = '';
    while (s.length < DRAFT_CHUNK_SIZE * 2.5) {
      s += Math.trunc(s.length * 7919).toString(36);
    }
    const chunks = chunkPayload_(s);
    expect(chunks.length).toBe(Math.ceil(s.length / DRAFT_CHUNK_SIZE));
    expect(chunks.join('')).toBe(s);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(DRAFT_CHUNK_SIZE);
    }
  });
});

describe('draftRowIndex_（主鍵找列）', () => {
  function fakeSheet(keys) {
    return {
      getLastRow: () => keys.length,
      getRange: () => ({ getValues: () => keys.map((k) => [k]) }),
    };
  }

  it('找到主鍵回傳 1-based 列號', () => {
    const sheet = fakeSheet(['測試生甲', '測試生乙']);
    expect(draftRowIndex_(sheet, '測試生乙')).toBe(2);
  });

  it('找不到回傳 -1', () => {
    const sheet = fakeSheet(['測試生甲']);
    expect(draftRowIndex_(sheet, '測試生丙')).toBe(-1);
  });

  it('空白分頁回傳 -1', () => {
    const sheet = { getLastRow: () => 0, getRange: () => ({ getValues: () => [] }) };
    expect(draftRowIndex_(sheet, '測試生甲')).toBe(-1);
  });
});
