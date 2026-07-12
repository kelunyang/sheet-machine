import dayjs from 'dayjs';
import { WARNING_MS } from './timeline.js';

// 問卷列表卡片（SheetCard）的純函數層（Phase 14）：
// 流程預覽看板串的組成與右上角狀態文字都在這裡，元件只負責渲染

// 看板串的日期小字：卡片空間有限，去掉秒數（dateConverter 是完整格式，這裡不用）
function chipDate_(tick) {
  return dayjs(tick).format('YYYY-MM-DD HH:mm');
}

// 流程預覽看板串：開始(建立日期) →（填寫/檢視）→（簽名 ×n，有簽名格才出現）→ 結束。
// 純靜態預覽（問卷沒有「當前階段」，不做指示物）。右上角提醒退役後，「還來得及嗎」
// 的急迫度改由結束節點承載——但只染方框下方日期文字（subTone），方框本身跟全條走 tone。
// tone（方框）：normal=進行中、muted=已截止/關閉/不開放整條轉灰。
// subTone（結束日期文字）：''=充裕灰、warning=剩<10分橘、danger=已截止磚紅。
// 結束節點語意：填寫未截止顯示「填寫結束」＋dueDate；已截止改「查看結束」＋viewDate。
export function buildFlowChips(sheet, now) {
  const active = sheet.dueDate > 0 && now < sheet.dueDate && sheet.writeAllowed;
  const ended = sheet.dueDate > 0 && now >= sheet.dueDate;
  const baseTone = active ? 'normal' : 'muted';
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
  let endLabel, endSub, subTone;
  if (ended) {
    endLabel = '查看結束';
    endSub = sheet.viewDate > 0 ? chipDate_(sheet.viewDate) : '';
    subTone = 'danger';
  } else {
    endLabel = '填寫結束';
    endSub = sheet.dueDate > 0 ? chipDate_(sheet.dueDate) : '不開放';
    subTone = active && sheet.dueDate - now <= WARNING_MS ? 'warning' : '';
  }
  nodes.push({ type: 'end', label: endLabel, sub: endSub, tone: baseTone, subTone });
  return nodes;
}
