<template>
  <div v-if="items.length > 1" ref="rootRef" class="field-timeline" aria-label="填寫進度導航">
    <div class="timeline-inner" :style="{ height: trackHeight + 'px' }">
      <!-- 目前題目 indicator：正面像素小學生（與 loading 遊戲同角色），站在 current 點旁 -->
      <canvas
        ref="walkerRef"
        class="walker"
        :width="SPRITE_W"
        :height="SPRITE_H"
        :style="{ top: walkerTop + 'px' }"
        aria-hidden="true"
      ></canvas>
      <svg :width="TRACK_W" :height="trackHeight" class="timeline-svg">
        <!-- 線段：相鄰兩點之間，顏色取上方點的狀態 -->
        <line
          v-for="(seg, i) in segments"
          :key="'seg-' + i"
          :x1="CX"
          :y1="seg.y1"
          :x2="CX"
          :y2="seg.y2"
          :class="'seg-' + seg.status"
          stroke-width="3"
        />
        <!-- 點：一題一個，點擊捲動到該欄位 -->
        <circle
          v-for="item in items"
          :key="item.tid"
          :cx="CX"
          :cy="item.y"
          r="6"
          :class="'dot-' + item.status"
          @click="goTo(item.tid)"
        >
          <title>{{ item.tooltip }}</title>
        </circle>
      </svg>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { BOY_FRONT, GIRL_FRONT, drawSprite } from '../utils/pixelSprites.js';
import { getGameSession } from '../composables/useLoadingGame';

// 從 scoringSystem 的 StageTimeline 移植的精簡版：拿掉物理引擎/擺動/tooltip 動畫，
// 只留「點＋線」導航。一題（type F 欄位）一個點，點擊捲動到 App.vue 給每個
// FormField 加的 formfield-<tid> 錨點。
// 顏色語意：灰=未填、綠=已填且驗證通過、紅=驗證錯誤（含必填未填被 valField 標紅）
const TRACK_W = 24;
const CX = TRACK_W / 2;
const DOT_GAP = 22; // 點與點的目標間距（px），總高由題數決定、上限交給 CSS max-height
const PAD = 8; // 首尾點距離 SVG 邊緣的留白，避免圓被裁切

// 正面小人 indicator：8×10 邏輯像素、CSS 放大 2 倍成 16×20（高度 < DOT_GAP，
// 站在 current 點左側不壓到相鄰點）；角色沿用 loading 遊戲抽到的那位（同一場 session
// 「你」是同一個小人）。捲動中兩幀原地踏步、停止後立定。
const SPRITE_W = 8;
const SPRITE_H = 10;
const SPRITE_SCALE = 2;
const STEP_MS = 120; // 踏步換幀間隔
const IDLE_MS = 150; // 最後一次 scroll 事件後多久算停下

const props = defineProps({
  // 整份 columnDB；這裡只讀不寫，狀態由 FormField 的 validateColumn 就地維護
  columns: { type: Array, required: true },
});

function fieldStatus(column) {
  if (column.status !== '') {
    return 'error';
  }
  let val = column.value;
  let empty =
    val === '' || val === null || val === undefined || (typeof val === 'number' && isNaN(val));
  return empty ? 'empty' : 'done';
}

const STATUS_TEXT = { empty: '未填', done: '已填', error: '格式錯誤' };

const questions = computed(() => props.columns.filter((column) => /F/.test(column.type)));

const trackHeight = computed(() => PAD * 2 + (questions.value.length - 1) * DOT_GAP);

const items = computed(() =>
  questions.value.map((column, index) => {
    let status = fieldStatus(column);
    return {
      tid: column.tid,
      y: PAD + index * DOT_GAP,
      status: status,
      tooltip: index + 1 + '. ' + column.name + '（' + STATUS_TEXT[status] + '）',
    };
  })
);

const segments = computed(() => {
  let result = [];
  for (let i = 0; i < items.value.length - 1; i++) {
    result.push({
      y1: items.value[i].y,
      y2: items.value[i + 1].y,
      status: items.value[i].status,
    });
  }
  return result;
});

