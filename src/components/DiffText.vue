<template>
  <div class="diff-text" v-html="diffHtml"></div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { html as diff2html } from 'diff2html';
import { createTwoFilesPatch } from 'diff';
import DOMPurify from 'dompurify';

// 兩段純文字的逐行 diff（Phase 23）。搬自 scoringSystem-cf 的 RankingComparison.vue，
// 改成直接吃兩段字串（原本吃排名陣列），並補上本專案的兩條紅線：
//   1. v-html 前一律過 DOMPurify（diff2html 的輸出含使用者輸入的文字）
//   2. 配色走全域配色表變數，不寫死 hex
// diff2html 的 CSS 走 index.html 的 CDN <link>（不在元件裡 import，singlefile 不處理 CSS import）。
// 手機（≤768px）自動切 line-by-line（並排兩欄在窄螢幕只能橫向捲，很難讀），桌機 side-by-side。
const props = defineProps({
  oldText: { type: String, default: '' },
  newText: { type: String, default: '' },
  oldTitle: { type: String, default: '原本' },
  newTitle: { type: String, default: '這次' },
});

const MOBILE_QUERY = '(max-width: 768px)';
const isMobile = ref(false);
let mql = null;

function onMqlChange(e) {
  isMobile.value = e.matches;
}

onMounted(() => {
  mql = window.matchMedia(MOBILE_QUERY);
  isMobile.value = mql.matches;
  // Safari <14 沒有 addEventListener，退回 addListener（比照 CollapsibleControls）
  if (mql.addEventListener) {
    mql.addEventListener('change', onMqlChange);
  } else if (mql.addListener) {
    mql.addListener(onMqlChange);
  }
});

onBeforeUnmount(() => {
  if (!mql) return;
  if (mql.removeEventListener) {
    mql.removeEventListener('change', onMqlChange);
  } else if (mql.removeListener) {
    mql.removeListener(onMqlChange);
  }
});

const diffHtml = computed(() => {
  const patch = createTwoFilesPatch(
    props.oldTitle,
    props.newTitle,
    props.oldText,
    props.newText,
    '',
    '',
    { context: 999 } // 全部行都顯示，不折疊——題目要一題不漏地看得到
  );
  const html = diff2html(patch, {
    drawFileList: false,
    matching: 'lines',
    outputFormat: isMobile.value ? 'line-by-line' : 'side-by-side',
    renderNothingWhenEmpty: false,
  });
  return DOMPurify.sanitize(html);
});
</script>

<style scoped>
.diff-text {
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  overflow-x: auto;
}
.diff-text :deep(.d2h-wrapper) {
  font-size: 14px;
}
/* 檔頭與 @@ 資訊行是 git patch 的殘留，對填表人無意義；行號同理（我們的「行」是題目不是程式碼） */
.diff-text :deep(.d2h-file-header),
.diff-text :deep(.d2h-info) {
  display: none;
}
.diff-text :deep(.d2h-file-wrapper) {
  border: none;
  margin: 0;
}
.diff-text :deep(.d2h-diff-table) {
  font-family: inherit;
}
.diff-text :deep(.d2h-code-line-ctn) {
  padding: 8px 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
.diff-text :deep(.d2h-code-side-linenumber),
.diff-text :deep(.d2h-code-linenumber) {
  display: none;
}
.diff-text :deep(.d2h-ins) {
  background-color: var(--el-color-success-light-9);
}
.diff-text :deep(.d2h-del) {
  background-color: var(--el-color-danger-light-9);
}
@media (max-width: 768px) {
  .diff-text :deep(.d2h-code-line-ctn) {
    padding: 6px 8px;
    font-size: 13px;
  }
}
</style>
