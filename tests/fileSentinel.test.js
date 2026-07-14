// 檔案欄的「沿用上次」哨兵裁決 ＋ `_file` 上傳登記表 ＋ fileID 歸屬驗證（Phase 23）。
// 以 new Function 載入 Code.js 並 stub GAS 全域（比照 inviteRpc.test.js 的載入模式）。
// 這裡守的是安全紅線：**前端沒有傳任意 fileID 進紀錄的通道**——
//   1. 沿用舊檔只送哨兵，fileID 由伺服器從本人紀錄表最後一列查出（哨兵絕不落地）
//   2. 新上傳的 fileID 必須在 _file 有登記（同問卷＋同人＋同欄位），或命中本人上次送出的值
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac, createHash } from 'node:crypto';
import _ from 'lodash';

const source = readFileSync(new URL('../src/Code.js', import.meta.url), 'utf8');

const REFER = 'REFER_SHEET_ID';
const RECORD = 'RECORD_SHEET_ID';
const PKEY = 'S001';
const DAY = 24 * 60 * 60 * 1000;

function toBuffer(data) {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  return Buffer.from(data.map((b) => b & 0xff));
}

function makeListRow() {
  const row = new Array(15).fill('');
  row[0] = '測試問卷';
  row[1] = REFER;
  row[2] = RECORD;
  row[3] = Date.now() + 30 * DAY;
  row[6] = ''; // 無簽名格
  row[12] = 'admin@example.com';
  row[14] = '是';
  return row;
}

// 問卷結構：A=uid(主鍵 P-T)、B=doc(檔案欄 F-F)、C=num(數字欄 F-N，用來驗「哨兵不是逃生門」)
// 第 1~8 列＝id／名稱／type／format／group／content／must／nullable，第 9 列起是名冊
const referRows = [
  ['uid', 'doc', 'num'],
  ['學號', '證明文件', '座號'],
  ['P', 'F', 'F'],
  ['T', 'F', 'N'],
  ['', '', ''],
  ['', '', ''],
  ['', '', ''],
  ['', '', ''],
  [PKEY, '', ''],
];

