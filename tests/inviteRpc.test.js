// 遠端簽名邀請的 RPC 層（含兩個競態防線，plan/todo.md 明定「務必寫測試覆蓋，不能只靠 UI 擋」）：
// 1. 受邀者送出簽名當下 Lock 內重查列——撤回/重發後送出要被明確擋下
// 2. 撤回預設不信前端認知——伺服器見 signed 拒絕並回最新狀態，force 才真的撤
// 以 new Function 載入 Code.js 並 stub 全部 GAS 全域（HMAC 用 node:crypto 對應）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac, createHash } from 'node:crypto';
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
    insertRowBefore: (idx) => inviteRows.splice(idx - 1, 0, new Array(14).fill('')),
    setFrozenRows: () => {},
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
  // 草稿分頁（referSSID 分頁）在這些邀請測試裡永遠是空的（無草稿）；draftSheet_ 新建時
  // 會補 DRAFT_HEADER + 凍結首列，故補上 appendRow/setFrozenRows no-op（getLastRow 仍回 0 → 無草稿）
  const emptySheetFake = {
    getLastRow: () => 0,
    getLastColumn: () => 0,
    getRange: () => ({ getValues: () => [] }),
    appendRow: () => {},
    setFrozenRows: () => {},
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
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (alg, str) =>
      [...createHash(alg).update(str, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
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
      requestInviteOtp, inviteOtpHash_, INVITE_OTP_TTL_MS, INVITE_OTP_MAX_ATTEMPTS,
      inviteRowOf_, parseInviteRow_, JWT_TTL_MS, writeRecord_,
      initInviteHeader, INVITE_HEADER,
      latestInviteForCell_, latestInviteForToken_, latestInvites_, inviteStatusFor_
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
  {
    token = 'a'.repeat(64),
    signName = '家長',
    status = 'pending',
    expireAt,
    fileID = '',
    otpHash = '',
    otpExpireAt = 0,
    otpAttempts = 0,
  } = {}
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
    otpHash,
    otpExpireAt,
    otpAttempts,
  });
}

const PNG_BLOB = 'data:image/png;base64,' + Buffer.from('tiny-png').toString('base64');

// OTP 只存在寄出的信裡（列上只有 hash）：從最後一封信取出 6 位數驗證碼
function lastOtp(ctx) {
  const body = ctx.sentEmails[ctx.sentEmails.length - 1].body;
  return body.match(/\n(\d{6})\n/)[1];
}

// 完整兩步登入：requestInviteOtp 寄碼 → 從信裡取碼 → inviteeLogin(邀請碼, otp)
function loginWithOtp(ctx, token = 'a'.repeat(64)) {
  const request = ctx.gas.requestInviteOtp(token);
  expect(request.success).toBe(true);
  return ctx.gas.inviteeLogin(token, lastOtp(ctx));
}

