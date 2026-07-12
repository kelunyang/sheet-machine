<template>
  <div class="sheet-card" :class="{ 'is-closed': !sheet.writeAllowed }">
    <div class="sc-top">
      <div class="sc-title">
        <el-tag
          v-for="tag in sheet.tags"
          :key="tag.id"
          :color="tag.color.background"
          :style="{ margin: '1px', color: tag.color.text, borderColor: tag.color.background }"
          effect="dark"
        >
          {{ tag.name }}
        </el-tag>
        <span class="sc-name">{{ sheet.name }}</span>
      </div>
    </div>
    <div class="sc-board">
      <div class="sc-flow">
        <template v-for="(node, index) in chips" :key="node.type + index">
          <el-icon v-if="index > 0" class="sc-arrow" aria-hidden="true"><i class="fa-solid fa-chevron-right"></i></el-icon>
          <span class="sc-node" :class="'sc-tone-' + node.tone">
            <span class="sc-node-box" :class="'sc-box-' + node.type">{{ node.label }}</span>
          </span>
        </template>
      </div>
      <div v-if="startNode || endNode" class="sc-dates">
        <span v-if="startNode" class="sc-date-start">{{ startNode.sub }}</span>
        <span
          v-if="endNode"
          class="sc-date-end"
          :class="endNode.subTone ? 'sc-sub-' + endNode.subTone : ''"
          >{{ endNode.sub }}</span
        >
      </div>
    </div>
    <div class="sc-actions">
      <el-button
        class="sc-enter"
        size="large"
        type="primary"
        :disabled="!sheet.writeAllowed"
        v-on:click="$emit('open')"
      >
        {{ enterLabel }}
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { buildFlowChips } from '../utils/sheetFlow.js';

// 問卷列表卡片（Phase 14）：版面骨架挪用 scoringSystem-cf 的 ProjectCard
// （標題＋流程看板串＋動作列），但看板串是純靜態預覽——問卷沒有「當前階段」，
// 不搬 LED 開車與 matter.js 彈跳。「簽名 ×n」chip 只在有簽名格的問卷出現。
// 右上角提醒已退役：急迫度改由結束日期的文字色（灰/橘/磚紅）表達，
// 開卡當下算一次、不自跑 tick（列表停留短，即時感留給進場後的 LifecycleTimeline）。
// 起訖日期已與看板串脫鉤：看板串只放格子（尺寸固定、不被長日期撐寬留白），
// 日期另成一列、起始靠左結束靠右，對到看板串首尾格的水平位置
const props = defineProps({
  // getQList 帶回的單筆問卷（含 tags/createdAt/dueDate/viewDate/writeAllowed/signatures）
  sheet: { type: Object, required: true },
});

defineEmits(['open']);

const chips = computed(() => buildFlowChips(props.sheet, Date.now()));

// 起訖日期脫鉤成獨立列：從看板串挑出帶日期的首（開始）尾（結束）節點
const startNode = computed(() => chips.value.find((n) => n.type === 'start' && n.sub));
const endNode = computed(() => chips.value.find((n) => n.type === 'end' && n.sub));

// 沿用舊表格 viewCheck 的語意：已過 dueDate（含 dueDate=0）只剩檢視
const enterLabel = computed(() => {
  return props.sheet.dueDate <= Date.now() ? '檢視表單' : '填寫&檢視表單';
});
</script>

<style scoped>
.sheet-card {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-bg-color);
  padding: 14px 16px;
  transition:
    transform 0.2s,
    box-shadow 0.2s;
}

.sheet-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--el-box-shadow-light);
  /* 淡黃（色表奶油米）：hover 底色，與 el-alert 同一暖色，整體感一致 */
  background: var(--sm-alert-bg);
}

.sheet-card.is-closed {
  background: var(--el-fill-color-light);
}

.sc-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 10px;
}

.sc-title {
  min-width: 0;
}

.sc-name {
  font-weight: bold;
  font-size: 1.1em;
  color: var(--el-text-color-primary);
  overflow-wrap: anywhere;
}

/* 看板板塊：看板串＋日期列打包成同寬區塊（fit-content 貼齊看板串實際寬度，
   非整張卡寬），日期列才能對到看板串首尾格、結束日期不會被丟到整卡最右邊；
   窄螢幕由 max-width:100% 收邊、看板串自己橫捲 */
.sc-board {
  width: fit-content;
  max-width: 100%;
  min-width: 0;
}

/* 流程看板串：靜態預覽，手機窄幅時整條橫向捲動。
   只放格子＋箭頭（日期已脫鉤到下方 .sc-dates），格子照 label 寬度貼齊、
   不被長日期撐寬（原本日期掛格子下方會把窄 label 的節點兩旁撐出無意義留白） */
.sc-flow {
  display: flex;
  align-items: center;
  gap: 8px;
  /* min-width:0 讓看板串在窄螢幕能縮到卡片寬、由自己的 overflow-x 橫捲，不撐爆卡片 */
  min-width: 0;
  overflow-x: auto;
  white-space: nowrap;
  padding: 2px 0 6px;
  margin-bottom: 4px;
  scrollbar-width: thin;
}

.sc-node {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

/* 起訖框：色表石墨灰（框架色，襯托磚紅的填寫/簽名 chip） */
.sc-node-box {
  padding: 5px 12px;
  border: 2px solid var(--el-color-info-light-5);
  border-radius: 4px;
  background: var(--el-color-info-light-9);
  font-size: 14px;
  font-weight: bold;
  color: var(--el-color-info);
}

/* 起訖日期：脫離看板串、自成一列（避免長日期把窄格子撐寬、兩旁留白）。
   width:100% 撐到 .sc-board 寬（＝看板串寬）而非整卡寬，起始靠左、結束靠右
   才會各自對到看板串首尾格；結束日期依急迫度變色 */
.sc-dates {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 0 2px;
  margin-bottom: 10px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.sc-date-end {
  margin-left: auto;
  text-align: right;
}

/* 中段 chip（填寫/簽名）：色表磚紅（珊瑚紅），與灰底起訖標記形成灰＋磚紅雙色 */
.sc-tone-normal .sc-box-chip {
  border-color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}

/* 已截止/關閉/不開放：整條方框轉灰（日期小字色由 subTone 決定，維持可讀次要灰） */
.sc-tone-muted .sc-node-box {
  border-color: var(--el-color-info-light-7);
  color: var(--el-text-color-placeholder);
  background: transparent;
}

/* 結束日期依急迫度變色（方框不變）：剩<10分橘、已截止磚紅；充裕維持 base 次要灰 */
.sc-sub-warning {
  color: var(--sm-warning-on-light);
}

.sc-sub-danger {
  color: var(--el-color-danger);
}

/* 箭頭高度對齊格子（border 2×2 + padding 5×2 + 文字行高 ≈ 33px）；色表石墨灰 */
.sc-arrow {
  flex-shrink: 0;
  height: 33px;
  color: var(--el-color-info-light-5);
  font-size: 14px;
}

.sc-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.sc-enter {
  margin-left: auto;
}

@media (max-width: 768px) {
  .sc-node-box {
    padding: 4px 9px;
    font-size: 13px;
  }

  .sc-arrow {
    height: 30px;
  }
}
</style>
