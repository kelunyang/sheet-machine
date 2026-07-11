// 遠端多方簽名邀請的純函數（src/Code.js 是 GAS 檔，非 ES module）：
// 以 new Function 載入原始碼並 stub 掉 GAS 全域，測試 token 格式閘門、效期計算、
// 列⇄物件互轉、狀態衍生、狀態機矩陣，以及 writeRecord 的簽名來源裁決 resolveSignatureSources_。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import _ from 'lodash';

const source = readFileSync(new URL('../src/Code.js', import.meta.url), 'utf8');

import { createHash } from 'node:crypto';

const fakeUtilities = {
  getUuid: () => 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEFFFF0000',
  DigestAlgorithm: { SHA_256: 'sha256' },
  computeDigest: (alg, str) =>
    [...createHash(alg).update(str, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
  base64Encode: (data) =>
    Buffer.from(
      typeof data === 'string' ? Buffer.from(data, 'utf8') : data.map((b) => b & 0xff)
    ).toString('base64'),
};

function loadGasInvites(props = {}) {
  const factory = new Function(
    'LodashGS',
    'PropertiesService',
    'Utilities',
    `${source}\n;return {
      INVITE_SHEET_NAME, INVITE_TTL_DEFAULT_MINUTES, INVITE_MAX_SIGNATURE_BYTES,
      INVITE_OTP_TTL_MS, INVITE_OTP_COOLDOWN_MS, INVITE_OTP_MAX_ATTEMPTS,
      inviteTokenValid_, newInviteToken_, inviteExpireAt_, inviteTtlMs_,
      inviteOtpValid_, newInviteOtp_, inviteOtpHash_,
      inviteRowOf_, parseInviteRow_, inviteStatusFor_, inviteTransition_,
      resolveSignatureSources_, INVITE_HEADER, INVITE_SHEET_COLS,
      inviteCellKey_, latestInvites_, latestInviteForCell_, latestInviteForToken_
    };`
  );
  return factory(
    { load: () => _ },
    { getScriptProperties: () => ({ getProperty: (key) => (key in props ? props[key] : null) }) },
    fakeUtilities
  );
}

const gas = loadGasInvites();
const DAY = 24 * 60 * 60 * 1000;

describe('inviteTokenValid_（token 格式白名單）', () => {
  it('64 字元小寫 hex → 合法', () => {
    expect(gas.inviteTokenValid_('a'.repeat(64))).toBe(true);
    expect(gas.inviteTokenValid_('0123456789abcdef'.repeat(4))).toBe(true);
  });

  it('過短/過長 → 不合法', () => {
    expect(gas.inviteTokenValid_('a'.repeat(63))).toBe(false);
    expect(gas.inviteTokenValid_('a'.repeat(65))).toBe(false);
    expect(gas.inviteTokenValid_('')).toBe(false);
  });

  it('大寫 hex → 不合法（token 一律小寫生成）', () => {
    expect(gas.inviteTokenValid_('A'.repeat(64))).toBe(false);
  });

  it('注入字串/非字串 → 不合法', () => {
    expect(gas.inviteTokenValid_('</script><script>alert(1)</script>' + 'a'.repeat(30))).toBe(
      false
    );
    expect(gas.inviteTokenValid_('"};alert(1);//' + 'a'.repeat(50))).toBe(false);
    expect(gas.inviteTokenValid_(null)).toBe(false);
    expect(gas.inviteTokenValid_(undefined)).toBe(false);
    expect(gas.inviteTokenValid_(123)).toBe(false);
  });

  it('newInviteToken_ 生成的 token 一定通過白名單', () => {
    expect(gas.inviteTokenValid_(gas.newInviteToken_())).toBe(true);
  });
});

describe('inviteExpireAt_（效期 = min(now+ttlMs, dueDate)）', () => {
  const now = 1750000000000;
  const SEVEN_DAYS = 7 * DAY;

  it('dueDate 在效期之後 → 取 now+ttlMs', () => {
    expect(gas.inviteExpireAt_(now, now + 30 * DAY, SEVEN_DAYS)).toBe(now + 7 * DAY);
  });

  it('dueDate 在效期之內 → 取 dueDate', () => {
    expect(gas.inviteExpireAt_(now, now + 2 * DAY, SEVEN_DAYS)).toBe(now + 2 * DAY);
  });

  it('dueDate 剛好在效期邊界 → 兩者相等', () => {
    expect(gas.inviteExpireAt_(now, now + 7 * DAY, SEVEN_DAYS)).toBe(now + 7 * DAY);
  });
});

describe('inviteTtlMs_（邀請效期＝ScriptProperties inviteTtlMinutes 分鐘，預設 7 天）', () => {
  const MIN = 60 * 1000;

  it('未設定 → 退回預設 INVITE_TTL_DEFAULT_MINUTES（7 天＝10080 分）', () => {
    expect(gas.INVITE_TTL_DEFAULT_MINUTES).toBe(7 * 24 * 60);
    expect(gas.inviteTtlMs_()).toBe(gas.INVITE_TTL_DEFAULT_MINUTES * MIN);
  });

  it('設定正整數分鐘 → 換算成毫秒', () => {
    expect(loadGasInvites({ inviteTtlMinutes: '30' }).inviteTtlMs_()).toBe(30 * MIN);
    expect(loadGasInvites({ inviteTtlMinutes: '1440' }).inviteTtlMs_()).toBe(1440 * MIN);
  });

  it('0／負數／非數字／空字串 → 退回預設', () => {
    const def = gas.INVITE_TTL_DEFAULT_MINUTES * MIN;
    expect(loadGasInvites({ inviteTtlMinutes: '0' }).inviteTtlMs_()).toBe(def);
    expect(loadGasInvites({ inviteTtlMinutes: '-5' }).inviteTtlMs_()).toBe(def);
    expect(loadGasInvites({ inviteTtlMinutes: 'abc' }).inviteTtlMs_()).toBe(def);
    expect(loadGasInvites({ inviteTtlMinutes: '' }).inviteTtlMs_()).toBe(def);
  });
});

describe('inviteRowOf_ / parseInviteRow_（物件⇄14 欄列互轉）', () => {
  const invite = {
    token: 'f'.repeat(64),
    referSSID: 'REFER_SHEET_ID',
    recordSSID: 'RECORD_SHEET_ID',
    primaryValue: '測試生甲',
    signName: '家長',
    email: 'user@example.com',
    expireAt: 1750000000000,
    status: 'pending',
    fileID: '',
    createdAt: 1749000000000,
    updatedAt: 1749500000000,
    otpHash: 'aGFzaA==',
    otpExpireAt: 1750000300000,
    otpAttempts: 2,
  };

  it('roundtrip 後原樣取回（數字欄位維持 number）', () => {
    expect(gas.parseInviteRow_(gas.inviteRowOf_(invite))).toEqual(invite);
  });

  it('Sheet 讀回的值全是字串/數字混雜也能 parse（模擬 getValues）', () => {
    const row = gas.inviteRowOf_(invite).map((v) => (typeof v === 'number' ? v.toString() : v));
    expect(gas.parseInviteRow_(row)).toEqual(invite);
  });

  it('列有 14 欄（A-N）', () => {
    expect(gas.inviteRowOf_(invite).length).toBe(14);
  });

  it('向下相容：11 欄舊列（A-K）parse 不炸，OTP 三欄視為無有效 OTP', () => {
    const oldRow = gas.inviteRowOf_(invite).slice(0, 11);
    const parsed = gas.parseInviteRow_(oldRow);
    expect(parsed.otpHash).toBe('');
    expect(parsed.otpExpireAt).toBe(0);
    expect(parsed.otpAttempts).toBe(0);
    expect(parsed.token).toBe(invite.token);
  });

  it('向下相容：14 欄但 OTP 欄是空字串（Sheet 空儲存格）→ 同樣視為無有效 OTP', () => {
    const row = [...gas.inviteRowOf_(invite).slice(0, 11), '', '', ''];
    const parsed = gas.parseInviteRow_(row);
    expect(parsed.otpHash).toBe('');
    expect(parsed.otpExpireAt).toBe(0);
    expect(parsed.otpAttempts).toBe(0);
  });

  it('物件缺 OTP 欄位 → inviteRowOf_ 以無 OTP 補齊', () => {
    const bare = { ...invite };
    delete bare.otpHash;
    delete bare.otpExpireAt;
    delete bare.otpAttempts;
    const row = gas.inviteRowOf_(bare);
    expect(row.length).toBe(14);
    expect(row[11]).toBe('');
    expect(row[12]).toBe(0);
    expect(row[13]).toBe(0);
  });
});

describe('email OTP 純函數', () => {
  it('inviteOtpValid_：6 位數字才合法', () => {
    expect(gas.inviteOtpValid_('012345')).toBe(true);
    expect(gas.inviteOtpValid_('000000')).toBe(true);
    expect(gas.inviteOtpValid_('12345')).toBe(false);
    expect(gas.inviteOtpValid_('1234567')).toBe(false);
    expect(gas.inviteOtpValid_('12a456')).toBe(false);
    expect(gas.inviteOtpValid_(123456)).toBe(false);
    expect(gas.inviteOtpValid_(null)).toBe(false);
    expect(gas.inviteOtpValid_(undefined)).toBe(false);
  });

  it('newInviteOtp_ 生成的 OTP 一定通過白名單（含補零）', () => {
    const otp = gas.newInviteOtp_();
    expect(gas.inviteOtpValid_(otp)).toBe(true);
  });

  it('inviteOtpHash_：同輸入同 hash、不同 OTP 或不同邀請碼（salt）都不同', () => {
    const token = 'a'.repeat(64);
    const h = gas.inviteOtpHash_('123456', token);
    expect(h).toBe(gas.inviteOtpHash_('123456', token));
    expect(h).not.toBe(gas.inviteOtpHash_('123457', token));
    expect(h).not.toBe(gas.inviteOtpHash_('123456', 'b'.repeat(64)));
    // 列上存的是 hash，不含明碼
    expect(h).not.toContain('123456');
  });

  it('OTP 參數定案：10 分鐘效期、60 秒重寄節流、連錯 5 次作廢', () => {
    expect(gas.INVITE_OTP_TTL_MS).toBe(10 * 60 * 1000);
    expect(gas.INVITE_OTP_COOLDOWN_MS).toBe(60 * 1000);
    expect(gas.INVITE_OTP_MAX_ATTEMPTS).toBe(5);
  });
});

describe('inviteStatusFor_（讀取時衍生狀態）', () => {
  const now = 1750000000000;

  it('無列 → none', () => {
    expect(gas.inviteStatusFor_(null, now)).toBe('none');
    expect(gas.inviteStatusFor_(undefined, now)).toBe('none');
  });

  it('pending 未過期 → pending', () => {
    expect(gas.inviteStatusFor_({ status: 'pending', expireAt: now + 1 }, now)).toBe('pending');
  });

  it('pending 過期（含剛好到期的邊界）→ expired', () => {
    expect(gas.inviteStatusFor_({ status: 'pending', expireAt: now }, now)).toBe('expired');
    expect(gas.inviteStatusFor_({ status: 'pending', expireAt: now - 1 }, now)).toBe('expired');
  });

  it('signed 過期仍是 signed（簽完不因時間失效）', () => {
    expect(gas.inviteStatusFor_({ status: 'signed', expireAt: now - DAY }, now)).toBe('signed');
  });
});

describe('inviteTransition_（狀態機全矩陣）', () => {
  const matrix = [
    // [status, action, allowed]
    ['none', 'send', true], // 發邀請
    ['none', 'revoke', false], // 沒有可撤的
    ['none', 'sign', false],
    ['pending', 'send', true], // 重發/換 email
    ['pending', 'revoke', true], // 撤回授權，在這個裝置簽名
    ['pending', 'sign', true], // 受邀者簽完
    ['expired', 'send', true], // 過期後重發
    ['expired', 'revoke', true], // 過期列可清掉改本機簽
    ['expired', 'sign', false], // 過期 token 不能簽
    ['signed', 'send', false], // 已簽名的格不可直接再邀（作廢重發走 force，RPC 層二段確認）
    ['signed', 'revoke', false], // 撤回已簽名需 force（RPC 層二段確認）
    ['signed', 'sign', false], // 不能重複簽
  ];

  it.each(matrix)('%s × %s → %s', (status, action, allowed) => {
    expect(gas.inviteTransition_(status, action)).toBe(allowed);
  });

  it('未知動作/狀態 → 一律拒絕', () => {
    expect(gas.inviteTransition_('pending', 'hack')).toBe(false);
    expect(gas.inviteTransition_('whatever', 'send')).toBe(false);
  });
});

describe('resolveSignatureSources_（writeRecord 簽名來源裁決）', () => {
  const now = 1750000000000;
  const local = (name) => ({ name, blob: 'data:image/png;base64,AAAA' });
  const inviteRow = (name, status, expireAt = now + DAY) => ({
    signName: name,
    status,
    expireAt,
    fileID: status === 'signed' ? 'FILE_ID_' + name : '',
  });

  it('全本地：無任何邀請列 → 每格都取前端 blob', () => {
    const result = gas.resolveSignatureSources_(
      ['學生', '家長'],
      [local('學生'), local('家長')],
      [],
      now
    );
    expect(result).toEqual([
      { name: '學生', source: 'local', blob: 'data:image/png;base64,AAAA' },
      { name: '家長', source: 'local', blob: 'data:image/png;base64,AAAA' },
    ]);
  });

  it('全遠端：每格都有 signed 邀請列 → 用列上 fileID', () => {
    const result = gas.resolveSignatureSources_(
      ['學生', '家長'],
      [],
      [inviteRow('學生', 'signed'), inviteRow('家長', 'signed')],
      now
    );
    expect(result).toEqual([
      { name: '學生', source: 'invite', fileID: 'FILE_ID_學生' },
      { name: '家長', source: 'invite', fileID: 'FILE_ID_家長' },
    ]);
  });

  it('混合：一格本地、一格遠端 signed', () => {
    const result = gas.resolveSignatureSources_(
      ['學生', '家長'],
      [local('學生')],
      [inviteRow('家長', 'signed')],
      now
    );
    expect(result[0].source).toBe('local');
    expect(result[1]).toEqual({ name: '家長', source: 'invite', fileID: 'FILE_ID_家長' });
  });

  it('pending 阻擋：授權中的格回 pending（整筆送出要被擋）', () => {
    const result = gas.resolveSignatureSources_(
      ['家長'],
      [local('家長')],
      [inviteRow('家長', 'pending')],
      now
    );
    expect(result).toEqual([{ name: '家長', source: 'pending' }]);
  });

  it('過期 pending 一樣阻擋（要求填寫者先重發或撤回，不悄悄改用本地）', () => {
    const result = gas.resolveSignatureSources_(
      ['家長'],
      [local('家長')],
      [inviteRow('家長', 'pending', now - 1)],
      now
    );
    expect(result).toEqual([{ name: '家長', source: 'pending' }]);
  });

  it('invite 優先：格同時有 signed 列與本地 blob → 用列上 fileID（前端無從偽造）', () => {
    const result = gas.resolveSignatureSources_(
      ['家長'],
      [local('家長')],
      [inviteRow('家長', 'signed')],
      now
    );
    expect(result).toEqual([{ name: '家長', source: 'invite', fileID: 'FILE_ID_家長' }]);
  });

  it('missing：無邀請列也無本地 blob（含空 blob）', () => {
    expect(gas.resolveSignatureSources_(['家長'], [], [], now)).toEqual([
      { name: '家長', source: 'missing' },
    ]);
    expect(gas.resolveSignatureSources_(['家長'], [{ name: '家長', blob: '' }], [], now)).toEqual([
      { name: '家長', source: 'missing' },
    ]);
  });

  it('其他人的邀請列不影響本格（依 signName 對應）', () => {
    const result = gas.resolveSignatureSources_(
      ['學生'],
      [local('學生')],
      [inviteRow('家長', 'pending')],
      now
    );
    expect(result[0].source).toBe('local');
  });
});

describe('doGet token 注入閘門', () => {
  const PAGE = '<html><head><title>t</title></head><body></body></html>';

  function runDoGet(e) {
    let injected = null;
    // 刻意不提供 createTemplateFromFile：bundle 內含 <? 序列（marked 的 regex），
    // template.evaluate() 會把它當 scriptlet 編譯而 SyntaxError，doGet 只准用
    // createHtmlOutputFromFile 取原始內容（實機炸過，2026-07-10）
    const fakeHtmlService = {
      createHtmlOutputFromFile: () => ({ getContent: () => PAGE }),
      createHtmlOutput: (content) => {
        injected = content;
        const output = {
          setTitle: () => output,
          addMetaTag: () => output,
        };
        return output;
      },
    };
    const factory = new Function(
      'LodashGS',
      'PropertiesService',
      'Utilities',
      'HtmlService',
      `${source}\n;return { doGet };`
    );
    const { doGet } = factory(
      { load: () => _ },
      { getScriptProperties: () => ({ getProperty: () => '測試系統' }) },
      fakeUtilities,
      fakeHtmlService
    );
    doGet(e);
    return injected;
  }

  it('合法 64 字元 hex token → 注入 window.__SM_INVITE_TOKEN__', () => {
    const token = 'ab'.repeat(32);
    const content = runDoGet({ parameter: { token } });
    expect(content).toContain('window.__SM_INVITE_TOKEN__="' + token + '"');
    expect(content.indexOf('<head><script>')).toBeGreaterThan(-1);
  });

  it('非法 token（注入字串）→ 原樣輸出、完全不注入', () => {
    const evil = '</script><script>alert(1)</script>';
    expect(runDoGet({ parameter: { token: evil } })).toBe(PAGE);
    expect(runDoGet({ parameter: { token: 'A'.repeat(64) } })).toBe(PAGE);
    expect(runDoGet({ parameter: { token: 'a'.repeat(63) } })).toBe(PAGE);
  });

  it('沒帶 token / 沒有 parameter → 不注入', () => {
    expect(runDoGet({ parameter: {} })).toBe(PAGE);
    expect(runDoGet({})).toBe(PAGE);
    expect(runDoGet(undefined)).toBe(PAGE);
  });
});

describe('latestInvites_ / latestInviteForCell_ / latestInviteForToken_（純 append 快照：取每格最新列）', () => {
  function fakeSheet(rows) {
    return {
      getLastRow: () => rows.length,
      getRange: (r, c, numRows, numCols) => ({
        getValues: () => rows.slice(r - 1, r - 1 + numRows).map((x) => x.slice(c - 1, c - 1 + numCols)),
      }),
    };
  }
  function snap({ token, refer = 'REFER_A', pkey = '測試生甲', signName = '家長', status = 'pending' }) {
    return gas.inviteRowOf_({
      token, referSSID: refer, recordSSID: 'REC', primaryValue: pkey, signName,
      email: 'p@example.com', expireAt: 9000000000000, status, fileID: '',
      createdAt: 1, updatedAt: 1, otpHash: '', otpExpireAt: 0, otpAttempts: 0,
    });
  }

  it('同格多筆 → 取最新（最後 append 的那列）、同格合併成一筆', () => {
    const sheet = fakeSheet([snap({ token: 't1', status: 'pending' }), snap({ token: 't2', status: 'signed' })]);
    const latest = gas.latestInviteForCell_(sheet, 'REFER_A', '測試生甲', '家長');
    expect(latest.token).toBe('t2');
    expect(latest.status).toBe('signed');
    expect(gas.latestInvites_(sheet).length).toBe(1);
  });

  it('不同格 → 各自保留最新', () => {
    const sheet = fakeSheet([snap({ token: 't1', signName: '學生' }), snap({ token: 't2', signName: '家長' })]);
    expect(gas.latestInvites_(sheet).length).toBe(2);
    expect(gas.latestInviteForCell_(sheet, 'REFER_A', '測試生甲', '學生').token).toBe('t1');
  });

  it('latestInviteForToken_：token 在最新列 → 命中；不存在 → null', () => {
    const sheet = fakeSheet([snap({ token: 't1' })]);
    expect(gas.latestInviteForToken_(sheet, 't1').token).toBe('t1');
    expect(gas.latestInviteForToken_(sheet, 'nope')).toBeNull();
  });

  it('superseded：舊 token 被同格更新列取代 → 回 null（correctness 關鍵）', () => {
    const sheet = fakeSheet([snap({ token: 'old' }), snap({ token: 'new' })]);
    expect(gas.latestInviteForToken_(sheet, 'new').token).toBe('new');
    expect(gas.latestInviteForToken_(sheet, 'old')).toBeNull();
  });

  it('跳過第 1 列表頭；只有表頭 → 空', () => {
    const sheet = fakeSheet([gas.INVITE_HEADER, snap({ token: 't1' })]);
    expect(gas.latestInvites_(sheet).length).toBe(1);
    expect(gas.latestInviteForToken_(sheet, 't1').token).toBe('t1');
    expect(gas.latestInvites_(fakeSheet([gas.INVITE_HEADER])).length).toBe(0);
  });

  it('空分頁 → 空', () => {
    const sheet = fakeSheet([]);
    expect(gas.latestInvites_(sheet)).toEqual([]);
    expect(gas.latestInviteForCell_(sheet, 'R', 'u', 's')).toBeNull();
    expect(gas.latestInviteForToken_(sheet, 't')).toBeNull();
  });
});