// 純 append 模型下「當前狀態」＝該格最新一列（測試的 inviteRows 無表頭列）；用真實 helper 取
function inviteSheetView(ctx) {
  return {
    getLastRow: () => ctx.inviteRows.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => ctx.inviteRows.slice(r - 1, r - 1 + nr).map((x) => x.slice(c - 1, c - 1 + nc)),
    }),
  };
}
function latestCell(ctx, signName = '家長') {
  return ctx.gas.latestInviteForCell_(inviteSheetView(ctx), REFER, '測試生甲', signName);
}
function statusOfCell(ctx, signName = '家長') {
  return ctx.gas.inviteStatusFor_(latestCell(ctx, signName), Date.now());
}

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
  it('首次發邀請：appendRow 一列 pending、寄信只含驗證碼不含網址、記 emailLog', () => {
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
    expect(ctx.sentEmails[0].body).toContain(row.token);
    // 名詞統一：64-hex 稱「邀請碼」，並預告會再寄 6 位數一次性驗證碼（OTP 二段驗證）
    expect(ctx.sentEmails[0].body).toContain('邀請碼');
    expect(ctx.sentEmails[0].body).toContain('一次性驗證碼');
    // 信裡刻意不放任何網址（GAS 連結會觸發 outlook.com 等的釣魚過濾、整封被無聲丟棄）
    expect(ctx.sentEmails[0].body).not.toContain('?token=');
    expect(ctx.sentEmails[0].body).not.toContain('http');
    expect(ctx.emailLogRows.length).toBe(1);
  });

  it('重發：append 新 token 快照、舊 token superseded 失效', () => {
    const ctx = loadGasRpc();
    const token = ctx.gas.issueToken_(REFER, '測試生甲', Date.now());
    ctx.gas.sendInvite(REFER, RECORD, token, '家長', 'user@example.com');
    const oldToken = latestCell(ctx).token;
    ctx.gas.sendInvite(REFER, RECORD, token, '家長', 'other@example.com');
    expect(ctx.inviteRows.length).toBe(2); // 純 append：兩筆快照，不覆寫
    const row = latestCell(ctx); // 每格最新
    expect(row.token).not.toBe(oldToken);
    expect(row.email).toBe('other@example.com');
    // 舊 token 已非該格最新列 → superseded 失效
    expect(ctx.gas.latestInviteForToken_(inviteSheetView(ctx), oldToken)).toBeNull();
  });

  it('已簽名的格 !force → 不重發、回含內嵌圖的最新狀態讓前端二段確認', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { status: 'signed' }));
    const token = ctx.gas.issueToken_(REFER, '測試生甲', Date.now());
    const result = ctx.gas.sendInvite(REFER, RECORD, token, '家長', 'user@example.com');
    expect(result.success).toBe(false);
    expect(result.status).toBe('signed');
    expect(result.invite.image).toMatch(/^data:image\/png;base64,/);
    expect(ctx.sentEmails.length).toBe(0);
    expect(ctx.inviteRows.length).toBe(1); // 列還在
    expect(ctx.trashedFiles.length).toBe(0); // 簽名檔沒被動
  });

  it('已簽名的格 force=true → 作廢舊簽名檔、append 新 pending 快照、寄新邀請信', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { status: 'signed' }));
    const oldToken = latestCell(ctx).token;
    const token = ctx.gas.issueToken_(REFER, '測試生甲', Date.now());
    const result = ctx.gas.sendInvite(REFER, RECORD, token, '家長', 'user@example.com', true);
    expect(result.success).toBe(true);
    expect(ctx.trashedFiles).toEqual(['SIGNED_FILE_ID']);
    expect(ctx.inviteRows.length).toBe(2); // 原 signed 列 + 新 pending 快照
    const row = latestCell(ctx);
    expect(row.status).toBe('pending');
    expect(row.fileID).toBe('');
    expect(row.token).not.toBe(oldToken);
    expect(ctx.sentEmails.length).toBe(1);
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
  it('pending → append revoked 終態快照（不刪列）', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { status: 'pending' }));
    const token = ctx.gas.issueToken_(REFER, '測試生甲', Date.now());
    const result = ctx.gas.revokeInvite(REFER, RECORD, token, '家長', false);
    expect(result).toEqual({ success: true, status: 'none' });
    expect(ctx.inviteRows.length).toBe(2); // 純 append：原列 + revoked 快照
    expect(statusOfCell(ctx)).toBe('revoked');
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

  it('signed + force=true → append revoked 快照、簽名檔進垃圾桶', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { status: 'signed' }));
    const token = ctx.gas.issueToken_(REFER, '測試生甲', Date.now());
    const result = ctx.gas.revokeInvite(REFER, RECORD, token, '家長', true);
    expect(result).toEqual({ success: true, status: 'none' });
    expect(ctx.inviteRows.length).toBe(2); // 原 signed 列 + revoked 快照
    expect(statusOfCell(ctx)).toBe('revoked');
    // 忠實快照：fileID 原樣保留供稽核（檔案本身已 trash，終態列沒有 reader 會拿它去讀檔）
    expect(latestCell(ctx).fileID).toBe('SIGNED_FILE_ID');
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

