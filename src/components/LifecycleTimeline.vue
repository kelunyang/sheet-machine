<template>
  <div v-if="visible" class="lifecycle-timeline" :class="'lt-' + state" aria-label="有效期間時間軸">
    <div class="lt-track">
      <!-- 當前時間標記：側面像素小學生（與 loading 遊戲同款素材縮小版）沿軌道走 -->
      <canvas
        ref="walkerRef"
        class="lt-walker"
        :width="SPRITE_W"
        :height="SPRITE_H"
        :style="{ left: walkerLeft }"
        aria-hidden="true"
      ></canvas>
      <div class="lt-rail">
        <div class="lt-fill" :style="{ width: percent + '%' }"></div>
      </div>
      <span class="lt-dot lt-dot-start"></span>
      <span class="lt-dot lt-dot-end"></span>
    </div>
    <div class="lt-ends">
      <div class="lt-end-label">
        <span class="lt-end-cap">{{ startLabel }}</span>
        <span class="lt-end-time">{{ dateConverter(startAt) }}</span>
      </div>
      <div class="lt-current" :style="{ left: currentLeft }">
        <template v-if="state === 'ended'">
          <span class="lt-ended-text">{{ endedText }}</span>
        </template>
        <template v-else-if="state === 'pending'">
          <span class="lt-ended-text">尚未開始</span>
        </template>
        <template v-else>
          <span class="lt-now">當前 {{ nowText }}</span>
          <span class="lt-count">距結束 {{ countdown }}</span>
        </template>
      </div>
      <div class="lt-end-label lt-right">
        <span class="lt-end-cap">{{ endLabel }}</span>
        <span class="lt-end-time">{{ dateConverter(endAt) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import dayjs from 'dayjs';
import { BOY, GIRL, drawSprite } from '../utils/pixelSprites.js';
import { getGameSession } from '../composables/useLoadingGame';
import { dateConverter } from '../utils/formatters.js';
import { timelineValid, timelineState, timelinePercent, remainingText } from '../utils/timeline.js';

// 問卷/邀請生命週期的橫向時間軸：起點●──小人──○終點，取代舊的
// 「問卷即將在 XXXX 秒後過期」el-alert。狀態與百分比邏輯在 utils/timeline.js，
// 視覺沿用 FieldTimeline 的點線語言（灰=未到、綠=已過時段、紅=逾期），
// 剩 <10 分鐘整條轉警示色。起訖無效（createdAt=0、dueDate=0）時整個不渲染。
const props = defineProps({
  startAt: { type: Number, default: 0 },
  endAt: { type: Number, default: 0 },
  startLabel: { type: String, required: true },
  endLabel: { type: String, required: true },
  // 逾期時取代倒數的中央文字（問卷=已經無法填寫、邀請=邀請已過期）
  endedText: { type: String, required: true },
  // 安靜模式（Phase 13）：平時不渲染，warning（剩 <10 分鐘）/ended 才浮現——
  // 回歸被取代的「即將過期」el-alert 的警示語意。決策點畫面（登入 drawer）不設，常駐
  quiet: { type: Boolean, default: false },
});

// 側面走路款 12×15、scale 2 顯示 24×30（LoadingGame 用同素材 scale 3）；
// 水平移動語意與遊戲一致，FieldTimeline 垂直導航才用正面款
const SPRITE_W = 12;
const SPRITE_H = 15;
const SPRITE_DISPLAY_W = 24;
const STEP_MS = 1000; // 慢速踏步：一秒一步，跟著 tick 走

const now = ref(Date.now());
const walkerRef = ref(null);

const sprite = getGameSession().playerIsGirl ? GIRL : BOY;
const reducedMotion =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const valid = computed(() => timelineValid(props.startAt, props.endAt));
const state = computed(() => timelineState(now.value, props.startAt, props.endAt));
const visible = computed(
  () => valid.value && (!props.quiet || state.value === 'warning' || state.value === 'ended')
);
const percent = computed(() => timelinePercent(now.value, props.startAt, props.endAt));
const countdown = computed(() => remainingText(now.value, props.endAt));
const nowText = computed(() => dayjs(now.value).format('HH:mm'));

// 小人腳踩在當前時間點上，首尾用 clamp 夾住不溢出軌道
const walkerLeft = computed(
  () => `clamp(0px, calc(${percent.value}% - ${SPRITE_DISPLAY_W / 2}px), calc(100% - ${SPRITE_DISPLAY_W}px))`
);

// 當前時間標籤跟著小人，同樣夾住不與兩端重疊溢出
const currentLeft = computed(() => `clamp(0px, calc(${percent.value}% - 60px), calc(100% - 120px))`);

let frameIndex = 0;
let tickTimer = null;

function drawWalker() {
  const canvas = walkerRef.value;
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, SPRITE_W, SPRITE_H);
  drawSprite(ctx, sprite[frameIndex], 0, 0);
}

// 每秒 tick：時間一直在走，active/warning 態順便換一幀踏步；
// pending/ended 或 prefers-reduced-motion 立定（幀 0）
function tick() {
  now.value = Date.now();
  const walking = !reducedMotion && (state.value === 'active' || state.value === 'warning');
  const nextFrame = walking ? (frameIndex === 0 ? 1 : 0) : 0;
  if (nextFrame !== frameIndex) {
    frameIndex = nextFrame;
    drawWalker();
  }
}

// visible 由 false 轉 true（登入載入資料、quiet 模式進 warning）時 canvas 才進 DOM，補畫第一幀
watch(visible, (val) => {
  if (val) {
    now.value = Date.now();
    requestAnimationFrame(drawWalker);
  }
});

onMounted(() => {
  drawWalker();
  tickTimer = setInterval(tick, STEP_MS);
});

onBeforeUnmount(() => {
  clearInterval(tickTimer);
});
</script>

<style scoped>
.lifecycle-timeline {
  margin: 8px 0 4px;
}

/* 軌道區：上方留小人高度，rail 垂直置於小人腳下 */
.lt-track {
  position: relative;
  padding-top: 30px; /* SPRITE_H × 2 */
  margin: 0 5px; /* 讓兩端圓點不貼容器邊 */
}

.lt-walker {
  position: absolute;
  bottom: 3px; /* 腳貼在 rail 上緣 */
  width: 24px; /* SPRITE_W × 2 */
  height: 30px; /* SPRITE_H × 2 */
  image-rendering: pixelated;
  pointer-events: none;
  transition: left 0.5s linear;
  z-index: 1;
}

@media (prefers-reduced-motion: reduce) {
  .lt-walker {
    transition: none;
  }
}

.lt-rail {
  position: relative;
  height: 4px;
  border-radius: 2px;
  background: var(--el-color-info-light-5);
  overflow: hidden;
}

.lt-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--el-color-success);
  transition: width 0.5s linear;
}