// draftEnabled：draftSheetID 有沒有設（未設＝_file 不記、驗證跳過，維持舊行為）
function loadGas({ recordRows = [], fileRows = null, draftEnabled = true } = {}) {
  const store = {
    jwtSecret: 'unit-test-secret',
    draftEncSecret: 'unit-test-draft-secret',
    listSheetID: 'LIST_SHEET_ID',
    universalStorageID: 'STORAGE_FOLDER_ID',
    emailLog: 'EMAIL_LOG_ID',
    systemTitle: '測試系統',
  };
  if (draftEnabled) store.draftSheetID = 'DRAFT_SHEET_ID';

  const fileStore = fileRows === null ? [] : fileRows;
  const makeSheet = (rows) => ({
    getLastRow: () => rows.length,
    getDataRange: () => ({ getValues: () => rows.map((r) => [...r]) }),
    appendRow: (row) => rows.push([...row]),
    setFrozenRows: () => {},
  });
  let fileSheetFake = fileRows === null ? null : makeSheet(fileStore);
  const createdFiles = [];
  // 送出成功後 writeRecord 會清本人的邀請列（_invites），這裡沒有邀請、只要不炸即可
  const inviteSheetFake = {
    getLastRow: () => 0,
    getRange: () => ({ getValues: () => [] }),
    appendRow: () => {},
    setFrozenRows: () => {},
  };

  const fakeSpreadsheetApp = {
    openById: (id) => {
      if (id === 'DRAFT_SHEET_ID') {
        return {
          getSheetByName: (name) =>
            name === '_file' ? fileSheetFake : name === '_invites' ? inviteSheetFake : null,
          insertSheet: (name) => {
            if (name === '_file') {
              fileSheetFake = makeSheet(fileStore);
              return fileSheetFake;
            }
            if (name === '_invites') {
              return inviteSheetFake;
            }
            return makeSheet([]);
          },
        };
      }
      if (id === REFER) {
        return { getSheets: () => [{ getDataRange: () => ({ getValues: () => referRows }) }] };
      }
      if (id === RECORD) {
        return {
          getSheets: () => [
            {
              appendRow: (row) => recordRows.push([...row]),
              getDataRange: () => ({ getValues: () => recordRows.map((r) => [...r]) }),
            },
          ],
        };
      }
      if (id === 'EMAIL_LOG_ID') return { getSheets: () => [{ appendRow: () => {} }] };
      return { getSheets: () => [{ getRange: () => ({ getValues: () => [makeListRow()] }) }] };
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
    newBlob: (bytes, type, name) => ({
      getBytes: () => bytes,
      getContentType: () => type,
      getName: () => name,
      getDataAsString: () => toBuffer(bytes).toString('utf8'),
    }),
    getUuid: () => '00000000-0000-4000-8000-000000000001',
  };
  const fakeDriveApp = {
    getFolderById: () => ({
      createFile: (blob) => {
        const file = {
          id: 'NEWFILE_' + createdFiles.length,
          name: blob.getName(),
          getId() {
            return this.id;
          },
          setName(n) {
            this.name = n;
            return this;
          },
          getUrl() {
            return 'https://drive.example/view/' + this.id;
          },
        };
        createdFiles.push(file);
        return file;
      },
    }),
    getFileById: (id) => ({ getUrl: () => 'https://drive.example/view/' + id }),
    searchFiles: () => ({ hasNext: () => false }),
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
      issueToken_, writeRecord_, saveFile_, deriveDraftKey_,
      latestRecordRowFor_, resolveReuseFileId_, fileLogHasUpload_, appendFileLog_,
      REUSE_LAST_FILE_SENTINEL, FILE_HEADER, FILE_SHEET_NAME
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
    fakeDriveApp,
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
  return { gas, recordRows, fileRows: fileStore, store, createdFiles };
}

// 紀錄列：A 時間、B accept、C 主鍵、D 簽名、E 分組、F 起依 headers 順序
// （uid=pos0→索引5、doc=pos1→索引6、num=pos2→索引7）
function makeRecordRow(docFileId, { pkey = PKEY } = {}) {
  return [Date.now(), true, pkey, '', '', pkey, docFileId, ''];
}
// _file 登記列：A 時間、B refer、C 上傳者假名、D **欄位 ID**（不是 pos——pos 會隨對照表單
// 插欄/搬欄位移，舊登記列就對到別的欄位了）、E fileID、F mimeType
function makeFileRow(gas, fileID, { columnID = 'doc', pkey = PKEY } = {}) {
  return [Date.now(), REFER, gas.deriveDraftKey_('id', REFER, pkey), columnID, fileID, 'image/png'];
}
function tokenFor(gas) {
  return gas.issueToken_(REFER, PKEY, Date.now());
}
// 送出一筆：只帶可填欄（前端 columnDB 過濾後就只有 F|C|G，主鍵欄不在其中——
// 送主鍵欄會被「你竄改數據？…不允許寫入！」擋下）
function submit(gas, token, docValue) {
  return gas.writeRecord_(REFER, RECORD, token, [{ id: 'doc', value: docValue }], true, [], '');
}

describe('純函數：紀錄表最後一列與 fileID 取值', () => {
  it('latestRecordRowFor_ 取該主鍵的最後一列（多次送出取最新）', () => {
    const { gas } = loadGas();
    const rows = [makeRecordRow('OLD'), [1, true, 'OTHER', '', '', 'OTHER', 'X'], makeRecordRow('NEW')];
    expect(gas.latestRecordRowFor_(rows, PKEY)[6]).toBe('NEW');
    expect(gas.latestRecordRowFor_(rows, 'NOBODY')).toBe(null);
  });

  it('resolveReuseFileId_ 走 pos+5 偏移；無列或空值回 null', () => {
    const { gas } = loadGas();
    expect(gas.resolveReuseFileId_(makeRecordRow('FID'), 1)).toBe('FID');
    expect(gas.resolveReuseFileId_(makeRecordRow(''), 1)).toBe(null);
    expect(gas.resolveReuseFileId_(null, 1)).toBe(null);
  });

  it('fileLogHasUpload_ 要問卷＋上傳者＋欄位ID＋fileID 四者全中', () => {
    const { gas } = loadGas();
    const me = gas.deriveDraftKey_('id', REFER, PKEY);
    const rows = [gas.FILE_HEADER, makeFileRow(gas, 'FID')];
    expect(gas.fileLogHasUpload_(rows, REFER, me, 'doc', 'FID')).toBe(true);
    // 別人上傳的同一個檔（假名不同）→ 不算他的
    expect(gas.fileLogHasUpload_(rows, REFER, gas.deriveDraftKey_('id', REFER, 'S999'), 'doc', 'FID')).toBe(false);
    // 換欄位、換問卷、換檔案 → 都不中
    expect(gas.fileLogHasUpload_(rows, REFER, me, 'other_col', 'FID')).toBe(false);
    expect(gas.fileLogHasUpload_(rows, 'OTHER_REFER', me, 'doc', 'FID')).toBe(false);
    expect(gas.fileLogHasUpload_(rows, REFER, me, 'doc', 'OTHER')).toBe(false);
    // 表頭列的字面字串不會誤中
    expect(gas.fileLogHasUpload_([gas.FILE_HEADER], REFER, 'x', 'doc', 'y')).toBe(false);
  });
});

describe('saveFile：上傳成功後在 _file 登記', () => {
  it('appendRow 一筆 [ms, refer, 上傳者假名, pos, fileID, mime]，分頁自帶表頭', () => {
    const ctx = loadGas();
    const report = ctx.gas.saveFile_(REFER, RECORD, tokenFor(ctx.gas), 'doc', {
      filename: 'a.png',
      mimeType: 'image/png',
      bytes: [1, 2, 3],
    });
    expect(report.status).toBe(true);
    expect(ctx.fileRows[0]).toEqual(ctx.gas.FILE_HEADER);
    const row = ctx.fileRows[1];
    expect(row[1]).toBe(REFER);
    expect(row[2]).toBe(ctx.gas.deriveDraftKey_('id', REFER, PKEY)); // 假名，非明文主鍵
    expect(row[2]).not.toBe(PKEY);
    expect(row[3]).toBe('doc'); // 欄位 ID（不是 pos）
    expect(row[4]).toBe(report.fileID);
    expect(row[5]).toBe('image/png');
    expect(typeof row[0]).toBe('number'); // ms timestamp
  });

  it('draftSheetID 未設：靜默不記，上傳照常成功', () => {
    const ctx = loadGas({ draftEnabled: false });
    const report = ctx.gas.saveFile_(REFER, RECORD, tokenFor(ctx.gas), 'doc', {
      filename: 'a.png',
      mimeType: 'image/png',
      bytes: [1, 2, 3],
    });
    expect(report.status).toBe(true);
    expect(ctx.fileRows.length).toBe(0);
  });
});

describe('writeRecord：沿用舊檔哨兵', () => {
  it('哨兵 → 伺服器從本人紀錄表最後一列查出 fileID 落地（哨兵本身絕不落地）', () => {
    const ctx = loadGas({ recordRows: [makeRecordRow('OLDFILE')] });
    const report = submit(ctx.gas, tokenFor(ctx.gas), ctx.gas.REUSE_LAST_FILE_SENTINEL);
    expect(report.status).toBe(true);
    const written = ctx.recordRows[ctx.recordRows.length - 1];
    expect(written[6]).toBe('OLDFILE');
    expect(written).not.toContain(ctx.gas.REUSE_LAST_FILE_SENTINEL);
  });

  it('查無先前檔案（沒送出過）→ 整筆擋下要求重傳', () => {
    const ctx = loadGas({ recordRows: [] });
    const report = submit(ctx.gas, tokenFor(ctx.gas), ctx.gas.REUSE_LAST_FILE_SENTINEL);
    expect(report.status).toBe(false);
    expect(report.errorLog.join('')).toContain('重新上傳');
    expect(ctx.recordRows.length).toBe(0);
  });

  it('別人的紀錄不會被沿用（只查本人 pkey 的列）', () => {
    const ctx = loadGas({ recordRows: [makeRecordRow('OTHERS_FILE', { pkey: 'S999' })] });
    const before = ctx.recordRows.length;
    const report = submit(ctx.gas, tokenFor(ctx.gas), ctx.gas.REUSE_LAST_FILE_SENTINEL);
    expect(report.status).toBe(false);
    expect(ctx.recordRows.length).toBe(before); // 沒有新列被寫進去
  });

  it('非檔案欄送哨兵：走該欄格式檢查被擋（哨兵不是逃生門）', () => {
    const ctx = loadGas();
    const report = ctx.gas.writeRecord_(
      REFER,
      RECORD,
      tokenFor(ctx.gas),
      [
        { id: 'doc', value: '' },
        { id: 'num', value: ctx.gas.REUSE_LAST_FILE_SENTINEL }, // 數字欄被塞哨兵
      ],
      true,
      [],
      ''
    );
    expect(report.status).toBe(false); // 哨兵在非檔案欄沒有特權，照走格式檢查
    expect(ctx.recordRows.length).toBe(0);
  });
});

describe('writeRecord：新上傳的 fileID 驗歸屬', () => {
  it('_file 有登記 → 放行落地', () => {
    const ctx = loadGas({ fileRows: [] });
    ctx.fileRows.push(makeFileRow(ctx.gas, 'MINE'));
    const report = submit(ctx.gas, tokenFor(ctx.gas), 'MINE');
    expect(report.status).toBe(true);
    expect(ctx.recordRows[0][6]).toBe('MINE');
  });

  it('_file 查無、但命中本人上次送出的同欄 fileID → 放行（涵蓋登記表上線前的舊暫存）', () => {
    const ctx = loadGas({ recordRows: [makeRecordRow('LEGACY')], fileRows: [] });
    const report = submit(ctx.gas, tokenFor(ctx.gas), 'LEGACY');
    expect(report.status).toBe(true);
    expect(ctx.recordRows[ctx.recordRows.length - 1][6]).toBe('LEGACY');
  });

  it('來源不明的 fileID（沒登記、也不是自己上次送出的）→ 整筆擋下', () => {
    const ctx = loadGas({ fileRows: [] });
    ctx.fileRows.push(makeFileRow(ctx.gas, 'MINE'));
    const report = submit(ctx.gas, tokenFor(ctx.gas), 'SOMEONE_ELSES_FILE');
    expect(report.status).toBe(false);
    expect(report.errorLog.join('')).toContain('檔案來源無法確認');
    expect(ctx.recordRows.length).toBe(0);
  });

  it('別人登記的 fileID 冒充不了（假名綁 pkey）', () => {
    const ctx = loadGas({ fileRows: [] });
    ctx.fileRows.push(makeFileRow(ctx.gas, 'THEIRS', { pkey: 'S999' }));
    const report = submit(ctx.gas, tokenFor(ctx.gas), 'THEIRS');
    expect(report.status).toBe(false);
    expect(ctx.recordRows.length).toBe(0);
  });

  it('draftSheetID 未設：無登記表可查，跳過驗證維持舊行為（誠實邊界）', () => {
    const ctx = loadGas({ draftEnabled: false });
    const report = submit(ctx.gas, tokenFor(ctx.gas), 'ANY_FILE');
    expect(report.status).toBe(true);
    expect(ctx.recordRows[0][6]).toBe('ANY_FILE');
  });

  it('saveFile 上傳完直接送出（端到端）：登記命中、fileID 落地', () => {
    const ctx = loadGas();
    const up = ctx.gas.saveFile_(REFER, RECORD, tokenFor(ctx.gas), 'doc', {
      filename: 'a.png',
      mimeType: 'image/png',
      bytes: [1, 2, 3],
    });
    const report = submit(ctx.gas, tokenFor(ctx.gas), up.fileID);
    expect(report.status).toBe(true);
    expect(ctx.recordRows[0][6]).toBe(up.fileID);
  });
});
