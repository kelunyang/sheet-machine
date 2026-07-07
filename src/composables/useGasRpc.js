// google.script.run 的 Promise 包裝。
// 失敗時 reject 的是 GAS 傳回的錯誤物件（含 .message），與原本 withFailureHandler 收到的相同。
export function gasRun(fnName, ...args) {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(reject)
      [fnName](...args);
  });
}

// 傳給 GAS 的參數必須是可序列化的 plain object；把 Vue 的 reactive/ref 內容拆掉代理
export function plainClone(value) {
  return JSON.parse(JSON.stringify(value));
}
