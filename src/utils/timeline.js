// 生命週期時間軸（LifecycleTimeline）的純函數層：
// 狀態判定/進度百分比/倒數文字都在這裡，元件只負責 tick 與繪製

// 剩餘時間低於這個值進 warning 態（沿用舊 el-alert 的 10 分鐘門檻）
export const WARNING_MS = 10 * 60 * 1000;

// 起訖是否構成有效區間：缺值、非數字、或終點不在起點之後（含 createdAt=0、
// dueDate=0「不開放」）都視為無效，元件整個不渲染
export function timelineValid(startAt, endAt) {
  return (
    typeof startAt === 'number' &&
    typeof endAt === 'number' &&
    isFinite(startAt) &&
    isFinite(endAt) &&
    startAt > 0 &&
    endAt > startAt
  );
}

// 四態：pending（未開始）/ active（進行中）/ warning（進行中且剩 <10 分鐘）/
// ended（已逾期）；無效區間回 ''
export function timelineState(now, startAt, endAt) {
  if (!timelineValid(startAt, endAt)) {
    return '';
  }
  if (now < startAt) {
    return 'pending';
  }
  if (now >= endAt) {
    return 'ended';
  }
  return endAt - now <= WARNING_MS ? 'warning' : 'active';
}

// 當前時間在軌道上的百分比位置（0–100 clamp）；無效區間回 0
export function timelinePercent(now, startAt, endAt) {
  if (!timelineValid(startAt, endAt)) {
    return 0;
  }
  let ratio = ((now - startAt) / (endAt - startAt)) * 100;
  return Math.max(0, Math.min(100, ratio));
}

// 距結束倒數文字：取最大的兩個單位（5天3時 / 3時20分 / 20分15秒 / 42秒）；
// 已到期回空字串（ended 態由中央文字呈現，不顯示倒數）
export function remainingText(now, endAt) {
  let ms = endAt - now;
  if (!isFinite(ms) || ms <= 0) {
    return '';
  }
  let totalSeconds = Math.floor(ms / 1000);
  let days = Math.floor(totalSeconds / 86400);
  let hours = Math.floor((totalSeconds % 86400) / 3600);
  let minutes = Math.floor((totalSeconds % 3600) / 60);
  let seconds = totalSeconds % 60;
  if (days > 0) {
    return days + '天' + hours + '時';
  }
  if (hours > 0) {
    return hours + '時' + minutes + '分';
  }
  if (minutes > 0) {
    return minutes + '分' + seconds + '秒';
  }
  return seconds + '秒';
}
