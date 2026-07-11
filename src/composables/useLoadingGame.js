import { reactive, computed } from 'vue';

// Phase 8：8-bit loading game 的單例狀態。
// 計數器式 begin/end——多個 RPC 重疊等待時遊戲卡不閃爍，全部結束才進入收尾。
// 收尾行為：
//   - 預設：loading 結束強制凍結遊戲，給玩家 2 秒看分數（settling）再關閉
//   - 「loading 結束也不結束遊戲」開啟：進入加班模式（overtime），玩到自己按關閉
//   - 「我不要再看到遊戲了」開啟：遊戲卡換成極簡文字卡，loading 結束直接關
// 兩個開關都存 localStorage。對應的 UI 是 App.vue 掛載的 <LoadingGame v-if="loadingGameVisible" />。

const LS_KEEP_PLAYING = 'smLoadingGameKeepPlaying';
const LS_HIDDEN = 'smLoadingGameHidden';
const SETTLE_MS = 2000;

// localStorage 不可用（無痕模式/停用）就只活在記憶體
function readFlag(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key, value) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // 寫不進去就算了，開關仍在本次 session 生效
  }
}

const state = reactive({
  jobs: [], // { id, label }
  settling: false, // loading 剛結束的 2 秒結算（遊戲凍結看分數）
  overtime: false, // loading 結束後繼續玩（keepPlaying 開啟時）
  keepPlaying: readFlag(LS_KEEP_PLAYING),
  hidden: readFlag(LS_HIDDEN),
});
let nextJobId = 1;
let settleTimer = null;

const DEFAULT_LABEL = '資料傳輸中';

function clearSettle() {
  if (settleTimer !== null) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  state.settling = false;
}

// 回傳收尾函數（冪等）：const done = beginLoading('確認身分中'); try {...} finally { done(); }
export function beginLoading(label = DEFAULT_LABEL) {
  const id = nextJobId++;
  clearSettle();
  state.overtime = false;
  state.jobs.push({ id, label });
  let settled = false;
  return function endLoading() {
    if (settled) {
      return;
    }
    settled = true;
    const index = state.jobs.findIndex((job) => job.id === id);
    if (index !== -1) {
      state.jobs.splice(index, 1);
    }
    if (state.jobs.length === 0 && !state.hidden) {
      if (state.keepPlaying) {
        state.overtime = true;
      } else {
        state.settling = true;
        settleTimer = setTimeout(() => {
          settleTimer = null;
          state.settling = false;
        }, SETTLE_MS);
      }
    }
  };
}

// 加班模式的手動關閉（遊戲卡上的「關閉遊戲」鈕）
export function closeLoadingGame() {
  clearSettle();
  state.overtime = false;
}

export function setKeepPlaying(value) {
  state.keepPlaying = value;
  writeFlag(LS_KEEP_PLAYING, value);
  if (!value && state.jobs.length === 0) {
    // loading 早已結束、又把加班關掉 → 卡片立即收起
    closeLoadingGame();
  }
}

export function setHidden(value) {
  state.hidden = value;
  writeFlag(LS_HIDDEN, value);
  if (value) {
    clearSettle();
    state.overtime = false;
  }
}

export function useLoadingGame() {
  return {
    // 卡片是否掛載（hidden 時顯示極簡文字卡）：有工作、結算中、或加班中
    loadingGameVisible: computed(() => state.jobs.length > 0 || state.settling || state.overtime),
    loadingGameLabel: computed(() =>
      state.jobs.length > 0 ? state.jobs[state.jobs.length - 1].label : DEFAULT_LABEL
    ),
  };
}

// LoadingGame.vue 內部用的完整狀態（含開關與結算/加班旗標）
export function useLoadingGameState() {
  return state;
}

// ===== 遊戲狀態跨顯示保留 =====
// LoadingGame.vue 隨 v-if 反覆掛載/卸載，比賽狀態放 module 層，
// 同一次頁面 session 內斷斷續續的 loading 拼起來像同一場比賽。
// 血條式計分：100 起跳，撞到扣 10+x、撿到加 10+x，歸零遊戲結束出記分板
const gameSession = {
  playerIsGirl: Math.random() < 0.5,
  controlled: false, // user 是否接管過（決定 HUD 顯示「你」還是「？」）
  playerScore: 100,
  cpuScore: 100,
  playerBag: false,
  playerJacket: false,
  cpuBag: false,
  cpuJacket: false,
};

export function getGameSession() {
  return gameSession;
}
