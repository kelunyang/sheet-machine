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
    <div class="jwt-countdown__label">{{ label }}</div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { getThemeColorConfig } from '../theme/colors.config.js';
import { formatRemainingTime } from '../utils/jwt';

// 登入有效時間倒數條（scoringSystem-cf topbar 圓形計時器的直線版）：
// Phase 9 起為嵌入式元件——由外層容器決定位置（各主 drawer body 頂部配 .drawer-sticky-top
// 主 drawer 已 with-header=false、標題在 body 內捲走，捲動時本條升到視窗最頂 y=0）；>50% 純顯示，<=50% 警告態可點擊續約。
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

// Phase 7：label 固定純白，軌道與填充全用深色——warning 不能用淺蜜桃橘（白字 1.9:1
// 不及格），改用深化棕 onLight（白字實測 5.0:1）；綠 5.1:1、紅 5.4:1、軌道石墨灰 6.8:1
const fillColor = computed(() => {
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
  position: relative;
  width: 100%;
  height: 26px;
  /* 深色軌道：白色 label 的對比前提（石墨灰對白字 6.8:1） */
  background: var(--el-color-info);
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
  color: #fff;
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
