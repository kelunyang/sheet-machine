<template>
  <el-drawer
    v-model="show"
    title="你正在處理多選欄位"
    direction="btt"
    :show-close="false"
    size="90%"
  >
    <el-space direction="vertical" fill wrap style="width: 100%">
      <el-alert title="勾選數量限制" type="info" show-icon>
        <template #default>
          <span style="font-size: 1.5em">
            請從 {{ options.length }} 項中
            {{ maxNum > 0 ? '挑出至多' + maxNum + '項' : '挑出你要的項目（數量不限）' }}，
            點一下左邊（候選）的選項即可移入右邊（已選），已選區可用每列的按鈕（或直接拖曳）調整順序
          </span>
        </template>
      </el-alert>
      <div>欄位名稱：{{ columnName }}</div>
      <div class="transfer-container">
        <div class="transfer-panel">
          <div class="panel-header">
            <div class="panel-title">候選名單（{{ availableItems.length }}）</div>
            <el-input
              v-model="filterQuery"
              placeholder="在此可以打字搜尋"
              clearable
              size="large"
            />
          </div>
          <transition-group name="available" tag="div" class="panel-body">
            <div
              v-for="item in filteredAvailable"
              :key="item"
              class="item-card"
              :class="{ disabled: maxReached }"
              @click="moveToSelected(item)"
            >
              <div class="item-label">{{ item }}</div>
              <div class="move-icon">→</div>
            </div>
            <div v-if="filteredAvailable.length === 0" key="empty-available" class="empty-tip">
              {{ availableItems.length === 0 ? '所有選項都已選擇' : '沒有符合搜尋的選項' }}
            </div>
          </transition-group>
        </div>
        <div class="transfer-panel">
          <div class="panel-header">
            <div class="panel-title">
              已選名單（{{ selected.length }}{{ maxNum > 0 ? '／至多' + maxNum : '' }}）
            </div>
            <div class="panel-hint">第1個在最上方，順序就是送出的順序</div>
          </div>
          <transition-group name="chosen" tag="div" class="panel-body">
            <div
              v-for="(item, index) in selected"
              :key="item"
              class="item-card selected-item"
              :class="{ dragging: draggedIndex === index }"
              draggable="true"
              @dragstart="handleDragStart(index, $event)"
              @dragover.prevent
              @drop="handleDrop(index, $event)"
              @dragend="draggedIndex = null"
            >
              <div class="rank-badge">{{ index + 1 }}</div>
              <div class="item-label">{{ item }}</div>
              <div class="item-actions">
                <button
                  type="button"
                  :disabled="index === 0"
                  title="上移"
                  @click.stop="moveSelected(index, 'up')"
                >
                  ↑
                </button>
                <button
                  type="button"
                  :disabled="index === selected.length - 1"
                  title="下移"
                  @click.stop="moveSelected(index, 'down')"
                >
                  ↓
                </button>
                <button
                  type="button"
                  class="remove-btn"
                  title="移出已選"
                  @click.stop="removeSelected(index)"
                >
                  ✕
                </button>
              </div>
            </div>
            <div v-if="selected.length === 0" key="empty-selected" class="empty-tip">
              還沒有選任何項目，請從候選名單點選
            </div>
          </transition-group>
        </div>
      </div>
      <el-button class="ma1 pa2 xs12" size="large" type="danger" @click="endSelection()"
        >選擇完畢！</el-button
      >
      <el-button class="ma1 pa2 xs12" size="large" type="primary" @click="show = false"
        >放棄選擇，回到上一頁</el-button
      >
    </el-space>
  </el-drawer>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import _ from 'lodash';
import { moveItem, reorderItem } from '../utils/multiSelect';

const show = defineModel('show', { type: Boolean, default: false });

const props = defineProps({
  // U 格式欄位（content = "maxNum::選項1;選項2..."，value = "選項1;選項2"）
  column: { type: Object, default: null },
});

// 選擇完畢時把排序後的選項陣列丟回去，App 負責回寫 columnDB + 驗證
const emit = defineEmits(['done']);

const columnName = ref('');
const options = ref([]);
const selected = ref([]);
const maxNum = ref(0);
const filterQuery = ref('');
const draggedIndex = ref(null);

// 每次打開 drawer 都從 column 重新初始化，放棄選擇再進來不會殘留上次的操作
watch(show, (open) => {
  if (open && props.column) {
    const config = props.column.content.split('::');
    maxNum.value = parseInt(config[0]) || 0;
    options.value = _.uniq(config[1].split(';'));
    selected.value = _.uniq(props.column.value.split(';')).filter((item) =>
      options.value.includes(item)
    );
    columnName.value = props.column.name;
    filterQuery.value = '';
    draggedIndex.value = null;
  }
});

