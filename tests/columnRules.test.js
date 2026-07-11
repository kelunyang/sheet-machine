import { describe, it, expect } from 'vitest';
import {
  formatDetector,
  findPrimaryKey,
  validateColumn,
  statusDetector,
  noneDeclared,
} from '../src/utils/columnRules';

function makeColumn(overrides = {}) {
  return {
    id: 'col1',
    name: '測試欄位',
    type: 'F',
    format: 'T',
    content: '',
    value: '',
    savedContent: '',
    must: false,
    nullable: false,
    group: '',
    uniGroup: false,
    status: '',
    ...overrides,
  };
}

describe('formatDetector', () => {
  it('比對 format 與 type 的正則', () => {
    const col = makeColumn({ type: 'F', format: 'T' });
    expect(formatDetector('T', 'F', col)).toBe(true);
    expect(formatDetector('S', 'F', col)).toBe(false);
    expect(formatDetector('T', 'A|P', col)).toBe(false);
  });

  it('空 format 正則等於只看 type', () => {
    const col = makeColumn({ type: 'F', format: 'F' });
    expect(formatDetector('', 'F', col)).toBe(true);
    expect(formatDetector('', 'C', col)).toBe(false);
  });

  it('C-S 計算欄位不可被誤判為 F-S 選單欄位（8749543 迴歸）', () => {
    const calcCol = makeColumn({ type: 'C', format: 'S' });
    expect(formatDetector('S', 'C', calcCol)).toBe(true);
    expect(formatDetector('S', 'F', calcCol)).toBe(false);
  });
});

describe('findPrimaryKey', () => {
  it('找出 type 含 P 的欄位', () => {
    const authDB = [
      makeColumn({ id: 'a', type: 'A' }),
      makeColumn({ id: 'p', type: 'P', value: 's1234567' }),
    ];
    expect(findPrimaryKey(authDB).id).toBe('p');
  });

  it('沒有主鍵時回傳 undefined', () => {
    expect(findPrimaryKey([makeColumn({ type: 'A' })])).toBeUndefined();
  });
});

describe('validateColumn', () => {
  it('必填欄位留空要報錯', () => {
    const col = makeColumn({ must: true, value: '' });
    validateColumn(col, [col]);
    expect(col.status).toBe('這個欄位必需有值！');
  });

  it('N 格式：長度正確通過、錯誤報錯', () => {
    const ok = makeColumn({ format: 'N', content: '5', value: '12345' });
    validateColumn(ok, [ok]);
    expect(ok.status).toBe('');

    const bad = makeColumn({ format: 'N', content: '5', value: '123' });
    validateColumn(bad, [bad]);
    expect(bad.status).toContain('長度為5');
  });

  it('N 格式 content=0：必須 0 開頭', () => {
    const ok = makeColumn({ format: 'N', content: '0', value: '0912' });
    validateColumn(ok, [ok]);
    expect(ok.status).toBe('');

    const bad = makeColumn({ format: 'N', content: '0', value: '912' });
    validateColumn(bad, [bad]);
    expect(bad.status).toBe('這裡應該要輸入0開頭的數字');
  });

  it('E 格式：Email 驗證', () => {
    const ok = makeColumn({ format: 'E', value: 'test@test.com' });
    validateColumn(ok, [ok]);
    expect(ok.status).toBe('');

    const bad = makeColumn({ format: 'E', value: 'not-an-email' });
    validateColumn(bad, [bad]);
    expect(bad.status).toBe('這裡應該輸入Email');
  });

  it('M 格式：台灣手機號碼', () => {
    const ok = makeColumn({ format: 'M', value: '0912345678' });
    validateColumn(ok, [ok]);
    expect(ok.status).toBe('');

    const bad = makeColumn({ format: 'M', value: '0212345678' });
    validateColumn(bad, [bad]);
    expect(bad.status).toBe('這裡應該輸入電話號碼，如0912345678');
  });

  it('I 格式：身分證字號（佔位測資）', () => {
    const ok = makeColumn({ format: 'I', value: 'A123456789' });
    validateColumn(ok, [ok]);
    expect(ok.status).toBe('');

    const bad = makeColumn({ format: 'I', value: 'a123456789' });
    validateColumn(bad, [bad]);
    expect(bad.status).toBe('這裡應該要輸入身分證號，如A123456789');
  });

  it('L 格式（滑桿）：範圍與間距', () => {
    // content 已被 loginView 轉為 [step, min, max]
    const ok = makeColumn({ format: 'L', content: [1, 1, 10], value: 5 });
    validateColumn(ok, [ok]);
    expect(ok.status).toBe('');

    const outOfRange = makeColumn({ format: 'L', content: [1, 1, 10], value: 11 });
    validateColumn(outOfRange, [outOfRange]);
    expect(outOfRange.status).toContain('介於1和10');

    const wrongStep = makeColumn({ format: 'L', content: [2, 1, 9], value: 4 });
    validateColumn(wrongStep, [wrongStep]);
    expect(wrongStep.status).toContain('每次增減2');
  });

  it('X 格式（多行文字）：長度上下限', () => {
    const tooLong = makeColumn({ format: 'X', content: [3, '', 2, 4], value: '一二三四' });
    validateColumn(tooLong, [tooLong]);
    expect(tooLong.status).toContain('超過限制');

    const tooShort = makeColumn({ format: 'X', content: ['', 5, 2, 4], value: '嗨' });
    validateColumn(tooShort, [tooShort]);
    expect(tooShort.status).toContain('太少');
  });

  it('S 格式：值必須來自選單', () => {
    const ok = makeColumn({ format: 'S', content: '甲;乙;丙', value: '乙' });
    validateColumn(ok, [ok]);
    expect(ok.status).toBe('');

    const bad = makeColumn({ format: 'S', content: '甲;乙;丙', value: '丁' });
    validateColumn(bad, [bad]);
    expect(bad.status).toBe('你真的是用選單選出來的值嗎？');
  });

  it('T 格式：自訂正則 + 台/臺自動替換', () => {
    const col = makeColumn({ format: 'T', content: '請輸入臺北開頭::^台北|^臺北', value: '台北市中正區' });
    validateColumn(col, [col]);
    expect(col.status).toBe('');
    expect(col.value).toBe('臺北市中正區');
  });

  it('群組欄位：全空報錯、填一個後全組清除', () => {
    const a = makeColumn({ id: 'a', group: 'g1', value: '' });
    const b = makeColumn({ id: 'b', group: 'g1', value: '' });
    const db = [a, b];
    validateColumn(a, db);
    expect(a.status).toContain('不得全為空');
    expect(b.status).toContain('不得全為空');

    a.value = '有值';
    validateColumn(a, db);
    expect(a.status).toBe('');
    expect(b.status).toBe('');
  });

  it('uniGroup 群組：欄位值不得重複', () => {
    const a = makeColumn({ id: 'a', group: 'g1', uniGroup: true, value: '相同' });
    const b = makeColumn({ id: 'b', group: 'g1', uniGroup: true, value: '相同' });
    const db = [a, b];
    validateColumn(a, db);
    expect(a.status).toContain('不得重複');
  });

  it('nullable 欄位留空不觸發格式檢查', () => {
    const col = makeColumn({ format: 'E', nullable: true, value: '' });
    validateColumn(col, [col]);
    expect(col.status).toBe('');
  });
});