describe('requestInviteOtp（登入第一步：驗邀請碼、寄一次性驗證碼）', () => {
  it('合法邀請碼 → 寄一封 OTP 信到邀請列登記信箱、列上只存 hash、回遮罩 email', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, {}));
    const before = Date.now();
    const result = ctx.gas.requestInviteOtp('a'.repeat(64));
    expect(result.success).toBe(true);
    expect(result.maskedEmail).not.toBe('user@example.com'); // 遮罩過
    expect(result.maskedEmail).toBe('u***r@example.com'); // 只遮 @ 前本地部分、保留頭尾與網域
    expect(ctx.sentEmails.length).toBe(1);
    expect(ctx.sentEmails[0].to).toBe('user@example.com');
    expect(ctx.sentEmails[0].subject).toContain('一次性驗證碼');
    // 信純文字、無任何網址（釣魚過濾）
    expect(ctx.sentEmails[0].body).not.toContain('http');
    const otp = lastOtp(ctx);
    const row = latestCell(ctx); // OTP 存在 append 的最新快照上
    expect(ctx.inviteRows.length).toBe(2); // 原列 + 帶 OTP 的快照
    expect(row.otpHash).toBe(ctx.gas.inviteOtpHash_(otp, 'a'.repeat(64)));
    expect(row.otpHash).not.toContain(otp); // 列上沒有明碼
    expect(row.otpExpireAt).toBeGreaterThanOrEqual(before + ctx.gas.INVITE_OTP_TTL_MS);
    expect(row.otpAttempts).toBe(0);
  });

  it('60 秒內重打 → 不重寄、回 cooldownSeconds（reload 濫發防線）', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, {}));
    expect(ctx.gas.requestInviteOtp('a'.repeat(64)).success).toBe(true);
    const again = ctx.gas.requestInviteOtp('a'.repeat(64));
    expect(again.success).toBe(false);
    expect(again.cooldownSeconds).toBeGreaterThan(0);
    expect(again.cooldownSeconds).toBeLessThanOrEqual(60);
    expect(again.maskedEmail).not.toBe(undefined); // 前端要顯示「已寄到 xxx」
    expect(ctx.sentEmails.length).toBe(1); // 沒寄第二封
  });

  it('亂造/不存在/過期邀請碼、表單關閉 → 一律 false 且不寄信', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { expireAt: Date.now() - 1000 }));
    expect(ctx.gas.requestInviteOtp('<script>')).toBe(false);
    expect(ctx.gas.requestInviteOtp('b'.repeat(64))).toBe(false);
    expect(ctx.gas.requestInviteOtp('a'.repeat(64))).toBe(false); // 過期
    expect(ctx.sentEmails.length).toBe(0);
    const closed = loadGasRpc({ listRows: [makeListRow({ writeAllowed: '否' })] });
    closed.inviteRows.push(makeInviteRow(closed.gas, {}));
    expect(closed.gas.requestInviteOtp('a'.repeat(64))).toBe(false);
    expect(closed.sentEmails.length).toBe(0);
  });

  it('Email 配額用盡 → 可操作的明確訊息、不寄信、列上無 OTP', () => {
    const ctx = loadGasRpc({ emailQuota: 0 });
    ctx.inviteRows.push(makeInviteRow(ctx.gas, {}));
    const result = ctx.gas.requestInviteOtp('a'.repeat(64));
    expect(result.success).toBe(false);
    expect(result.message).toContain('額度');
    expect(ctx.sentEmails.length).toBe(0);
    expect(ctx.gas.parseInviteRow_(ctx.inviteRows[0]).otpHash).toBe('');
  });

  it('signed 邀請也可請求 OTP（受邀者回來查看自己的簽名）', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { status: 'signed' }));
    expect(ctx.gas.requestInviteOtp('a'.repeat(64)).success).toBe(true);
  });
});

