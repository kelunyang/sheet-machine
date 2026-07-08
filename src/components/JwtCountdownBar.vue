<template>
  <div
    class="jwt-countdown"
    :class="{ 'jwt-countdown--clickable': clickable, 'jwt-countdown--pulse': warning }"
    :role="clickable ? 'button' : undefined"
    :aria-label="label"
    @click="onClick"
  >
    <div
      class="jwt-countdown__fill"
      :style="{ width: sessionPercentage + '%', background: fillColor }"
    ></div>
    <div class="jwt-countdown__label" :style="{ color: labelColor }">{{ label }}</div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { getThemeColorConfig } from '../theme/colors.config.js';
import { formatRemainingTime } from '../utils/jwt';

// 登入有效時間倒數條（scoringSystem-cf topbar 圓形計時器的直線版）：
// fixed 疊在全螢幕 dialog/drawer 之上；>50% 純顯示，<=50% 進入警告態可點擊續約。
const WARNING_PERCENTAGE = 50;
const DANGER_REMAINING_MS = 5 * 60 * 1000;

const props = defineProps({
  remainingTime: { type: Number, required: true },
  sessionPercentage: { type: Number, required: true },
  renewing: { type: Boolean, default: false },
});

const emit = defineEmits(['renew']);

const warning = computed(() => props.sessionPercentage <= WARNING_PERCENTAGE);
const danger = computed(() => props.remainingTime < DANGER_REMAINING_MS);
const clickable = computed(() => warning.value && !props.renewing);

const state = computed(() => {
  if (danger.value) return 'danger';
  if (warning.value) return 'warning';
  return 'success';
});

const fillColor = computed(() => getThemeColorConfig(state.value).background);

// 警告態的字落在未填滿的淺色軌道上，蜜桃橘要用深化版才夠對比
const labelColor = computed(() => {
  const config = getThemeColorConfig(state.value);
  return state.value === 'warning' ? config.onLight : config.background;
});

const label = computed(() => {
  if (props.renewing) {
    return '延長登入時間中，請稍候…';
  }
  const remainText = '登入時間剩 ' + formatRemainingTime(props.remainingTime);
  return warning.value ? remainText + '，點這條延長 1 小時' : remainText;
});

function onClick() {
  if (clickable.value) {
    emit('renew');
  }
}
</script>

<style scoped>
.jwt-countdown {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 26px;
  /* Element Plus 彈窗 z-index 從 2000 起跳逐次遞增，取夠高的值確保蓋在全螢幕 dialog 上 */
  z-index: 5000;
  background: rgba(0, 0, 0, 0.14);
  overflow: hidden;
  user-select: none;
}

.jwt-countdown__fill {
  height: 100%;
  transition: width 1s linear;
  opacity: 0.85;
}

.jwt-countdown__label {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  text-shadow:
    0 0 3px #fff,
    0 0 5px #fff;
  pointer-events: none;
}

.jwt-countdown--clickable {
  cursor: pointer;
}

.jwt-countdown--pulse .jwt-countdown__fill {
  animation: jwt-countdown-pulse 1.6s ease-in-out infinite;
}

@keyframes jwt-countdown-pulse {
  0%,
  100% {
    opacity: 0.85;
  }
  50% {
    opacity: 0.45;
  }
}

/* 手機直式：正常態縮成細條不擋內容，警告態（要可點）才放大 */
@media (max-width: 768px) {
  .jwt-countdown {
    height: 10px;
  }

  .jwt-countdown__label {
    display: none;
  }

  .jwt-countdown--pulse {
    height: 26px;
  }

  .jwt-countdown--pulse .jwt-countdown__label {
    display: flex;
  }
}
</style>
