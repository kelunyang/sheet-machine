// 後端 JWT（src/Code.js 是 GAS 檔，非 ES module）：
// 以 new Function 載入原始碼並 stub 掉 GAS 全域（Utilities 的 HMAC/base64 用 node:crypto 對應實作），
// 測試 signJwt_/verifyJwt_/issueToken_/authByToken_/renewToken。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import _ from 'lodash';

const source = readFileSync(new URL('../src/Code.js', import.meta.url), 'utf8');

const TEST_SECRET = 'unit-test-secret';
const REFER = 'REFER_SHEET_ID';
const RECORD = 'RECORD_SHEET_ID';

function toBuffer(data) {
  if (typeof data === 'string') {
    return Buffer.from(data, 'utf8');
  }
  // GAS 的 byte[] 是帶號整數（-128..127）
  return Buffer.from(data.map((b) => b & 0xff));
}

const fakeUtilities = {
  computeHmacSha256Signature: (data, key) => {
    const digest = createHmac('sha256', key).update(data).digest();
    return [...digest].map((b) => (b > 127 ? b - 256 : b));
  },
  base64EncodeWebSafe: (data) => toBuffer(data).toString('base64url'),
  base64DecodeWebSafe: (str) => [...Buffer.from(str, 'base64url')],
  newBlob: (bytes) => ({ getDataAsString: () => toBuffer(bytes).toString('utf8') }),
  getUuid: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeffff0000',
};

// 清單分頁的一列（A:O）：B=refer、C=record、D=dueDate、O=writeAllowed
function makeListRow({ refer = REFER, record = RECORD, dueDate, writeAllowed = '是' }) {
  const row = new Array(15).fill('');
  row[0] = '測試問卷';
  row[1] = refer;
  row[2] = record;
  row[3] = dueDate === undefined ? Date.now() + 86400000 : dueDate;
  row[14] = writeAllowed;
  return row;
}

function loadGasJwt({ listRows = [] } = {}) {
  const store = { jwtSecret: TEST_SECRET, listSheetID: 'LIST_SHEET_ID' };
  const fakePropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => (key in store ? store[key] : null),
      setProperty: (key, value) => {
        store[key] = value;
      },
    }),
  };
  const fakeSpreadsheetApp = {
    openById: () => ({
      getSheets: () => [{ getRange: () => ({ getValues: () => listRows }) }],
    }),
  };
  const factory = new Function(
    'LodashGS',
    'PropertiesService',
    'Utilities',
    'SpreadsheetApp',
    `${source}\n;return { signJwt_, verifyJwt_, issueToken_, authByToken_, getJwtSecret_, renewToken, JWT_TTL_MS };`
  );
  return factory({ load: () => _ }, fakePropertiesService, fakeUtilities, fakeSpreadsheetApp);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('signJwt_ / verifyJwt_', () => {
  const { signJwt_, verifyJwt_ } = loadGasJwt();
  const now = Date.now();
  const payload = {
    pkey: '測試生甲',
    refer: REFER,
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 3600,
  };

  it('sign → verify roundtrip，payload 原樣取回', () => {
    const token = signJwt_(payload, TEST_SECRET);
    expect(token.split('.').length).toBe(3);
    const claims = verifyJwt_(token, TEST_SECRET, now);
    expect(claims).toEqual(payload);
  });

  it('中文與 base64url 特殊字元都能 roundtrip', () => {
    const token = signJwt_({ ...payload, pkey: 'A123456789?>~壓力測試' }, TEST_SECRET);
    expect(verifyJwt_(token, TEST_SECRET, now).pkey).toBe('A123456789?>~壓力測試');
  });

  it('竄改 payload → 驗證失敗', () => {
    const token = signJwt_(payload, TEST_SECRET);
    const parts = token.split('.');
    const tampered = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8')
    );
    tampered.pkey = '測試生乙';
    parts[1] = Buffer.from(JSON.stringify(tampered), 'utf8').toString('base64url');
    expect(verifyJwt_(parts.join('.'), TEST_SECRET, now)).toBe(false);
  });

  it('用錯的 secret 驗證 → 失敗', () => {
    const token = signJwt_(payload, TEST_SECRET);
    expect(verifyJwt_(token, 'other-secret', now)).toBe(false);
  });

  it('exp 過期 → 失敗；剛好到期（邊界）也算過期', () => {
    const token = signJwt_(payload, TEST_SECRET);
    expect(verifyJwt_(token, TEST_SECRET, payload.exp * 1000 - 1)).not.toBe(false);
    expect(verifyJwt_(token, TEST_SECRET, payload.exp * 1000)).toBe(false);
    expect(verifyJwt_(token, TEST_SECRET, payload.exp * 1000 + 1)).toBe(false);
  });

  it('格式錯誤的 token 一律回 false 不 throw', () => {
    for (const bad of ['', 'abc', 'a.b', 'a.b.c.d', '!!.@@.##', null, undefined, 123]) {
      expect(verifyJwt_(bad, TEST_SECRET, now)).toBe(false);
    }
  });

  it('缺 exp 的 payload → 失敗', () => {
    const token = signJwt_({ pkey: 'x', refer: REFER }, TEST_SECRET);
    expect(verifyJwt_(token, TEST_SECRET, now)).toBe(false);
  });
});