describe('inviteeLogin（登入第二步：邀請碼 + OTP 雙因子）', () => {
  it('正確 OTP → 回 session token + read-only 內容 + 遮罩主鍵，且 OTP 單次使用即作廢', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, {}));
    ctx.gas.requestInviteOtp('a'.repeat(64));
    const otp = lastOtp(ctx);
    const result = ctx.gas.inviteeLogin('a'.repeat(64), otp);
    expect(result).not.toBe(false);
    expect(result.otpFailed).toBe(undefined);
    expect(result.signName).toBe('家長');
    expect(result.alreadySigned).toBe(false);
    expect(result.maskedPkey).not.toContain('測試生甲');
    // 生命週期時間軸起點：邀請發出時間要回給受邀者（重發沿用原值）
    expect(result.inviteCreatedAt).toBe(ctx.gas.parseInviteRow_(ctx.inviteRows[0]).createdAt);
    const claims = ctx.gas.verifyJwt_(result.sessionToken, 'unit-test-secret', Date.now());
    expect(claims.invite).toBe('a'.repeat(64));
    expect(claims.pkey).toBe('測試生甲');
    // 單次使用＝append「效期於使用當下終止」的事實快照：不清空任何欄位，
    // hash 原樣保留供稽核、otpExpireAt 記為使用時刻（之後 now >= otpExpireAt 一律拒絕）
    const row = latestCell(ctx);
    expect(row.otpHash).not.toBe(''); // 沒被清空
    expect(row.otpExpireAt).toBeLessThanOrEqual(Date.now());
    // 同一組 OTP 第二次用 → 失敗（單次使用）
    expect(ctx.gas.inviteeLogin('a'.repeat(64), otp).otpFailed).toBe(true);
  });

  it('已簽名的邀請 → alreadySigned + 附自己的簽名圖', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { status: 'signed' }));
    const result = loginWithOtp(ctx);
    expect(result.alreadySigned).toBe(true);
    expect(result.myImage).toMatch(/^data:image\/png;base64,/);
  });

  it('OTP 通過前不回傳任何問卷內容：錯誤 OTP → otpFailed、attempts+1', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, {}));
    ctx.gas.requestInviteOtp('a'.repeat(64));
    const wrong = lastOtp(ctx) === '000000' ? '000001' : '000000';
    const result = ctx.gas.inviteeLogin('a'.repeat(64), wrong);
    expect(result.otpFailed).toBe(true);
    expect(result.headers).toBe(undefined);
    expect(result.sessionToken).toBe(undefined);
    expect(latestCell(ctx).otpAttempts).toBe(1); // 錯誤計次落在 append 的最新快照
  });

  it('連錯 5 次 → OTP 作廢（之後連正確的 OTP 也失敗，需重寄）', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, {}));
    ctx.gas.requestInviteOtp('a'.repeat(64));
    const otp = lastOtp(ctx);
    const wrong = otp === '000000' ? '000001' : '000000';
    for (let i = 0; i < ctx.gas.INVITE_OTP_MAX_ATTEMPTS; i++) {
      expect(ctx.gas.inviteeLogin('a'.repeat(64), wrong).otpFailed).toBe(true);
    }
    // 作廢不落地：hash 原樣保留，「attempts >= MAX」的讀取端判斷就是作廢本身
    const row = latestCell(ctx);
    expect(row.otpHash).not.toBe('');
    expect(row.otpAttempts).toBe(ctx.gas.INVITE_OTP_MAX_ATTEMPTS);
    expect(ctx.gas.inviteeLogin('a'.repeat(64), otp).otpFailed).toBe(true); // 連正確的也被拒
  });

  it('逾期 OTP → 拒絕', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(
      makeInviteRow(ctx.gas, {
        otpHash: ctx.gas.inviteOtpHash_('123456', 'a'.repeat(64)),
        otpExpireAt: Date.now() - 1000,
      })
    );
    expect(ctx.gas.inviteeLogin('a'.repeat(64), '123456').otpFailed).toBe(true);
  });

  it('列上無 OTP 直接猜 6 位數 → 拒絕；OTP 格式不對 → 拒絕且不動列', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, {}));
    expect(ctx.gas.inviteeLogin('a'.repeat(64), '123456').otpFailed).toBe(true);
    expect(ctx.gas.inviteeLogin('a'.repeat(64), '12345').otpFailed).toBe(true);
    expect(ctx.gas.inviteeLogin('a'.repeat(64), 'abcdef').otpFailed).toBe(true);
    expect(ctx.gas.inviteeLogin('a'.repeat(64)).otpFailed).toBe(true); // 沒帶 otp
    expect(ctx.gas.parseInviteRow_(ctx.inviteRows[0]).otpAttempts).toBe(0);
  });

  it('重發（token 換新）後：舊邀請碼連 OTP 都要不到、舊 OTP 隨列作廢', () => {
    const ctx = loadGasRpc();
    const filler = ctx.gas.issueToken_(REFER, '測試生甲', Date.now());
    ctx.gas.sendInvite(REFER, RECORD, filler, '家長', 'user@example.com');
    const oldToken = latestCell(ctx).token;
    ctx.gas.requestInviteOtp(oldToken); // 舊 token 的 OTP 已寄出
    ctx.gas.sendInvite(REFER, RECORD, filler, '家長', 'user@example.com'); // 重發換 token（append）
    expect(ctx.gas.requestInviteOtp(oldToken)).toBe(false); // 舊邀請碼 superseded 失效
    expect(ctx.gas.inviteeLogin(oldToken, '123456')).toBe(false);
    // 最新快照（重發那筆）OTP 三欄已清空（重發不留殘留）
    const row = latestCell(ctx);
    expect(row.otpHash).toBe('');
    expect(row.otpAttempts).toBe(0);
  });

  it('亂造 token / 不存在的 token / 過期邀請 / 表單關閉 → 一律 false', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { expireAt: Date.now() - 1000 }));
    expect(ctx.gas.inviteeLogin('<script>', '123456')).toBe(false);
    expect(ctx.gas.inviteeLogin('b'.repeat(64), '123456')).toBe(false);
    expect(ctx.gas.inviteeLogin('a'.repeat(64), '123456')).toBe(false); // 過期
    const closed = loadGasRpc({ listRows: [makeListRow({ writeAllowed: '否' })] });
    closed.inviteRows.push(makeInviteRow(closed.gas, {}));
    expect(closed.gas.inviteeLogin('a'.repeat(64), '123456')).toBe(false);
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
    const row = latestCell(ctx); // signed 快照為最新列
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

  it('受邀者已簽 → 直接沿用列上 fileID、寫入成功、append consumed 終態快照', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { signName: '家長', status: 'signed' }));
    const result = submit(ctx, [{ name: '學生', blob: PNG_BLOB }]);
    expect(result.status).toBe(true);
    expect(ctx.recordRows[0][3]).toBe('FILE_0;SIGNED_FILE_ID');
    expect(ctx.inviteRows.length).toBe(2); // 純 append：原 signed 列 + consumed 快照（token 用畢即焚）
    expect(statusOfCell(ctx)).toBe('consumed'); // 每格最新為 consumed
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

