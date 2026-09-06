<template>
  <el-button
    v-if="clickable"
    class="rate-bar ma1 pa2 xs12"
    size="large"
    type="primary"
    :disabled="disabled"
    :style="barStyle"
    @click="emit('click')"
  >
    <span class="rate-bar__text" aria-hidden="true">{{ label }}</span>
    <span class="rate-bar__text rate-bar__text--fill" aria-hidden="true">{{ label }}</span>
    <span class="rate-bar__sr">{{ label }}</span>
  </el-button>
  <div
    v-else
    class="rate-bar rate-bar--plain"
    role="progressbar"
    :aria-valuenow="clampedPercentage"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-label="label"
    :style="barStyle"
  >
    <span class="rate-bar__text" aria-hidden="true">{{ label }}</span>
    <span class="rate-bar__text rate-bar__text--fill" aria-hidden="true">{{ label }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { getRateScaleStep } from '../theme/colors.config.js';

// 填答率條（Phase 29）
//
// 視覺點子取自 scoringSystem-cf 的 CountdownButton，但**不移植該元件**——那顆 70% 是倒數
// 計時器的東西（duration/autoStart/flipAt/spinner/翻轉動畫），顏色全寫死 hex，文字用
// mix-blend-mode: difference 會把底色變成不受控的負片（#020180 深藍 → 亮黃 #fdfe7f）。
// 本元件照本專案已有的 JwtCountdownBar 骨架長，顏色一律走 colors.config.js 的色階變數。
//
// 兩個形態共用同一套填充與文字邏輯：
//   clickable=true  → el-button 外殼（登入頁的入口按鈕）。保留 el-button 的尺寸、focus ring、
//                     disabled 行為，只用 :style 覆蓋 background 成 linear-gradient 硬斷點。
//   clickable=false → 唯讀 div（StatDialog 表格內每一列的條），role="progressbar"。
//
// 跨填充邊界的文字對比：**疊兩層文字＋clip-path**，不用 mix-blend-mode。
// 底層是未填充區的文字色（白底上的深色），上層是填充區的文字色（白），上層 clip 到填充寬度，
// 邊界切換是像素級精準，兩個顏色的對比度都在配色表裡有實測值。
const props = defineProps({
  // 0～100；超出範圍會被夾住（分子取交集後理論上不會 >100，這裡是防線）
  percentage: { type: Number, default: 0 },
  label: { type: String, default: '' },
  clickable: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  // 載入態：填充改用石墨灰，與真實數據的分級色區隔——不然條滿版會被讀成「填答率 100%」
  loading: { type: Boolean, default: false },
});

const emit = defineEmits(['click']);

const clampedPercentage = computed(() => {
  const pct = Number(props.percentage);
  if (!Number.isFinite(pct)) {
    return 0;
  }
  return Math.min(100, Math.max(0, pct));
});

const step = computed(() => getRateScaleStep(clampedPercentage.value));

const barStyle = computed(() => {
  const fill = props.loading ? 'var(--el-color-info)' : step.value.background;
  const fillText = props.loading ? '#ffffff' : step.value.text;
  const pct = clampedPercentage.value + '%';
  return {
    // 硬斷點：填充色到 pct、其後是白底，不做漸層過渡（邊界要跟文字的 clip 對齊）
    background: `linear-gradient(to right, ${fill} 0%, ${fill} ${pct}, #ffffff ${pct}, #ffffff 100%)`,
    '--sm-rate-fill': pct,
    '--sm-rate-fill-text': fillText,
  };
});
</script>

<style scoped>
.rate-bar {
  position: relative;
  width: 100%;
  overflow: hidden;
  /* 未填充區是白底，邊框與底層文字用主色 */
  border: 2px solid var(--el-color-primary);
  color: var(--el-color-primary);
  /* 條長與顏色都會變，一起過場；縮回動畫的時長是 App.vue 等待開 drawer 的依據 */
  transition:
    background 600ms ease-out,
    border-color 600ms ease-out;
}

/* el-button 形態：把 EP 的底色/文字色/hover 全部讓給我們的漸層，
   只借它的尺寸、focus ring 與 disabled 行為 */
.rate-bar.el-button {
  --el-button-bg-color: transparent;
  --el-button-border-color: var(--el-color-primary);
  --el-button-hover-bg-color: transparent;
  --el-button-hover-border-color: var(--el-color-primary);
  --el-button-hover-text-color: var(--el-color-primary);
  --el-button-active-bg-color: transparent;
  --el-button-active-border-color: var(--el-color-primary);
  --el-button-disabled-bg-color: transparent;
  --el-button-disabled-border-color: var(--el-color-primary);
  font-weight: 700;
}

/* 唯讀形態（表格內）：矮一點、不吃 el-button 的 padding */
.rate-bar--plain {
  display: block;
  height: 26px;
  line-height: 22px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 700;
}

.rate-bar__text {
  position: relative;
  z-index: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rate-bar--plain .rate-bar__text {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
}

/* 上層：填充區的文字色，clip 到填充寬度 */
.rate-bar__text--fill {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--sm-rate-fill-text);
  clip-path: inset(0 calc(100% - var(--sm-rate-fill)) 0 0);
  transition: clip-path 600ms ease-out;
  pointer-events: none;
}

/* 螢幕閱讀器唯一該讀到的那份（上下兩層都 aria-hidden，否則會讀兩次） */
.rate-bar__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .rate-bar,
  .rate-bar__text--fill {
    transition: none;
  }
}
</style>