function goTo(tid) {
  let target = document.getElementById('formfield-' + tid);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ===== 目前題目判定 + 小人繪製 =====
const rootRef = ref(null);
const walkerRef = ref(null);
const currentIndex = ref(0);

const sprite = getGameSession().playerIsGirl ? GIRL_FRONT : BOY_FRONT;
const reducedMotion =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 小人垂直置中對齊 current 點，夾在軌道範圍內（首點只溢 2px，夾掉避免被 overflow 裁切）
const walkerTop = computed(() => {
  const item = items.value[currentIndex.value];
  if (!item) {
    return 0;
  }
  const h = SPRITE_H * SPRITE_SCALE;
  return Math.min(Math.max(0, item.y - h / 2), Math.max(0, trackHeight.value - h));
});

let frameIndex = 0;
let stepTimer = null;
let stopTimer = null;

function drawWalker() {
  const canvas = walkerRef.value;
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, SPRITE_W, SPRITE_H);
  drawSprite(ctx, sprite[frameIndex], 0, 0);
}

function stopStepping() {
  clearInterval(stepTimer);
  clearTimeout(stopTimer);
  stepTimer = null;
  stopTimer = null;
  if (frameIndex !== 0) {
    frameIndex = 0;
    drawWalker();
  }
}

function startStepping() {
  if (!stepTimer) {
    stepTimer = setInterval(() => {
      frameIndex = frameIndex === 0 ? 1 : 0;
      drawWalker();
    }, STEP_MS);
  }
  clearTimeout(stopTimer);
  stopTimer = setTimeout(stopStepping, IDLE_MS);
}

// 取「中心最接近視窗中線」的題目當 current；rAF 節流，一次捲動事件叢只算一次
let rafPending = false;

function updateCurrent() {
  rafPending = false;
  const mid = window.innerHeight / 2;
  let best = 0;
  let bestDist = Infinity;
  items.value.forEach((item, index) => {
    const el = document.getElementById('formfield-' + item.tid);
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const dist = Math.abs(rect.top + rect.height / 2 - mid);
    if (dist < bestDist) {
      bestDist = dist;
      best = index;
    }
  });
  currentIndex.value = best;
}

// scroll 不冒泡，掛 window 捕獲階段收所有捲動容器（drawer body 換內部結構也不怕）；
// timeline 自身的跟隨捲動不算使用者移動，濾掉避免小人原地空踏
function onScroll(event) {
  if (event.target === rootRef.value) {
    return;
  }
  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(updateCurrent);
  }
  if (!reducedMotion) {
    startStepping();
  }
}

// current 點捲出 timeline 可視範圍（max-height 70vh 內捲）時，把它帶回中間
watch(currentIndex, () => {
  const root = rootRef.value;
  const item = items.value[currentIndex.value];
  if (!root || !item || root.scrollHeight <= root.clientHeight) {
    return;
  }
  const margin = SPRITE_H * SPRITE_SCALE;
  if (item.y - margin < root.scrollTop || item.y + margin > root.scrollTop + root.clientHeight) {
    root.scrollTop = Math.max(0, item.y - root.clientHeight / 2);
  }
});

// 題目集合變動（登入載入欄位）時重算 current 並補畫
watch(
  () => items.value.length,
  () => {
    if (currentIndex.value >= items.value.length) {
      currentIndex.value = 0;
    }
    nextTick(() => {
      drawWalker();
      updateCurrent();
    });
  }
);

onMounted(() => {
  drawWalker();
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  nextTick(updateCurrent);
});

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll, { capture: true });
  stopStepping();
});
</script>

<style scoped>
.field-timeline {
  position: fixed;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 30;
  max-height: 70vh;
  overflow-y: auto;
  /* 隱藏自身捲軸，題目太多時仍可捲動這條導航 */
  scrollbar-width: none;
}

.field-timeline::-webkit-scrollbar {
  display: none;
}

.timeline-inner {
  position: relative;
  /* 左欄給小人（16px 顯示寬 + 2px 間隙），右欄軌道 24px */
  width: 42px;
}

.timeline-svg {
  display: block;
  margin-left: 18px;
}

.walker {
  position: absolute;
  left: 0;
  width: 16px; /* SPRITE_W × SPRITE_SCALE */
  height: 20px; /* SPRITE_H × SPRITE_SCALE，小於點距 22px */
  image-rendering: pixelated;
  pointer-events: none;
  transition: top 0.2s ease;
}

@media (prefers-reduced-motion: reduce) {
  .walker {
    transition: none;
  }
}

circle {
  cursor: pointer;
  stroke: var(--el-bg-color, #fff);
  stroke-width: 2;
}

.dot-empty {
  fill: var(--el-color-info-light-5);
}

.dot-done {
  fill: var(--el-color-success);
}

.dot-error {
  fill: var(--el-color-danger);
}

.seg-empty {
  stroke: var(--el-color-info-light-5);
}

.seg-done {
  stroke: var(--el-color-success);
}

.seg-error {
  stroke: var(--el-color-danger);
}
</style>
