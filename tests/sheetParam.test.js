// ?sheet= 深連結的 doGet 注入閘門（src/Code.js 的 sheetParamValid_）：
// 沿用 jwt.test.js 的 new Function stub 模式載入 GAS 原始碼，只測純函數。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import _ from 'lodash';

const source = readFileSync(new URL('../src/Code.js', import.meta.url), 'utf8');

function loadGas() {
  const fakePropertiesService = {
    getScriptProperties: () => ({
      getProperty: () => null,
      setProperty: () => {},
    }),
  };
  const factory = new Function(
    'LodashGS',
    'PropertiesService',
    `${source}\n;return { sheetParamValid_ };`
  );
  return factory({ load: () => _ }, fakePropertiesService);
}

const { sheetParamValid_ } = loadGas();

describe('sheetParamValid_', () => {
  it('接受 Drive 檔案 ID 格式（實際約 44 字元，含 - 與 _）', () => {
    expect(sheetParamValid_('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE')).toBe(true);
    expect(sheetParamValid_('a'.repeat(20))).toBe(true);
    expect(sheetParamValid_('a'.repeat(100))).toBe(true);
  });

  it('拒絕長度超出範圍', () => {
    expect(sheetParamValid_('a'.repeat(19))).toBe(false);
    expect(sheetParamValid_('a'.repeat(101))).toBe(false);
    expect(sheetParamValid_('')).toBe(false);
  });

  it('拒絕非法字元（含 script 注入嘗試）', () => {
    expect(sheetParamValid_('"};alert(1);//aaaaaaaaaaaaaaaaaaaa')).toBe(false);
    expect(sheetParamValid_('<script>alert(1)</script>aaaaaaaaaa')).toBe(false);
    expect(sheetParamValid_('aaaaaaaaaaaaaaaaaaaa aaaaa')).toBe(false);
    expect(sheetParamValid_('aaaaaaaaaaaaaaaaaaaa/../..')).toBe(false);
  });

  it('拒絕非字串', () => {
    expect(sheetParamValid_(undefined)).toBe(false);
    expect(sheetParamValid_(null)).toBe(false);
    expect(sheetParamValid_(1234567890123456789n)).toBe(false);
    expect(sheetParamValid_(['a'.repeat(44)])).toBe(false);
  });
});
