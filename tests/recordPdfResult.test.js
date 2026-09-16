// 輸出 PDF（Phase 31）前端：後端回應分類（登入頁「取得我的 PDF」）與結束頁狀態
import { describe, it, expect } from 'vitest';
import { pdfResultKind, pdfTooFrequentMessage, submitPdfState, PDF_MESSAGES } from '../src/utils/recordPdf';

describe('pdfResultKind', () => {
  it('登入冷卻優先於其他判斷', () => {
    expect(pdfResultKind({ throttled: true, cooldownSeconds: 30 })).toBe('throttled');
  });

  it('false／null／undefined＝認證失敗（與登入同一種說法，不區分帳號存不存在）', () => {
    expect(pdfResultKind(false)).toBe('authFailed');
    expect(pdfResultKind(null)).toBe('authFailed');
    expect(pdfResultKind(undefined)).toBe('authFailed');
  });

  it('各種認證通過後的狀態；產生次數限制與登入冷卻是兩回事', () => {
    expect(pdfResultKind({ pdfDisabled: true })).toBe('disabled');
    expect(pdfResultKind({ noRecord: true })).toBe('noRecord');
    expect(pdfResultKind({ pdfThrottled: true, retryMinutes: 12 })).toBe('tooFrequent');
    expect(pdfResultKind({ failed: true })).toBe('failed');
    expect(pdfResultKind({ url: 'https://drive.google.com/file/d/X/view', lastTick: 1 })).toBe('ready');
  });

  it('沒有 url 的成功形狀一律當失敗（不給前端一個空連結）', () => {
    expect(pdfResultKind({ url: '', lastTick: 1 })).toBe('failed');
    expect(pdfResultKind({})).toBe('failed');
  });

  it('每個需要提示的分類都有文案', () => {
    for (const kind of ['noRecord', 'disabled', 'failed']) {
      expect(PDF_MESSAGES[kind]).toBeTruthy();
    }
    expect(PDF_MESSAGES.submitFailed).toContain('取得我的 PDF');
  });
});

describe('pdfTooFrequentMessage', () => {
  it('有分鐘數就講幾分鐘後；沒有就說稍後', () => {
    expect(pdfTooFrequentMessage(12)).toContain('12 分鐘後');
    expect(pdfTooFrequentMessage(undefined)).toContain('稍後');
  });

  it('結束頁版本要講清楚答案已經送出、去哪裡補拿', () => {
    const message = pdfTooFrequentMessage(5, { submitted: true });
    expect(message).toContain('送出成功');
    expect(message).toContain('取得我的 PDF');
  });
});

describe('submitPdfState（結束頁）', () => {
  it('送出成功且有 PDF → 顯示連結', () => {
    expect(submitPdfState({ status: true, pdf: { url: 'U' }, pdfError: false })).toEqual({ url: 'U', message: '' });
  });

  it('送出成功但 PDF 失敗 → 顯示補拿提示', () => {
    expect(submitPdfState({ status: true, pdf: null, pdfError: true, pdfThrottled: null })).toEqual({
      url: '',
      message: PDF_MESSAGES.submitFailed,
    });
  });

  it('送出成功但產生次數超過上限 → 顯示幾分鐘後再拿', () => {
    const state = submitPdfState({ status: true, pdf: null, pdfError: true, pdfThrottled: { retryMinutes: 7 } });
    expect(state.url).toBe('');
    expect(state.message).toBe(pdfTooFrequentMessage(7, { submitted: true }));
  });

  it('沒開 PDF 的問卷（舊後端沒這些欄位也一樣）→ 全空', () => {
    expect(submitPdfState({ status: true, pdf: null, pdfError: false })).toEqual({ url: '', message: '' });
    expect(submitPdfState({ status: true })).toEqual({ url: '', message: '' });
  });

  it('送出失敗 → 不顯示任何 PDF 狀態', () => {
    expect(submitPdfState({ status: false, pdf: null, pdfError: true })).toEqual({ url: '', message: '' });
    expect(submitPdfState(null)).toEqual({ url: '', message: '' });
  });
});
