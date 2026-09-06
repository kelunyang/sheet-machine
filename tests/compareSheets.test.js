// 填答率統計（compareSheets，Phase 29）。
// 以 new Function 載入 Code.js 並 stub GAS 全域（比照 mySubmitStatus.test.js 的載入模式）。
//
// 這裡守的紅線：
//   1. 總填答率 = sum(已填)/sum(應填)，**不是各組 rate 的平均**——各組應填人數不同，
//      直接平均會系統性高估（本檔用 40人10% / 5人100% / 5人100% 鎖住 28% 而非 70%）。
//   2. 分子取交集，rate 永遠 <= 100——填完後被移出名冊的人不得讓分子超出分母。
//   3. 名冊資料從第 9 列（索引 8）起——第 8 列是 nullable 定義列，不得被當成名冊資料。
//   4. compareNatural_ 不得因為「甲」「A05」這種非數字產生 NaN 把排序搞爛。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import _ from 'lodash';

const source = readFileSync(new URL('../src/Code.js', import.meta.url), 'utf8');

const REFER = 'REFER_SHEET_ID';
const RECORD = 'RECORD_SHEET_ID';

// 欄位定義 8 列：A=uid(P-T 主鍵)、B=cls(G-T 分組)、C=no(G-N 座號)、D=memo(F-T)
function definitionRows({ withGroup = true } = {}) {
  return withGroup
    ? [
        ['uid', 'cls', 'no', 'memo'],
        ['學號', '班級', '座號', '備註'],
        ['P', 'G', 'G', 'F'],
        ['T', 'T', 'N', 'T'],
        ['', '', '', ''],
        ['', '', '', ''],
        ['', '', '', ''],
        ['', '', '', ''],
      ]
    : [
        ['uid', 'memo'],
        ['學號', '備註'],
        ['P', 'F'],
        ['T', 'T'],
        ['', ''],
        ['', ''],
        ['', ''],
        ['', ''],
      ];
}

// 紀錄列：A 時間、B accept、C 主鍵、D 簽名、E 分組、F 起是答案
function recordRow(pkey, cls) {
  return [1, false, pkey, '', cls, 'ans'];
}

