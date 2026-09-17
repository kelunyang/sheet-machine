// 主鍵落地的 📝 資料標記（2026-09-17）。
// 事故：116 部署的學校代碼 011310 送出後紀錄表 C 欄變成 11310（試算表把純數字字串自動轉成數字），
// 名冊的 011310 永遠對不上——填答率 0、查不到上次紀錄。把欄格式設成純文字也擋不住。
// 以 new Function 載入 Code.js 並 stub GAS 全域（比照 fileSentinel.test.js 的載入模式）。
//
// 這裡守的紅線：
//   1. 主鍵寫進任何試算表都帶 📝（紀錄表 C、_invites D、_logins C、_email F），空主鍵照舊落空格。
//   2. 讀回比對一律先剝 📝——**沒有標記的舊列照樣比得上**（上線前已送出的紀錄不能變成「沒填過」）。
//   3. 📝 只存在儲存格裡：剝完的值才能拿去比對、算 HMAC、簽 token、組檔名。
//   4. tools/export.js 各放一份 helper（另一個 GAS 專案叫不到 Code.js），字面值必須一致。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac, createHash } from 'node:crypto';
import _ from 'lodash';

const source = readFileSync(new URL('../src/Code.js', import.meta.url), 'utf8');
const toolSource = readFileSync(new URL('../tools/export.js', import.meta.url), 'utf8');

const REFER = 'REFER_SHEET_ID';
const RECORD = 'RECORD_SHEET_ID';
const PKEY = '011310'; // 開頭是 0 的純數字主鍵：沒有標記就會被吃掉
const DAY = 24 * 60 * 60 * 1000;

function toBuffer(data) {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  return Buffer.from(data.map((b) => b & 0xff));
}

// 模擬試算表 appendRow 的自動轉型：長得像數字的字串存成數字（開頭的 0 就此消失）
function sheetsCoerce(value) {
  if (typeof value === 'string' && /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i.test(value)) {
    return Number(value);
  }
  return value;
}

function makeListRow() {
  const row = new Array(15).fill('');
  row[0] = '測試問卷';
  row[1] = REFER;
  row[2] = RECORD;
  row[3] = Date.now() + 30 * DAY;
  row[12] = 'admin@example.com';
  row[13] = '是';
  return row;
}

// 問卷結構：A=uid(主鍵 P-T)、B=memo(自由文字 F-T)
const referRows = [
  ['uid', 'memo'],
  ['學校代碼', '備註'],
  ['P', 'F'],
  ['T', 'T'],
  ['', ''],
  ['', ''],
  ['', ''],
  ['', ''],
  [PKEY, ''],
];

// 會吃 0 的假分頁：appendRow 過 sheetsCoerce，讀取支援 getDataRange 與 getRange(row, col, n, m)
function coercingSheet(rows) {
  return {
    appendRow: (row) => rows.push(row.map(sheetsCoerce)),
    getDataRange: () => ({ getValues: () => rows.map((r) => [...r]) }),
    getLastRow: () => rows.length,
    getRange: (row, col, numRows, numCols) => ({
      getValues: () =>
        rows.slice(row - 1, row - 1 + numRows).map((r) => [...r].slice(col - 1, col - 1 + numCols)),
    }),
    setFrozenRows: () => {},
  };
}

