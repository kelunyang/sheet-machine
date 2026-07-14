<template>
  <div class="field-switch" v-if="options.length > 1">
    <!-- 「與上次送出不同」不在這裡：它跟填答狀態圖示同一組，掛在 FormField 的左側狀態邊界條上 -->
    <el-segmented
      v-model="source"
      :options="options"
      size="small"
      :disabled="!enableModify"
      class="field-switch__seg"
    />
    <!-- 檔案欄的值進不了輸入框（value 是 fileID／哨兵），這裡把選中來源的檔案連結攤出來 -->
    <div v-if="isFileField(column) && fileHint !== ''" class="field-switch__hint">
      <span>{{ fileHint }}</span>
      <el-link v-if="fileUrl !== ''" :href="fileUrl" target="_blank">
        <el-icon><i class="fa-solid fa-eye"></i></el-icon>開啟檔案
      </el-link>
    </div>
    <div v-else-if="source === 'draft'" class="field-switch__hint">
      這格是從「{{ draftSourceText(column) }}」還原的（線上暫存不代表最終結果，正式結果以已送出的紀錄為準）
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import {
  buildSourceOptions,
  currentSource,
  applySource,
  draftSourceText,
  fileUrlOfSource,
  isFileField,
} from '../utils/fieldSources';
import { validateColumn } from '../utils/columnRules';
import { REUSE_LAST_FILE } from '../utils/sentinels';

// 每題的「答案來源」切換器（Phase 23）：el-segmented 四個選項——
// 預設值／你上次的／暫存／你現在填的。**切換就自動帶入該來源的值**（不必再按帶入鈕）；
// 沒有值的來源不長出選項，「你現在填的」在使用者真的動手前是 disabled。
// 取代原本每題固定兩行的唯讀文字（[系統原本儲存的答案]／[你上次輸入的答案]，空值也佔版面）。
// 只有一個選項時整條不顯示（＝這題只有「你現在填的」，沒有版本可切）。
const props = defineProps({
  column: { type: Object, required: true },
  columnDb: { type: Array, required: true },
  enableModify: { type: Boolean, default: false },
});

const options = computed(() => buildSourceOptions(props.column));

const source = computed({
  get: () => currentSource(props.column),
  set: (kind) => {
    applySource(props.column, kind);
    validateColumn(props.column, props.columnDb);
  },
});

// 檔案欄：目前選的來源代表哪一個檔案（連結由 fileUrlOfSource 依來源決定——
// 「沿用上次」指向上次送出的檔案、新上傳指向 uploadUrl，兩者不可混用）
const fileHint = computed(() => {
  if (!isFileField(props.column)) return '';
  if (props.column.value === REUSE_LAST_FILE) return '沿用上次上傳的檔案';
  if (props.column.value !== '') return '你這次上傳的檔案';
  if (source.value === 'last') return '你上次提供的檔案';
  return '';
});
const fileUrl = computed(() => fileUrlOfSource(props.column, source.value));
</script>

<style scoped>
.field-switch {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
/* 手機上選項多時要能縮，不撐爆版面 */
.field-switch__seg {
  max-width: 100%;
}
.field-switch__hint {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  color: var(--el-text-color-secondary);
  font-size: 0.9em;
}
</style>
