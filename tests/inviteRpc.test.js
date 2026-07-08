// 遠端簽名邀請的 RPC 層（含兩個競態防線，todo.md 明定「務必寫測試覆蓋，不能只靠 UI 擋」）：
// 1. 受邀者送出簽名當下 Lock 內重查列——撤回/重發後送出要被明確擋下
// 2. 撤回預設不信前端認知——伺服器見 signed 拒絕並回最新狀態，force 才真的撤
// 以 new Function 載入 Code.js 並 stub 全部 GAS 全域（HMAC 用 node:crypto 對應）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import _ from 'lodash';

const source = readFileSync(new URL('../src/Code.js', import.meta.url), 'utf8');

const REFER = 'REFER_SHEET_ID';
const RECORD = 'RECORD_SHEET_ID';
const DAY = 24 * 60 * 60 * 1000;

function toBuffer(data) {
  if (typeof data === 'string') {
    return Buffer.from(data, 'utf8');
  }
  return Buffer.from(data.map((b) => b & 0xff));
}

// 清單分頁的一列（A:O）：A=名稱、B=refer、C=record、D=dueDate、G=簽名格、M=回信、O=writeAllowed
function makeListRow({ dueDate, writeAllowed = '是', signatures = '學生;家長' } = {}) {
  const row = new Array(15).fill('');
  row[0] = '測試問卷';
  row[1] = REFER;
  row[2] = RECORD;
  row[3] = dueDate === undefined ? Date.now() + 30 * DAY : dueDate;
  row[6] = signatures;
  row[12] = 'admin@example.com';
  row[14] = writeAllowed;
  return row;
}

