// 問卷列表卡片（Phase 14）的純函數層：看板串組成與右上角狀態
import { describe, it, expect } from 'vitest';
import { sheetStatus, buildFlowChips } from '../src/utils/sheetFlow.js';
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

describe('sheetStatus', () => {
  it('開放填寫中：可填寫至日期 + success', () => {
    const status = sheetStatus(baseSheet(), NOW);
    expect(status.write.text).toMatch(/^可填寫至 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(status.write.tone).toBe('success');
  });

  it('剩不到 10 分鐘：warning', () => {
    const status = sheetStatus(baseSheet({ dueDate: NOW + WARNING_MS - 1000 }), NOW);
    expect(status.write.text).toMatch(/^可填寫至 /);
    expect(status.write.tone).toBe('warning');
  });

  it('已截止：已截止填寫 + danger', () => {
    const status = sheetStatus(baseSheet({ dueDate: NOW - DAY }), NOW);
    expect(status.write).toEqual({ text: '已截止填寫', tone: 'danger' });
  });

  it('writeAllowed=false：暫時關閉 + info（優先於其他狀態）', () => {
    const status = sheetStatus(baseSheet({ writeAllowed: false, dueDate: NOW - DAY }), NOW);
    expect(status.write).toEqual({ text: '暫時關閉', tone: 'info' });
  });

  it('dueDate=0：不開放填寫 + info', () => {
    const status = sheetStatus(baseSheet({ dueDate: 0 }), NOW);
    expect(status.write).toEqual({ text: '不開放填寫', tone: 'info' });
  });

  it('第二行固定是可檢視至（無論填寫狀態）', () => {
    for (const overrides of [{}, { dueDate: NOW - DAY }, { writeAllowed: false }, { dueDate: 0 }]) {
      const status = sheetStatus(baseSheet(overrides), NOW);
      expect(status.view.text).toMatch(/^可檢視至 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
      expect(status.view.tone).toBe('info');
    }
  });

  it('viewDate 缺值（資料異常）：view 為 null 不炸', () => {
    expect(sheetStatus(baseSheet({ viewDate: 0 }), NOW).view).toBeNull();
    expect(sheetStatus(baseSheet({ viewDate: NaN }), NOW).view).toBeNull();
  });

  it('viewDate 與 dueDate 相同：第二行冗餘，省略', () => {
    const due = NOW + 5 * DAY;
    expect(sheetStatus(baseSheet({ dueDate: due, viewDate: due }), NOW).view).toBeNull();
  });
});

describe('buildFlowChips', () => {
  it('有簽名格：開始→填寫→簽名×2→結束，全 normal', () => {
    const chips = buildFlowChips(baseSheet(), NOW);
    expect(chips.map((chip) => chip.type)).toEqual(['start', 'chip', 'chip', 'end']);
    expect(chips.map((chip) => chip.label)).toEqual(['開始', '填寫', '簽名 ×2', '結束']);
    expect(chips.every((chip) => chip.tone === 'normal')).toBe(true);
  });

  it('無簽名格：沒有簽名 chip', () => {
    const chips = buildFlowChips(baseSheet({ signatures: [] }), NOW);
    expect(chips.map((chip) => chip.label)).toEqual(['開始', '填寫', '結束']);
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

  it('已截止：填寫轉檢視、整條 muted、結束標記 danger', () => {
    const chips = buildFlowChips(baseSheet({ dueDate: NOW - DAY }), NOW);
    expect(chips[1].label).toBe('檢視');
    expect(chips[0].tone).toBe('muted');
    expect(chips[1].tone).toBe('muted');
    expect(chips[2].tone).toBe('muted');
    expect(chips.at(-1).tone).toBe('danger');
  });

  it('writeAllowed=false：整條 muted（未截止時結束標記也是 muted 不轉紅）', () => {
    const chips = buildFlowChips(baseSheet({ writeAllowed: false }), NOW);
    expect(chips.every((chip) => chip.tone === 'muted')).toBe(true);
  });

  it('dueDate=0：結束標記顯示「不開放」、整條 muted', () => {
    const chips = buildFlowChips(baseSheet({ dueDate: 0 }), NOW);
    expect(chips.at(-1).sub).toBe('不開放');
    expect(chips.every((chip) => chip.tone === 'muted')).toBe(true);
  });
});