describe('noneable（D 註記「無資料」宣告，Phase 15）', () => {
  it('noneDeclared：noneable 且值為「無資料」才成立', () => {
    expect(noneDeclared(makeColumn({ noneable: true, value: '無資料' }))).toBe(true);
    expect(noneDeclared(makeColumn({ noneable: true, value: '無' }))).toBe(false);
    expect(noneDeclared(makeColumn({ value: '無資料' }))).toBe(false);
  });

  it('M+D：必填欄宣告「無資料」通過必填與格式檢查', () => {
    const col = makeColumn({ format: 'M', must: true, noneable: true, value: '無資料' });
    validateColumn(col, [col]);
    expect(col.status).toBe('');
  });

  it('沒有 D 的欄位填「無資料」照樣被格式檢查擋下', () => {
    const col = makeColumn({ format: 'M', value: '無資料' });
    validateColumn(col, [col]);
    expect(col.status).toBe('這裡應該輸入電話號碼，如0912345678');
  });

  it('群組全員宣告「無資料」＝視同全空，被「不得全空」擋下', () => {
    const a = makeColumn({ id: 'a', format: 'M', group: 'g', noneable: true, value: '無資料' });
    const b = makeColumn({ id: 'b', format: 'M', group: 'g', noneable: true, value: '無資料' });
    validateColumn(a, [a, b]);
    expect(a.status).toContain('不得全為空');
    expect(b.status).toContain('不得全為空');
  });

  it('群組一人真資料＋一人「無資料」：通過', () => {
    const a = makeColumn({ id: 'a', format: 'M', group: 'g', noneable: true, value: '0912345678' });
    const b = makeColumn({ id: 'b', format: 'M', group: 'g', noneable: true, value: '無資料' });
    validateColumn(a, [a, b]);
    validateColumn(b, [a, b]);
    expect(a.status).toBe('');
    expect(b.status).toBe('');
  });

  it('uniGroup：「無資料」視同空值，不與其他成員的真實值判為重複', () => {
    const a = makeColumn({ id: 'a', group: 'g', uniGroup: true, noneable: true, value: '無資料' });
    const b = makeColumn({ id: 'b', group: 'g', uniGroup: true, noneable: true, value: '真的值' });
    const c = makeColumn({ id: 'c', group: 'g', uniGroup: true, noneable: true, value: '另一個值' });
    validateColumn(b, [a, b, c]);
    expect(b.status).toBe('');
  });
});

describe('statusDetector', () => {
  it('必答未答 → danger', () => {
    const col = makeColumn({ must: true, value: '' });
    expect(statusDetector(col)).toEqual({ status: 'danger', result: '必答題卻未答' });
  });

  it('已回答（與儲存值不同）→ success', () => {
    const col = makeColumn({ value: '新答案', savedContent: '舊答案' });
    expect(statusDetector(col).status).toBe('success');
  });

  it('輸入值等於儲存值 → warning', () => {
    const col = makeColumn({ value: '相同', savedContent: '相同' });
    expect(statusDetector(col).status).toBe('warning');
  });

  it('非 F 類型回傳 undefined', () => {
    const col = makeColumn({ type: 'C' });
    expect(statusDetector(col)).toBeUndefined();
  });
});

