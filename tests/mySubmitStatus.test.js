// 「查詢我填答了沒」（mySubmitStatus）：需認證的唯讀查詢。
// 以 new Function 載入 Code.js 並 stub GAS 全域（比照 fileSentinel.test.js 的載入模式）。
// 這裡守的紅線是：**這支不能變成 Phase 21 防枚舉的旁路**——冷卻要擋、失敗要記 _logins、
// O 欄「開放進入」非「是」要拒絕，全部與 readRecord_ 同規則。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac, createHash } from 'node:crypto';
import _ from 'lodash';

const source = readFileSync(new URL('../src/Code.js', import.meta.url), 'utf8');

const REFER = 'REFER_SHEET_ID';
const RECORD = 'RECORD_SHEET_ID';
const PKEY = 'S001';
const PASSWORD = 'A123456789';
const DAY = 24 * 60 * 60 * 1000;

function toBuffer(data) {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  return Buffer.from(data.map((b) => b & 0xff));
}

// 問卷結構：A=uid（主鍵 P-T）、B=pw（認證欄 A-T，就是這張表的「密碼」欄）、C=memo（F-T）
const referRows = [
  ['uid', 'pw', 'memo'],
  ['學號', '密碼', '備註'],
  ['P', 'A', 'F'],
  ['T', 'T', 'T'],
  ['', '', ''],
  ['', '', ''],
  ['', '', ''],
  ['', '', ''],
  [PKEY, PASSWORD, ''],
];

function makeListRow({ writeAllowed = '是', signNames = '導師;家長' } = {}) {
  const row = new Array(15).fill('');
  row[0] = '測試問卷';
  row[1] = REFER;
  row[2] = RECORD;
  row[3] = Date.now() + 30 * DAY;
  row[6] = signNames;
  row[10] = '登入失敗提示';
  row[12] = 'admin@example.com';
  row[14] = writeAllowed;
  return row;
}

// 紀錄列：A 時間、B accept(是否為修改)、C 主鍵、D 簽名 fileID(以 ; 串接)、E 分組、F 起是答案
function makeRecordRow(tick, { pkey = PKEY, modified = false, signs = '' } = {}) {
  return [tick, modified, pkey, signs, '', pkey, PASSWORD, ''];
}