describe('initInviteHeader（補人類可讀表頭，冪等、不刪不覆寫資料）', () => {
  it('既有資料無表頭 → 首列補表頭、原資料整列下移保留', () => {
    const dataRow = [
      'b'.repeat(64), REFER, RECORD, 'A123456789', '家長', 'p@example.com',
      Date.now() + DAY, 'pending', '', Date.now(), Date.now(), '', 0, 0,
    ];
    const ctx = loadGasRpc({ inviteRows: [dataRow.slice()] });
    const msg = ctx.gas.initInviteHeader();
    expect(msg).toContain('表頭');
    expect(ctx.inviteRows.length).toBe(2);
    expect(ctx.inviteRows[0][0]).toBe(ctx.gas.INVITE_HEADER[0]); // 首列＝表頭
    expect(ctx.inviteRows[1]).toEqual(dataRow); // 原資料完整保留於第 2 列
  });

  it('空表 → 直接寫入表頭', () => {
    const ctx = loadGasRpc({ inviteRows: [] });
    ctx.gas.initInviteHeader();
    expect(ctx.inviteRows.length).toBe(1);
    expect(ctx.inviteRows[0][0]).toBe(ctx.gas.INVITE_HEADER[0]);
  });

  it('已有表頭 → 冪等，不再變更', () => {
    const ctx = loadGasRpc({ inviteRows: [] });
    ctx.gas.initInviteHeader();
    const before = JSON.parse(JSON.stringify(ctx.inviteRows));
    const msg = ctx.gas.initInviteHeader();
    expect(msg).toContain('已有表頭');
    expect(ctx.inviteRows).toEqual(before);
  });

  it('表頭列對既有 reader 惰性：加表頭後仍能以邀請碼查到資料列', () => {
    const token = 'c'.repeat(64);
    const dataRow = [
      token, REFER, RECORD, 'A123456789', '家長', 'p@example.com',
      Date.now() + DAY, 'pending', '', Date.now(), Date.now(), '', 0, 0,
    ];
    const ctx = loadGasRpc({ inviteRows: [dataRow.slice()] });
    ctx.gas.initInviteHeader();
    // 表頭在第 1 列、資料在第 2 列；listInvites 仍應解析得到該筆（表頭被 key 過濾）
    const session = ctx.gas.issueToken_(REFER, 'A123456789', Date.now());
    const res = ctx.gas.listInvites(REFER, RECORD, session);
    expect(res.invites.map((i) => i.signName)).toContain('家長');
  });
});