// draftEnabled：有設 draftSheetID 才會記 _logins、送出後作廢邀請
function loadGas({
  recordRows = [],
  roster = referRows,
  draftEnabled = false,
  inviteRows = [],
  loginRows = [],
} = {}) {
  const store = {
    jwtSecret: 'unit-test-secret',
    draftEncSecret: 'unit-test-draft-secret',
    listSheetID: 'LIST_SHEET_ID',
    universalStorageID: 'STORAGE_FOLDER_ID',
    systemTitle: '測試系統',
  };
  if (draftEnabled) store.draftSheetID = 'DRAFT_SHEET_ID';
  const tabs = { _invites: coercingSheet(inviteRows), _logins: coercingSheet(loginRows) };
  const fakeSpreadsheetApp = {
    openById: (id) => {
      if (id === 'DRAFT_SHEET_ID') {
        return {
          // 空分頁當作還沒建：程式才會照真實流程先 append 表頭（myLoginHistory_ 固定跳過第 1 列）
          getSheetByName: (name) =>
            name in tabs && tabs[name].getLastRow() > 0 ? tabs[name] : null,
          insertSheet: (name) => tabs[name] || coercingSheet([]),
        };
      }
      if (id === REFER) {
        return { getSheets: () => [{ getDataRange: () => ({ getValues: () => roster }) }] };
      }
      if (id === RECORD) {
        return {
          getSheets: () => [
            {
              appendRow: (row) => recordRows.push(row.map(sheetsCoerce)),
              getDataRange: () => ({ getValues: () => recordRows.map((r) => [...r]) }),
              getLastRow: () => recordRows.length,
              getRange: (row, col, numRows, numCols) => ({
                getValues: () =>
                  recordRows
                    .slice(row - 1, row - 1 + numRows)
                    .map((r) => [...r].slice(col - 1, col - 1 + numCols)),
              }),
            },
          ],
        };
      }
      return {
        getSheets: () => [
          { getMaxColumns: () => 15, getRange: () => ({ getValues: () => [makeListRow()] }) },
        ],
      };
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
    // JWT 解 payload 走 newBlob(bytes).getDataAsString()
    newBlob: (bytes) => ({ getDataAsString: () => toBuffer(bytes).toString('utf8') }),
    getUuid: () => '00000000-0000-4000-8000-000000000001',
  };
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
    `${source}\n;return {
      PKEY_MARKER, pkeyCell_, pkeyFromCell_, issueToken_, writeRecord_, compareSheets,
      latestRecordRowFor_, latestRecordRowsByPkey_, summarizeUserRecords_,
      inviteRowOf_, parseInviteRow_, compactInviteRows_, latestInvites_, INVITE_HEADER, INVITE_SHEET_COLS,
      filterLoginRows_, analyzeLoginRows_, readRecord_, mySubmitStatus_
    };`
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
    {
      getFileById: (id) => ({ getUrl: () => 'https://drive.example/view/' + id }),
      searchFiles: () => ({ hasNext: () => false }),
    },
    { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    { getRemainingDailyQuota: () => 0, sendEmail: () => {} },
    { getService: () => ({ getUrl: () => 'https://script.example/exec' }) },
    { getActiveUser: () => ({ getEmail: () => '' }) },
    (() => {
      const map = new Map();
      const cache = {
        get: (k) => (map.has(k) ? map.get(k) : null),
        put: (k, v) => map.set(k, String(v)),
        remove: (k) => map.delete(k),
      };
      return { getScriptCache: () => cache };
    })()
  );
  return { gas, recordRows, inviteRows, loginRows };
}

function submit(gas) {
  const token = gas.issueToken_(REFER, PKEY, Date.now());
  return gas.writeRecord_(REFER, RECORD, token, [{ id: 'memo', value: '測試' }], true, [], '');
}

// 紀錄列：A 時間、B accept、C 主鍵、D 簽名、E 分組、F 起是答案
function recordRow(pkeyCell, tick = 1) {
  return [tick, true, pkeyCell, '', '', '', '答案'];
}

describe('純函數：pkeyCell_／pkeyFromCell_', () => {
  const { gas } = loadGas();

  it('寫入加 📝；空主鍵照舊落空格，不寫孤零零的 📝', () => {
    expect(gas.pkeyCell_('011310')).toBe('📝011310');
    expect(gas.pkeyCell_('user@example.com')).toBe('📝user@example.com');
    expect(gas.pkeyCell_('')).toBe('');
    expect(gas.pkeyCell_(null)).toBe('');
    expect(gas.pkeyCell_(undefined)).toBe('');
  });

  it('讀回剝開頭一個 📝；沒有標記的舊值原樣（含已被轉成數字的舊列）', () => {
    expect(gas.pkeyFromCell_('📝011310')).toBe('011310');
    expect(gas.pkeyFromCell_('S001')).toBe('S001');
    expect(gas.pkeyFromCell_(11310)).toBe('11310');
    expect(gas.pkeyFromCell_('')).toBe('');
    expect(gas.pkeyFromCell_(null)).toBe('');
    expect(gas.pkeyFromCell_(undefined)).toBe('');
  });

  it('只剝開頭、只剝一個：一來一回永遠拿回原值', () => {
    expect(gas.pkeyFromCell_('A📝B')).toBe('A📝B');
    ['011310', 'S001', '📝weird', 'user@example.com'].forEach((key) => {
      expect(gas.pkeyFromCell_(gas.pkeyCell_(key))).toBe(key);
    });
  });
});

describe('事故重現：開頭是 0 的主鍵送出後還對得上名冊', () => {
  it('沒有標記時，試算表會把 011310 吃成 11310（證明這個 fake 真的會吃 0）', () => {
    expect(sheetsCoerce('011310')).toBe(11310);
    expect(sheetsCoerce('📝011310')).toBe('📝011310');
  });

  it('writeRecord_ 寫進紀錄表 C 欄的是 📝011310，沒被轉成數字', () => {
    const { gas, recordRows } = loadGas();
    expect(submit(gas).status).toBe(true);
    expect(recordRows).toHaveLength(1);
    expect(recordRows[0][2]).toBe('📝011310');
  });

  it('送出後：填答率 1/1、查得到上次紀錄與送出次數', () => {
    const { gas, recordRows } = loadGas();
    submit(gas);
    submit(gas);
    const stat = gas.compareSheets(REFER, RECORD);
    expect(stat.filled).toBe(1);
    expect(stat.total).toBe(1);
    expect(stat.rate).toBe(100);
    expect(gas.latestRecordRowFor_(recordRows, PKEY)).not.toBe(null);
    expect(gas.summarizeUserRecords_(recordRows, PKEY).length).toBe(2);
    expect(Object.keys(gas.latestRecordRowsByPkey_(recordRows))).toEqual([PKEY]);
  });
});

describe('相容：加標記之前送出的舊列照樣認得', () => {
  it('同一人舊列（無標記）＋新列（有標記）算同一人、次數相加、最後一列取新列', () => {
    const { gas } = loadGas();
    const rows = [recordRow('S001', 1), recordRow('📝S001', 2)];
    expect(gas.summarizeUserRecords_(rows, 'S001').length).toBe(2);
    expect(gas.latestRecordRowFor_(rows, 'S001')[0]).toBe(2);
    expect(Object.keys(gas.latestRecordRowsByPkey_(rows))).toEqual(['S001']);
  });

  it('compareSheets：名冊 S001／S002／S003，紀錄表一列舊格式一列新格式 → 2/3', () => {
    const roster = [...referRows.slice(0, 8), ['S001', ''], ['S002', ''], ['S003', '']];
    const recordRows = [recordRow('S001'), recordRow('📝S002')];
    const { gas } = loadGas({ recordRows, roster });
    const stat = gas.compareSheets(REFER, RECORD);
    expect(stat.filled).toBe(2);
    expect(stat.total).toBe(3);
  });
});

describe('整條流程：0 開頭的主鍵送出後，各功能都找得到本人（紀錄表／_logins／_invites 都會吃 0）', () => {
  const AUTH = () => [{ id: 'uid', value: PKEY }];

  it('readRecord_：_logins 記 📝011310；送出次數與「你上次的答案」都拿得到', () => {
    const { gas, loginRows } = loadGas({ draftEnabled: true });
    submit(gas);
    submit(gas);
    const out = gas.readRecord_(REFER, RECORD, AUTH());
    expect(out.status.length).toBe(2);
    expect(out.headers.find((h) => h.id === 'memo').lastInput).toBe('測試');
    const logged = loginRows.filter((r) => r[1] === REFER);
    expect(logged.at(-1)[2]).toBe('📝011310');
  });

  it('mySubmitStatus_：送出次數、上次答案、自己的登入時間線都拿得到', () => {
    const { gas } = loadGas({ draftEnabled: true });
    submit(gas);
    submit(gas);
    gas.readRecord_(REFER, RECORD, AUTH());
    const out = gas.mySubmitStatus_(REFER, RECORD, AUTH());
    expect(out.length).toBe(2);
    expect(out.lastAnswers.find((a) => a.value === '測試')).toBeTruthy();
    expect(out.logins.length).toBe(2); // readRecord_ 一次＋這次查詢一次，都是 011310 本人
  });

  it('送出後作廢本人的邀請：_invites 的 📝011310 列認得是本人，append consumed 終態', () => {
    const inviteRows = [];
    const { gas } = loadGas({ draftEnabled: true, inviteRows });
    inviteRows.push([...gas.INVITE_HEADER]);
    const pending = gas.inviteRowOf_({
      token: 'b'.repeat(64),
      referSSID: REFER,
      recordSSID: RECORD,
      primaryValue: PKEY,
      signName: '家長',
      email: 'parent@example.com',
      expireAt: Date.now() + DAY,
      status: 'pending',
      fileID: '',
      createdAt: 1,
      updatedAt: 1,
    });
    inviteRows.push(pending.map(sheetsCoerce));
    expect(submit(gas).status).toBe(true);
    expect(inviteRows).toHaveLength(3);
    expect(inviteRows[2][3]).toBe('📝011310');
    expect(inviteRows[2][7]).toBe('consumed');
  });
});

describe('_invites：D 欄主鍵帶標記，parse 後一律是原值', () => {
  function invite(overrides = {}) {
    return {
      token: 'a'.repeat(64),
      referSSID: REFER,
      recordSSID: RECORD,
      primaryValue: PKEY,
      signName: '家長',
      email: 'parent@example.com',
      expireAt: 9999,
      status: 'pending',
      fileID: '',
      createdAt: 1,
      updatedAt: 1,
      ...overrides,
    };
  }

  it('inviteRowOf_ 寫 📝，parseInviteRow_ 讀回原值（HMAC／token／名冊查詢吃的都是原值）', () => {
    const { gas } = loadGas();
    const row = gas.inviteRowOf_(invite());
    expect(row[3]).toBe('📝011310');
    expect(gas.parseInviteRow_(row.map(sheetsCoerce)).primaryValue).toBe(PKEY);
  });

  it('舊格式列（無標記）parse 結果不變', () => {
    const { gas } = loadGas();
    const row = gas.inviteRowOf_(invite({ primaryValue: 'S001' }));
    row[3] = 'S001';
    expect(gas.parseInviteRow_(row).primaryValue).toBe('S001');
  });

  it('同一格舊列＋新列：latestInvites_ 與離線壓縮都當成同一格，後列勝出', () => {
    const { gas } = loadGas();
    const oldRow = gas.inviteRowOf_(
      invite({ primaryValue: 'S001', status: 'pending', updatedAt: 1 })
    );
    oldRow[3] = 'S001';
    const newRow = gas.inviteRowOf_(
      invite({ primaryValue: 'S001', status: 'signed', updatedAt: 2 })
    );
    const rows = [gas.INVITE_HEADER, oldRow, newRow];
    const sheet = {
      getLastRow: () => rows.length,
      getRange: () => ({ getValues: () => rows.map((r) => [...r]) }),
    };
    const latest = gas.latestInvites_(sheet);
    expect(latest).toHaveLength(1);
    expect(latest[0].status).toBe('signed');
    const compacted = gas.compactInviteRows_(rows);
    expect(compacted).toHaveLength(1);
    expect(compacted[0][7]).toBe('signed');
  });
});

describe('_logins：C 欄帳號帶標記，查詢與掃描都認原值', () => {
  it('filterLoginRows_：新舊格式混在一起都算本人', () => {
    const { gas } = loadGas();
    const rows = [
      [1, REFER, 'S001', '失敗'],
      [2, REFER, '📝S001', '成功'],
      [3, REFER, '📝S002', '成功'],
    ];
    const mine = gas.filterLoginRows_(rows, REFER, 'S001', 50);
    expect(mine.map((r) => r.tick)).toEqual([2, 1]);
  });

  it('analyzeLoginRows_：同帳號新舊格式算同一人（連錯後成功照樣抓得到）', () => {
    const { gas } = loadGas();
    const rows = [
      [1, REFER, 'S001', '失敗'],
      [2, REFER, '📝S001', '失敗'],
      [3, REFER, '📝S001', '失敗'],
      [4, REFER, '📝S001', '成功'],
    ];
    const out = gas.analyzeLoginRows_(rows, 3)[REFER];
    expect(out.distinctFailCount).toBe(1);
    expect(out.suspectedHits).toEqual(['S001']);
  });
});

describe('tools/export.js：與 Code.js 同一個標記', () => {
  const tool = new Function(
    'LodashGS',
    'SpreadsheetApp',
    'PropertiesService',
    `${toolSource}\n;return { PKEY_MARKER_, pkeyFromCell_, injectRefer, buildReferContext_ };`
  )(
    { load: () => _ },
    { getUi: () => ({}) },
    { getScriptProperties: () => ({ getProperty: () => null }) }
  );
  const { gas } = loadGas();

  it('字面值一致、剝除規則一致', () => {
    expect(tool.PKEY_MARKER_).toBe(gas.PKEY_MARKER);
    ['📝011310', 'S001', 11310, '', null, 'A📝B'].forEach((cell) => {
      expect(tool.pkeyFromCell_(cell)).toBe(gas.pkeyFromCell_(cell));
    });
  });

  it('匯出的主鍵欄一律帶 📝（輸出也是 setValues，不帶會再被吃一次 0）', () => {
    const ctx = tool.buildReferContext_([], []);
    ctx.sigCount = 0;
    ctx.dataCols = [];
    expect(tool.injectRefer(PKEY, ctx, recordRow('📝011310'))[2]).toBe('📝011310');
    expect(tool.injectRefer('S001', ctx, recordRow('S001'))[2]).toBe('📝S001');
    expect(tool.injectRefer('', ctx, recordRow(''))[2]).toBe('');
  });
});

describe('tools/export.js 匯出整趟（輸出表也會吃 0）', () => {
  // 名冊：P01 學校代碼（P-T，不是 N 格式——原本只有 L|N|M|P|G 格式才帶 📝）、A01 驗證碼、F01 答案
  const roster = [
    ['P01', 'A01', 'F01'],
    ['學校代碼', '驗證碼', '備註'],
    ['P', 'A', 'F'],
    ['T', 'T', 'T'],
    ['', '', ''],
    ['', '', ''],
    ['', '', ''],
    ['', '', ''],
    ['011310', 'pw1', ''],
    ['S002', 'pw2', ''],
  ];
  // 紀錄表（已經落地的樣子）：兩列標題＋舊格式列、新格式列、上線前就被吃掉 0 的列
  const record = [
    ['', '', '', '', '', 'P01', 'A01', 'F01'],
    ['送出時間', '有效', '主鍵', '簽名檔ID', '分組', '學校代碼', '驗證碼', '備註'],
    [1000, true, 'S002', '', '', '', '', '舊的'],
    [2000, true, '📝S002', '', '', '', '', '新的'],
    [3000, true, '📝011310', '', '', '', '', '答案'],
    [500, true, 11310, '', '', '', '', '早就被吃掉'],
  ];

  function runExport({ uniquePrimary }) {
    let written = null;
    // 資料列是最後一次 setValues（標題列先寫），留最後一次就是輸出的資料
    const outSheet = {
      name: '',
      getName() {
        return this.name;
      },
      getRange: () => ({
        setValues: (values) => {
          written = values.map((row) => row.map(sheetsCoerce));
        },
      }),
    };
    const newSS = {
      getId: () => 'OUT_ID',
      getUrl: () => 'https://sheet.example/OUT_ID',
      getSheetByName: () => null,
      insertSheet: (name) => {
        outSheet.name = name;
        return outSheet;
      },
      getSheets: () => [outSheet],
      deleteSheet: () => {},
    };
    const tool = new Function(
      'LodashGS',
      'SpreadsheetApp',
      'PropertiesService',
      'DriveApp',
      'Session',
      'Utilities',
      `${toolSource}\n;return { runExport_ };`
    )(
      { load: () => _ },
      {
        getUi: () => ({}),
        openById: (id) => {
          const rows = id === REFER ? roster : id === RECORD ? record : null;
          if (rows === null) throw new Error('unexpected sheet ' + id);
          return {
            getSheets: () => [
              { getDataRange: () => ({ getValues: () => rows.map((r) => [...r]) }) },
            ],
          };
        },
        create: () => newSS,
        flush: () => {},
      },
      { getScriptProperties: () => ({ getProperty: () => 'EXPORT_FOLDER' }) },
      {
        getFolderById: () => ({ getName: () => '匯出' }),
        searchFiles: () => ({ hasNext: () => false }),
        getFileById: () => ({ moveTo: () => {} }),
      },
      { getActiveUser: () => ({ getEmail: () => '' }) },
      { formatDate: () => '' }
    );
    const listSS = { getSheetByName: () => ({ appendRow: () => {} }) };
    const result = tool.runExport_(listSS, ['測試問卷', REFER, RECORD], {
      headerCount: 2,
      uniquePrimary,
    });
    return { result, written };
  }

  // 輸出列：[時間, 有效, 主鍵, 分組, P01, A01, F01]（無簽名格）
  it('主鍵欄（C）與名冊帶入的主鍵題（P01）都帶 📝，輸出後 0 還在', () => {
    const { result, written } = runExport({ uniquePrimary: true });
    expect(result.ok).toBe(true);
    const row = written.find((r) => r[6] === '答案');
    expect(row[2]).toBe('📝011310');
    expect(row[4]).toBe('📝011310');
  });

  it('同一人新舊格式的列算同一人：只輸出最新一筆', () => {
    const { written } = runExport({ uniquePrimary: true });
    const s002 = written.filter((r) => r[2] === '📝S002');
    expect(s002).toHaveLength(1);
    expect(s002[0][6]).toBe('新的');
    expect(s002[0][4]).toBe('📝S002'); // 舊列也對得上名冊
    expect(written).toHaveLength(3);
  });

  it('「每一筆都輸出」時新舊兩列都在、主鍵欄統一帶 📝', () => {
    const { written } = runExport({ uniquePrimary: false });
    const s002 = written.filter((r) => r[2] === '📝S002');
    expect(s002.map((r) => r[6]).sort()).toEqual(['新的', '舊的'].sort());
  });

  it('上線前就被吃掉 0 的舊列：救不回來，照 11310 輸出、對不到名冊（不會誤配到 011310）', () => {
    const { written } = runExport({ uniquePrimary: true });
    const eaten = written.find((r) => r[6] === '早就被吃掉');
    expect(eaten[2]).toBe('📝11310');
    expect(eaten[4]).toBe(''); // 名冊沒有 11310，不回填
  });
});