describe('issueToken_ / authByToken_', () => {
  it('簽發的 token 通過驗證且綁定問卷', () => {
    const { issueToken_, authByToken_ } = loadGasJwt();
    const token = issueToken_(REFER, '測試生甲', Date.now());
    const claims = authByToken_(REFER, token);
    expect(claims.pkey).toBe('測試生甲');
    expect(claims.refer).toBe(REFER);
  });

  it('refer 不符（拿 A 問卷 token 打 B 問卷）→ 拒絕', () => {
    const { issueToken_, authByToken_ } = loadGasJwt();
    const token = issueToken_(REFER, '測試生甲', Date.now());
    expect(authByToken_('OTHER_REFER', token)).toBe(false);
  });

  it('token 有效期為 1 小時', () => {
    const { issueToken_, authByToken_, JWT_TTL_MS } = loadGasJwt();
    expect(JWT_TTL_MS).toBe(3600000);
    vi.useFakeTimers();
    const issuedAt = Date.now();
    const token = issueToken_(REFER, '測試生甲', issuedAt);
    vi.setSystemTime(issuedAt + JWT_TTL_MS - 1000);
    expect(authByToken_(REFER, token)).not.toBe(false);
    vi.setSystemTime(issuedAt + JWT_TTL_MS + 1000);
    expect(authByToken_(REFER, token)).toBe(false);
  });

  it('jwtSecret 未設定時自動生成並寫回', () => {
    const store = {};
    const factory = new Function(
      'LodashGS',
      'PropertiesService',
      'Utilities',
      `${source}\n;return { getJwtSecret_ };`
    );
    const { getJwtSecret_ } = factory(
      { load: () => _ },
      {
        getScriptProperties: () => ({
          getProperty: (key) => (key in store ? store[key] : null),
          setProperty: (key, value) => {
            store[key] = value;
          },
        }),
      },
      fakeUtilities
    );
    const secret = getJwtSecret_();
    expect(secret.length).toBe(64);
    expect(store.jwtSecret).toBe(secret);
    expect(getJwtSecret_()).toBe(secret);
  });
});

describe('renewToken（手動續約）', () => {
  it('有效 token + 開放中的表單 → 換發新 token（pkey/refer 不變、exp 延後）', () => {
    const gas = loadGasJwt({ listRows: [makeListRow({})] });
    vi.useFakeTimers();
    const t0 = Date.now();
    const oldToken = gas.issueToken_(REFER, '測試生甲', t0);
    // 過了半小時再續約
    vi.setSystemTime(t0 + 30 * 60 * 1000);
    const result = gas.renewToken(REFER, RECORD, oldToken);
    expect(result.renewed).toBe(true);
    const claims = gas.authByToken_(REFER, result.token);
    expect(claims.pkey).toBe('測試生甲');
    const oldClaims = gas.verifyJwt_(oldToken, TEST_SECRET, Date.now());
    expect(claims.exp).toBeGreaterThan(oldClaims.exp);
  });

  it('過期 token 不能續（回 tokenExpired，前端導回登入）', () => {
    const gas = loadGasJwt({ listRows: [makeListRow({})] });
    vi.useFakeTimers();
    const t0 = Date.now();
    const token = gas.issueToken_(REFER, '測試生甲', t0);
    vi.setSystemTime(t0 + gas.JWT_TTL_MS + 1000);
    expect(gas.renewToken(REFER, RECORD, token)).toEqual({ tokenExpired: true });
  });

  it('refer 不符的 token → tokenExpired', () => {
    const gas = loadGasJwt({ listRows: [makeListRow({})] });
    const token = gas.issueToken_('OTHER_REFER', '測試生甲', Date.now());
    expect(gas.renewToken(REFER, RECORD, token)).toEqual({ tokenExpired: true });
  });

  it('表單已過 dueDate → 拒絕續約', () => {
    const gas = loadGasJwt({ listRows: [makeListRow({ dueDate: Date.now() - 1000 })] });
    const token = gas.issueToken_(REFER, '測試生甲', Date.now());
    const result = gas.renewToken(REFER, RECORD, token);
    expect(result.renewed).toBe(false);
    expect(result.message).toContain('過期');
  });

  it('表單關閉（writeAllowed 否）→ 拒絕續約', () => {
    const gas = loadGasJwt({ listRows: [makeListRow({ writeAllowed: '否' })] });
    const token = gas.issueToken_(REFER, '測試生甲', Date.now());
    const result = gas.renewToken(REFER, RECORD, token);
    expect(result.renewed).toBe(false);
    expect(result.message).toContain('關閉');
  });

  it('找不到表單 → 拒絕續約', () => {
    const gas = loadGasJwt({ listRows: [] });
    const token = gas.issueToken_(REFER, '測試生甲', Date.now());
    expect(gas.renewToken(REFER, RECORD, token).renewed).toBe(false);
  });
});
