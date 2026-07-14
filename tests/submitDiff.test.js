// 送出前差異對照的純函數（Phase 23，utils/submitDiff.js）：文字組裝、基準取值、零差異判定。
import { describe, it, expect } from 'vitest';
import {
  diffableColumns,
  fileColumns,
  baselineValue,
  buildDiffText,
  buildFileComparison,
  hasAnyDiff,
} from '../src/utils/submitDiff';
import { REUSE_LAST_FILE } from '../src/utils/sentinels';

function col(overrides) {
  return {
    id: 'c1',
    name: '欄位',
    type: 'F',
    format: 'T',
    content: '',
    value: '',
    savedContent: '',
    status: '',
    ...overrides,
  };
}

describe('哪些欄位進 diff', () => {
  it('只收使用者作答的文字欄；C 計算欄、G 分組欄、檔案欄都不進文字 diff', () => {
    const columns = [
      col({ id: 'a', format: 'T' }),
      col({ id: 'b', type: 'C', format: 'S' }),
      col({ id: 'c', type: 'G', format: 'T' }),
      col({ id: 'd', format: 'F' }),
    ];
    expect(diffableColumns(columns).map((c) => c.id)).toEqual(['a']);
    expect(fileColumns(columns).map((c) => c.id)).toEqual(['d']);
  });
});

describe('baselineValue：基準取值', () => {
  it("mode='last' 取上次送出；沒送出過自動退回系統值", () => {
    expect(baselineValue(col({ savedContent: '舊', lastInput: '上次' }), 'last')).toBe('上次');
    expect(baselineValue(col({ savedContent: '舊' }), 'last')).toBe('舊');
  });

  it("mode='saved' 一律取系統值（📝 前綴剝掉）", () => {
    expect(baselineValue(col({ savedContent: '📝6', lastInput: '上次' }), 'saved')).toBe('6');
  });
});

describe('buildDiffText：純文字組裝', () => {
  it('一題一段【題名】＋值行', () => {
    const columns = [col({ name: '姓名', value: '王小明', savedContent: '王小華' })];
    expect(buildDiffText(columns, 'last', 'current')).toBe('【姓名】\n王小明\n');
    expect(buildDiffText(columns, 'last', 'baseline')).toBe('【姓名】\n王小華\n');
  });

  it('X 多行文字原樣逐行展開（逐行比對才看得出改哪一行）', () => {
    const columns = [col({ name: '自述', format: 'X', value: '第一行\n第二行' })];
    expect(buildDiffText(columns, 'last', 'current')).toBe('【自述】\n第一行\n第二行\n');
  });

  it('U 多選每個選項一行', () => {
    const columns = [col({ name: '社團', format: 'U', content: '2::甲;乙', value: '甲;乙' })];
    expect(buildDiffText(columns, 'last', 'current')).toBe('【社團】\n- 甲\n- 乙\n');
  });

  it('空值留「（未填）」佔位，讓「原本有值→清空」在 diff 看得見', () => {
    const columns = [col({ name: '備註', value: '', savedContent: '有內容' })];
    expect(buildDiffText(columns, 'last', 'current')).toContain('（未填）');
    expect(buildDiffText(columns, 'last', 'baseline')).toContain('有內容');
  });

  it('L 滑桿數字轉字串、📝 前綴剝掉', () => {
    const columns = [col({ name: '分數', format: 'L', value: 60, lastInput: '📝50' })];
    expect(buildDiffText(columns, 'last', 'current')).toBe('【分數】\n60\n');
    expect(buildDiffText(columns, 'last', 'baseline')).toBe('【分數】\n50\n');
  });
});

describe('hasAnyDiff：零差異就不打擾使用者', () => {
  it('值與上次送出相同 → 無差異', () => {
    const columns = [col({ value: '甲', lastInput: '甲', savedContent: '乙' })];
    expect(hasAnyDiff(columns, 'last')).toBe(false);
    // 但改成跟系統值比就有差異
    expect(hasAnyDiff(columns, 'saved')).toBe(true);
  });

  it('📝 前綴不算差異（後端落地格式，不是使用者改的）', () => {
    expect(hasAnyDiff([col({ format: 'L', value: 6, lastInput: '📝6' })], 'last')).toBe(false);
  });

  it('檔案欄：這次有新上傳 → 有差異；沿用舊檔的哨兵 → 不算差異', () => {
    const base = { format: 'F', lastInput: 'https://drive/x' };
    expect(hasAnyDiff([col({ ...base, value: 'NEWFILE' })], 'last')).toBe(true);
    expect(hasAnyDiff([col({ ...base, value: REUSE_LAST_FILE })], 'last')).toBe(false);
    expect(hasAnyDiff([col({ ...base, value: '' })], 'last')).toBe(false);
  });

  it('C 計算欄的值變動不算差異（不是使用者輸入的）', () => {
    const columns = [col({ type: 'C', format: 'S', value: '總和 100', savedContent: '總和 0' })];
    expect(hasAnyDiff(columns, 'last')).toBe(false);
  });
});

describe('buildFileComparison：檔案欄前後對照', () => {
  it('三態：新上傳／沿用上次／無檔案', () => {
    const columns = [
      col({
        id: 'f1',
        name: '文件A',
        format: 'F',
        value: 'NEW',
        uploadUrl: 'https://drive/new',
        lastInput: 'https://drive/prev',
      }),
      col({
        id: 'f2',
        name: '文件B',
        format: 'F',
        value: REUSE_LAST_FILE,
        lastInput: 'https://drive/old',
      }),
      col({ id: 'f3', name: '文件C', format: 'F', value: '' }),
    ];
    const rows = buildFileComparison(columns, 'last');
    expect(rows.map((r) => r.after.kind)).toEqual(['new', 'reuse', 'none']);
    // 新上傳：前＝上次送出的檔案、後＝這次上傳的檔案（兩者不可相同）
    expect(rows[0].beforeUrl).toBe('https://drive/prev');
    expect(rows[0].after.url).toBe('https://drive/new');
    // 沿用上次：後指向的就是上次那個檔案
    expect(rows[1].beforeUrl).toBe('https://drive/old');
    expect(rows[1].after.url).toBe('https://drive/old');
    expect(rows[2].beforeUrl).toBe('');
  });

  // 實機回報的 bug：舊版 applyFileUpload 拿新 URL 蓋掉 lastInput、after 又讀 lastInput，
  // 於是「從沒傳過檔的欄位這次傳了」會顯示成前後同一個檔案
  it('從沒上傳過的欄位這次上傳：前＝沒有檔案、後＝這次上傳的（不是同一個）', () => {
    const columns = [
      col({
        id: 'f1',
        name: '文件A',
        format: 'F',
        value: 'NEW',
        uploadUrl: 'https://drive/new',
        // lastInput 為 undefined＝這個人從來沒送出過這一欄的檔案
      }),
    ];
    const rows = buildFileComparison(columns, 'last');
    expect(rows[0].beforeUrl).toBe('');
    expect(rows[0].after).toEqual({ kind: 'new', url: 'https://drive/new' });
  });
});
