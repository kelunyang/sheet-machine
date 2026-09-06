// 計算欄（C-S）運算式引擎（Phase 30）
import { describe, it, expect } from 'vitest';
import {
  computeCalcColumn,
  legacySumUp,
  parseCalcContent,
  splitStatements,
  validateCalcExpression,
  toNum,
} from '../src/utils/formula.js';

// 測試用欄位工廠
const calc = (content, id = 'C01') => ({
  id,
  type: 'C',
  format: 'S',
  content,
  value: '',
  savedContent: '',
});
const field = (id, value, extra = {}) => ({
  id,
  type: 'F',
  format: 'S',
  content: '',
  value,
  savedContent: '',
  ...extra,
});

// 真實案例：報名基本費 ＋ 每科單價 ×科數，兩者都由身分（F01）決定
const REAL_CONTENT =
  '預計作業費 {} 元（已含報名基本費）::' +
  '科數 = countif("是", S02, S03, S04, S05, S06, S07);' +
  '單價 = match(F01, "低收入戶", 0, "中低收入戶", 85, 170);' +
  '基本費 = match(F01, "低收入戶", 0, "中低收入戶", 100, 200);' +
  '基本費 + 單價 * 科數' +
  '::0';

const roster = (identity, picks) => {
  const column = calc(REAL_CONTENT);
  const columns = [
    column,
    field('F01', identity),
    ...['S02', 'S03', 'S04', 'S05', 'S06', 'S07'].map((id, i) =>
      field(id, picks[i] ? '是' : '否')
    ),
  ];
  return { column, columns };
};

describe('parseCalcContent', () => {
  it('不含 :: 一律走 legacy', () => {
    expect(parseCalcContent('S02:170;S03:170').legacy).toBe(true);
    expect(parseCalcContent('').legacy).toBe(true);
  });

  it('三段各就各位，小數位數空或非數字都當 0', () => {
    expect(parseCalcContent('金額 {} 元::1+1::2')).toEqual({
      legacy: false,
      template: '金額 {} 元',
      expr: '1+1',
      decimals: 2,
    });
    expect(parseCalcContent('::1+1::').decimals).toBe(0);
    expect(parseCalcContent('::1+1::abc').decimals).toBe(0);
    expect(parseCalcContent('::1+1::-3').decimals).toBe(0);
  });

  it('只有兩段時運算式仍解析得到，第三段缺＝0 位小數', () => {
    const parsed = parseCalcContent('金額 {}::1+1');
    expect(parsed.expr).toBe('1+1');
    expect(parsed.decimals).toBe(0);
  });
});

describe('splitStatements', () => {
  it('引號內的分號不切行', () => {
    expect(splitStatements('x = countif("是;否", S02); x * 10')).toEqual([
      'x = countif("是;否", S02)',
      'x * 10',
    ]);
  });

  it('單引號同樣不切，行尾多餘分號被忽略', () => {
    expect(splitStatements("x = countif('a;b', S02); x;")).toEqual(["x = countif('a;b', S02)", 'x']);
  });

  it('空字串回空陣列', () => {
    expect(splitStatements('')).toEqual([]);
    expect(splitStatements('  ;  ')).toEqual([]);
  });
});

describe('真實案例：三個身分別', () => {
  it('一般＝200 + 170×3', () => {
    const { column, columns } = roster('一般', [1, 1, 1, 0, 0, 0]);
    expect(computeCalcColumn(column, columns)).toEqual({
      ok: true,
      text: '預計作業費 710 元（已含報名基本費）',
      error: '',
    });
  });

  it('中低收入戶＝100 + 85×3', () => {
    const { column, columns } = roster('中低收入戶', [1, 1, 1, 0, 0, 0]);
    expect(computeCalcColumn(column, columns).text).toBe('預計作業費 355 元（已含報名基本費）');
  });

  it('低收入戶＝0', () => {
    const { column, columns } = roster('低收入戶', [1, 1, 1, 1, 1, 1]);
    expect(computeCalcColumn(column, columns).text).toBe('預計作業費 0 元（已含報名基本費）');
  });

  it('三元寫法與 match 寫法結果一致', () => {
    const ternary = calc(
      '預計作業費 {} 元（已含報名基本費）::' +
        'n = countif("是", S02, S03, S04, S05, S06, S07);' +
        '(F01 == "低收入戶" ? 0 : (F01 == "中低收入戶" ? 100 : 200)) + ' +
        '(F01 == "低收入戶" ? 0 : (F01 == "中低收入戶" ? 85 : 170)) * n' +
        '::0'
    );
    const { column, columns } = roster('中低收入戶', [1, 1, 1, 0, 0, 0]);
    const swapped = columns.map((col) => (col === column ? ternary : col));
    expect(computeCalcColumn(ternary, swapped).text).toBe(
      computeCalcColumn(column, columns).text
    );
  });
});

