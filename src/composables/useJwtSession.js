import { ref, computed, onBeforeUnmount } from 'vue';
import { ElMessage } from 'element-plus';
import {
  decodeJwtPayload,
  isTokenExpired,
  getTokenRemainingTime,
  getSessionPercentage,
} from '../utils/jwt';

// JWT session 倒數與續約（移植自 scoringSystem-cf MainLayout.vue 的續約守衛）：
// 1 秒 tick 驅動剩餘時間/百分比，token 過期時呼叫 onExpired（導回登入）。
// 手動續約限制：每個 token 只能手動續一次（以 iat 追蹤）；續約成功換發新 token
// （新 iat），倒數條回滿後掉回門檻以下可以再續。不做自動續約（2026-07-08 定案）。
export function useJwtSession({ token, onRenew, onExpired }) {
  const nowTick = ref(Date.now());
  const renewing = ref(false);
  const lastManualRenewIat = ref(null);
  let expiredNotified = false;

  const timer = setInterval(() => {
    nowTick.value = Date.now();
    if (token.value !== '' && isTokenExpired(token.value, nowTick.value)) {
      if (!expiredNotified) {
        expiredNotified = true;
        onExpired();
      }
    } else {
      expiredNotified = false;
    }
  }, 1000);
  onBeforeUnmount(() => {
    clearInterval(timer);
  });

  const remainingTime = computed(() => {
    if (token.value === '') {
      return 0;
    }
    return getTokenRemainingTime(token.value, nowTick.value);
  });

  const sessionPercentage = computed(() => {
    if (token.value === '') {
      return 0;
    }
    return getSessionPercentage(token.value, nowTick.value);
  });

  async function handleRenewClick() {
    if (renewing.value || token.value === '') {
      return;
    }
    const claims = decodeJwtPayload(token.value);
    const iat = claims && typeof claims.iat === 'number' ? claims.iat : null;
    if (iat !== null && iat === lastManualRenewIat.value) {
      ElMessage('這次登入已經續約過了，等下次快到期時再續吧');
      return;
    }
    lastManualRenewIat.value = iat;
    renewing.value = true;
    try {
      await onRenew();
    } finally {
      renewing.value = false;
    }
  }

  return { remainingTime, sessionPercentage, renewing, handleRenewClick };
}
