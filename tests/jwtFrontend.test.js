// 前端 JWT 工具（src/utils/jwt.js）：純函數，只解碼不驗簽，供倒數條 UI 使用。
import { describe, it, expect } from 'vitest';
import {
  decodeJwtPayload,
  getTokenExpiryTime,
  isTokenExpired,
  getTokenRemainingTime,
  getSessionPercentage,
  formatRemainingTime,
} from '../src/utils/jwt';

// 與後端 signJwt_ 相同的組法（簽章內容不影響解碼測試）
function makeToken(payload) {
  const b64url = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
  return b64url({ alg: 'HS256', typ: 'JWT' }) + '.' + b64url(payload) + '.fake-signature';
}

const NOW = 1750000000000; // 固定測試時間（ms）
const NOW_SEC = NOW / 1000;

describe('decodeJwtPayload', () => {
  it('合法 token 解出 payload（含中文主鍵值）', () => {
    const token = makeToken({ pkey: '測試生甲', refer: 'REFER', iat: 1, exp: 2 });
    expect(decodeJwtPayload(token)).toEqual({ pkey: '測試生甲', refer: 'REFER', iat: 1, exp: 2 });
  });

  it('base64url 特殊字元（-、_）能正確解碼', () => {
    // ?>~ 的組合會在 base64 產生 + / 字元，web-safe 版轉成 - _
    const token = makeToken({ pkey: '??>>~~??>>', exp: 2 });
    expect(decodeJwtPayload(token).pkey).toBe('??>>~~??>>');
  });

  it('格式錯誤一律回 null 不 throw', () => {
    for (const bad of ['', 'abc', 'a.b', 'a.###.c', null, undefined, 42]) {
      expect(decodeJwtPayload(bad)).toBeNull();
    }
  });
});

describe('isTokenExpired / getTokenExpiryTime', () => {
  const token = makeToken({ iat: NOW_SEC - 1800, exp: NOW_SEC + 1800 });

  it('exp 轉成毫秒', () => {
    expect(getTokenExpiryTime(token)).toBe(NOW + 1800000);
  });

  it('未到期 false、剛好到期（邊界）true、過期 true', () => {
    expect(isTokenExpired(token, NOW)).toBe(false);
    expect(isTokenExpired(token, NOW + 1800000 - 1)).toBe(false);
    expect(isTokenExpired(token, NOW + 1800000)).toBe(true);
    expect(isTokenExpired(token, NOW + 1800000 + 1)).toBe(true);
  });

  it('解不開或缺 exp 的 token 視為已過期（防禦）', () => {
    expect(isTokenExpired('garbage', NOW)).toBe(true);
    expect(isTokenExpired(makeToken({ pkey: 'x' }), NOW)).toBe(true);
  });
});

describe('getTokenRemainingTime', () => {
  it('回傳剩餘毫秒；過期回 0 不回負值', () => {
    const token = makeToken({ iat: NOW_SEC, exp: NOW_SEC + 60 });
    expect(getTokenRemainingTime(token, NOW)).toBe(60000);
    expect(getTokenRemainingTime(token, NOW + 59000)).toBe(1000);
    expect(getTokenRemainingTime(token, NOW + 61000)).toBe(0);
    expect(getTokenRemainingTime('garbage', NOW)).toBe(0);
  });
});

describe('getSessionPercentage（倒數條寬度）', () => {
  const token = makeToken({ iat: NOW_SEC, exp: NOW_SEC + 3600 });

  it('剛簽發 100、過半 50、快結束趨近 0、過期 0', () => {
    expect(getSessionPercentage(token, NOW)).toBe(100);
    expect(getSessionPercentage(token, NOW + 1800000)).toBe(50);
    expect(getSessionPercentage(token, NOW + 3599000)).toBe(0); // 四捨五入後歸 0
    expect(getSessionPercentage(token, NOW + 3600000)).toBe(0);
    expect(getSessionPercentage(token, NOW + 9999000)).toBe(0);
  });

  it('時鐘漂移到 iat 之前 → 100（防禦）', () => {
    expect(getSessionPercentage(token, NOW - 5000)).toBe(100);
  });

  it('缺 iat 或 exp → 0（倒數條不顯示錯誤比例）', () => {
    expect(getSessionPercentage(makeToken({ exp: NOW_SEC + 3600 }), NOW)).toBe(0);
    expect(getSessionPercentage(makeToken({ iat: NOW_SEC }), NOW)).toBe(0);
    expect(getSessionPercentage('garbage', NOW)).toBe(0);
  });
});

describe('formatRemainingTime', () => {
  it('各級距的中文顯示', () => {
    expect(formatRemainingTime(0)).toBe('0秒');
    expect(formatRemainingTime(-500)).toBe('0秒');
    expect(formatRemainingTime(45 * 1000)).toBe('45秒');
    expect(formatRemainingTime(5 * 60 * 1000 + 30 * 1000)).toBe('5分30秒');
    expect(formatRemainingTime(60 * 60 * 1000)).toBe('1小時0分');
    expect(formatRemainingTime(90 * 60 * 1000)).toBe('1小時30分');
  });

  it('不足一秒無條件捨去', () => {
    expect(formatRemainingTime(999)).toBe('0秒');
    expect(formatRemainingTime(1999)).toBe('1秒');
  });
});
