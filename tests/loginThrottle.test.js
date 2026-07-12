// 登入防枚舉（Phase 21）：CacheService 即時防線 ＋ _logins 稽核日誌 ＋ scanLoginLog 定時掃描。
// 以 new Function 載入 Code.js 並 stub 全部 GAS 全域；CacheService 用可控時鐘的 fake（TTL 忠實模擬），
// 冷卻期滿以推進時鐘驗證。HMAC 用 node:crypto，比照 inviteRpc.test.js。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import _ from 'lodash';

const source = readFileSync(new URL('../src/Code.js', import.meta.url), 'utf8');

const REFER = 'REFER_SHEET_ID';
const RECORD = 'RECORD_SHEET_ID';
const ADMIN = 'admin@example.com';

function toBuffer(data) {
  if (typeof data === 'string') {
    return Buffer.from(data, 'utf8');
  }
  return Buffer.from(data.map((b) => b & 0xff));
}

// 名冊列（A:O）：A 名稱、B refer、C record、M(12) 管理員 Email、O(14) 開放進入
function makeListRow() {
  const row = new Array(15).fill('');
  row[0] = '測試問卷';
  row[1] = REFER;
  row[2] = RECORD;
  row[12] = ADMIN;
  row[14] = '是';
  return row;
}

// 對照表單（refer）：前 8 列 meta（P 主鍵走密碼路徑）+ 名冊資料列
const REFER_ROWS = [
  ['uid'],
  ['學號'],
  ['P'],
  ['T'],
  [''],
  [''],
  [''],
  [''],
  ['測試生甲'],
];

// 可控時鐘 + TTL 忠實的 fake CacheService（GAS getScriptCache 是全 script 共用單例）
function makeCache(clock) {
  const store = new Map();
  return {
    _store: store,
    get: (k) => {
      if (!store.has(k)) {
        return null;
      }
      const e = store.get(k);
      if (clock.now >= e.expireAt) {
        store.delete(k);
        return null;
      }
      return e.value;
    },
    put: (k, v, ttlSec) => {
      store.set(k, {
        value: String(v),
        expireAt: clock.now + (ttlSec == null ? 600 : ttlSec) * 1000,
      });
    },
    remove: (k) => {
      store.delete(k);
    },
  };
}

