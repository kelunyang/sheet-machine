<template>
  <div v-if="items.length > 1" ref="rootRef" class="field-timeline" aria-label="填寫進度導航">
    <!-- 起點旗（綠）／終點旗（格紋＝完賽），跟著軌道捲動：長問卷捲到底才看到終點旗 -->
    <div class="tl-flag tl-flag--start" aria-hidden="true"><i class="fa-solid fa-flag"></i></div>
    <div class="timeline-inner" :style="{ height: trackHeight + 'px' }">
      <!-- 目前題目 indicator：正面像素小學生（與 loading 遊戲同角色），站在 current 點旁 -->
      <canvas
        ref="walkerRef"
        class="walker"
        :class="{ 'walker--snap': walkerSnap }"
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
    <div class="tl-flag tl-flag--end" aria-hidden="true"><i class="fa-solid fa-flag-checkered"></i></div>
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
// 起點旗高度（px），須與 CSS .tl-flag 的 height 一致：起點旗排在軌道上方、把
// timeline-inner 往下推，內捲回捲比對 item.y 與 scrollTop 時要加上這段偏移才對得準
const FLAG_H = 18;

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
// 小人動畫模式：大跳（超過 2 個點距）時暫時關掉 transition 直接瞬移，見下方 watch(currentIndex)
const walkerSnap = ref(false);

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

// 取「中心最接近視窗中線」的題目當 current。IO 空窗時的 fallback：全量掃所有錨點。
// rafPending 由下方 schedulePick 統一管理（IO 回呼與 scroll 共用同一個 rAF 入口）。
let rafPending = false;

