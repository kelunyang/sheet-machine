// 填答率五段色階（Phase 29）：段界歸屬與夾值。
// 條上疊著文字、文字會跨過填充邊界，所以每段的「底色＋文字色」都要成對取出，
// 段界算錯就會出現「條是這一段的色、文字是另一段的色」。
import { describe, it, expect } from 'vitest';
import { RATE_SCALE, getRateScaleStep } from '../src/theme/colors.config.js';

describe('RATE_SCALE', () => {
  it('五段、上界遞增、最後一段為 100', () => {
    expect(RATE_SCALE).toHaveLength(5);
    const maxes = RATE_SCALE.map((s) => s.max);
    expect(maxes).toEqual([...maxes].sort((a, b) => a - b));
    expect(maxes[maxes.length - 1]).toBe(100);
  });

  it('每段都有底色、文字色與 WCAG 對比度，且對比度過 AA（4.5:1）', () => {
    RATE_SCALE.forEach((step) => {
      expect(step.background).toMatch(/^#[0-9a-f]{6}$/);
      expect(step.text).toMatch(/^#[0-9a-f]{6}$/);
      expect(step.contrast).toBeGreaterThanOrEqual(4.5);
    });
  });
});

describe('getRateScaleStep', () => {
  it('段界屬於下段（<= max）', () => {
    expect(getRateScaleStep(20).background).toBe(RATE_SCALE[0].background);
    expect(getRateScaleStep(20.1).background).toBe(RATE_SCALE[1].background);
    expect(getRateScaleStep(80).background).toBe(RATE_SCALE[3].background);
    expect(getRateScaleStep(80.1).background).toBe(RATE_SCALE[4].background);
  });

  it('0 落在第一段、100 落在最後一段', () => {
    expect(getRateScaleStep(0).background).toBe(RATE_SCALE[0].background);
    expect(getRateScaleStep(100).background).toBe(RATE_SCALE[4].background);
  });

  it('超出範圍與非數字都夾住，不回 undefined', () => {
    expect(getRateScaleStep(-5).background).toBe(RATE_SCALE[0].background);
    expect(getRateScaleStep(120).background).toBe(RATE_SCALE[4].background);
    expect(getRateScaleStep(NaN).background).toBe(RATE_SCALE[0].background);
    expect(getRateScaleStep(undefined).background).toBe(RATE_SCALE[0].background);
  });
});
