// 問卷生命週期時間軸的後端資料源：sheetCreatedAt_（CacheService 快取 Drive 建立時間、
// 失敗退化回 0）與 getQList_ 對 visible 清單附掛 createdAt。
// 比照 inviteRpc.test.js 以 new Function 載入 Code.js 並 stub 需要的 GAS 全域。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import _ from 'lodash';

const source = readFileSync(new URL('../src/Code.js', import.meta.url), 'utf8');

const REFER_ID = 'REFER_SHEET_DRIVE_ID';
const CREATED_MS = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

// 清單分頁的一列（A:P）：B=refer（唯一的 Drive 試算表 ID，建立時間查它）、
// L=顯示、N=sheetID（問卷識別字串/前端暫存 key，實務上是「204」這種編號，不是 Drive ID）、
// O=writeAllowed
function makeListRow({ refer = REFER_ID } = {}) {
  const row = new Array(16).fill('');
  row[0] = '測試問卷';
  row[1] = refer;
  row[2] = 'RECORD_SHEET_ID';
  row[3] = String(Date.now() + 30 * DAY); // dueDate
  row[4] = String(Date.now() + 60 * DAY); // viewDate（未來才 visible）
  row[11] = '是'; // 顯示
  row[13] = '204'; // 若誤拿這欄查 Drive 就是當初的 bug
  row[14] = '是'; // writeAllowed
  return row;
}

function loadGas({ listRows = [makeListRow(), makeListRow()], cacheStore = {}, driveFails = false } = {}) {
  const driveCalls = [];
  const cachePuts = [];
  const factory = new Function(
    'LodashGS',
    'PropertiesService',
    'SpreadsheetApp',
    'DriveApp',
    'CacheService',
    `${source}\n;return { sheetCreatedAt_, getQList_ };`
  );
  const gas = factory(
    { load: () => _ },
    {
      getScriptProperties: () => ({
        getProperty: (key) => (key === 'listSheetID' ? 'LIST_SHEET_ID' : null),
      }),
    },
    {
      openById: () => ({
        getSheets: () => [{ getRange: () => ({ getValues: () => [new Array(16).fill(''), ...listRows] }) }],
      }),
    },
    {
      getFileById: (id) => {
        driveCalls.push(id);
        if (driveFails) {
          throw new Error('Drive unavailable');
        }
        return { getDateCreated: () => new Date(CREATED_MS) };
      },
    },
    {
      getScriptCache: () => ({
        get: (key) => (key in cacheStore ? cacheStore[key] : null),
        put: (key, value, ttl) => {
          cacheStore[key] = value;
          cachePuts.push({ key, value, ttl });
        },
      }),
    }
  );
  return { gas, driveCalls, cachePuts, cacheStore };
}

describe('sheetCreatedAt_', () => {
  it('cache miss：打一次 Drive、寫入快取（TTL 上限 6 小時）並回建立時間', () => {
    const { gas, driveCalls, cachePuts } = loadGas();
    expect(gas.sheetCreatedAt_(REFER_ID)).toBe(CREATED_MS);
    expect(driveCalls).toEqual([REFER_ID]);
    expect(cachePuts).toEqual([
      { key: 'createdAt_' + REFER_ID, value: String(CREATED_MS), ttl: 21600 },
    ]);
  });

  it('cache hit：不打 Drive，直接回快取值', () => {
    const { gas, driveCalls } = loadGas({
      cacheStore: { ['createdAt_' + REFER_ID]: String(CREATED_MS) },
    });
    expect(gas.sheetCreatedAt_(REFER_ID)).toBe(CREATED_MS);
    expect(driveCalls).toEqual([]);
  });

  it('Drive 讀取失敗回 0（前端時間軸退化隱藏），不往外拋', () => {
    const { gas } = loadGas({ driveFails: true });
    expect(gas.sheetCreatedAt_(REFER_ID)).toBe(0);
  });

  it('refer 空字串直接回 0，不打 Drive', () => {
    const { gas, driveCalls } = loadGas();
    expect(gas.sheetCreatedAt_('')).toBe(0);
    expect(driveCalls).toEqual([]);
  });
});

describe('getQList_ 附掛 createdAt', () => {
  it('visible 清單每項都有 createdAt（查 B 欄 refer，不是 N 欄）；同 refer 第二次讀走快取，Drive 只打一次', () => {
    const { gas, driveCalls } = loadGas();
    const list = gas.getQList_();
    expect(list).toHaveLength(2);
    for (const item of list) {
      expect(item.createdAt).toBe(CREATED_MS);
    }
    expect(driveCalls).toEqual([REFER_ID]);
  });

  it('單表 Drive 失敗不拖垮清單：該表 createdAt=0、清單照回', () => {
    const { gas } = loadGas({ driveFails: true });
    const list = gas.getQList_();
    expect(list).toHaveLength(2);
    expect(list[0].createdAt).toBe(0);
  });
});
