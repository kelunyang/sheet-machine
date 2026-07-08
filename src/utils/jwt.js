// 前端 JWT 工具（移植自 scoringSystem-cf 的 utils/jwt.ts）：
// 只解碼、不驗簽——僅供倒數條等 UI 顯示用，授權判斷永遠在後端 verifyJwt_。
// claims 的 iat/exp 依 JWT 慣例為「秒」，本模組對外一律回傳毫秒。
// 各函數皆可傳入 nowMs 供測試固定時間，省略時取 Date.now()。

export function decodeJwtPayload(token) {
  if (typeof token !== 'string' || token === '') {
    return null;
  }
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    payload += '='.repeat((4 - (payload.length % 4)) % 4);
    // atob 回傳 latin1 字串，pkey 可能是中文（姓名/學號），要走 UTF-8 解碼
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export function getTokenExpiryTime(token) {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') {
    return null;
  }
  return payload.exp * 1000;
}

export function isTokenExpired(token, nowMs = Date.now()) {
  const expiry = getTokenExpiryTime(token);
  if (expiry === null) {
    return true;
  }
  return nowMs >= expiry;
}

export function getTokenRemainingTime(token, nowMs = Date.now()) {
  const expiry = getTokenExpiryTime(token);
  if (expiry === null) {
    return 0;
  }
  const remaining = expiry - nowMs;
  return remaining > 0 ? remaining : 0;
}

// 剩餘壽命百分比（0-100），供倒數條寬度；缺 iat/exp 或已過期回 0
export function getSessionPercentage(token, nowMs = Date.now()) {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number' || typeof payload.iat !== 'number') {
    return 0;
  }
  const issued = payload.iat * 1000;
  const expiry = payload.exp * 1000;
  if (nowMs >= expiry) {
    return 0;
  }
  if (nowMs < issued || expiry <= issued) {
    return 100;
  }
  const percentage = ((expiry - nowMs) / (expiry - issued)) * 100;
  return Math.max(0, Math.min(100, Math.round(percentage)));
}

// 「59分30秒」式的剩餘時間文字（本系統 exp 至多 1 小時，不需要天/時級距）
export function formatRemainingTime(milliseconds) {
  if (milliseconds <= 0) {
    return '0秒';
  }
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return hours + '小時' + minutes + '分';
  }
  if (minutes > 0) {
    return minutes + '分' + seconds + '秒';
  }
  return seconds + '秒';
}