/* 起終圓點：疊在 rail 兩端，語意同 FieldTimeline（實心=已過、空心=未到） */
.lt-dot {
  position: absolute;
  bottom: -3px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--el-bg-color, #fff);
  box-sizing: content-box;
}

.lt-dot-start {
  left: -5px;
  background: var(--el-color-success);
}

.lt-dot-end {
  right: -5px;
  background: var(--el-color-info-light-5);
}

/* 起訖標籤列：兩端各一組，中央是跟著小人的當前時間/倒數 */
.lt-ends {
  position: relative;
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  min-height: 34px;
}

.lt-end-label {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.lt-right {
  text-align: right;
}

.lt-end-cap {
  font-weight: bold;
  color: var(--el-text-color-regular);
}

.lt-current {
  position: absolute;
  top: 0;
  width: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  font-size: 12px;
  color: var(--el-text-color-regular);
  transition: left 0.5s linear;
}

.lt-now {
  font-weight: bold;
}

.lt-count {
  color: var(--el-text-color-secondary);
}

.lt-ended-text {
  font-weight: bold;
  color: var(--el-color-danger);
}

/* ===== 警示態（剩 <10 分鐘）：軌道轉 warning、倒數轉 danger 加粗 ===== */
.lt-warning .lt-fill,
.lt-warning .lt-dot-start {
  background: var(--el-color-warning);
}

.lt-warning .lt-count {
  color: var(--el-color-danger);
  font-weight: bold;
}

.lt-warning .lt-now {
  color: var(--el-color-danger);
}

/* ===== 逾期態：整條轉紅 ===== */
.lt-ended .lt-fill,
.lt-ended .lt-dot-start,
.lt-ended .lt-dot-end {
  background: var(--el-color-danger);
}

/* ===== 未開始態：軌道全灰 ===== */
.lt-pending .lt-dot-start {
  background: var(--el-color-info-light-5);
}

@media (max-width: 768px) {
  .lt-end-label {
    font-size: 11px;
  }

  .lt-end-time {
    max-width: 100px;
    word-break: break-all;
  }
}
</style>
