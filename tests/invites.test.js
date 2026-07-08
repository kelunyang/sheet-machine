// 遠端多方簽名邀請的純函數（src/Code.js 是 GAS 檔，非 ES module）：
// 以 new Function 載入原始碼並 stub 掉 GAS 全域，測試 token 格式閘門、效期計算、
// 列⇄物件互轉、狀態衍生、狀態機矩陣，以及 writeRecord 的簽名來源裁決 resolveSignatureSources_。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import _ from 'lodash';

const source = readFileSync(new URL('../src/Code.js', import.meta.url), 'utf8');

const fakeUtilities = {
  getUuid: () => 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEFFFF0000',
};

function loadGasInvites() {
  const factory = new Function(
    'LodashGS',
    'PropertiesService',
    'Utilities',
    `${source}\n;return {
      INVITE_SHEET_NAME, INVITE_TTL_DAYS, INVITE_MAX_SIGNATURE_BYTES,
      inviteTokenValid_, newInviteToken_, inviteExpireAt_,
      inviteRowOf_, parseInviteRow_, inviteStatusFor_, inviteTransition_,
      resolveSignatureSources_, inviteRowIndexByCell_, inviteRowIndexByToken_
    };`
  );
  return factory(
    { load: () => _ },
    { getScriptProperties: () => ({ getProperty: () => null }) },
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

describe('inviteExpireAt_（效期 = min(now+7天, dueDate)）', () => {
  const now = 1750000000000;

  it('dueDate 在 7 天之後 → 取 now+7 天', () => {
    expect(gas.inviteExpireAt_(now, now + 30 * DAY, 7)).toBe(now + 7 * DAY);
  });

  it('dueDate 在 7 天之內 → 取 dueDate', () => {
    expect(gas.inviteExpireAt_(now, now + 2 * DAY, 7)).toBe(now + 2 * DAY);
  });

  it('dueDate 剛好在第 7 天（邊界）→ 兩者相等', () => {
    expect(gas.inviteExpireAt_(now, now + 7 * DAY, 7)).toBe(now + 7 * DAY);
  });

  it('INVITE_TTL_DAYS 定案為 7 天', () => {
    expect(gas.INVITE_TTL_DAYS).toBe(7);
  });
});

describe('inviteRowOf_ / parseInviteRow_（物件⇄11 欄列互轉）', () => {
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
  };

  it('roundtrip 後原樣取回（數字欄位維持 number）', () => {
    expect(gas.parseInviteRow_(gas.inviteRowOf_(invite))).toEqual(invite);
  });

  it('Sheet 讀回的值全是字串/數字混雜也能 parse（模擬 getValues）', () => {
    const row = gas.inviteRowOf_(invite).map((v) => (typeof v === 'number' ? v.toString() : v));
    expect(gas.parseInviteRow_(row)).toEqual(invite);
  });

  it('列有 11 欄（A-K）', () => {
    expect(gas.inviteRowOf_(invite).length).toBe(11);
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
    ['signed', 'send', false], // 已簽名的格不可再邀
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
    const fakeHtmlService = {
      createTemplateFromFile: () => ({ evaluate: () => ({ getContent: () => PAGE }) }),
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

describe('inviteRowIndexByCell_ / inviteRowIndexByToken_（找列）', () => {
  const row = (token, refer, pkey, signName) => [token, refer, 'REC', pkey, signName];
  function fakeSheet(rows) {
    return {
      getLastRow: () => rows.length,
      getRange: (r, c, numRows, numCols) => ({
        getValues: () => rows.map((x) => x.slice(0, numCols)),
      }),
    };
  }

  it('以（referSSID, 主鍵值, 簽名格名稱）三鍵找列，回 1-based 列號', () => {
    const sheet = fakeSheet([
      row('t1', 'REFER_A', '測試生甲', '學生'),
      row('t2', 'REFER_A', '測試生甲', '家長'),
      row('t3', 'REFER_A', '測試生乙', '家長'),
    ]);
    expect(gas.inviteRowIndexByCell_(sheet, 'REFER_A', '測試生甲', '家長')).toBe(2);
    expect(gas.inviteRowIndexByCell_(sheet, 'REFER_A', '測試生丙', '家長')).toBe(-1);
    expect(gas.inviteRowIndexByCell_(sheet, 'REFER_B', '測試生甲', '家長')).toBe(-1);
  });

  it('以 token 找列', () => {
    const sheet = fakeSheet([row('t1', 'R', 'u', 's'), row('t2', 'R', 'u', 's2')]);
    expect(gas.inviteRowIndexByToken_(sheet, 't2')).toBe(2);
    expect(gas.inviteRowIndexByToken_(sheet, 'tx')).toBe(-1);
  });

  it('空分頁回 -1', () => {
    const sheet = { getLastRow: () => 0, getRange: () => ({ getValues: () => [] }) };
    expect(gas.inviteRowIndexByCell_(sheet, 'R', 'u', 's')).toBe(-1);
    expect(gas.inviteRowIndexByToken_(sheet, 't')).toBe(-1);
  });
});