function updateCurrent() {
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

// 統一 rAF 入口：每幀最多重算一次 current。集合有交會走 live pick（當場量測），
// 空窗才退回全量掃。IO 回呼與 scroll 都經此節流，快速捲動時每幀都更新、不再只等 IO 回呼時機。
function runPick() {
  rafPending = false;
  if (intersecting.size === 0) {
    updateCurrent();
    return;
  }
  const idx = pickCurrentFromIntersecting();
  if (idx >= 0) {
    currentIndex.value = idx;
  } else {
    // 超高欄位可能整個蓋過中線帶、導致集合空窗；退回 nearest-midline 全量掃保底
    updateCurrent();
  }
}

function schedulePick() {
  if (rafPending) {
    return;
  }
  rafPending = true;
  requestAnimationFrame(runPick);
}

// ===== current 偵測：IntersectionObserver（錨點制）=====
// 舊做法靠 window scroll 事件 + 每幀全量 getBoundingClientRect，兩個弱點：不發 scroll
// 的位移（版面高度變化等）不會重算，且每幀 forced layout。改用 IO：對每題錨點
// #formfield-<tid> 掛觀察器，rootMargin 把觸發帶壓成視窗中線的一條窄帶（上下各切 45%），
// 錨點中心進中線帶才算交會，交會集合裡挑中心最接近中線者當 current。
let io = null;
// tid -> 交會中的錨點元素本身（不存 entry.boundingClientRect 快照）。
// 存元素而非 rect：pick 時當場 getBoundingClientRect 取即時位置——若存 rect 快照，
// 集合裡各筆會是不同時間（有的幾秒前）存下的，混在一起比距離會選錯 current、
// 造成穩定捲動時仍一次跳好幾格再修正（顆粒抖動）。集合只有 3~7 個，當場量測成本可忽略。
const intersecting = new Map();

// 從交會集合挑中心最接近視窗中線的題目；集合空回 -1（交由 fallback 全量掃）
function pickCurrentFromIntersecting() {
  const mid = window.innerHeight / 2;
  let bestTid = null;
  let bestDist = Infinity;
  intersecting.forEach((el, tid) => {
    // live rect：當下量測，不用回呼當時存的快照，避免 stale rect 選錯 current
    const rect = el.getBoundingClientRect();
    const dist = Math.abs(rect.top + rect.height / 2 - mid);
    if (dist < bestDist) {
      bestDist = dist;
      bestTid = tid;
    }
  });
  if (bestTid === null) {
    return -1;
  }
  return items.value.findIndex((item) => item.tid === bestTid);
}

function onIntersect(entries) {
  entries.forEach((entry) => {
    const tid = entry.target.id.replace('formfield-', '');
    if (entry.isIntersecting) {
      intersecting.set(tid, entry.target);
    } else {
      intersecting.delete(tid);
    }
  });
  // 只更新集合成員，實際 pick 交給共用 rAF 入口（live rect 當場量測）
  schedulePick();
}

// 重掛 observer：items 變動（登入載入欄位、tid 列表改變）後錨點集合也變，需重新觀察
function setupObserver() {
  if (typeof IntersectionObserver !== 'function') {
    // 環境無 IO（測試 jsdom 等）時退回純 fallback，仍靠 scroll 事件觸發 updateCurrent
    return;
  }
  if (io) {
    io.disconnect();
  }
  intersecting.clear();
  io = new IntersectionObserver(onIntersect, {
    // root:null → 用 viewport；drawer 是全螢幕 fixed，viewport 即可涵蓋
    root: null,
    // 上下各切 45%，只留中間 10% 當中線帶：錨點中心進帶才交會，避免整頁多題同時算 current
    rootMargin: '-45% 0px -45% 0px',
    threshold: 0,
  });
  items.value.forEach((item) => {
    const el = document.getElementById('formfield-' + item.tid);
    if (el) {
      io.observe(el);
    }
  });
}

// scroll 不冒泡，掛 window 捕獲階段收所有捲動容器（drawer body 換內部結構也不怕）。
// timeline 自身的跟隨捲動不算使用者移動，濾掉避免小人原地空踏。
function onScroll(event) {
  if (event.target === rootRef.value) {
    return;
  }
  // 每幀重算 current（rAF 節流）：快速拖曳捲軸時 IO 回呼時機不足以每幀更新，
  // 由 scroll 補上；有交會走 live pick、空窗走全量掃，皆在 runPick 內決定
  schedulePick();
  if (!reducedMotion) {
    startStepping();
  }
}

// current 點捲出 timeline 可視範圍（max-height 70vh 內捲）時，把它帶回中間。
// 用 scrollTo smooth 平滑捲動——舊做法直接指派 scrollTop 是瞬移，與小人 canvas 的
// `transition: top 0.2s` 兩套時間軸打架（拖曳時小人先滑到底邊、瞬移又彈回中間 → 亂飄）；
// 遲滯加大到約 2 個點距（44px），離邊緣還有一段就提前回捲，減少「滑到最底才跳」的視覺。
watch(currentIndex, (nv, ov) => {
  // 小人動畫：位移 ≤ 2 個點距（walkerTop 隨 index 線性，故用 index 差判定）維持
  // transition:top 0.2s 的平滑走動；超過就是「真跳」（捲軸高靈敏、手抖 snap-back 讓
  // 捲動位置單幀瞬移數千 px，current 忠實反映成跳好幾格），此時關 transition 直接瞬移，
  // 否則 0.2s 會把每次大跳演成滑過整條軌道的動畫、來回大跳＝小人飛來飛去。
  if (!reducedMotion && typeof ov === 'number' && Math.abs(nv - ov) > 2) {
    walkerSnap.value = true;
    // 位置落定後移除 snap class：watch 是 pre-flush，snap class 與新 walkerTop 同一次
    // render 一起套用（該幀無動畫）；等 render 提交（nextTick）再等一幀（rAF）確保
    // 瞬移已完成，才恢復 transition，避免移除 class 時殘留的位移又被演成動畫
    nextTick(() => {
      requestAnimationFrame(() => {
        walkerSnap.value = false;
      });
    });
  }

  const root = rootRef.value;
  const item = items.value[currentIndex.value];
  if (!root || !item || root.scrollHeight <= root.clientHeight) {
    return;
  }
  // current 點捲出 timeline 可視範圍（max-height 70vh 內捲）時，把它帶回中間。
  // 用 scrollTo smooth 平滑捲動——直接指派 scrollTop 是瞬移，與小人 canvas 的
  // transition 兩套時間軸打架（拖曳時小人先滑到底邊、瞬移又彈回中間 → 亂飄）；
  // 遲滯加大到約 2 個點距（44px），離邊緣還有一段就提前回捲，減少「滑到最底才跳」。
  const margin = DOT_GAP * 2;
  // 起點旗把軌道往下推 FLAG_H，item.y（timeline-inner 內座標）換算捲動內容座標要補上
  const itemTop = item.y + FLAG_H;
  if (itemTop - margin < root.scrollTop || itemTop + margin > root.scrollTop + root.clientHeight) {
    const targetTop = Math.max(0, itemTop - root.clientHeight / 2);
    root.scrollTo({
      top: targetTop,
      // reduced-motion 下用 auto（無動畫）尊重使用者偏好，其餘平滑捲動避免瞬移
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  }
});

// 題目集合變動（登入載入欄位）時重算 current、補畫、重掛 observer
watch(
  () => items.value.length,
  () => {
    if (currentIndex.value >= items.value.length) {
      currentIndex.value = 0;
    }
    nextTick(() => {
      drawWalker();
      setupObserver();
      updateCurrent();
    });
  }
);

onMounted(() => {
  drawWalker();
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  nextTick(() => {
    setupObserver();
    updateCurrent();
  });
});

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll, { capture: true });
  if (io) {
    io.disconnect();
    io = null;
  }
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

/* 桌機（有精準指標）把整條往內推：全螢幕 drawer 的原生捲軸在視窗右緣約 15px，
   圓點可點區原本壓在捲軸左半、抓滑塊會誤點圓點觸發 goTo；離開捲軸帶即可。
   手機（粗指標）維持 6px 不吃版面。 */
@media (pointer: fine) {
  .field-timeline {
    right: 20px;
  }
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

/* 起點／終點旗：對齊軌道欄（同 svg 的 margin-left 18px + 寬 24px 置中）。
   height 須與 script 的 FLAG_H 一致（回捲座標補償用）。
   起點綠旗＝出發、格紋旗＝完賽（賽事通用符號）；色走主題語意變數，不寫死 hex */
.tl-flag {
  height: 18px;
  line-height: 18px;
  margin-left: 18px;
  width: 24px;
  text-align: center;
  font-size: 12px;
}

.tl-flag--start {
  color: var(--el-color-success);
}

.tl-flag--end {
  color: var(--el-text-color-primary);
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

/* 大跳時（位移 > 2 個點距）暫時關掉 transition 直接瞬移，落定後由 JS 移除本 class
   恢復平滑；否則 0.2s 動畫會把每次大跳演成飛過整條軌道 */
.walker--snap {
  transition: none;
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