// 完整 GAS stub 環境；inviteRows 是活的（RPC 寫入會改動它，測試可直接斷言）
function loadGasRpc({ listRows = [makeListRow()], inviteRows = [], emailQuota = 100 } = {}) {
  const store = {
    jwtSecret: 'unit-test-secret',
    listSheetID: 'LIST_SHEET_ID',
    draftSheetID: 'DRAFT_SHEET_ID',
    universalStorageID: 'STORAGE_FOLDER_ID',
    emailLog: 'EMAIL_LOG_ID',
    systemTitle: '測試系統',
  };
  const sentEmails = [];
  const emailLogRows = [];
  const trashedFiles = [];
  const createdFiles = [];
  const recordRows = [];
  let fileSeq = 0;

  const rangeFor =
    (rows) =>
    (row, col, numRows = 1, numCols = 1) => ({
      getValues: () =>
        rows.slice(row - 1, row - 1 + numRows).map((r) => r.slice(col - 1, col - 1 + numCols)),
      setValues: (vals) => {
        for (let i = 0; i < vals.length; i++) {
          rows[row - 1 + i] = [...vals[i]];
        }
      },
    });
  const inviteSheetFake = {
    getLastRow: () => inviteRows.length,
    getRange: rangeFor(inviteRows),
    appendRow: (row) => inviteRows.push([...row]),
    deleteRow: (idx) => inviteRows.splice(idx - 1, 1),
  };
  // 問卷結構表：前 8 列定義（id/名稱/type/format/group/content/must/nullable）+ 名冊資料列
  const referRows = [
    ['uid', 'memo'],
    ['學號', '備註'],
    ['P', 'F'],
    ['T', 'T'],
    ['', ''],
    ['', ''],
    ['', ''],
    ['', ''],
    ['測試生甲', '虛構測試資料'],
  ];
  const emptySheetFake = {
    getLastRow: () => 0,
    getLastColumn: () => 0,
    getRange: () => ({ getValues: () => [] }),
  };
  const fakeSpreadsheetApp = {
    openById: (id) => {
      if (id === 'DRAFT_SHEET_ID') {
        return {
          getSheetByName: (name) => (name === '_invites' ? inviteSheetFake : null),
          insertSheet: (name) => (name === '_invites' ? inviteSheetFake : emptySheetFake),
        };
      }
      if (id === 'EMAIL_LOG_ID') {
        return { getSheets: () => [{ appendRow: (row) => emailLogRows.push(row) }] };
      }
      if (id === REFER) {
        return { getSheets: () => [{ getDataRange: () => ({ getValues: () => referRows }) }] };
      }
      if (id === RECORD) {
        return { getSheets: () => [{ appendRow: (row) => recordRows.push([...row]) }] };
      }
      // 清單分頁（getRange('A:O') 不帶數字參數）
      return { getSheets: () => [{ getRange: () => ({ getValues: () => listRows }) }] };
    },
  };
  const fakeUtilities = {
    computeHmacSha256Signature: (data, key) => {
      const digest = createHmac('sha256', key).update(data).digest();
      return [...digest].map((b) => (b > 127 ? b - 256 : b));
    },
    base64EncodeWebSafe: (data) => toBuffer(data).toString('base64url'),
    base64DecodeWebSafe: (str) => [...Buffer.from(str, 'base64url')],
    base64Encode: (data) => toBuffer(data).toString('base64'),
    base64Decode: (str) => [...Buffer.from(str, 'base64')],
    newBlob: (bytes, type, name) => ({
      getDataAsString: () => toBuffer(bytes).toString('utf8'),
      getBytes: () => bytes,
      getContentType: () => type,
      getName: () => name,
    }),
    getUuid: () => {
      fileSeq += 1;
      return '00000000-0000-4000-8000-' + String(fileSeq).padStart(12, '0');
    },
  };
  const fakeDriveApp = {
    getFolderById: () => ({
      createFile: (blob) => {
        const file = {
          id: 'FILE_' + createdFiles.length,
          name: blob.getName(),
          getId() {
            return this.id;
          },
          setName(n) {
            this.name = n;
            return this;
          },
          getUrl: () => 'https://drive.example/file',
        };
        createdFiles.push(file);
        return file;
      },
    }),
    getFileById: (id) => ({
      setTrashed: () => trashedFiles.push(id),
      getUrl: () => 'https://drive.example/view/' + id,
      getBlob: () => ({
        getContentType: () => 'image/png',
        getBytes: () => [...Buffer.from('fake-image-' + id, 'utf8')],
      }),
    }),
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
    `${source}\n;return {
      issueToken_, issueInviteSession_, authByToken_, verifyJwt_, signJwt_, getJwtSecret_,
      sendInvite, revokeInvite, listInvites, inviteeLogin, submitInviteSignature, renewToken,
      inviteRowOf_, parseInviteRow_, JWT_TTL_MS, writeRecord_
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
    {
      getRemainingDailyQuota: () => emailQuota,
      sendEmail: (to, replyTo, subject, body) => sentEmails.push({ to, replyTo, subject, body }),
    },
    { getService: () => ({ getUrl: () => 'https://script.example/exec' }) },
    { getActiveUser: () => ({ getEmail: () => '' }) }
  );
  return { gas, inviteRows, sentEmails, emailLogRows, trashedFiles, createdFiles, recordRows };
}

function makeInviteRow(
  gas,
  { token = 'a'.repeat(64), signName = '家長', status = 'pending', expireAt, fileID = '' } = {}
) {
  return gas.inviteRowOf_({
    token,
    referSSID: REFER,
    recordSSID: RECORD,
    primaryValue: '測試生甲',
    signName,
    email: 'user@example.com',
    expireAt: expireAt === undefined ? Date.now() + 5 * DAY : expireAt,
    status,
    fileID: status === 'signed' && fileID === '' ? 'SIGNED_FILE_ID' : fileID,
    createdAt: Date.now() - DAY,
    updatedAt: Date.now() - DAY,
  });
}

const PNG_BLOB = 'data:image/png;base64,' + Buffer.from('tiny-png').toString('base64');

describe('authByToken_ 拒絕受邀者 session（權限分流）', () => {
  it('受邀者 session token 打填寫者側 RPC → 一律 false', () => {
    const { gas } = loadGasRpc();
    const session = gas.issueInviteSession_(
      {
        token: 'a'.repeat(64),
        referSSID: REFER,
        primaryValue: '測試生甲',
        signName: '家長',
        expireAt: Date.now() + DAY,
      },
      Date.now(),
      Date.now() + DAY
    );
    // session 本身簽章有效（verifyJwt_ 通過）……
    expect(gas.verifyJwt_(session, 'unit-test-secret', Date.now())).not.toBe(false);
    // ……但 authByToken_（writeRecord/saveDraft/sendInvite 的入口）拒絕
    expect(gas.authByToken_(REFER, session)).toBe(false);
  });

  it('填寫者 token 照常通過', () => {
    const { gas } = loadGasRpc();
    const token = gas.issueToken_(REFER, '測試生甲', Date.now());
    expect(gas.authByToken_(REFER, token).pkey).toBe('測試生甲');
  });
});

describe('issueInviteSession_（exp 三重封頂）', () => {
  const now = 1750000000000;
  const invite = (expireAt) => ({
    token: 'a'.repeat(64),
    referSSID: REFER,
    primaryValue: '測試生甲',
    signName: '家長',
    expireAt,
  });

  it('邀請與 dueDate 都很遠 → exp = now + 1hr', () => {
    const { gas } = loadGasRpc();
    const session = gas.issueInviteSession_(invite(now + 5 * DAY), now, now + 30 * DAY);
    const claims = gas.verifyJwt_(session, 'unit-test-secret', now);
    expect(claims.exp).toBe(Math.floor((now + gas.JWT_TTL_MS) / 1000));
    expect(claims.invite).toBe('a'.repeat(64));
    expect(claims.signName).toBe('家長');
  });

  it('邀請快到期 → exp 被邀請 expireAt 封頂', () => {
    const { gas } = loadGasRpc();
    const session = gas.issueInviteSession_(invite(now + 10 * 60 * 1000), now, now + 30 * DAY);
    expect(gas.verifyJwt_(session, 'unit-test-secret', now).exp).toBe(
      Math.floor((now + 10 * 60 * 1000) / 1000)
    );
  });

  it('問卷 dueDate 更早 → exp 被 dueDate 封頂', () => {
    const { gas } = loadGasRpc();
    const session = gas.issueInviteSession_(invite(now + 5 * DAY), now, now + 5 * 60 * 1000);
    expect(gas.verifyJwt_(session, 'unit-test-secret', now).exp).toBe(
      Math.floor((now + 5 * 60 * 1000) / 1000)
    );
  });
});

describe('sendInvite（發=重發=換email 同一支 upsert）', () => {
  it('首次發邀請：appendRow 一列 pending、寄信含連結+驗證碼、記 emailLog', () => {
    const ctx = loadGasRpc();
    const token = ctx.gas.issueToken_(REFER, '測試生甲', Date.now());
    const result = ctx.gas.sendInvite(REFER, RECORD, token, '家長', 'user@example.com');
    expect(result.success).toBe(true);
    expect(ctx.inviteRows.length).toBe(1);
    const row = ctx.gas.parseInviteRow_(ctx.inviteRows[0]);
    expect(row.status).toBe('pending');
    expect(row.signName).toBe('家長');
    expect(row.primaryValue).toBe('測試生甲');
    expect(ctx.sentEmails.length).toBe(1);
    expect(ctx.sentEmails[0].to).toBe('user@example.com');
    expect(ctx.sentEmails[0].body).toContain('?token=' + row.token);
    expect(ctx.sentEmails[0].body).toContain(row.token);
    expect(ctx.emailLogRows.length).toBe(1);
  });

  it('重發：同一格覆寫同一列、換新 token（舊 token 自動失效）', () => {
    const ctx = loadGasRpc();
    const token = ctx.gas.issueToken_(REFER, '測試生甲', Date.now());
    ctx.gas.sendInvite(REFER, RECORD, token, '家長', 'user@example.com');
    const oldToken = ctx.gas.parseInviteRow_(ctx.inviteRows[0]).token;
    ctx.gas.sendInvite(REFER, RECORD, token, '家長', 'other@example.com');
    expect(ctx.inviteRows.length).toBe(1);
    const row = ctx.gas.parseInviteRow_(ctx.inviteRows[0]);
    expect(row.token).not.toBe(oldToken);
    expect(row.email).toBe('other@example.com');
  });

  it('已簽名的格不能再發邀請', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { status: 'signed' }));
    const token = ctx.gas.issueToken_(REFER, '測試生甲', Date.now());
    const result = ctx.gas.sendInvite(REFER, RECORD, token, '家長', 'user@example.com');
    expect(result.success).toBe(false);
    expect(result.status).toBe('signed');
    expect(ctx.sentEmails.length).toBe(0);
  });

  it('簽名格名稱不在清單 G 欄 → 拒絕', () => {
    const ctx = loadGasRpc();
    const token = ctx.gas.issueToken_(REFER, '測試生甲', Date.now());
    expect(ctx.gas.sendInvite(REFER, RECORD, token, '校長', 'user@example.com').success).toBe(
      false
    );
  });

  it('Email 格式錯誤 / 配額用盡 / 表單關閉 → 拒絕', () => {
    const ctx = loadGasRpc();
    const token = ctx.gas.issueToken_(REFER, '測試生甲', Date.now());
    expect(ctx.gas.sendInvite(REFER, RECORD, token, '家長', 'not-an-email').success).toBe(false);
    const noQuota = loadGasRpc({ emailQuota: 0 });
    const t2 = noQuota.gas.issueToken_(REFER, '測試生甲', Date.now());
    expect(noQuota.gas.sendInvite(REFER, RECORD, t2, '家長', 'user@example.com').success).toBe(
      false
    );
    const closed = loadGasRpc({ listRows: [makeListRow({ writeAllowed: '否' })] });
    const t3 = closed.gas.issueToken_(REFER, '測試生甲', Date.now());
    expect(closed.gas.sendInvite(REFER, RECORD, t3, '家長', 'user@example.com').success).toBe(
      false
    );
  });

  it('沒有有效登入 token → tokenExpired', () => {
    const ctx = loadGasRpc();
    const result = ctx.gas.sendInvite(REFER, RECORD, 'garbage', '家長', 'user@example.com');
    expect(result.tokenExpired).toBe(true);
  });
});

describe('revokeInvite（競態防線 #2：不信前端認知）', () => {
  it('pending 列 → 直接刪列', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { status: 'pending' }));
    const token = ctx.gas.issueToken_(REFER, '測試生甲', Date.now());
    const result = ctx.gas.revokeInvite(REFER, RECORD, token, '家長', false);
    expect(result).toEqual({ success: true, status: 'none' });
    expect(ctx.inviteRows.length).toBe(0);
  });

  it('受邀者剛簽完（signed）且 !force → 不刪、回含內嵌圖的最新狀態讓前端二段確認', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { status: 'signed' }));
    const token = ctx.gas.issueToken_(REFER, '測試生甲', Date.now());
    const result = ctx.gas.revokeInvite(REFER, RECORD, token, '家長', false);
    expect(result.success).toBe(false);
    expect(result.status).toBe('signed');
    expect(result.invite.image).toMatch(/^data:image\/png;base64,/);
    expect(ctx.inviteRows.length).toBe(1); // 列還在
    expect(ctx.trashedFiles.length).toBe(0); // 簽名檔沒被動
  });

  it('signed + force=true → 刪列且簽名檔進垃圾桶', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { status: 'signed' }));
    const token = ctx.gas.issueToken_(REFER, '測試生甲', Date.now());
    const result = ctx.gas.revokeInvite(REFER, RECORD, token, '家長', true);
    expect(result).toEqual({ success: true, status: 'none' });
    expect(ctx.inviteRows.length).toBe(0);
    expect(ctx.trashedFiles).toEqual(['SIGNED_FILE_ID']);
  });

  it('無列（已被撤回過）→ 冪等回 success/none', () => {
    const ctx = loadGasRpc();
    const token = ctx.gas.issueToken_(REFER, '測試生甲', Date.now());
    expect(ctx.gas.revokeInvite(REFER, RECORD, token, '家長', false)).toEqual({
      success: true,
      status: 'none',
    });
  });
});

describe('inviteeLogin（token 即憑證）', () => {
  it('有效 pending 邀請 → 回 session token + read-only 內容 + 遮罩主鍵', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, {}));
    const result = ctx.gas.inviteeLogin('a'.repeat(64));
    expect(result).not.toBe(false);
    expect(result.signName).toBe('家長');
    expect(result.alreadySigned).toBe(false);
    expect(result.maskedPkey).not.toContain('測試生甲');
    const claims = ctx.gas.verifyJwt_(result.sessionToken, 'unit-test-secret', Date.now());
    expect(claims.invite).toBe('a'.repeat(64));
    expect(claims.pkey).toBe('測試生甲');
  });

  it('已簽名的邀請 → alreadySigned + 附自己的簽名圖', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { status: 'signed' }));
    const result = ctx.gas.inviteeLogin('a'.repeat(64));
    expect(result.alreadySigned).toBe(true);
    expect(result.myImage).toMatch(/^data:image\/png;base64,/);
  });

  it('亂造 token / 不存在的 token / 過期邀請 / 表單關閉 → 一律 false', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { expireAt: Date.now() - 1000 }));
    expect(ctx.gas.inviteeLogin('<script>')).toBe(false);
    expect(ctx.gas.inviteeLogin('b'.repeat(64))).toBe(false);
    expect(ctx.gas.inviteeLogin('a'.repeat(64))).toBe(false); // 過期
    const closed = loadGasRpc({ listRows: [makeListRow({ writeAllowed: '否' })] });
    closed.inviteRows.push(makeInviteRow(closed.gas, {}));
    expect(closed.gas.inviteeLogin('a'.repeat(64))).toBe(false);
  });
});

describe('submitInviteSignature（競態防線 #1：送出當下 Lock 內重查列）', () => {
  function makeSession(gas, inviteToken = 'a'.repeat(64)) {
    return gas.issueInviteSession_(
      {
        token: inviteToken,
        referSSID: REFER,
        primaryValue: '測試生甲',
        signName: '家長',
        expireAt: Date.now() + 5 * DAY,
      },
      Date.now(),
      Date.now() + 30 * DAY
    );
  }

  it('正常送出：建檔、列轉 signed + fileID', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, {}));
    const result = ctx.gas.submitInviteSignature(makeSession(ctx.gas), PNG_BLOB);
    expect(result.success).toBe(true);
    const row = ctx.gas.parseInviteRow_(ctx.inviteRows[0]);
    expect(row.status).toBe('signed');
    expect(row.fileID).toBe('FILE_0');
    expect(ctx.createdFiles.length).toBe(1);
    expect(ctx.createdFiles[0].name).toContain('家長簽名');
  });

  it('填寫者已撤回（列不在）→ 明確 revoked 錯誤，不建檔', () => {
    const ctx = loadGasRpc();
    const session = makeSession(ctx.gas); // session 簽發時列還在的情境：這裡直接不放列
    const result = ctx.gas.submitInviteSignature(session, PNG_BLOB);
    expect(result.success).toBe(false);
    expect(result.revoked).toBe(true);
    expect(ctx.createdFiles.length).toBe(0);
  });

  it('填寫者已重發（列上 token 換新）→ 舊 session 查無列、revoked', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { token: 'c'.repeat(64) })); // 新 token 的列
    const result = ctx.gas.submitInviteSignature(makeSession(ctx.gas, 'a'.repeat(64)), PNG_BLOB);
    expect(result.revoked).toBe(true);
  });

  it('已簽名的列再送 → 拒絕不重複建檔', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { status: 'signed' }));
    const result = ctx.gas.submitInviteSignature(makeSession(ctx.gas), PNG_BLOB);
    expect(result.success).toBe(false);
    expect(ctx.createdFiles.length).toBe(0);
  });

  it('邀請已過期 → 拒絕', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { expireAt: Date.now() - 1000 }));
    expect(ctx.gas.submitInviteSignature(makeSession(ctx.gas), PNG_BLOB).success).toBe(false);
  });

  it('裸邀請 token 直接打（不是 session JWT）→ tokenExpired', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, {}));
    const result = ctx.gas.submitInviteSignature('a'.repeat(64), PNG_BLOB);
    expect(result.tokenExpired).toBe(true);
  });

  it('填寫者的一般 token（無 invite claim）→ 拒絕', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, {}));
    const fillerToken = ctx.gas.issueToken_(REFER, '測試生甲', Date.now());
    expect(ctx.gas.submitInviteSignature(fillerToken, PNG_BLOB).tokenExpired).toBe(true);
  });

  it('非 PNG data URI / 超過 2MB → 拒絕', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, {}));
    const session = makeSession(ctx.gas);
    expect(ctx.gas.submitInviteSignature(session, 'data:text/html;base64,AAAA').success).toBe(
      false
    );
    const big = 'data:image/png;base64,' + Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64');
    expect(ctx.gas.submitInviteSignature(session, big).success).toBe(false);
  });
});

describe('listInvites', () => {
  it('回各格狀態（衍生 expired）、signed 附圖', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(
      makeInviteRow(ctx.gas, { token: 'a'.repeat(64), signName: '學生', status: 'signed' })
    );
    ctx.inviteRows.push(
      makeInviteRow(ctx.gas, {
        token: 'b'.repeat(64),
        signName: '家長',
        expireAt: Date.now() - 1000,
      })
    );
    const token = ctx.gas.issueToken_(REFER, '測試生甲', Date.now());
    const result = ctx.gas.listInvites(REFER, RECORD, token);
    const byName = _.keyBy(result.invites, 'signName');
    expect(byName['學生'].status).toBe('signed');
    expect(byName['學生'].image).toMatch(/^data:image\/png;base64,/);
    expect(byName['家長'].status).toBe('expired');
    expect(byName['家長'].image).toBeUndefined();
  });
});

describe('writeRecord_ 簽名混合裁決（競態防線 #3：送出當下重讀 invites）', () => {
  // 問卷欄位只有主鍵 uid 與文字欄 memo；簽名格為 學生;家長（makeListRow 預設）
  const record = [{ id: 'memo', value: '測試內容' }];

  function submit(ctx, signatures) {
    const token = ctx.gas.issueToken_(REFER, '測試生甲', Date.now());
    return ctx.gas.writeRecord_(REFER, RECORD, token, record, true, signatures, '');
  }

  it('全本地簽名 → 正常寫入，簽名檔各自建檔', () => {
    const ctx = loadGasRpc();
    const result = submit(ctx, [
      { name: '學生', blob: PNG_BLOB },
      { name: '家長', blob: PNG_BLOB },
    ]);
    expect(result.status).toBe(true);
    expect(ctx.recordRows.length).toBe(1);
    expect(ctx.recordRows[0][3]).toBe('FILE_0;FILE_1'); // 簽名 fileID 欄
  });

  it('有格還在授權中 → 整筆擋下、不寫入', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { signName: '家長', status: 'pending' }));
    const result = submit(ctx, [
      { name: '學生', blob: PNG_BLOB },
      { name: '家長', blob: PNG_BLOB }, // 就算前端硬塞本地簽名也不採用
    ]);
    expect(result.status).toBe(false);
    expect(result.errorLog.join()).toContain('家長');
    expect(ctx.recordRows.length).toBe(0);
    expect(ctx.createdFiles.length).toBe(0);
  });

  it('受邀者已簽 → 直接沿用列上 fileID、寫入成功、invites 列清空', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { signName: '家長', status: 'signed' }));
    const result = submit(ctx, [{ name: '學生', blob: PNG_BLOB }]);
    expect(result.status).toBe(true);
    expect(ctx.recordRows[0][3]).toBe('FILE_0;SIGNED_FILE_ID');
    expect(ctx.inviteRows.length).toBe(0); // token 用畢即焚
    expect(ctx.trashedFiles.length).toBe(0); // 簽名檔已進紀錄，不能被清掉
  });

  it('缺簽名（無邀請列也無本地 blob）→ 擋下', () => {
    const ctx = loadGasRpc();
    const result = submit(ctx, [{ name: '學生', blob: PNG_BLOB }]);
    expect(result.status).toBe(false);
    expect(result.errorLog.join()).toContain('家長');
    expect(ctx.recordRows.length).toBe(0);
  });

  it('問卷沒有簽名格 → 邀請機制完全不介入', () => {
    const ctx = loadGasRpc({ listRows: [makeListRow({ signatures: '' })] });
    const result = submit(ctx, []);
    expect(result.status).toBe(true);
    expect(ctx.recordRows[0][3]).toBe('');
  });
});

describe('renewToken 受邀者路徑', () => {
  it('列仍 pending → 換發新 session，exp 仍被邀請效期封頂', () => {
    const ctx = loadGasRpc();
    const expireAt = Date.now() + 30 * 60 * 1000; // 邀請 30 分鐘後到期
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { expireAt }));
    const session = ctx.gas.issueInviteSession_(
      ctx.gas.parseInviteRow_(ctx.inviteRows[0]),
      Date.now(),
      Date.now() + 30 * DAY
    );
    const result = ctx.gas.renewToken(REFER, RECORD, session);
    expect(result.renewed).toBe(true);
    const claims = ctx.gas.verifyJwt_(result.token, 'unit-test-secret', Date.now());
    expect(claims.invite).toBe('a'.repeat(64));
    expect(claims.exp).toBeLessThanOrEqual(Math.ceil(expireAt / 1000));
  });

  it('列已被撤回/重發 → 不能續', () => {
    const ctx = loadGasRpc();
    const session = ctx.gas.issueInviteSession_(
      {
        token: 'a'.repeat(64),
        referSSID: REFER,
        primaryValue: '測試生甲',
        signName: '家長',
        expireAt: Date.now() + DAY,
      },
      Date.now(),
      Date.now() + DAY
    );
    const result = ctx.gas.renewToken(REFER, RECORD, session);
    expect(result.renewed).toBe(false);
    expect(result.message).toContain('撤回');
  });

  it('列已 signed → 不能續', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { status: 'signed' }));
    const session = ctx.gas.issueInviteSession_(
      ctx.gas.parseInviteRow_(ctx.inviteRows[0]),
      Date.now(),
      Date.now() + DAY
    );
    expect(ctx.gas.renewToken(REFER, RECORD, session).renewed).toBe(false);
  });
});
