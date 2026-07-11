import dayjs from 'dayjs';
import { WARNING_MS } from './timeline.js';

// 問卷列表卡片（SheetCard）的純函數層（Phase 14）：
// 流程預覽看板串的組成與右上角狀態文字都在這裡，元件只負責渲染

// 看板串的日期小字：卡片空間有限，去掉秒數（dateConverter 是完整格式，這裡不用）
function chipDate_(tick) {
  return dayjs(tick).format('YYYY-MM-DD HH:mm');
}

// 右上角兩行「色點＋期限文字」：可填寫至／可檢視至各一行，檢視期不再另掛卡片下方。
// tone 對映 Element Plus 語意色：success/warning/danger/info
export function sheetStatus(sheet, now) {
  let write;
  if (!sheet.writeAllowed) {
    write = { text: '暫時關閉', tone: 'info' };
  } else if (!sheet.dueDate || sheet.dueDate <= 0) {
    write = { text: '不開放填寫', tone: 'info' };
  } else if (now >= sheet.dueDate) {
    write = { text: '已截止填寫', tone: 'danger' };
  } else {
    write = {
      text: '可填寫至 ' + chipDate_(sheet.dueDate),
      tone: sheet.dueDate - now <= WARNING_MS ? 'warning' : 'success',
    };
  }
  // getQList 只回傳 viewDate 未過的問卷，這裡的空值防禦只擋資料異常；
  // 檢視期與填寫截止同時（截止即不可檢視）時第二行冗餘，省略
  const view =
    sheet.viewDate > 0 && sheet.viewDate !== sheet.dueDate
      ? { text: '可檢視至 ' + chipDate_(sheet.viewDate), tone: 'info' }
      : null;
  return { write, view };
}

// 流程預覽看板串：開始(建立日期) →（填寫/檢視）→（簽名 ×n，有簽名格才出現）→ 結束(截止日期)。
// 純靜態預覽（問卷沒有「當前階段」，不做指示物）；tone：normal=進行中主題色、
// muted=已截止/關閉/不開放整條轉灰、danger=已截止的結束標記紅字
export function buildFlowChips(sheet, now) {
  const ended = sheet.dueDate > 0 && now >= sheet.dueDate;
  const inactive = ended || !sheet.writeAllowed || !sheet.dueDate || sheet.dueDate <= 0;
  const baseTone = inactive ? 'muted' : 'normal';
  const nodes = [
    {
      type: 'start',
      label: '開始',
      sub: sheet.createdAt > 0 ? chipDate_(sheet.createdAt) : '',
      tone: baseTone,
    },
    { type: 'chip', label: ended ? '檢視' : '填寫', sub: '', tone: baseTone },
  ];
  if (Array.isArray(sheet.signatures) && sheet.signatures.length > 0) {
    nodes.push({ type: 'chip', label: '簽名 ×' + sheet.signatures.length, sub: '', tone: baseTone });
  }
  nodes.push({
    type: 'end',
    label: '結束',
    sub: sheet.dueDate > 0 ? chipDate_(sheet.dueDate) : '不開放',
    tone: ended ? 'danger' : baseTone,
  });
  return nodes;
}
