// loading 小遊戲的部署者預設（ScriptProperties loadingGameDefault=0）：
// 後端 loadingGameDefaultOff_ 決定 doGet 注不注入 window.__SM_LOADING_GAME_OFF__；
// 前端 useLoadingGame 只在使用者沒自己切過開關（localStorage 無值）時採用它。
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import _ from 'lodash';

const source = readFileSync(new URL('../src/Code.js', import.meta.url), 'utf8');

function loadGas(propertyValue) {
  const fakePropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => (key === 'loadingGameDefault' ? propertyValue : null),
      setProperty: () => {},
    }),
  };
  const factory = new Function(
    'LodashGS',
    'PropertiesService',
    `${source}\n;return { loadingGameDefaultOff_ };`
  );
  return factory({ load: () => _ }, fakePropertiesService);
}

describe('loadingGameDefaultOff_', () => {
  it('未設＝維持開（既有部署行為不變）', () => {
    expect(loadGas(null).loadingGameDefaultOff_()).toBe(false);
  });

  it('0（容忍前後空白）＝關', () => {
    expect(loadGas('0').loadingGameDefaultOff_()).toBe(true);
    expect(loadGas(' 0 ').loadingGameDefaultOff_()).toBe(true);
  });

  it('1 與其他值一律維持開', () => {
    expect(loadGas('1').loadingGameDefaultOff_()).toBe(false);
    expect(loadGas('').loadingGameDefaultOff_()).toBe(false);
    expect(loadGas('00').loadingGameDefaultOff_()).toBe(false);
    expect(loadGas('off').loadingGameDefaultOff_()).toBe(false);
  });
});

describe('useLoadingGame 的 hidden 預設', () => {
  afterEach(() => {
    delete globalThis.window;
    delete globalThis.localStorage;
    vi.resetModules();
  });

  // state 是 module 層單例、import 當下讀開關，所以每個情境重新載入模組
  async function loadState({ deployOff, stored }) {
    vi.resetModules();
    if (deployOff !== undefined) {
      globalThis.window = { __SM_LOADING_GAME_OFF__: deployOff };
    }
    if (stored !== undefined) {
      globalThis.localStorage = {
        getItem: (key) => (key === 'smLoadingGameHidden' ? stored : null),
        setItem: () => {},
      };
    }
    const mod = await import('../src/composables/useLoadingGame');
    return mod.useLoadingGameState();
  }

  it('沒有注入（未設 property / dev）＝遊戲照常顯示', async () => {
    expect((await loadState({ stored: null })).hidden).toBe(false);
  });

  it('部署者關閉、使用者沒切過＝不顯示遊戲', async () => {
    expect((await loadState({ deployOff: true, stored: null })).hidden).toBe(true);
  });

  it('部署者關閉、localStorage 不可用＝仍不顯示遊戲', async () => {
    expect((await loadState({ deployOff: true })).hidden).toBe(true);
  });

  it('使用者自己按過「重新顯示」（存 0）＝以使用者為準', async () => {
    expect((await loadState({ deployOff: true, stored: '0' })).hidden).toBe(false);
  });

  it('使用者自己關過（存 1）＝部署者沒關也維持關', async () => {
    expect((await loadState({ stored: '1' })).hidden).toBe(true);
  });

  it('注入值不是 true 一律不算關', async () => {
    expect((await loadState({ deployOff: 'true', stored: null })).hidden).toBe(false);
  });
});
