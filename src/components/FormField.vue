<template>
  <el-space direction="vertical" fill wrap class="ma1 pa2 xs12 breakword">
    <el-alert :title="column.name" type="info" show-icon v-if="formatDetector('M', 'C', column)">
      <template #default>
        <span style="font-size: 1.5em" v-html="htmlConverter(column.content)"></span>
      </template>
    </el-alert>
    <el-tag v-if="formatDetector('', 'F', column)" :type="statusDetector(column).status">{{
      statusDetector(column).result
    }}</el-tag>
    <div
      v-if="!/G/.test(column.type)"
      v-show="!formatDetector('M', 'C', column)"
      class="qTitle xs12"
    >
      {{ column.name }}
    </div>
    <div
      v-if="!/G/.test(column.type)"
      v-show="!formatDetector('M', 'C', column)"
      class="xs12 breakword"
    >
      <span class="oriTip">
        {{
          formatDetector('F', 'C|F', column)
            ? '[系統原本儲存的檔案（點擊開啟新連結）]'
            : formatDetector('S', 'C', column)
              ? ''
              : '[系統原本儲存的答案]'
        }}
      </span>
      <span v-if="formatDetector('F', 'F|C', column) || formatDetector('S', 'C', column)">
        <el-link
          v-if="formatDetector('F', 'C|F', column)"
          :href="column.savedContent"
          target="_blank"
          ><el-icon><i class="fa-solid fa-eye"></i></el-icon>{{ column.savedContent }}</el-link
        >
        <span v-if="formatDetector('S', 'C', column)">{{ sumUp(column, columnDb) }}</span>
      </span>
      <span v-else>
        {{ column.savedContent }}
      </span>
    </div>
    <div v-if="!/G/.test(column.type)" class="xs12 breakword" v-show="column.lastInput !== undefined">
      <span class="oriTip">
        {{
          formatDetector('F', 'F', column)
            ? column.value === ''
              ? '[你上次提供的檔案（點擊開啟新連結）]'
              : '[你剛剛上傳的檔案（點擊開啟新連結）]'
            : '[你上次輸入的答案]'
        }}
      </span>
      <span v-if="formatDetector('F', 'F', column)">
        <el-link :href="column.lastInput" target="_blank"
          ><el-icon><i class="fa-solid fa-eye"></i></el-icon>{{ column.lastInput }}</el-link
        >
      </span>
      <span v-else>{{ column.lastInput }}</span>
    </div>
    <el-input
      v-show="enableModify"
      v-if="formatDetector('I|M|N|T|E|P', 'F', column)"
      size="large"
      class="xs12"
      :label="column.name"
      v-model="column.value"
      v-on:change="validate()"
      :disabled="isNoneDeclared"
      outline
    >
    </el-input>
    <el-input
      v-show="enableModify"
      v-if="formatDetector('X', 'F', column)"
      size="large"
      class="xs12"
      :label="column.name"
      v-model="column.value"
      v-on:change="validate()"
      :disabled="isNoneDeclared"
      :autosize="{ minRows: column.content[2], maxRows: column.content[3] }"
      show-word-limit
      :maxlength="column.content[0]"
      :minlength="column.content[1]"
      type="textarea"
      outline
    >
    </el-input>
    <el-select
      v-show="enableModify"
      v-if="formatDetector('S', 'F', column)"
      v-model="column.value"
      class="xs12"
      :placeholder="column.name"
      v-on:change="validate()"
      :disabled="isNoneDeclared"
      size="large"
    >
      <el-option
        v-for="item in column.content.split(';')"
        :key="item + column.tid + 'key'"
        :label="item"
        :value="item"
      />
    </el-select>
    <el-slider
      v-show="enableModify"
      v-if="formatDetector('L', 'F', column)"
      v-model="column.value"
      v-on:change="validate()"
      size="large"
      input-size="large"
      :step="column.content[0]"
      :min="column.content[1]"
      :max="column.content[2]"
      show-input
      show-stops
    />
    <el-button
      v-show="enableModify"
      v-if="formatDetector('P', 'F', column)"
      class="ma1 pa2 xs12"
      size="large"
      type="success"
      :disabled="isNoneDeclared"
      v-on:click="$emit('query-pc', column)"
    >
      按此自動填入郵遞區號（但你得自己確認對不對）
    </el-button>
    <el-button
      v-show="enableModify"
      v-if="formatDetector('F', 'F', column)"
      class="ma1 pa2 xs12"
      size="large"
      type="success"
      :disabled="isNoneDeclared"
      v-on:click="$emit('upload-file', column)"
      >點此上傳檔案{{ column.value !== '' ? '(已上傳)' : '(無上傳)' }}</el-button
    >
    <el-button
      v-show="enableModify"
      v-if="formatDetector('U', 'F', column)"
      class="ma1 pa2 xs12"
      size="large"
      type="success"
      :disabled="isNoneDeclared"
      v-on:click="$emit('multi-select', column)"
      >點此挑選你要的選項[{{
        column.value !== '' ? '已選' + column.value.split(';').length : '無選擇'
      }}]</el-button
    >
    <el-button
      v-show="enableModify"
      v-if="column.noneable && formatDetector('', 'F', column)"
      class="ma1 pa2 xs12 no-data-btn"
      :class="{ 'is-declared': isNoneDeclared }"
      size="large"
      v-on:click="toggleNoData()"
      >{{ isNoneDeclared ? '已填「無資料」（點此改回手動輸入）' : '這題我沒有資料' }}</el-button
    >
    <div v-show="enableModify" class="captionWord" v-if="column.nullable">這個欄位可以留空</div>
    <div v-show="enableModify" class="captionWord" v-if="column.group !== ''">
      {{ groupTip(column, columnDb) }}
    </div>
    <div v-show="enableModify" class="alertWord" v-if="column.status !== ''">
      {{ column.status }}
    </div>
    <div v-show="enableModify" class="captionWord" v-if="column.status === ''">
      {{ formatHelper(column) }}
    </div>
  </el-space>
