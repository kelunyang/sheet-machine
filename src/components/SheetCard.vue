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
      <div class="sc-status">
        <div class="sc-status-line" :class="'sc-tone-' + status.write.tone">
          <span class="sc-dot"></span>
          <span class="sc-status-text">{{ status.write.text }}</span>
        </div>
        <div v-if="status.view" class="sc-status-line" :class="'sc-tone-' + status.view.tone">
          <span class="sc-dot"></span>
          <span class="sc-status-text">{{ status.view.text }}</span>
        </div>
      </div>
    </div>
    <div class="sc-flow">
      <template v-for="(node, index) in chips" :key="node.type + index">
        <el-icon v-if="index > 0" class="sc-arrow" aria-hidden="true"><i class="fa-solid fa-chevron-right"></i></el-icon>
        <span class="sc-node" :class="'sc-tone-' + node.tone">
          <span class="sc-node-box" :class="'sc-box-' + node.type">{{ node.label }}</span>
          <span v-if="node.sub" class="sc-node-sub">{{ node.sub }}</span>
        </span>
      </template>
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
import { sheetStatus, buildFlowChips } from '../utils/sheetFlow.js';

// 問卷列表卡片（Phase 14）：版面骨架挪用 scoringSystem-cf 的 ProjectCard
// （標題＋右上角色點狀態／流程看板串／動作列），但看板串是純靜態預覽——
// 問卷沒有「當前階段」，不搬 LED 開車與 matter.js 彈跳。
// 「簽名 ×n」chip 只在有簽名格的問卷出現，使用者選卷前就知道要簽名。
// 倒數在開卡當下算一次、不自跑 tick（列表停留短，即時感留給進場後的 LifecycleTimeline）
const props = defineProps({
  // getQList 帶回的單筆問卷（含 tags/createdAt/dueDate/viewDate/writeAllowed/signatures）
  sheet: { type: Object, required: true },
});

defineEmits(['open']);

const status = computed(() => sheetStatus(props.sheet, Date.now()));
const chips = computed(() => buildFlowChips(props.sheet, Date.now()));

// 沿用舊表格 viewCheck 的語意：已過 dueDate（含 dueDate=0）只剩檢視
const enterLabel = computed(() => {
  return props.sheet.dueDate <= Date.now() ? '檢視表單' : '填寫&檢視表單';
});
</script>

<style scoped>
.sheet-card {
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

/* 右上角：兩行「色點＋期限」直排靠右（可填寫至／可檢視至），
   色點機制挪用 ProjectCard 的 status-dot */
.sc-status {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  flex-shrink: 0;
}

.sc-status-line {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: bold;
  white-space: nowrap;
}

.sc-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentcolor;
}

.sc-tone-success {
  color: var(--el-color-success);
}

.sc-tone-warning {
  color: var(--el-color-warning);
}

.sc-tone-danger {
  color: var(--el-color-danger);
}

.sc-tone-info {
  color: var(--el-color-info);
}

/* 流程看板串：靜態預覽，手機窄幅時整條橫向捲動。
   起訖日期掛在格子外下方，所以整列頂端對齊、箭頭自己對到格子的垂直中心 */
.sc-flow {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  overflow-x: auto;
  white-space: nowrap;
  padding: 2px 0 6px;
  margin-bottom: 8px;
  scrollbar-width: thin;
}

.sc-node {
  display: inline-flex;
  flex-direction: column;
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

/* 起訖日期：格子外、下方小字 */
.sc-node-sub {
  font-size: 11px;
  margin-top: 3px;
  color: var(--el-text-color-secondary);
}

/* 中段 chip（填寫/簽名）：色表磚紅（珊瑚紅），與灰底起訖標記形成灰＋磚紅雙色 */
.sc-tone-normal .sc-box-chip {
  border-color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}

/* 已截止/關閉/不開放：整條轉灰 */
.sc-tone-muted .sc-node-box {
  border-color: var(--el-color-info-light-7);
  color: var(--el-text-color-placeholder);
  background: transparent;
}

.sc-tone-muted .sc-node-sub {
  color: var(--el-text-color-placeholder);
}

/* 已截止的結束標記：紅字（日期小字跟著紅） */
.sc-tone-danger .sc-node-box {
  border-color: var(--el-color-danger);
  color: var(--el-color-danger);
  background: transparent;
}

.sc-tone-danger .sc-node-sub {
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
  .sc-status-line {
    font-size: 12px;
  }

  .sc-node-box {
    padding: 4px 9px;
    font-size: 13px;
  }

  .sc-arrow {
    height: 30px;
  }
}
</style>