describe('純 append 終態語意（revoked/consumed 後的 reader 行為）', () => {
  it('撤回後：listInvites 不再列出該格（等同未邀請）、且可重新發邀請', () => {
    const ctx = loadGasRpc();
    const filler = ctx.gas.issueToken_(REFER, '測試生甲', Date.now());
    ctx.gas.sendInvite(REFER, RECORD, filler, '家長', 'user@example.com');
    ctx.gas.revokeInvite(REFER, RECORD, filler, '家長', false);
    expect(statusOfCell(ctx)).toBe('revoked');
    expect(ctx.gas.listInvites(REFER, RECORD, filler).invites).toEqual([]); // revoked 不列出
    // send 允許 revoked → true：可重新發邀請
    expect(ctx.gas.sendInvite(REFER, RECORD, filler, '家長', 'user@example.com').success).toBe(true);
    expect(statusOfCell(ctx)).toBe('pending');
  });

  it('消耗（送出成功）後：舊邀請碼再要 OTP / 登入一律 false', () => {
    const ctx = loadGasRpc();
    ctx.inviteRows.push(makeInviteRow(ctx.gas, { signName: '家長', status: 'signed' }));
    const token = ctx.gas.issueToken_(REFER, '測試生甲', Date.now());
    ctx.gas.writeRecord_(
      REFER, RECORD, token, [{ id: 'memo', value: 'x' }], true, [{ name: '學生', blob: PNG_BLOB }], ''
    );
    expect(statusOfCell(ctx)).toBe('consumed');
    // consumed → resolveActiveInvite_ 回 null → 兩支登入 RPC 一律拒絕
    expect(ctx.gas.requestInviteOtp('a'.repeat(64))).toBe(false);
    expect(ctx.gas.inviteeLogin('a'.repeat(64), '123456')).toBe(false);
  });
});
