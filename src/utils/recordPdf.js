// 輸出 PDF（Phase 31）：後端回應的分類與提示文案。純函數，App.vue 只負責依分類顯示。
// myRecordPdf 回：認證不過 false／冷卻 {throttled, cooldownSeconds}／P 欄空 {pdfDisabled}／
// 沒送出過 {noRecord}／產生太頻繁 {pdfThrottled, retryMinutes}／產生失敗 {failed}／
// 成功 {url, lastTick, generated}

export const PDF_MESSAGES = {
  noRecord: '需完成填寫並送出後，才可產生 PDF',
  disabled: '這份問卷沒有開啟 PDF 輸出',
  failed: 'PDF 產生失敗，請稍後再試；一直失敗請聯絡問卷管理者',
  // 結束頁：紀錄已寫入、只有 PDF 沒產生成功——講清楚答案沒丟、去哪裡補拿
  submitFailed:
    '你的填答已經送出成功，但 PDF 產生失敗。請稍後回到這份問卷的登入頁，輸入認證資料後按「取得我的 PDF」重新產生。',
};

// 產生次數超過限制（每人每份問卷在一段時間內有上限，保護全系統共用的每日建立文件額度）
export function pdfTooFrequentMessage(retryMinutes, { submitted = false } = {}) {
  const wait = typeof retryMinutes === 'number' && retryMinutes > 0 ? retryMinutes + ' 分鐘後' : '稍後';
  if (submitted) {
    return (
      '你的填答已經送出成功，但你短時間內產生 PDF 的次數太多，這次沒有產生。請' +
      wait +
      '回到這份問卷的登入頁，按「取得我的 PDF」。'
    );
  }
  return '短時間內產生 PDF 的次數太多，請' + wait + '再試。';
}

// 'throttled' | 'authFailed' | 'disabled' | 'noRecord' | 'tooFrequent' | 'failed' | 'ready'
// throttled＝登入冷卻（認證連錯）；tooFrequent＝PDF 產生次數限制，兩者不同
export function pdfResultKind(res) {
  if (res && res.throttled) {
    return 'throttled';
  }
  if (!res) {
    return 'authFailed';
  }
  if (res.pdfDisabled) {
    return 'disabled';
  }
  if (res.noRecord) {
    return 'noRecord';
  }
  if (res.pdfThrottled) {
    return 'tooFrequent';
  }
  if (typeof res.url === 'string' && res.url !== '') {
    return 'ready';
  }
  return 'failed';
}

// writeRecord 回傳裡的 PDF 狀態 → 結束頁要顯示什麼（沒開 PDF 的問卷全空）。
// message＝沒產生成功時要顯示的提示（成功或沒開 PDF 時是空字串）
export function submitPdfState(report) {
  if (!report || report.status !== true) {
    return { url: '', message: '' };
  }
  const url = report.pdf && typeof report.pdf.url === 'string' ? report.pdf.url : '';
  if (url !== '' || report.pdfError !== true) {
    return { url, message: '' };
  }
  if (report.pdfThrottled) {
    return { url: '', message: pdfTooFrequentMessage(report.pdfThrottled.retryMinutes, { submitted: true }) };
  }
  return { url: '', message: PDF_MESSAGES.submitFailed };
}
