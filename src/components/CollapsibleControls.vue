<template>
  <div class="collapsible-controls" ref="rootRef">
    <div class="cc-body-wrap" :class="{ 'is-collapsed': collapsible && !expanded }">
      <div class="cc-body">
        <slot></slot>
      </div>
    </div>
    <!-- peek：收合後仍露出的主要動作（如簽名列的「下一個簽名」），讓使用者知道還能做什麼；
         展開態或桌機（collapsible=false）不顯示，主按鈕由 body 內的本尊負責，避免重複 -->
    <div v-if="collapsible && !expanded && $slots.peek" class="cc-peek">
      <slot name="peek"></slot>
    </div>
    <button
      v-if="collapsible"
      type="button"
      class="cc-handle"
      :aria-expanded="expanded"
      @click="toggle"
    >
      <i class="fa-solid" :class="expanded ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
      <span>{{ expanded ? expandedText : collapsedText }}</span>
      <i class="fa-solid" :class="expanded ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
    </button>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

// 手機用的可收合控制列外殼（Phase 22）：把 toolbar 的「按鈕群」包起來——
// JWT 倒數條在外層（永遠留著、效期是時間敏感資訊），只有這裡包住的按鈕會收合。
// 手機（≤768px）往下捲題目/簽名時自動收成 handle（「更多功能請點此」），
// 捲回頂端（top≈0）自動彈開；也可隨時點 handle 手動展開／收合。
// 桌機/平板：collapsible=false，原樣顯示、無 handle、無收合。
// active=false（如 viewOnly 無任何按鈕）時整個外殼退化為單純 passthrough，不長 handle。
// 具名插槽 #peek：收合後仍露出的主要動作（如簽名列的「下一個簽名」），
// 讓使用者收合狀態下也知道能做什麼；展開態/桌機不顯示（主按鈕由預設 slot 的本尊負責）。
const props = defineProps({
  // 這個實例是否有可收合的內容（父層據按鈕顯示條件決定，避免收合空殼長出 handle）
  active: { type: Boolean, default: true },
  collapsedText: { type: String, default: '更多功能請點此' },
  expandedText: { type: String, default: '收合功能列' },
});

const rootRef = ref(null);
const isMobile = ref(false);
const expanded = ref(true);
// 只有「手機 且 有內容」才啟用收合；其一不成立就原樣顯示
const collapsible = computed(() => isMobile.value && props.active);

const MOBILE_QUERY = '(max-width: 768px)';
// 捲過這段距離才算「離開頂端」；在此之內（含 top:0）視為在頂端 → 自動展開
const COLLAPSE_THRESHOLD = 32;
// 需明顯往下捲才收合，濾掉頂端輕微抖動與「點 handle 展開」當下的慣性回彈
const SCROLL_DELTA = 6;
// 手動展開後的寬限期：擋掉點擊當下的慣性捲動把它立刻收回去（bug：按了不彈開）
const EXPAND_GRACE_MS = 350;

let mql = null;
let scrollEl = null;
let lastScrollTop = 0;
let expandGraceUntil = 0;

function onMqlChange(e) {
  isMobile.value = e.matches;
}

function onScroll() {
  if (!collapsible.value || !scrollEl) return;
  const st = scrollEl.scrollTop;
  if (st <= COLLAPSE_THRESHOLD) {
    // 捲回頂端：自動彈開
    expanded.value = true;
  } else if (st - lastScrollTop > SCROLL_DELTA && Date.now() > expandGraceUntil) {
    // 明顯往下捲（讀題/簽名）且已離頂：自動收合；手動展開寬限期內不收
    expanded.value = false;
  }
  lastScrollTop = st;
}

function toggle() {
  expanded.value = !expanded.value;
  // 手動展開時給一段寬限期，避免點擊當下的慣性捲動誤把它收回去
  if (expanded.value) expandGraceUntil = Date.now() + EXPAND_GRACE_MS;
}

onMounted(() => {
  mql = window.matchMedia(MOBILE_QUERY);
  isMobile.value = mql.matches;
  // Safari <14 只有 addListener；現代瀏覽器用 addEventListener
  if (mql.addEventListener) mql.addEventListener('change', onMqlChange);
  else mql.addListener(onMqlChange);

  // 捲動容器＝所在的 el-drawer body（.drawer-flow-body / .el-drawer__body），監聽它的捲動
  scrollEl = rootRef.value?.closest('.el-drawer__body') || null;
  if (scrollEl) {
    lastScrollTop = scrollEl.scrollTop;
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
  }
});

onBeforeUnmount(() => {
  if (mql) {
    if (mql.removeEventListener) mql.removeEventListener('change', onMqlChange);
    else mql.removeListener(onMqlChange);
  }
  if (scrollEl) scrollEl.removeEventListener('scroll', onScroll);
});
</script>

<style scoped>
/* 收合動畫：grid-template-rows 1fr↔0fr——不必量內容高度就能平滑收放
   （按鈕會換行、高度不定，max-height 過渡難抓，grid 1fr/0fr 是穩解） */
.cc-body-wrap {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows 0.25s ease;
}

.cc-body-wrap.is-collapsed {
  grid-template-rows: 0fr;
}

.cc-body-wrap > .cc-body {
  overflow: hidden;
  min-height: 0;
}

/* peek：收合後仍露出的按鈕列，內距比照各 toolbar 的 __controls */
.cc-peek {
  display: flex;
  gap: 8px;
  padding: 8px var(--el-drawer-padding-primary, 20px);
}

/* handle：抽屜把手，整條可點；色走主題語意變數（不寫死 hex） */
.cc-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  padding: 6px 20px;
  border: none;
  border-top: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
}

.cc-handle:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}

.cc-handle i {
  font-size: 11px;
  opacity: 0.7;
}
</style>
