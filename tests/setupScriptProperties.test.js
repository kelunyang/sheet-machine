// setupScriptProperties（移植新部署時一次補齊 ScriptProperties 預設值）：
// 1. 程式碼讀到的每個 property 都要登記在「有預設／手動填／系統維護」三份清單之一（新增 property 忘了登記會失敗）
// 2. 只補沒設或空白的，已有值不動、密鑰不碰
// 3. 補上的預設值讓讀取端行為和沒設時完全一樣
// 4. 只允許部署帳號本人在編輯器執行（google.script.run 叫到直接擋）
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import _ from 'lodash';

const source = readFileSync(new URL('../src/Code.js', import.meta.url), 'utf8');

function loadGas(store = {}, session) {
  const writes = [];
  const fakePropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => (key in store ? store[key] : null),
      getProperties: () => ({ ...store }),
      setProperty: (key, value) => {
        store[key] = value;
      },
      setProperties: (props, deleteAllOthers) => {
        writes.push({ props, deleteAllOthers });
        Object.assign(store, props);
      },
    }),
  };
  const factory = new Function(
    'LodashGS',
    'PropertiesService',
    'Session',
    `${source}\n;return {
      scriptPropertyDefaults_, scriptPropertyManual_, scriptPropertySystemManaged_,
      scriptPropertySetupPlan_, setupScriptProperties,
      loginFailMax_, loginCooldownMs_, scanAlertThreshold_, scanAlertWindowSec_, scanAlertCooldownSec_,
      pdfGenMax_, pdfGenWindowMs_, inviteTtlMs_, fileLogRetentionMs_, draftRebuildMinRows_,
      loadingGameDefaultOff_, positiveIntProp_,
      LOGIN_SCAN_FAIL_THRESHOLD_DEFAULT, LOGIN_SCAN_DISTINCT_THRESHOLD_DEFAULT
    };`
  );
  return { gas: factory({ load: () => _ }, fakePropertiesService, session), store, writes };
}

function ownerSession(active = 'owner@example.com', effective = 'owner@example.com') {
  return {
    getActiveUser: () => ({ getEmail: () => active }),
    getEffectiveUser: () => ({ getEmail: () => effective }),
  };
}