function loadGas({ props = {}, listRows = [makeListRow()], loginSeed = null, tryLock = true } = {}) {
  const store = Object.assign(
    {
      draftEncSecret: 'unit-test-draft-secret',
      listSheetID: 'LIST_SHEET_ID',
      draftSheetID: 'DRAFT_SHEET_ID',
    },
    props
  );
  // 對齊真實時間：readRecord_ 內部用真實 new Date()，fake cache 的 TTL 時鐘要同基準才一致
  const clock = { now: Date.now() };
  const cache = makeCache(clock);
  const sentEmails = [];
  // loginSeed=null → _logins 分頁尚未存在（首次 append 建表頭）；陣列 → 已存在且帶那些列
  let loginRows = loginSeed === null ? null : loginSeed.slice();
  const makeLoginSheet = () => ({
    getLastRow: () => loginRows.length,
    getLastColumn: () => loginRows.reduce((m, r) => Math.max(m, r.length), 0),
    getRange: (r, c, nr, nc) => ({
      getValues: () =>
        loginRows.slice(r - 1, r - 1 + nr).map((row) => {
          const s = row.slice(c - 1, c - 1 + nc);
          while (s.length < nc) {
            s.push('');
          }
          return s;
        }),
    }),
    appendRow: (row) => loginRows.push([...row]),
    setFrozenRows: () => {},
  });

  const fakeSpreadsheetApp = {
    openById: (id) => {
      if (id === 'DRAFT_SHEET_ID') {
        return {
          getSheetByName: (name) =>
            name === '_logins' && loginRows !== null ? makeLoginSheet() : null,
          insertSheet: (name) => {
            if (name === '_logins') {
              loginRows = [];
              return makeLoginSheet();
            }
            return { appendRow: () => {}, setFrozenRows: () => {} };
          },
        };
      }
      if (id === REFER) {
        return { getSheets: () => [{ getDataRange: () => ({ getValues: () => REFER_ROWS }) }] };
      }
      // 名冊分頁（getRange('A:O')）
      return { getSheets: () => [{ getRange: () => ({ getValues: () => listRows }) }] };
    },
  };
  const fakeUtilities = {
    computeHmacSha256Signature: (data, key) => {
      const digest = createHmac('sha256', key).update(data).digest();
      return [...digest].map((b) => (b > 127 ? b - 256 : b));
    },
    base64EncodeWebSafe: (data) => toBuffer(data).toString('base64url'),
    getUuid: () => '00000000-0000-4000-8000-000000000000',
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
      deriveDraftKey_, loginPseudonym_, checkLoginThrottle_, recordLoginAttempt_,
      appendLoginLog_, analyzeLoginRows_, flagLoginAnomalies_, buildScanAlertBody_,
      scanLoginLog_, readRecord_, authRecord, LOGIN_HEADER,
      loginFailMax_, loginCooldownMs_
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
    {},
    { getScriptLock: () => ({ tryLock: () => tryLock, waitLock: () => {}, releaseLock: () => {} }) },
    {
      getRemainingDailyQuota: () => 100,
      sendEmail: (to, subject, body) => sentEmails.push({ to, subject, body }),
    },
    {},
    {
      getActiveUser: () => ({ getEmail: () => '' }),
      getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }),
    },
    { getScriptCache: () => cache }
  );
  return { gas, clock, cache, store, sentEmails, getLoginRows: () => loginRows };
}

const AUTH = [{ id: 'uid', value: '測試生甲' }];
const ACCT = '測試生甲'; // recordLoginAttempt_ 的 loginId 參數＝明文真實帳號值（落 _logins C 欄）

describe('loginPseudonym_ / deriveDraftKey_（假名穩定且分離）', () => {
  it('同一嘗試主鍵值穩定派生同一假名（purpose=log）', () => {
    const { gas } = loadGas();
    const p1 = gas.loginPseudonym_(REFER, AUTH);
    const p2 = gas.loginPseudonym_(REFER, AUTH);
    expect(p1).toBe(p2);
    expect(p1).toMatch(/^[A-Za-z0-9_-]+$/); // base64url，可落地
    expect(p1).not.toContain('測試生甲'); // 明文不落地
    expect(p1).toBe(gas.deriveDraftKey_('log', REFER, '測試生甲'));
  });

  it('log 假名與 id/enc（Phase 20）不同（key separation）', () => {
    const { gas } = loadGas();
    const log = gas.deriveDraftKey_('log', REFER, '測試生甲');
    expect(log).not.toBe(gas.deriveDraftKey_('id', REFER, '測試生甲'));
    expect(log).not.toBe(gas.deriveDraftKey_('enc', REFER, '測試生甲'));
    expect(log).not.toBe(gas.deriveDraftKey_('log', 'OTHER', '測試生甲'));
    expect(log).not.toBe(gas.deriveDraftKey_('log', REFER, '測試生乙'));
  });

  it('無 P 欄或空嘗試值 → 回 null（呼叫端跳過限流）', () => {
    const { gas } = loadGas();
    expect(gas.loginPseudonym_(REFER, [{ id: 'uid', value: '' }])).toBe(null);
    expect(gas.loginPseudonym_(REFER, [{ id: 'nope', value: 'x' }])).toBe(null);
  });
});