function loadGas({ recordRows = [], listRow = makeListRow(), draftEnabled = true } = {}) {
  const store = {
    jwtSecret: 'unit-test-secret',
    draftEncSecret: 'unit-test-draft-secret',
    listSheetID: 'LIST_SHEET_ID',
    universalStorageID: 'STORAGE_FOLDER_ID',
    systemTitle: '測試系統',
  };
  if (draftEnabled) store.draftSheetID = 'DRAFT_SHEET_ID';

  const loginRows = [];
  const loginSheetFake = {
    getLastRow: () => loginRows.length,
    getDataRange: () => ({ getValues: () => loginRows.map((r) => [...r]) }),
    // myLoginHistory_ 的尾端回掃（列號 1-based，含表頭語意）
    getRange: (row, col, numRows, numCols) => ({
      getValues: () =>
        loginRows
          .slice(row - 1, row - 1 + numRows)
          .map((r) => [...r].slice(col - 1, col - 1 + numCols)),
    }),
    appendRow: (row) => loginRows.push([...row]),
    setFrozenRows: () => {},
  };

  const fakeSpreadsheetApp = {
    openById: (id) => {
      if (id === 'DRAFT_SHEET_ID') {
        return {
          getSheetByName: (name) => (name === '_logins' ? loginSheetFake : null),
          insertSheet: () => loginSheetFake,
        };
      }
      if (id === REFER) {
        return { getSheets: () => [{ getDataRange: () => ({ getValues: () => referRows }) }] };
      }
      if (id === RECORD) {
        return {
          getSheets: () => [
            { getDataRange: () => ({ getValues: () => recordRows.map((r) => [...r]) }) },
          ],
        };
      }
      // listSheetID：A:O
      return { getSheets: () => [{ getRange: () => ({ getValues: () => [listRow] }) }] };
    },
  };
  const fakeUtilities = {
    computeHmacSha256Signature: (data, key) => {
      const digest = createHmac('sha256', key).update(data).digest();
      return [...digest].map((b) => (b > 127 ? b - 256 : b));
    },
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (alg, str) =>
      [...createHash(alg).update(str, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
    base64EncodeWebSafe: (data) => toBuffer(data).toString('base64url'),
    base64DecodeWebSafe: (str) => [...Buffer.from(str, 'base64url')],
    base64Encode: (data) => toBuffer(data).toString('base64'),
    base64Decode: (str) => [...Buffer.from(str, 'base64')],
    getUuid: () => '00000000-0000-4000-8000-000000000001',
  };
  const fakeDriveApp = {
    getFileById: (id) => ({
      getUrl: () => 'https://drive.example/view/' + id,
      getBlob: () => ({
        getContentType: () => 'image/png',
        getBytes: () => [...Buffer.from('sign-' + id, 'utf8')],
      }),
    }),
    searchFiles: () => ({ hasNext: () => false }),
  };
  const cacheMap = new Map();
  const factory = new Function(
    'LodashGS',
    'PropertiesService',
    'Utilities',
    'SpreadsheetApp',
    'DriveApp',
    'LockService',
    'MailApp',
    'ScriptApp',
    'Session',
    'CacheService',
    `${source}\n;return { mySubmitStatus_, summarizeUserRecords_, answersFromRecordRow_, filterLoginRows_, deriveDraftKey_, loginFailMax_ };`
  );
  const gas = factory(
    { load: () => _ },
    {
      getScriptProperties: () => ({
        getProperty: (key) => (key in store ? store[key] : null),
        setProperty: (key, value) => {
          store[key] = value;
        },
      }),
    },
    fakeUtilities,
    fakeSpreadsheetApp,
    fakeDriveApp,
    { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    { getRemainingDailyQuota: () => 0, sendEmail: () => {} },
    { getService: () => ({ getUrl: () => 'https://script.example/exec' }) },
    { getActiveUser: () => ({ getEmail: () => '' }) },
    {
      getScriptCache: () => ({
        get: (k) => (cacheMap.has(k) ? cacheMap.get(k) : null),
        put: (k, v) => cacheMap.set(k, String(v)),
        remove: (k) => cacheMap.delete(k),
      }),
    }
  );
  return { gas, loginRows, cacheMap };
}

function authOf({ pkey = PKEY, pw = PASSWORD } = {}) {
  return [
    { id: 'uid', value: pkey },
    { id: 'pw', value: pw },
  ];
}

describe('純函數：summarizeUserRecords_', () => {
  it('無紀錄回 length:0 與空陣列', () => {
    const { gas } = loadGas();
    const summary = gas.summarizeUserRecords_([makeRecordRow(1, { pkey: 'OTHER' })], PKEY);
    expect(summary.length).toBe(0);
    expect(summary.lastTick).toBe(0);
    expect(summary.modified).toBe(false);
    expect(summary.history).toEqual([]);
    expect(summary.signIDs).toEqual([]);
  });

  it('多筆時 length 為次數、lastTick/modified 取最後一列、history 保持時間順', () => {
    const { gas } = loadGas();
    const rows = [
      makeRecordRow(1000, { modified: false }),
      makeRecordRow(2000, { pkey: 'OTHER', modified: true }),
      makeRecordRow(3000, { modified: true }),
    ];
    const summary = gas.summarizeUserRecords_(rows, PKEY);
    expect(summary.length).toBe(2);
    expect(summary.lastTick).toBe(3000);
    expect(summary.modified).toBe(true);
    expect(summary.history).toEqual([
      { tick: 1000, modified: false },
      { tick: 3000, modified: true },
    ]);
  });

  it('signIDs 只取最後一列、以 ; 切開並濾掉空值', () => {
    const { gas } = loadGas();
    const rows = [
      makeRecordRow(1000, { signs: 'OLD_SIGN' }),
      makeRecordRow(2000, { signs: 'SIGN_A;SIGN_B;' }),
    ];
    expect(gas.summarizeUserRecords_(rows, PKEY).signIDs).toEqual(['SIGN_A', 'SIGN_B']);
    expect(gas.summarizeUserRecords_([makeRecordRow(1000)], PKEY).signIDs).toEqual([]);
  });
});

describe('純函數：filterLoginRows_（查詢 drawer 的登入時間線）', () => {
  // _logins 列：A ms／B refer／C 明文帳號值／D 結果
  const rows = [
    [1000, REFER, PKEY, '失敗'],
    [2000, 'OTHER_REFER', PKEY, '成功'],
    [3000, REFER, 'OTHER_USER', '成功'],
    [4000, REFER, PKEY, '成功'],
    ['timestamp 時間(ms)', REFER, PKEY, '成功'],
  ];

  it('只回同一問卷同一帳號的列，且由新到舊', () => {
    const { gas } = loadGas();
    expect(gas.filterLoginRows_(rows, REFER, PKEY, 50)).toEqual([
      { tick: 4000, success: true },
      { tick: 1000, success: false },
    ]);
  });

  it('limit 生效（湊滿就停手，保留最新的幾筆）', () => {
    const { gas } = loadGas();
    expect(gas.filterLoginRows_(rows, REFER, PKEY, 1)).toEqual([{ tick: 4000, success: true }]);
  });

  it('時間欄非數字的列（表頭殘留）跳過，查無資料回空陣列', () => {
    const { gas } = loadGas();
    expect(gas.filterLoginRows_(rows, REFER, PKEY, 50).some((r) => isNaN(r.tick))).toBe(false);
    expect(gas.filterLoginRows_(rows, REFER, 'NOBODY', 50)).toEqual([]);
  });
});

describe('純函數：answersFromRecordRow_（查詢 drawer 的下載用）', () => {
  // 紀錄列前 5 欄是 metadata，欄位值從 pos+5 起
  const headers = [
    { id: 'uid', name: '學號', type: 'P', format: 'T', pos: 0 },
    { id: 'memo', name: '備註', type: 'F', format: 'T', pos: 1 },
    { id: 'doc', name: '證明文件', type: 'F', format: 'F', pos: 2 },
  ];

  it('只取可填欄（F），檔案欄拼成 Drive 連結、非檔案欄剝掉 📝 標記', () => {
    const { gas } = loadGas();
    const row = [1000, false, PKEY, '', '', PKEY, '📝我的備註', 'FILE_ID_1'];
    expect(gas.answersFromRecordRow_(headers, row)).toEqual([
      { name: '備註', value: '我的備註' },
      { name: '證明文件', value: 'https://drive.google.com/file/d/FILE_ID_1/view' },
    ]);
  });

  it('沒有紀錄列（null）回空陣列；空值不拼連結', () => {
    const { gas } = loadGas();
    expect(gas.answersFromRecordRow_(headers, null)).toEqual([]);
    const row = [1000, false, PKEY, '', '', PKEY, '', ''];
    expect(gas.answersFromRecordRow_(headers, row)).toEqual([
      { name: '備註', value: '' },
      { name: '證明文件', value: '' },
    ]);
  });
});

describe('mySubmitStatus_：認證與開放條件', () => {
  it('認證通過回送出統計與簽名 data URL', () => {
    const { gas } = loadGas({
      recordRows: [makeRecordRow(1000), makeRecordRow(2000, { modified: true, signs: 'SIGN_A' })],
    });
    const result = gas.mySubmitStatus_(REFER, RECORD, authOf());
    expect(result.length).toBe(2);
    expect(result.lastTick).toBe(2000);
    expect(result.modified).toBe(true);
    expect(result.history.length).toBe(2);
    expect(result.hasSignatureSlot).toBe(true);
    expect(result.signatures.length).toBe(1);
    // 最後一次的答案（給下載鈕）：只有可填欄（本結構只有 memo 一個 F 欄）
    expect(result.lastAnswers).toEqual([{ name: '備註', value: '' }]);
    expect(result.signatures[0]).toContain('data:image/png;base64,');
    // 不回任何個資：沒有主鍵值、沒有答案內容、沒有 token/draftKeys
    expect(JSON.stringify(result)).not.toContain(PKEY);
    expect(result.token).toBeUndefined();
    expect(result.draftKeys).toBeUndefined();
  });

  it('沒送出過的人回 length:0（不是 false）', () => {
    const { gas } = loadGas();
    const result = gas.mySubmitStatus_(REFER, RECORD, authOf());
    expect(result.length).toBe(0);
    expect(result.history).toEqual([]);
  });

  it('認證欄位錯誤回 false，且 _logins 記一筆失敗（沒繞過稽核）', () => {
    const { gas, loginRows } = loadGas();
    expect(gas.mySubmitStatus_(REFER, RECORD, authOf({ pw: 'WRONG' }))).toBe(false);
    const dataRows = loginRows.filter((r) => r[1] === REFER);
    expect(dataRows.length).toBe(1);
    expect(dataRows[0][2]).toBe(PKEY);
    expect(dataRows[0][3]).toBe('失敗');
  });

  it('連錯滿 loginFailMax 後被冷卻擋下（回 throttled，不再驗證）', () => {
    const { gas, loginRows } = loadGas();
    const max = gas.loginFailMax_();
    for (let i = 0; i < max; i++) {
      expect(gas.mySubmitStatus_(REFER, RECORD, authOf({ pw: 'WRONG' }))).toBe(false);
    }
    const blocked = gas.mySubmitStatus_(REFER, RECORD, authOf());
    expect(blocked.throttled).toBe(true);
    expect(blocked.cooldownSeconds).toBeGreaterThan(0);
    // 被擋下的那次不進 _logins（與 readRecord_ 一樣：check 先於 record）
    expect(loginRows.filter((r) => r[1] === REFER).length).toBe(max);
  });

  it('O 欄「開放進入」非「是」一律拒絕（與登入同規則）', () => {
    const { gas } = loadGas({
      recordRows: [makeRecordRow(1000)],
      listRow: makeListRow({ writeAllowed: '否' }),
    });
    expect(gas.mySubmitStatus_(REFER, RECORD, authOf())).toBe(false);
  });

  it('問卷沒有簽名格時 hasSignatureSlot 為 false', () => {
    const { gas } = loadGas({
      recordRows: [makeRecordRow(1000)],
      listRow: makeListRow({ signNames: '' }),
    });
    expect(gas.mySubmitStatus_(REFER, RECORD, authOf()).hasSignatureSlot).toBe(false);
  });
});
