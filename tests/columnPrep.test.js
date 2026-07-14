// prepareColumnsForDisplay：登入後欄位整理（自 App.vue loginView 純搬移下沉）
import { describe, it, expect } from 'vitest';
import { prepareColumnsForDisplay } from '../src/utils/columnPrep';

function makeColumn(overrides = {}) {
  return {
    id: 'col1',
    name: '測試欄位',
    type: 'F',
    format: 'T',
    group: '',
    content: '',
    must: false,
    nullable: false,
    value: '',
    status: '待清',
    ...overrides,
  };
}

describe('prepareColumnsForDisplay', () => {
  it('每個欄位都補上 tid、status 清空', () => {
    const columns = [makeColumn(), makeColumn({ id: 'col2', type: 'C' })];
    prepareColumnsForDisplay(columns, []);
    expect(columns[0].tid).toBeTruthy();
    expect(columns[1].tid).toBeTruthy();
    expect(columns[0].tid).not.toBe(columns[1].tid);
    expect(columns[0].status).toBe('');
    expect(columns[1].status).toBe('');
  });

  it('group 解析：名稱與 U（unique）旗標', () => {
    const columns = [
      makeColumn({ group: '住址:U' }),
      makeColumn({ id: 'col2', group: '住址' }),
      makeColumn({ id: 'col3', group: '' }),
    ];
    prepareColumnsForDisplay(columns, []);
    expect(columns[0].group).toBe('住址');
    expect(columns[0].uniGroup).toBe(true);
    expect(columns[1].group).toBe('住址');
    expect(columns[1].uniGroup).toBe(false);
    expect(columns[2].uniGroup).toBeUndefined();
  });

  it('一般欄位從暫存 queue 疊回 value', () => {
    const columns = [makeColumn()];
    prepareColumnsForDisplay(columns, [{ id: 'col1', val: '之前填的' }]);
    expect(columns[0].value).toBe('之前填的');
  });

  // Phase 23：疊回來的值要標 draftOrigin（＝「暫存」這個來源的內容）與 source='draft'
  //（登入後 segmented 一進場就停在「暫存」）
  it('從 queue 疊回的欄位標 draftOrigin=local＋source=draft；沒疊回的不標', () => {
    const columns = [makeColumn(), makeColumn({ id: 'col2' })];
    prepareColumnsForDisplay(columns, [{ id: 'col1', val: '之前填的' }]);
    expect(columns[0].draftOrigin).toEqual({ val: '之前填的', source: 'local' });
    expect(columns[0].source).toBe('draft');
    expect(columns[1].draftOrigin).toBe(undefined);
    expect(columns[1].source).toBe(undefined);
  });

  it('L 欄的 draftOrigin 記的是 parseInt 之後的值（切回「暫存」才拿得到正確的值）', () => {
    const columns = [makeColumn({ format: 'L', content: '2;0;10' })];
    prepareColumnsForDisplay(columns, [{ id: 'col1', val: '6' }]);
    expect(columns[0].value).toBe(6);
    expect(columns[0].draftOrigin).toEqual({ val: 6, source: 'local' });
  });

  it('queue 傳 undefined（受邀者 read-only）不會炸、value 不動', () => {
    const columns = [makeColumn({ value: '後端給的' })];
    prepareColumnsForDisplay(columns, undefined);
    expect(columns[0].value).toBe('後端給的');
  });

  it('檔案欄位：queue 有 isFile 項 → 還原 value/uploadUrl（不覆寫 lastInput）；沒有且必填 → 顯示提示', () => {
    const restored = [makeColumn({ format: 'F', must: true })];
    prepareColumnsForDisplay(restored, [
      { id: 'col1', val: 'FILE_ID', url: 'https://drive.example/f', isFile: true },
    ]);
    expect(restored[0].value).toBe('FILE_ID');
    expect(restored[0].uploadUrl).toBe('https://drive.example/f');
    expect(restored[0].lastInput).toBe(undefined); // 上次送出的檔案不被覆寫
    expect(restored[0].status).toBe('');

    const empty = [makeColumn({ format: 'F', must: true })];
    prepareColumnsForDisplay(empty, []);
    expect(empty[0].status).toBe('請至少選擇一個檔案');
  });

  it('U 格式：value 過濾掉不在選項清單裡的值', () => {
    const columns = [makeColumn({ format: 'U', content: '3::甲;乙;丙', value: '甲;不存在的;丙' })];
    prepareColumnsForDisplay(columns, []);
    expect(columns[0].value).toBe('甲;丙');
  });

  it('L 格式：content 轉數字陣列、value parseInt', () => {
    const columns = [makeColumn({ format: 'L', content: '2;0;10', value: '6' })];
    prepareColumnsForDisplay(columns, []);
    expect(columns[0].content).toEqual([2, 0, 10]);
    expect(columns[0].value).toBe(6);
  });

  it('L 格式 content 設定不合法 → 退回預設 [1, 10, 100]', () => {
    const columns = [makeColumn({ format: 'L', content: '', value: '' })];
    prepareColumnsForDisplay(columns, []);
    expect(columns[0].content).toEqual([1, 10, 100]);
    expect(Number.isNaN(columns[0].value)).toBe(true); // parseInt('') 維持既有行為
  });

  it('X 格式：content 轉為長度上下限陣列，空位保留預設', () => {
    const columns = [makeColumn({ format: 'X', content: '100;;;6' })];
    prepareColumnsForDisplay(columns, []);
    expect(columns[0].content).toEqual([100, '', 2, 6]);
  });

  it('非 F 型欄位（C/G）不做任何轉換，只補 tid 清 status', () => {
    const columns = [makeColumn({ type: 'C', format: 'U', content: 'x', value: 'y' })];
    prepareColumnsForDisplay(columns, []);
    expect(columns[0].value).toBe('y');
    expect(columns[0].content).toBe('x');
  });
});