function loadGas({ referRows, recordRows = [] }) {
  const fakeSpreadsheetApp = {
    openById: (id) => {
      if (id === REFER) {
        return { getSheets: () => [{ getDataRange: () => ({ getValues: () => referRows.map((r) => [...r]) }) }] };
      }
      if (id === RECORD) {
        return {
          getSheets: () => [
            {
              getLastRow: () => recordRows.length,
              // compareSheets 只讀 C:E → getRange(1, 3, lastRow, 3)
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
      throw new Error('unexpected sheet: ' + id);
    },
  };
  const factory = new Function(
    'LodashGS',
    'PropertiesService',
    'SpreadsheetApp',
    `${source}\n;return { compareSheets, compareNatural_, rateOf_, pkeysOf_, unfinishedLabel_ };`
  );
  return factory(
    { load: () => _ },
    { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
    fakeSpreadsheetApp
  );
}

describe('純函數：compareNatural_', () => {
  const gas = loadGas({ referRows: definitionRows() });

  it('純數字依數值排序（"10" 排在 "9" 之後，不是字串序）', () => {
    expect(['10', '9', '2'].sort(gas.compareNatural_)).toEqual(['2', '9', '10']);
  });

  it('數字排在文字前，文字之間走 localeCompare', () => {
    const sorted = ['乙', '3', '甲', '1'].sort(gas.compareNatural_);
    expect(sorted.slice(0, 2)).toEqual(['1', '3']);
    expect(sorted.slice(2).sort()).toEqual(['乙', '甲'].sort());
  });

  it('非數字不得產生 NaN 把排序搞爛（"A05" 這種混合值）', () => {
    const sorted = ['A05', 'A1', 'A10'].sort(gas.compareNatural_);
    expect(sorted).toHaveLength(3);
    expect(sorted).toContain('A05');
  });

  it('前後空白與空字串：空字串當文字處理，不因 Number("") === 0 被誤判成數字', () => {
    expect(gas.compareNatural_(' 2 ', '10')).toBeLessThan(0);
    expect(gas.compareNatural_('', '1')).toBeGreaterThan(0);
  });

  it('null/undefined 不炸', () => {
    expect(() => ['1', null, undefined, '甲'].sort(gas.compareNatural_)).not.toThrow();
  });
});

describe('純函數：rateOf_', () => {
  const gas = loadGas({ referRows: definitionRows() });

  it('分子取交集：填完後被移出名冊的人不得讓 rate 超過 100', () => {
    const stat = gas.rateOf_(['a', 'b'], ['a', 'b', 'ghost1', 'ghost2']);
    expect(stat.filled).toBe(2);
    expect(stat.total).toBe(2);
    expect(stat.rate).toBe(100);
  });

  it('total 為 0 時回 0，不回 NaN/Infinity', () => {
    const stat = gas.rateOf_([], ['a']);
    expect(stat.rate).toBe(0);
    expect(Number.isNaN(stat.rate)).toBe(false);
  });

  it('unfinished 是「名冊上有但沒填」的人', () => {
    const stat = gas.rateOf_(['a', 'b', 'c'], ['b']);
    expect(stat.unfinished).toEqual(['a', 'c']);
    expect(stat.filled).toBe(1);
  });
});

describe('compareSheets：分組模式', () => {
  // 動機段的例子：A 班 40 人填 4（10%）、B 班 5 人填 5（100%）、C 班 5 人填 5（100%）
  // 各組 rate 平均 = 70%（錯）、sum/sum = 14/50 = 28%（對）
  function unevenFixture() {
    const rows = definitionRows();
    const records = [];
    for (let i = 0; i < 40; i++) {
      rows.push(['A' + i, 'A班', String(i + 1), '']);
      if (i < 4) records.push(recordRow('A' + i, 'A班'));
    }
    for (let i = 0; i < 5; i++) {
      rows.push(['B' + i, 'B班', String(i + 1), '']);
      records.push(recordRow('B' + i, 'B班'));
    }
    for (let i = 0; i < 5; i++) {
      rows.push(['C' + i, 'C班', String(i + 1), '']);
      records.push(recordRow('C' + i, 'C班'));
    }
    return { referRows: rows, recordRows: records };
  }

  it('總填答率是 sum(已填)/sum(應填)，不是各組 rate 的平均', () => {
    const gas = loadGas(unevenFixture());
    const out = gas.compareSheets(REFER, RECORD);
    expect(out.mode).toBe('grouped');
    expect(out.filled).toBe(14);
    expect(out.total).toBe(50);
    expect(out.rate).toBe(28); // 未加權平均會是 70
    expect(_.meanBy(out.groups, (g) => g.rate)).toBeCloseTo(70, 0); // 舊算法的值，用來鎖住差異
  });

  it('每組各自回 filled/total/rate', () => {
    const gas = loadGas(unevenFixture());
    const out = gas.compareSheets(REFER, RECORD);
    const a = _.find(out.groups, { classno: 'A班' });
    expect(a.filled).toBe(4);
    expect(a.total).toBe(40);
    expect(a.rate).toBe(10);
  });

  it('組別依 compareNatural_ 排序（數字班級照數值排）', () => {
    const rows = definitionRows();
    ['10', '2', '1'].forEach((cls, i) => rows.push(['S' + i, cls, String(i + 1), '']));
    const gas = loadGas({ referRows: rows, recordRows: [] });
    const out = gas.compareSheets(REFER, RECORD);
    expect(_.map(out.groups, 'classno')).toEqual(['1', '2', '10']);
  });

  it('未完成者列座號、依 compareNatural_ 排序、附 (未完成/應填)', () => {
    const rows = definitionRows();
    // 座號故意亂序放，且含 10 以確保不是字串序
    [
      ['S1', '10'],
      ['S2', '2'],
      ['S3', '9'],
    ].forEach(([uid, no]) => rows.push([uid, '甲班', no, '']));
    const gas = loadGas({ referRows: rows, recordRows: [] });
    const out = gas.compareSheets(REFER, RECORD);
    // 全體未填時走「全體均未填寫」這條，先讓一個人填掉以進入列名單分支
    const gas2 = loadGas({ referRows: rows, recordRows: [recordRow('S1', '甲班')] });
    const out2 = gas2.compareSheets(REFER, RECORD);
    expect(out.groups[0].unfinished).toBe('全體均未填寫');
    expect(out2.groups[0].unfinished).toBe('2,9 (2/3)');
  });

  it('全填完回「已完成」', () => {
    const rows = definitionRows();
    rows.push(['S1', '甲班', '1', '']);
    const gas = loadGas({ referRows: rows, recordRows: [recordRow('S1', '甲班')] });
    expect(gas.compareSheets(REFER, RECORD).groups[0].unfinished).toBe('已完成');
  });

  it('名冊資料從第 9 列起——第 8 列（nullable 定義列）不得被當成名冊資料', () => {
    const rows = definitionRows();
    // 把 nullable 列（索引 7）塞成看起來像資料的樣子
    rows[7] = ['GHOST', '甲班', '99', 'N'];
    rows.push(['S1', '甲班', '1', '']);
    const gas = loadGas({ referRows: rows, recordRows: [recordRow('S1', '甲班')] });
    const out = gas.compareSheets(REFER, RECORD);
    expect(out.total).toBe(1); // 若誤含 nullable 列會變 2
    expect(out.rate).toBe(100);
  });
});

describe('compareSheets：總體模式與退場', () => {
  it('名冊無 G 欄：算得出總填答率，但不列未完成者', () => {
    const rows = definitionRows({ withGroup: false });
    rows.push(['S1', ''], ['S2', ''], ['S3', ''], ['S4', '']);
    const gas = loadGas({
      referRows: rows,
      // 無 G 欄時 writeRecord 的組別欄寫空字串，這裡照實模擬
      recordRows: [recordRow('S1', ''), recordRow('S2', '')],
    });
    const out = gas.compareSheets(REFER, RECORD);
    expect(out.mode).toBe('overall');
    expect(out.filled).toBe(2);
    expect(out.total).toBe(4);
    expect(out.rate).toBe(50);
    expect(out.groups).toEqual([]);
  });

  it('名冊無 P 欄：認不出誰是誰，回全零不炸', () => {
    const rows = [
      ['memo'],
      ['備註'],
      ['F'],
      ['T'],
      [''],
      [''],
      [''],
      [''],
      ['x'],
    ];
    const gas = loadGas({ referRows: rows, recordRows: [] });
    const out = gas.compareSheets(REFER, RECORD);
    expect(out).toEqual({ mode: 'overall', filled: 0, total: 0, rate: 0, groups: [] });
  });

  it('紀錄表為空：rate 為 0，不炸也不讀 getRange', () => {
    const rows = definitionRows();
    rows.push(['S1', '甲班', '1', '']);
    const gas = loadGas({ referRows: rows, recordRows: [] });
    const out = gas.compareSheets(REFER, RECORD);
    expect(out.filled).toBe(0);
    expect(out.rate).toBe(0);
  });
});