describe('顯示模板與小數位數', () => {
  it('模板空＝只顯示數字；沒有 {} ＝結果接在尾端', () => {
    expect(computeCalcColumn(calc('::1+1::0'), []).text).toBe('2');
    expect(computeCalcColumn(calc('總計：::1+1::0'), []).text).toBe('總計：2');
  });

  it('{} 可出現多次', () => {
    expect(computeCalcColumn(calc('{} 元（{}）::40+2::0'), []).text).toBe('42 元（42）');
  });

  it('小數位數走 toFixed', () => {
    expect(computeCalcColumn(calc('::10/4::2'), []).text).toBe('2.50');
    expect(computeCalcColumn(calc('::10/4::0'), []).text).toBe('3');
  });

  it('字串結果原樣顯示，不做 toFixed', () => {
    expect(computeCalcColumn(calc('你的身分：{}::match("A", "A", "甲", "乙")::0'), []).text).toBe(
      '你的身分：甲'
    );
  });
});

describe('白名單：越界語法一律擋下且不丟例外', () => {
  const cases = [
    ['constructor.constructor("return 1")()', /函數名稱|不支援的語法/],
    ['window.localStorage', /不支援的語法/],
    ['S02["x"]', /不支援的語法/],
    ['(() => 1)()', /./],
    ['[1,2,3]', /不支援的語法/],
    ['foo(1)', /不認得的函數/],
    ['S99 + 1', /不認得的欄位/],
    ['S02 = 999', /./],
    ['1 & 2', /不支援的運算子/],
    ['this', /不支援的語法/],
  ];

  for (const [expr, pattern] of cases) {
    it('擋下 ' + expr, () => {
      const column = calc('::' + expr + '::0');
      const result = computeCalcColumn(column, [column, field('S02', '1')]);
      expect(result.ok).toBe(false);
      expect(result.text).toBe('');
      expect(result.error).toMatch(pattern);
    });
  }

  it('未知運算子與未知函數都不會漏接', () => {
    expect(computeCalcColumn(calc('::sum(1,2) + max(3,4) + abs(-5)::0'), []).text).toBe('12');
    expect(computeCalcColumn(calc('::round(2.345, 2)::2'), []).text).toBe('2.35');
  });
});

describe('欄位取值規則', () => {
  it('F 欄 value 為空時退回 savedContent', () => {
    const column = calc('::F01 * 2::0');
    const columns = [column, field('F01', '', { savedContent: '21' })];
    expect(computeCalcColumn(column, columns).text).toBe('42');
  });

  it('📝 前綴會被剝除', () => {
    const column = calc('::F01 * 2::0');
    const columns = [column, field('F01', '📝21')];
    expect(computeCalcColumn(column, columns).text).toBe('42');
    expect(toNum('📝21')).toBe(21);
  });

  it('C-T 取名冊文字（savedContent）', () => {
    const column = calc('::match(C02, "甲", 100, 0)::0');
    const columns = [column, { id: 'C02', type: 'C', format: 'T', content: '', value: '', savedContent: '甲' }];
    expect(computeCalcColumn(column, columns).text).toBe('100');
  });

  it('C-S 引用 C-S 取結果值（不是顯示字串）', () => {
    const base = calc('小計 {} 元::F01 * 10::0', 'C02');
    const total = calc('總計 {} 元::C02 + 5::0', 'C01');
    const columns = [total, base, field('F01', '3')];
    expect(computeCalcColumn(base, columns).text).toBe('小計 30 元');
    expect(computeCalcColumn(total, columns).text).toBe('總計 35 元');
  });

  it('引用說明區塊（C-M）或檔案檢視（C-F）＝錯誤', () => {
    const column = calc('::C02 + 1::0');
    const columns = [
      column,
      { id: 'C02', type: 'C', format: 'M', content: '# 說明', value: '', savedContent: '' },
    ];
    const result = computeCalcColumn(column, columns);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/沒有可以計算的值/);
  });

  it('引用舊格式計算欄＝錯誤（舊格式沒有結果值可取）', () => {
    const column = calc('::C02 + 1::0');
    const columns = [column, calc('F01:10', 'C02'), field('F01', '3')];
    expect(computeCalcColumn(column, columns).ok).toBe(false);
  });
});

