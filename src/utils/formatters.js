import dayjs from 'dayjs';

// 多個對話框共用的輸出格式化工具

export function dateConverter(tick) {
  if (tick === '' || tick === undefined) {
    return '無';
  } else {
    let dayObj = dayjs(tick);
    return dayObj.format('YYYY-MM-DD HH:mm:ss');
  }
}

// Papa 來自 index.html 的 CDN 全域
export function downloadCSV(arr, name, writeTick) {
  let output =
    '﻿' +
    Papa.unparse(arr) +
    '\r\n寫入資料庫時間,' +
    dateConverter(writeTick) +
    '\r\n本資料產生時間,' +
    dayjs().format('YYYY-MM-DD HH:mm:ss');
  let blob = new Blob([output], { type: 'text/csv' });
  let url = window.URL.createObjectURL(blob);
  let element = document.createElement('a');
  element.setAttribute('href', url);
  element.setAttribute('download', name);
  element.click();
}