</template>

<script setup>
import { computed } from 'vue';
import { htmlConverter } from '../utils/markdown';
import {
  formatDetector,
  formatHelper,
  statusDetector,
  groupTip,
  sumUp,
  validateColumn,
  noneDeclared,
} from '../utils/columnRules';

const props = defineProps({
  // 單一欄位物件（就地驗證會改寫 column.status / column.value）
  column: { type: Object, required: true },
  // 整份 columnDB：群組驗證與 C-S 計算欄需要
  columnDb: { type: Array, required: true },
  enableModify: { type: Boolean, default: false },
});

defineEmits(['query-pc', 'upload-file', 'multi-select']);

// D 欄位「無資料」雙態按鈕：狀態純粹從 value 導出，不另存旗標
const isNoneDeclared = computed(() => noneDeclared(props.column));

function toggleNoData() {
  props.column.value = isNoneDeclared.value ? '' : '無資料';
  validateColumn(props.column, props.columnDb);
}

function validate() {
  validateColumn(props.column, props.columnDb);
}
</script>

<style scoped>
/* D 欄位「無資料」雙態按鈕：配色一律取自全域配色表變數（src/theme/colors.config.js）。
   用 .el-button.no-data-btn 兩類名提高權重，穩壓 Element Plus 預設的 .el-button 變數，
   靠設定 --el-button-* 自訂屬性上色（EP 內部樣式讀這些變數，含 hover/active）。
   未宣告態：奶油米底（--sm-alert-bg）＋深珊瑚紅框字（--el-color-danger-dark-2）——
   純珊瑚紅 --el-color-danger 疊奶油米僅 4.19:1 不及 AA，故框字用深一階（實測 5.80:1）。 */
.el-button.no-data-btn {
  --el-button-bg-color: var(--sm-alert-bg);
  --el-button-border-color: var(--el-color-danger-dark-2);
  --el-button-text-color: var(--el-color-danger-dark-2);
  --el-button-hover-bg-color: var(--el-color-danger-light-9);
  --el-button-hover-border-color: var(--el-color-danger-dark-2);
  --el-button-hover-text-color: var(--el-color-danger-dark-2);
  --el-button-active-bg-color: var(--el-color-danger-light-9);
  --el-button-active-border-color: var(--el-color-danger-dark-2);
  --el-button-active-text-color: var(--el-color-danger-dark-2);
}
/* 已宣告「無資料」態：實心珊瑚紅反白（白字疊珊瑚紅實測 5.44:1，AA 合規），
   一眼看出「已選無資料」是啟用狀態（沿用原 :plain 兩態的視覺區分意圖）。 */
.el-button.no-data-btn.is-declared {
  --el-button-bg-color: var(--el-color-danger);
  --el-button-border-color: var(--el-color-danger);
  --el-button-text-color: #ffffff;
  --el-button-hover-bg-color: var(--el-color-danger-dark-2);
  --el-button-hover-border-color: var(--el-color-danger-dark-2);
  --el-button-hover-text-color: #ffffff;
  --el-button-active-bg-color: var(--el-color-danger-dark-2);
  --el-button-active-border-color: var(--el-color-danger-dark-2);
  --el-button-active-text-color: #ffffff;
}
</style>