describe('循環偵測', () => {
  it('A → B → A 回錯誤，不 stack overflow', () => {
    const a = calc('::C02 + 1::0', 'C01');
    const b = calc('::C01 + 1::0', 'C02');
    const result = computeCalcColumn(a, [a, b]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/循環/);
  });

  it('自我引用同樣擋下', () => {
    const a = calc('::C01 + 1::0', 'C01');
    expect(computeCalcColumn(a, [a]).error).toMatch(/循環/);
  });
});

describe('錯誤態：畫面絕不出現 NaN', () => {
  it('除以零回錯誤', () => {
    const result = computeCalcColumn(calc('::1/0::0'), []);
    expect(result.ok).toBe(false);
    expect(result.text).toBe('');
  });

  it('運算式段空白回錯誤', () => {
    expect(computeCalcColumn(calc('金額::  ::0'), []).ok).toBe(false);
  });

  it('中間行不是指派回錯誤', () => {
    expect(computeCalcColumn(calc('::1 + 1; 2 + 2::0'), []).error).toMatch(/名稱 = 式子/);
  });

  it('中間值名稱與欄位 ID 重複回錯誤', () => {
    const column = calc('::F01 = 5; F01 * 2::0');
    expect(computeCalcColumn(column, [column, field('F01', '1')]).error).toMatch(/重複/);
  });
});

describe('legacy 相容', () => {
  const legacyColumn = calc('S02:170;S03:170;S04:170');
  const legacyColumns = [
    legacyColumn,
    field('S02', '1'),
    field('S03', '1'),
    field('S04', '0'),
  ];

  it('輸出字串與舊 sumUp 完全一致', () => {
    expect(legacySumUp(legacyColumn, legacyColumns)).toBe('3個欄位總和為：340');
    expect(computeCalcColumn(legacyColumn, legacyColumns)).toEqual({
      ok: true,
      text: '3個欄位總和為：340',
      error: '',
    });
  });

  it('抓最後一個數字區塊的舊規則維持不變', () => {
    const column = calc('S02:2');
    expect(legacySumUp(column, [column, field('S02', '選項3')])).toBe('1個欄位總和為：6');
    expect(legacySumUp(column, [column, field('S02', '是')])).toBe('1個欄位總和為：0');
  });

  it('content 空回空字串', () => {
    expect(legacySumUp(calc(''), [])).toBe('');
  });

  it('非 C-S 欄位一律回空字串', () => {
    expect(computeCalcColumn(field('F01', '1'), [])).toEqual({ ok: true, text: '', error: '' });
  });
});

describe('上線前檢查器規則（與 tools/export.js 同規則）', () => {
  const ids = ['F01', 'S02', 'S03'];

  it('正確的運算式沒有錯誤', () => {
    expect(
      validateCalcExpression('n = countif("是", S02, S03); F01 == "甲" ? n * 2 : n', ids)
    ).toEqual([]);
  });

  it('抓得到打錯的欄位 ID', () => {
    expect(validateCalcExpression('S99 + 1', ids)[0]).toMatch(/不存在的欄位 ID 或名稱/);
  });

  it('抓得到括號沒配對', () => {
    expect(validateCalcExpression('(S02 + 1', ids)[0]).toMatch(/括號沒有配對/);
  });

  it('抓得到 = 誤當比較', () => {
    expect(validateCalcExpression('F01 = "甲" ? 1 : 0', ids).join()).toMatch(/比較要寫/);
  });

  it('抓得到屬性存取與箭頭函數', () => {
    expect(validateCalcExpression('window.localStorage', ids).join()).toMatch(/屬性存取/);
    expect(validateCalcExpression('(() => 1)()', ids).join()).toMatch(/=>/);
  });

  it('中間行不是指派、最後一行是指派都會被抓到', () => {
    expect(validateCalcExpression('1 + 1; 2', ids)[0]).toMatch(/名稱 = 式子/);
    expect(validateCalcExpression('n = 1; m = 2', ids)[0]).toMatch(/最後一行應該是結果式/);
  });

  it('中間值名稱與欄位 ID 衝突會被抓到', () => {
    expect(validateCalcExpression('F01 = 1; F01 + 1', ids)[0]).toMatch(/與欄位 ID 重複/);
  });

  it('字串常值裡的中文不會被當成欄位 ID', () => {
    expect(validateCalcExpression('match(F01, "低收入戶", 0, 170)', ids)).toEqual([]);
  });

  it('allIds 為 null（精靈單欄驗證）時跳過引用存在性檢查', () => {
    expect(validateCalcExpression('S99 + 1', null)).toEqual([]);
  });

  it('運算式空白回錯誤', () => {
    expect(validateCalcExpression('   ', ids)[0]).toMatch(/空的/);
  });
});