describe('checkLoginThrottle_ / recordLoginAttempt_（縱向鎖定）', () => {
  it('連錯達上限（預設 5）→ 被冷卻；未達上限不擋', () => {
    const { gas, clock } = loadGas();
    const p = gas.loginPseudonym_(REFER, AUTH);
    for (let i = 0; i < 4; i++) {
      gas.recordLoginAttempt_(REFER, p, ACCT, false, clock.now);
      expect(gas.checkLoginThrottle_(REFER, p, clock.now).allowed).toBe(true);
    }
    gas.recordLoginAttempt_(REFER, p, ACCT, false, clock.now); // 第 5 次
    const blocked = gas.checkLoginThrottle_(REFER, p, clock.now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.cooldownRemainMs).toBeGreaterThan(0);
  });

  it('冷卻期滿（推進時鐘）自動解除', () => {
    const { gas, clock } = loadGas();
    const p = gas.loginPseudonym_(REFER, AUTH);
    for (let i = 0; i < 5; i++) {
      gas.recordLoginAttempt_(REFER, p, ACCT, false, clock.now);
    }
    expect(gas.checkLoginThrottle_(REFER, p, clock.now).allowed).toBe(false);
    clock.now += 5 * 60 * 1000 + 1; // 過 5 分鐘冷卻
    expect(gas.checkLoginThrottle_(REFER, p, clock.now).allowed).toBe(true);
  });

  it('成功清零：連錯 4 次後成功，計數歸零、再錯 1 次不被鎖', () => {
    const { gas, clock } = loadGas();
    const p = gas.loginPseudonym_(REFER, AUTH);
    for (let i = 0; i < 4; i++) {
      gas.recordLoginAttempt_(REFER, p, ACCT, false, clock.now);
    }
    gas.recordLoginAttempt_(REFER, p, ACCT, true, clock.now); // 成功清零
    gas.recordLoginAttempt_(REFER, p, ACCT, false, clock.now); // 重新從 1 起算
    expect(gas.checkLoginThrottle_(REFER, p, clock.now).allowed).toBe(true);
  });

  it('可用 ScriptProperties 調整上限與冷卻', () => {
    const { gas, clock } = loadGas({ props: { loginFailMax: '2', loginCooldownMinutes: '10' } });
    const p = gas.loginPseudonym_(REFER, AUTH);
    gas.recordLoginAttempt_(REFER, p, ACCT, false, clock.now);
    gas.recordLoginAttempt_(REFER, p, ACCT, false, clock.now); // 第 2 次達上限
    const blocked = gas.checkLoginThrottle_(REFER, p, clock.now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.cooldownRemainMs).toBe(10 * 60 * 1000);
  });
});

describe('_logins 稽核日誌（純 append、存明文真實帳號、成功失敗都記）', () => {
  it('首次 append 建表頭＋凍結；C 欄存明文真實帳號值（非假名），成功失敗都落地', () => {
    const { gas, clock, getLoginRows } = loadGas();
    const p = gas.loginPseudonym_(REFER, AUTH);
    gas.recordLoginAttempt_(REFER, p, ACCT, false, clock.now);
    gas.recordLoginAttempt_(REFER, p, ACCT, true, clock.now);
    const rows = getLoginRows();
    expect(rows[0]).toEqual(gas.LOGIN_HEADER); // 表頭列
    // C 欄＝明文真實帳號值（稽核價值＝知道是誰；保護靠暫存表永不分享），不是 HMAC 假名
    expect(rows[1]).toEqual([clock.now, REFER, ACCT, '失敗']);
    expect(rows[2]).toEqual([clock.now, REFER, ACCT, '成功']);
    expect(rows[1][2]).not.toBe(p); // 存的是真值、不是傳進來的 cache-key 假名
  });

  it('draftSheetID 未設 → 靜默不記（cache 防線照常）', () => {
    const { gas, clock } = loadGas({ props: { draftSheetID: '' } });
    const p = gas.loginPseudonym_(REFER, AUTH);
    // 不 throw；仍能鎖定
    for (let i = 0; i < 5; i++) {
      gas.recordLoginAttempt_(REFER, p, ACCT, false, clock.now);
    }
    expect(gas.checkLoginThrottle_(REFER, p, clock.now).allowed).toBe(false);
  });
});

