import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  beginLoading,
  useLoadingGame,
  useLoadingGameState,
  getGameSession,
  setKeepPlaying,
  setHidden,
  closeLoadingGame,
} from '../src/composables/useLoadingGame';

// 單例計數器 + 收尾狀態機：
// 多個 RPC 重疊等待時遊戲卡不閃爍；全部結束後預設進入 2 秒結算（settling）再關，
// keepPlaying 開啟改進加班模式（overtime），hidden 開啟直接關。
// node 環境沒有 localStorage，開關走記憶體 fallback（readFlag/writeFlag try/catch）。
describe('useLoadingGame', () => {
  const { loadingGameVisible, loadingGameLabel } = useLoadingGame();
  const state = useLoadingGameState();

  beforeEach(() => {
    vi.useFakeTimers();
    setKeepPlaying(false);
    setHidden(false);
    closeLoadingGame();
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('begin/end 控制可見性：結束後先進 2 秒結算（看分數）再關閉', () => {
    expect(loadingGameVisible.value).toBe(false);
    const done = beginLoading('確認身分中');
    expect(loadingGameVisible.value).toBe(true);
    done();
    // loading 結束不立刻消失：settling 撐 2 秒
    expect(loadingGameVisible.value).toBe(true);
    expect(state.settling).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(loadingGameVisible.value).toBe(false);
    done(); // 冪等：重複呼叫不得再觸發結算
    expect(state.settling).toBe(false);
  });

  it('重疊等待：全部結束才進結算，label 跟最後開始的工作', () => {
    const doneA = beginLoading('確認身分中');
    const doneB = beginLoading('查詢簽名邀請狀態中');
    expect(loadingGameLabel.value).toBe('查詢簽名邀請狀態中');
    doneB();
    // 還有工作在跑：不進結算
    expect(state.settling).toBe(false);
    expect(loadingGameLabel.value).toBe('確認身分中');
    doneA();
    expect(state.settling).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(loadingGameVisible.value).toBe(false);
  });

  it('結算中來了新工作：取消結算、繼續顯示', () => {
    const doneA = beginLoading('A');
    doneA();
    expect(state.settling).toBe(true);
    const doneB = beginLoading('B');
    expect(state.settling).toBe(false);
    expect(loadingGameVisible.value).toBe(true);
    vi.advanceTimersByTime(3000);
    // 舊的結算 timer 已被取消，不會把還在 loading 的卡關掉
    expect(loadingGameVisible.value).toBe(true);
    doneB();
    vi.advanceTimersByTime(2000);
    expect(loadingGameVisible.value).toBe(false);
  });

  it('keepPlaying（載入完成也不結束遊戲）：進加班模式直到手動關閉', () => {
    setKeepPlaying(true);
    const done = beginLoading('A');
    done();
    expect(state.overtime).toBe(true);
    vi.advanceTimersByTime(10000);
    expect(loadingGameVisible.value).toBe(true); // 不會自動關
    closeLoadingGame();
    expect(loadingGameVisible.value).toBe(false);
  });

  it('加班中把 keepPlaying 關掉：卡片立即收起', () => {
    setKeepPlaying(true);
    const done = beginLoading('A');
    done();
    expect(loadingGameVisible.value).toBe(true);
    setKeepPlaying(false);
    expect(loadingGameVisible.value).toBe(false);
  });

  it('hidden（我不要再看到遊戲了）：loading 中仍掛載（極簡卡），結束直接關', () => {
    setHidden(true);
    const done = beginLoading('A');
    expect(loadingGameVisible.value).toBe(true);
    expect(state.hidden).toBe(true);
    done();
    // 不進結算、不進加班
    expect(state.settling).toBe(false);
    expect(state.overtime).toBe(false);
    expect(loadingGameVisible.value).toBe(false);
  });

  it('未帶 label 用預設「資料傳輸中」', () => {
    const done = beginLoading();
    expect(loadingGameLabel.value).toBe('資料傳輸中');
    done();
  });

  it('遊戲狀態為跨顯示的單例（分數/穿戴延續）', () => {
    const session = getGameSession();
    expect(typeof session.playerIsGirl).toBe('boolean');
    expect(session.playerScore).toBe(100);
    session.playerScore = 42;
    session.playerJacket = true;
    expect(getGameSession().playerScore).toBe(42);
    expect(getGameSession().playerJacket).toBe(true);
    session.playerScore = 100;
    session.playerJacket = false;
  });
});