describe('ScriptProperties 清單完整性', () => {
  const { gas } = loadGas();
  const registered = [
    ...Object.keys(gas.scriptPropertyDefaults_()),
    ...Object.keys(gas.scriptPropertyManual_()),
    ...gas.scriptPropertySystemManaged_(),
  ];

  it('三份清單互不重複', () => {
    expect(new Set(registered).size).toBe(registered.length);
  });

  it('程式碼讀到的每個 property 都有登記，反之亦然', () => {
    const read = new Set();
    for (const m of source.matchAll(/getProperty\('(\w+)'\)/g)) read.add(m[1]);
    for (const m of source.matchAll(/positiveIntProp_\('(\w+)'/g)) read.add(m[1]);
    expect([...read].sort()).toEqual([...registered].sort());
    expect(read.size).toBe(26);
  });
});

describe('scriptPropertySetupPlan_', () => {
  const { gas } = loadGas();

  it('全新專案：補 13 項預設值（全是字串），9 項列為待手動填', () => {
    const plan = gas.scriptPropertySetupPlan_({});
    expect(Object.keys(plan.fill)).toHaveLength(13);
    expect(Object.values(plan.fill).every((v) => typeof v === 'string')).toBe(true);
    expect(plan.fill.loginFailMax).toBe('5');
    expect(plan.fill.inviteTtlMinutes).toBe('10080');
    expect(plan.fill.loadingGameDefault).toBe('1');
    expect(plan.kept).toEqual([]);
    expect(plan.missing).toHaveLength(9);
    expect(plan.missing).toContain('listSheetID');
  });

  it('已有值不動（含調過的值與部署者關掉的遊戲）', () => {
    const plan = gas.scriptPropertySetupPlan_({
      loginFailMax: '99999',
      loadingGameDefault: '0',
      listSheetID: 'abc',
    });
    expect(plan.fill.loginFailMax).toBeUndefined();
    expect(plan.fill.loadingGameDefault).toBeUndefined();
    expect(plan.kept).toEqual(expect.arrayContaining(['loginFailMax', 'loadingGameDefault']));
    expect(plan.missing).not.toContain('listSheetID');
  });

  it('空白值視同沒設（讀取端本來就把空白當沒設）', () => {
    const plan = gas.scriptPropertySetupPlan_({ pdfGenMax: '  ', systemTitle: '' });
    expect(plan.fill.pdfGenMax).toBe('10');
    expect(plan.missing).toContain('systemTitle');
  });

  it('密鑰與游標永遠不會被補', () => {
    const plan = gas.scriptPropertySetupPlan_({});
    for (const key of gas.scriptPropertySystemManaged_()) {
      expect(plan.fill[key]).toBeUndefined();
      expect(plan.missing).not.toContain(key);
    }
  });
});

describe('補上預設值後行為不變', () => {
  function readAll(gas) {
    return {
      loginFailMax: gas.loginFailMax_(),
      loginCooldownMs: gas.loginCooldownMs_(),
      scanAlertThreshold: gas.scanAlertThreshold_(),
      scanAlertWindowSec: gas.scanAlertWindowSec_(),
      scanAlertCooldownSec: gas.scanAlertCooldownSec_(),
      loginScanFail: gas.positiveIntProp_('loginScanFailThreshold', gas.LOGIN_SCAN_FAIL_THRESHOLD_DEFAULT),
      loginScanDistinct: gas.positiveIntProp_(
        'loginScanDistinctThreshold',
        gas.LOGIN_SCAN_DISTINCT_THRESHOLD_DEFAULT
      ),
      pdfGenMax: gas.pdfGenMax_(),
      pdfGenWindowMs: gas.pdfGenWindowMs_(),
      inviteTtlMs: gas.inviteTtlMs_(),
      fileLogRetentionMs: gas.fileLogRetentionMs_(),
      draftRebuildMinRows: gas.draftRebuildMinRows_(),
      loadingGameOff: gas.loadingGameDefaultOff_(),
    };
  }

  it('沒設 vs 填了預設值：每個讀取端結果相同', () => {
    const empty = loadGas({}).gas;
    const filledStore = { ...empty.scriptPropertySetupPlan_({}).fill };
    const filled = loadGas(filledStore).gas;
    expect(readAll(filled)).toEqual(readAll(empty));
  });
});

describe('setupScriptProperties', () => {
  it('部署帳號本人執行：只寫缺的、不刪其他 property', () => {
    const store = { jwtSecret: 'keep-me', loginFailMax: '99999' };
    const { gas, writes } = loadGas(store, ownerSession());
    expect(gas.setupScriptProperties()).toBeUndefined();
    expect(writes).toHaveLength(1);
    expect(writes[0].deleteAllOthers).toBe(false);
    expect(store.jwtSecret).toBe('keep-me');
    expect(store.loginFailMax).toBe('99999');
    expect(store.pdfGenWindowMinutes).toBe('360');
  });

  it('重跑：沒有缺的就不寫', () => {
    const { gas } = loadGas({}, ownerSession());
    const filled = gas.scriptPropertySetupPlan_({}).fill;
    const rerun = loadGas({ ...filled }, ownerSession());
    rerun.gas.setupScriptProperties();
    expect(rerun.writes).toHaveLength(0);
  });

  it('匿名（google.script.run）或非部署帳號：一筆都不寫', () => {
    for (const session of [ownerSession(''), ownerSession('someone@example.com')]) {
      const { gas, writes, store } = loadGas({}, session);
      gas.setupScriptProperties();
      expect(writes).toHaveLength(0);
      expect(store).toEqual({});
    }
  });
});