describe('per-refer 橫向即時警報（過閾值寄該問卷管理者，節流）', () => {
  it('窗口失敗過閾值 → 寄一封給 M 欄管理者；節流內不重寄', () => {
    const { gas, clock, sentEmails } = loadGas({ props: { scanAlertThreshold: '3' } });
    // 用不同帳號灌 3 次失敗（per-refer 計數不分帳號）
    for (let i = 0; i < 3; i++) {
      gas.recordLoginAttempt_(REFER, 'pseudo-' + i, 'acct-' + i, false, clock.now);
    }
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].to).toBe(ADMIN);
    // 即時警報寄給問卷管理者（可能是老師，信任層級較低），刻意只給計數、不列任何帳號值
    expect(sentEmails[0].body).not.toContain('acct-');
    // 節流內再觸發不重寄
    gas.recordLoginAttempt_(REFER, 'pseudo-x', 'acct-x', false, clock.now);
    expect(sentEmails.length).toBe(1);
  });
});

describe('analyzeLoginRows_ / flagLoginAnomalies_（掃描判定純函數）', () => {
  const rowsOf = (specs) => specs.map((s) => [0, s.refer || REFER, s.p, s.r]);

  it('連錯 ≥3 次後成功 → 標記疑似撞中；連錯 2 次後成功不標', () => {
    const { gas } = loadGas();
    const hit = gas.analyzeLoginRows_(
      rowsOf([
        { p: 'A', r: '失敗' },
        { p: 'A', r: '失敗' },
        { p: 'A', r: '失敗' },
        { p: 'A', r: '成功' },
        { p: 'B', r: '失敗' },
        { p: 'B', r: '失敗' },
        { p: 'B', r: '成功' },
      ]),
      3
    );
    expect(hit[REFER].suspectedHits).toEqual(['A']);
  });

  it('跳過表頭/雜訊列（結果非成功/失敗）', () => {
    const { gas } = loadGas();
    const a = gas.analyzeLoginRows_(
      rowsOf([
        { p: 'account 登入帳號(明文主鍵值)', r: '結果' }, // 表頭
        { p: 'A', r: '失敗' },
      ]),
      3
    );
    expect(a[REFER].attempts).toBe(1);
    expect(a[REFER].fails).toBe(1);
  });

  it('三規則各自觸發 / 全不觸發的邊界', () => {
    const { gas } = loadGas();
    // 規則 1：失敗總數 ≥ 閾值
    const a1 = gas.analyzeLoginRows_(
      rowsOf(Array.from({ length: 20 }, () => ({ p: 'A', r: '失敗' }))),
      3
    );
    expect(gas.flagLoginAnomalies_(a1, 20, 10).length).toBe(1);
    expect(gas.flagLoginAnomalies_(a1, 21, 10).length).toBe(0);
    // 規則 2：相異失敗假名數 ≥ 閾值
    const a2 = gas.analyzeLoginRows_(
      rowsOf(Array.from({ length: 10 }, (_v, i) => ({ p: 'U' + i, r: '失敗' }))),
      3
    );
    expect(gas.flagLoginAnomalies_(a2, 100, 10).length).toBe(1);
    expect(gas.flagLoginAnomalies_(a2, 100, 11).length).toBe(0);
    // 全不觸發（少量失敗、無疑似命中）
    const a3 = gas.analyzeLoginRows_(rowsOf([{ p: 'A', r: '失敗' }, { p: 'B', r: '成功' }]), 3);
    expect(gas.flagLoginAnomalies_(a3, 20, 10).length).toBe(0);
  });
});

