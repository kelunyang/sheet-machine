// LifecycleTimeline 的純函數層：四態邊界、百分比 clamp、倒數文字、缺值退化
import { describe, it, expect } from 'vitest';
import {
  WARNING_MS,
  timelineValid,
  timelineState,
  timelinePercent,
  remainingText,
} from '../src/utils/timeline.js';

const START = 1_700_000_000_000;
const END = START + 14 * 24 * 60 * 60 * 1000; // 14 天後

describe('timelineValid', () => {
  it('正常區間有效', () => {
    expect(timelineValid(START, END)).toBe(true);
  });

  it('createdAt=0（Drive 讀取失敗的退化值）無效', () => {
    expect(timelineValid(0, END)).toBe(false);
  });

  it('dueDate=0（不開放）無效', () => {
    expect(timelineValid(START, 0)).toBe(false);
  });

  it('終點等於或早於起點無效', () => {
    expect(timelineValid(START, START)).toBe(false);
    expect(timelineValid(START, START - 1)).toBe(false);
  });

  it('缺值/NaN 無效', () => {
    expect(timelineValid(undefined, END)).toBe(false);
    expect(timelineValid(START, undefined)).toBe(false);
    expect(timelineValid(NaN, END)).toBe(false);
    expect(timelineValid(START, NaN)).toBe(false);
  });
});

describe('timelineState', () => {
  it('now < start → pending', () => {
    expect(timelineState(START - 1, START, END)).toBe('pending');
  });

  it('start <= now < end-10分 → active（含起點當下）', () => {
    expect(timelineState(START, START, END)).toBe('active');
    expect(timelineState(END - WARNING_MS - 1, START, END)).toBe('active');
  });

  it('剩 <=10 分鐘 → warning（門檻當下即轉態）', () => {
    expect(timelineState(END - WARNING_MS, START, END)).toBe('warning');
    expect(timelineState(END - 1, START, END)).toBe('warning');
  });

  it('now >= end → ended（終點當下即逾期）', () => {
    expect(timelineState(END, START, END)).toBe('ended');
    expect(timelineState(END + 1, START, END)).toBe('ended');
  });

  it('無效區間回空字串', () => {
    expect(timelineState(START, 0, END)).toBe('');
    expect(timelineState(START, START, 0)).toBe('');
  });

  it('區間短於 10 分鐘：一開始就是 warning', () => {
    let shortEnd = START + 5 * 60 * 1000;
    expect(timelineState(START, START, shortEnd)).toBe('warning');
  });
});

describe('timelinePercent', () => {
  it('起點 0、中點 50、終點 100', () => {
    expect(timelinePercent(START, START, END)).toBe(0);
    expect(timelinePercent((START + END) / 2, START, END)).toBe(50);
    expect(timelinePercent(END, START, END)).toBe(100);
  });

  it('超出區間 clamp 到 0/100', () => {
    expect(timelinePercent(START - 9999, START, END)).toBe(0);
    expect(timelinePercent(END + 9999, START, END)).toBe(100);
  });

  it('無效區間（含負 span）回 0', () => {
    expect(timelinePercent(START, START, START - 1)).toBe(0);
    expect(timelinePercent(START, 0, END)).toBe(0);
    expect(timelinePercent(START, undefined, END)).toBe(0);
  });
});

describe('remainingText', () => {
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('天級：天+時', () => {
    expect(remainingText(0, 5 * DAY + 3 * HOUR + 20 * MIN)).toBe('5天3時');
  });

  it('時級：時+分', () => {
    expect(remainingText(0, 3 * HOUR + 20 * MIN + 15 * 1000)).toBe('3時20分');
  });

  it('分級：分+秒', () => {
    expect(remainingText(0, 20 * MIN + 15 * 1000)).toBe('20分15秒');
  });

  it('秒級：只有秒', () => {
    expect(remainingText(0, 42 * 1000)).toBe('42秒');
  });

  it('已到期/無效回空字串', () => {
    expect(remainingText(100, 100)).toBe('');
    expect(remainingText(101, 100)).toBe('');
    expect(remainingText(0, NaN)).toBe('');
  });
});
