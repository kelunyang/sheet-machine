// 問卷列表卡片（Phase 14）的純函數層：看板串組成（含結束節點急迫度日期色）
import { describe, it, expect } from 'vitest';
import { buildFlowChips } from '../src/utils/sheetFlow.js';
import { WARNING_MS } from '../src/utils/timeline.js';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

// 開放填寫中、有兩組簽名格的基準問卷
function baseSheet(overrides) {
  return {
    writeAllowed: true,
    createdAt: NOW - 7 * DAY,
    dueDate: NOW + 5 * DAY,
    viewDate: NOW + 30 * DAY,
    signatures: ['家長', '導師'],
    ...overrides,
  };
}

describe('buildFlowChips', () => {
  it('有簽名格：開始→填寫→簽名×2→填寫結束，全 normal', () => {
    const chips = buildFlowChips(baseSheet(), NOW);
    expect(chips.map((chip) => chip.type)).toEqual(['start', 'chip', 'chip', 'end']);
    expect(chips.map((chip) => chip.label)).toEqual(['開始', '填寫', '簽名 ×2', '填寫結束']);
    expect(chips.every((chip) => chip.tone === 'normal')).toBe(true);
  });

  it('充裕（開放中且離截止 >10 分）：結束日期文字不變色（subTone falsy）', () => {
    const chips = buildFlowChips(baseSheet(), NOW);
    expect(chips.at(-1).subTone).toBeFalsy();
  });

  it('快截止（剩不到 10 分鐘）：結束仍「填寫結束」、日期轉 warning', () => {
    const chips = buildFlowChips(baseSheet({ dueDate: NOW + WARNING_MS - 1000 }), NOW);
    expect(chips.at(-1).label).toBe('填寫結束');
    expect(chips.at(-1).subTone).toBe('warning');
  });

  it('無簽名格：沒有簽名 chip', () => {
    const chips = buildFlowChips(baseSheet({ signatures: [] }), NOW);
    expect(chips.map((chip) => chip.label)).toEqual(['開始', '填寫', '填寫結束']);
  });

  it('signatures 缺值（後端過期清空等退化情況）不炸、不出簽名 chip', () => {
    const chips = buildFlowChips(baseSheet({ signatures: undefined }), NOW);
    expect(chips.map((chip) => chip.type)).toEqual(['start', 'chip', 'end']);
  });

  it('起訖標記帶日期小字（無秒數）', () => {
    const chips = buildFlowChips(baseSheet(), NOW);
    expect(chips[0].sub).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(chips.at(-1).sub).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('createdAt=0：開始標記不帶日期', () => {
    const chips = buildFlowChips(baseSheet({ createdAt: 0 }), NOW);
    expect(chips[0].sub).toBe('');
  });

  it('已截止：填寫轉檢視、整條方框 muted、結束改「查看結束」+viewDate、日期 danger', () => {
    const chips = buildFlowChips(baseSheet({ dueDate: NOW - DAY, viewDate: NOW + 30 * DAY }), NOW);
    expect(chips[1].label).toBe('檢視');
    expect(chips.every((chip) => chip.tone === 'muted')).toBe(true);
    expect(chips.at(-1).label).toBe('查看結束');
    expect(chips.at(-1).sub).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(chips.at(-1).subTone).toBe('danger');
  });

  it('writeAllowed=false：整條方框 muted、結束仍「填寫結束」、日期不轉色', () => {
    const chips = buildFlowChips(baseSheet({ writeAllowed: false }), NOW);
    expect(chips.every((chip) => chip.tone === 'muted')).toBe(true);
    expect(chips.at(-1).label).toBe('填寫結束');
    expect(chips.at(-1).subTone).toBeFalsy();
  });

  it('dueDate=0：結束標記顯示「不開放」、整條方框 muted', () => {
    const chips = buildFlowChips(baseSheet({ dueDate: 0 }), NOW);
    expect(chips.at(-1).label).toBe('填寫結束');
    expect(chips.at(-1).sub).toBe('不開放');
    expect(chips.every((chip) => chip.tone === 'muted')).toBe(true);
  });
});