describe('scanLoginLog_（游標增量、不重複告警、tryLock、收件人 fallback）', () => {
  // 一批帶表頭 + 連錯 3 次後成功（疑似命中）的 _logins
  const seedWithHit = () => [
    ['timestamp 時間(ms)', 'referSSID 問卷表ID', 'account 登入帳號(明文主鍵值)', 'result 結果'],
    [1, REFER, 'A', '失敗'],
    [2, REFER, 'A', '失敗'],
    [3, REFER, 'A', '失敗'],
    [4, REFER, 'A', '成功'],
  ];

  it('乾淨批次 → 不寄信、游標前進；製造疑似命中 → 寄 securityAlertEmail、再跑不重複', () => {
    const { gas, store, sentEmails } = loadGas({
      props: { securityAlertEmail: 'sec@example.com' },
      loginSeed: seedWithHit(),
    });
    const msg1 = gas.scanLoginLog_();
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].to).toBe('sec@example.com');
    expect(sentEmails[0].body).toContain('疑似撞中');
    expect(msg1).toContain('游標前進至 5');
    expect(store.loginScanCursor).toBe('5');
    // 再跑一次：無新增列 → 不重複告警
    const msg2 = gas.scanLoginLog_();
    expect(sentEmails.length).toBe(1);
    expect(msg2).toContain('無新增登入紀錄');
  });

  it('乾淨批次（無異常）不寄信、游標仍前進', () => {
    const { gas, sentEmails, store } = loadGas({
      loginSeed: [
        ['timestamp 時間(ms)', 'referSSID 問卷表ID', 'account 登入帳號(明文主鍵值)', 'result 結果'],
        [1, REFER, 'A', '失敗'],
        [2, REFER, 'A', '成功'],
      ],
    });
    const msg = gas.scanLoginLog_();
    expect(sentEmails.length).toBe(0);
    expect(msg).toContain('無異常');
    expect(store.loginScanCursor).toBe('3');
  });

  it('securityAlertEmail 未設 → fallback 觸發器擁有者（getEffectiveUser）', () => {
    const { gas, sentEmails } = loadGas({ loginSeed: seedWithHit() });
    gas.scanLoginLog_();
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].to).toBe('owner@example.com');
  });

  it('tryLock 失敗 → 直接 return，不動游標', () => {
    const { gas, store } = loadGas({ loginSeed: seedWithHit(), tryLock: false });
    const msg = gas.scanLoginLog_();
    expect(msg).toContain('上一輪掃描仍在執行');
    expect(store.loginScanCursor).toBe(undefined);
  });

  it('_logins 不存在 → 明確回報、不寄信', () => {
    const { gas, sentEmails } = loadGas({ loginSeed: null });
    expect(gas.scanLoginLog_()).toContain('_logins 分頁不存在');
    expect(sentEmails.length).toBe(0);
  });
});

describe('readRecord_ 整合（被擋早退回一致化；失敗記一筆稽核）', () => {
  it('冷卻中 → 回 {throttled, cooldownSeconds}，不進驗證、不洩漏存在性', () => {
    const { gas, clock } = loadGas();
    const p = gas.loginPseudonym_(REFER, AUTH);
    for (let i = 0; i < 5; i++) {
      gas.recordLoginAttempt_(REFER, p, ACCT, false, clock.now);
    }
    const result = gas.readRecord_(REFER, RECORD, AUTH);
    expect(result.throttled).toBe(true);
    expect(result.cooldownSeconds).toBeGreaterThan(0);
    // 一致化：被鎖回應不帶任何問卷內容
    expect(result.headers).toBe(undefined);
    expect(result.token).toBe(undefined);
  });

  it('認證錯誤 → 回 false 且 _logins 記一筆失敗（C 欄存嘗試的明文帳號值）', () => {
    const { gas, getLoginRows } = loadGas();
    const wrong = [{ id: 'uid', value: '不存在的人' }];
    expect(gas.readRecord_(REFER, RECORD, wrong)).toBe(false);
    const rows = getLoginRows();
    const last = rows[rows.length - 1];
    expect(last[1]).toBe(REFER);
    expect(last[3]).toBe('失敗');
    // 失敗列 C 欄＝攻擊者/使用者嘗試的明文值（枚舉攻擊者可能塞真學號清單，這是刻意取捨）
    expect(last[2]).toBe('不存在的人');
  });
});
