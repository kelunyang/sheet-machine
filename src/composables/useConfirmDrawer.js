import { reactive } from 'vue';

// Phase 7：全站彈窗語言統一為 el-drawer，本模組以單例 drawer 取代 ElMessageBox。
// Promise API 模擬 ElMessageBox 介面——confirm/prompt 回傳 Promise，
// 確認 resolve（prompt resolve { value }）、取消或關閉 reject('cancel')，
// 讓 useDraft/useInvites/App.vue 既有的 await + try/catch 寫法原樣沿用。
// 對應的 UI 是 App.vue 掛載的 <ConfirmDrawer />（讀同一份 state）。
const state = reactive({
  show: false,
  mode: 'confirm', // 'confirm' | 'prompt'
  title: '',
  message: '',
  confirmButtonText: '確定',
  cancelButtonText: '取消',
  type: 'info', // ElMessageBox 的 type；warning 時確認鈕轉 danger 紅
  inputValue: '',
  inputPlaceholder: '',
  inputPattern: null,
  inputErrorMessage: '',
  inputError: '',
  size: '40%', // el-drawer 高度（ttb）；長訊息的呼叫端可調高避免手機被裁
});

let pendingResolve = null;
let pendingReject = null;

function open(mode, message, title, options) {
  state.mode = mode;
  state.message = message;
  state.title = title;
  state.confirmButtonText = options.confirmButtonText || '確定';
  state.cancelButtonText = options.cancelButtonText || '取消';
  state.type = options.type || 'info';
  state.inputValue = '';
  state.inputPlaceholder = options.inputPlaceholder || '';
  state.inputPattern = options.inputPattern || null;
  state.inputErrorMessage = options.inputErrorMessage || '格式錯誤';
  state.inputError = '';
  state.size = options.size || '40%';
  state.show = true;
  return new Promise((resolve, reject) => {
    pendingResolve = resolve;
    pendingReject = reject;
  });
}

export function drawerConfirm(message, title, options = {}) {
  return open('confirm', message, title, options);
}

export function drawerPrompt(message, title, options = {}) {
  return open('prompt', message, title, options);
}

// ===== 以下由 ConfirmDrawer.vue 使用 =====

export function useConfirmDrawerState() {
  return state;
}

export function settleConfirm() {
  if (state.mode === 'prompt' && state.inputPattern && !state.inputPattern.test(state.inputValue)) {
    state.inputError = state.inputErrorMessage;
    return;
  }
  const resolve = pendingResolve;
  pendingResolve = null;
  pendingReject = null;
  state.show = false;
  if (resolve) {
    resolve(state.mode === 'prompt' ? { value: state.inputValue } : 'confirm');
  }
}

// 取消鈕與 drawer 關閉（ESC／點遮罩）共用；settleConfirm 之後的 close 事件會因
// pending 已清空而變成 no-op，不會二次 settle
export function settleCancel() {
  const reject = pendingReject;
  pendingResolve = null;
  pendingReject = null;
  state.show = false;
  if (reject) {
    reject('cancel');
  }
}