const availableItems = computed(() => {
  return options.value.filter((item) => !selected.value.includes(item));
});

const filteredAvailable = computed(() => {
  if (filterQuery.value === '') {
    return availableItems.value;
  }
  return availableItems.value.filter((item) => item.includes(filterQuery.value));
});

const maxReached = computed(() => {
  return maxNum.value > 0 && selected.value.length >= maxNum.value;
});

function moveToSelected(item) {
  if (maxReached.value) {
    ElMessage('最多只能選' + maxNum.value + '項，要換選項請先從已選名單移出');
    return;
  }
  selected.value = [...selected.value, item];
}

function removeSelected(index) {
  selected.value = selected.value.filter((item, i) => i !== index);
}

function moveSelected(index, direction) {
  selected.value = moveItem(selected.value, index, direction);
}

function handleDragStart(index, event) {
  draggedIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
}

function handleDrop(dropIndex, event) {
  event.preventDefault();
  if (draggedIndex.value === null) {
    return;
  }
  selected.value = reorderItem(selected.value, draggedIndex.value, dropIndex);
  draggedIndex.value = null;
}

function endSelection() {
  emit('done', [...selected.value]);
  show.value = false;
}
</script>

<style scoped>
.transfer-container {
  display: flex;
  gap: 16px;
  align-items: stretch;
}

.transfer-panel {
  flex: 1;
  min-width: 0;
  border: 2px solid #e1e8ed;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  min-height: 300px;
}

.panel-header {
  background: #f8f9fa;
  padding: 12px 16px;
  border-bottom: 1px solid #e1e8ed;
  flex-shrink: 0;
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
  color: #2c3e50;
  margin-bottom: 6px;
}

.panel-hint {
  font-size: 12px;
  color: #7f8c8d;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  max-height: 45vh;
  padding: 10px;
  position: relative;
}

.item-card {
  display: flex;
  align-items: center;
  padding: 12px 15px;
  margin-bottom: 8px;
  border: 1px solid #e1e8ed;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.3s;
  background: white;
}

.item-card:hover:not(.disabled):not(.selected-item) {
  border-color: #3498db;
  background: #f0f8ff;
  transform: translateX(2px);
}

.item-card.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: #f5f5f5;
}

.selected-item {
  border-color: #28a745;
  background: #f8fff9;
  cursor: grab;
}

.selected-item:active {
  cursor: grabbing;
}

.selected-item.dragging {
  opacity: 0.5;
  transform: rotate(2deg);
}

.item-label {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  line-height: 1.4;
  color: #2c3e50;
  word-break: break-word;
}

.move-icon {
  color: #666;
  padding: 0 8px;
  font-size: 16px;
}

.rank-badge {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  margin-right: 12px;
  flex-shrink: 0;
}

.item-actions {
  display: flex;
  gap: 4px;
  margin-left: 8px;
}

.item-actions button {
  background: #f8f9fa;
  border: 1px solid #e1e8ed;
  border-radius: 4px;
  cursor: pointer;
  color: #2c3e50;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 手機可點目標至少 32px */
  min-width: 32px;
  height: 32px;
  font-size: 14px;
}

.item-actions button:hover:not(:disabled) {
  background: #e9ecef;
  border-color: #999;
}

.item-actions button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.item-actions .remove-btn {
  color: #dc3545;
}

.item-actions .remove-btn:hover:not(:disabled) {
  background: #f8d7da;
  border-color: #dc3545;
}

.empty-tip {
  text-align: center;
  color: #7f8c8d;
  padding: 30px 10px;
  font-style: italic;
}

/* 手機：左右並排轉上下堆疊 */
@media (max-width: 768px) {
  .transfer-container {
    flex-direction: column;
  }

  .panel-body {
    max-height: 30vh;
  }
}

/* 方向性過渡動畫：候選區往右消失、已選區從左進入 */
.available-move,
.chosen-move {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.available-enter-active,
.chosen-enter-active {
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.available-enter-from,
.chosen-leave-to {
  opacity: 0;
  transform: translateX(30px);
}

.available-leave-active,
.chosen-leave-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  position: absolute;
  width: calc(100% - 20px);
}

.available-leave-to {
  opacity: 0;
  transform: translateX(30px);
}

.chosen-enter-from {
  opacity: 0;
  transform: translateX(-30px);
}
</style>
