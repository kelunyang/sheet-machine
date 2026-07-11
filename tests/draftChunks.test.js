// 線上暫存的純函數（src/Code.js 是 GAS 檔，非 ES module）：
// 以 new Function 載入原始碼並 stub 掉 GAS 全域，直接測試其中的純函數。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import _ from 'lodash';

const source = readFileSync(new URL('../src/Code.js', import.meta.url), 'utf8');

// GAS Utilities 的 gzip/base64 stub：GAS 的 gzip 即標準 gzip 格式，用 node:zlib + Buffer 模擬。
// 注意：此 stub 的 ungzip **不檢查 content type**，但真機 GAS 會——decodeDraftPayload_ 的
// newBlob 第二參數 'application/x-gzip' 少了會在真機丟「non-null content type」例外，node 這裡
// 測不出來（曾實際上線爆過）。故 gzip 相關改動一律以真機 roundtrip 為準，別只信這裡綠。
function makeBlob(buf) {
  return {
    _buf: buf,
    getBytes: () => Array.from(buf),
    getDataAsString: () => buf.toString('utf8'),
  };
}
const Utilities = {
  // 第二參數（content type）在真機必要、此 stub 忽略即可
  newBlob: (data) =>
    typeof data === 'string' ? makeBlob(Buffer.from(data, 'utf8')) : makeBlob(Buffer.from(data)),
  gzip: (blob) => makeBlob(gzipSync(blob._buf)),
  ungzip: (blob) => makeBlob(gunzipSync(blob._buf)),
  base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
  base64Decode: (str) => Array.from(Buffer.from(str, 'base64')),
};

function loadGasFunctions() {
  const factory = new Function(
    'LodashGS',
    'PropertiesService',
    'Utilities',
    `${source}\n;return {
      chunkPayload_, DRAFT_CHUNK_SIZE, DRAFT_HEADER,
      encodeDraftPayload_, decodeDraftPayload_, parseDraftRow_, latestDraftRowForKey_,
    };`
  );
  return factory(
    { load: () => _ },
    { getScriptProperties: () => ({ getProperty: () => null }) },
    Utilities
  );
}

const {
  chunkPayload_,
  DRAFT_CHUNK_SIZE,
  DRAFT_HEADER,
  encodeDraftPayload_,
  decodeDraftPayload_,
  parseDraftRow_,
  latestDraftRowForKey_,
} = loadGasFunctions();

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

describe('encodeDraftPayload_ / decodeDraftPayload_（gzip 單格化）', () => {
  it('encode 帶 gz: 前綴（自描述版本記號）', () => {
    expect(encodeDraftPayload_('{"a":1}').slice(0, 3)).toBe('gz:');
  });

  it('roundtrip：一般 JSON 草稿', () => {
    const original = JSON.stringify({ sid: 'S1', data: { queue: [{ id: 'q1', value: '答案' }] } });
    expect(decodeDraftPayload_(encodeDraftPayload_(original))).toBe(original);
  });

  it('roundtrip：含中文與特殊字元', () => {
    const original = '測試生甲的答案：「你好，世界」\n第二行\t制表符 emoji 🙂';
    expect(decodeDraftPayload_(encodeDraftPayload_(original))).toBe(original);
  });

  it('roundtrip：空字串', () => {
    expect(decodeDraftPayload_(encodeDraftPayload_(''))).toBe('');
  });

  it('可壓縮的 JSON 通常縮小（重複結構）', () => {
    const repetitive = JSON.stringify(
      Array.from({ length: 200 }, (_v, i) => ({ id: 'field_' + i, value: '' }))
    );
    const encoded = encodeDraftPayload_(repetitive);
    // 高度重複的內容即使加 base64 回胖仍應淨縮
    expect(encoded.length).toBeLessThan(repetitive.length);
  });

  it('編碼後 >45000 字 → 切塊 → 串接 decode 仍還原', () => {
    // 用近乎不可壓縮的隨機內容逼出編碼後仍超過單格上限的情境
    let s = '';
    let seed = 1;
    while (s.length < 200000) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      s += seed.toString(36);
    }
    const encoded = encodeDraftPayload_(s);
    expect(encoded.length).toBeGreaterThan(DRAFT_CHUNK_SIZE);
    const chunks = chunkPayload_(encoded);
    expect(chunks.length).toBeGreaterThan(1);
    expect(decodeDraftPayload_(chunks.join(''))).toBe(s);
  });

  it('無 gz: 前綴原樣回傳（防呆，非舊格式相容）', () => {
    expect(decodeDraftPayload_('plain text')).toBe('plain text');
  });
});

describe('parseDraftRow_（解析草稿列）', () => {
  it('單格 payload：A 主鍵、B updatedAt、C payload', () => {
    expect(parseDraftRow_(['測試生甲', 1700000000000, 'gz:AAA'])).toEqual({
      key: '測試生甲',
      updatedAt: 1700000000000,
      payload: 'gz:AAA',
    });
  });

  it('變長 chunk 列：C 起串接', () => {
    expect(parseDraftRow_(['測試生乙', 1700000000001, 'part1', 'part2', 'part3']).payload).toBe(
      'part1part2part3'
    );
  });

  it('尾端空格（讀取端補齊的空儲存格）串接後不影響', () => {
    expect(parseDraftRow_(['測試生丙', 1700000000002, 'gz:BBB', '', '']).payload).toBe('gz:BBB');
  });

  it('updatedAt 以 10 進位整數解析', () => {
    expect(parseDraftRow_(['k', '1700000000003', 'x']).updatedAt).toBe(1700000000003);
  });
});

describe('latestDraftRowForKey_（同主鍵最新列勝出）', () => {
  const header = DRAFT_HEADER;

  it('多版本 → 回傳最後（最新）一列，舊版 superseded', () => {
    const rows = [
      header,
      ['測試生甲', 1700000000000, 'gz:v1'],
      ['測試生乙', 1700000000001, 'gz:other'],
      ['測試生甲', 1700000000002, 'gz:v2'],
    ];
    expect(latestDraftRowForKey_(rows, '測試生甲')).toEqual(['測試生甲', 1700000000002, 'gz:v2']);
  });

  it('表頭列首欄為字面字串，永不匹配真實主鍵', () => {
    const rows = [header, ['測試生甲', 1700000000000, 'gz:v1']];
    // 拿表頭字面字串去查也只會撈到表頭列自己，不會誤傷資料
    expect(latestDraftRowForKey_(rows, DRAFT_HEADER[0])).toBe(rows[0]);
    // 真實主鍵不會撈到表頭
    expect(latestDraftRowForKey_(rows, '測試生甲')).toEqual(['測試生甲', 1700000000000, 'gz:v1']);
  });

  it('查無此主鍵回 null', () => {
    const rows = [header, ['測試生甲', 1700000000000, 'gz:v1']];
    expect(latestDraftRowForKey_(rows, '測試生丙')).toBeNull();
  });

  it('只有表頭（空資料）查真實主鍵回 null', () => {
    expect(latestDraftRowForKey_([header], '測試生甲')).toBeNull();
  });
});
