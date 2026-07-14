<template>
  <div class="form-field" :class="{ 'has-status-bar': showStatusBar }">
    <!-- 左側狀態邊界條：一條狀態色的細邊界（＝這一題到哪裡為止），頂端一個圖示標填答狀態
         （已回答／未回答／格式錯誤…）。文字說明走 tooltip，不佔版面 -->
    <div v-if="showStatusBar" class="form-field__status" :class="'is-' + fieldStatus.status">
      <el-tooltip :content="fieldStatus.result" placement="right">
        <span class="form-field__status-icon" role="img" :aria-label="fieldStatus.result">
          <i class="fa-solid" :class="STATUS_ICON[fieldStatus.status]"></i>
        </span>
      </el-tooltip>
      <!-- 這題跟上次送出的不一樣：接在狀態圖示下面，同一組標記（不佔題目的橫向版面） -->
      <el-tooltip v-if="showDiffMark" content="與上次送出不同" placement="right">
        <span class="form-field__diff-icon" role="img" aria-label="與上次送出不同">
          <i class="fa-solid fa-pen"></i>
        </span>
      </el-tooltip>
      <span class="form-field__status-line"></span>
    </div>
  <el-space direction="vertical" fill wrap class="ma1 pa2 xs12 breakword form-field__body">
    <el-alert :title="column.name" type="info" show-icon v-if="formatDetector('M', 'C', column)">
      <template #default>
        <span style="font-size: 1.5em" v-html="htmlConverter(column.content)"></span>
      </template>
    </el-alert>
    <div
      v-if="!/G/.test(column.type)"
      v-show="!formatDetector('M', 'C', column)"
      class="qTitle xs12"
    >
      {{ column.name }}
    </div>
    <!-- 唯讀展示欄（type=C）：直接把值攤出來給人看，沒有「答案來源」可切
         C-S 計算欄＝即時運算結果；C-T＝名冊該欄的文字；C-F＝名冊指定的檔案 -->
    <div v-if="formatDetector('S', 'C', column)" class="xs12 breakword">
      {{ sumUp(column, columnDb) }}
    </div>
    <div v-if="formatDetector('T', 'C', column)" class="xs12 breakword">
      {{ column.savedContent }}
    </div>
    <div v-if="formatDetector('F', 'C', column)" class="xs12 breakword">
      <el-link v-if="column.savedContent !== ''" :href="column.savedContent" target="_blank">
        <el-icon><i class="fa-solid fa-eye"></i></el-icon>系統提供的檔案（點擊開啟新分頁）
      </el-link>
      <span v-else class="captionWord">（系統沒有提供你對應的檔案）</span>
    </div>
    <!-- 作答欄（type=F）：答案來源切換器（預設值／你上次的／暫存／你現在填的，切了就自動帶入） -->
    <FieldValueSwitch
      v-if="formatDetector('', 'F', column)"
      :column="column"
      :column-db="columnDb"
      :enable-modify="enableModify"
    />
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
      >點此上傳檔案{{ uploadBtnState }}</el-button
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
  </div>
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
import { REUSE_LAST_FILE } from '../utils/sentinels';
import { markUserInput, differsFromLast } from '../utils/fieldSources';
import FieldValueSwitch from './FieldValueSwitch.vue';

const props = defineProps({
  // 單一欄位物件（就地驗證會改寫 column.status / column.value）
  column: { type: Object, required: true },
  // 整份 columnDB：群組驗證與 C-S 計算欄需要
  columnDb: { type: Array, required: true },
  enableModify: { type: Boolean, default: false },
});

defineEmits(['query-pc', 'upload-file', 'multi-select']);

// 左側狀態邊界條：只有作答欄（F-type）有；說明欄（M-C）與分組欄（G）不是題目，不掛
const showStatusBar = computed(() => formatDetector('', 'F', props.column));
const fieldStatus = computed(
  () => statusDetector(props.column) || { status: 'info', result: '' }
);
// statusDetector 的四種 status 各配一個 FA 圖示（顏色由 CSS 的 .is-* 給）
const STATUS_ICON = {
  success: 'fa-circle-check',
  danger: 'fa-circle-exclamation',
  warning: 'fa-circle-half-stroke',
  info: 'fa-circle-dot',
};

// 「與上次送出不同」：接在狀態圖示下面（只在可編輯時有意義——唯讀檢視沒有「這次要送出」這回事）
const showDiffMark = computed(() => props.enableModify && differsFromLast(props.column));

// 檔案上傳鈕三態：沿用上次（哨兵）／這次已上傳／無上傳
const uploadBtnState = computed(() => {
  if (props.column.value === REUSE_LAST_FILE) return '(沿用上次檔案)';
  return props.column.value !== '' ? '(已上傳)' : '(無上傳)';
});

// D 欄位「無資料」雙態按鈕：狀態純粹從 value 導出，不另存旗標
const isNoneDeclared = computed(() => noneDeclared(props.column));

function toggleNoData() {
  props.column.value = isNoneDeclared.value ? '' : '無資料';
  // 宣告「無資料」也是使用者動手填的答案，記進「你現在填的」
  markUserInput(props.column);
  validateColumn(props.column, props.columnDb);
}

// 輸入元件的 change：使用者動手了 → 當下的值記成「你現在填的」，來源切到 user
// （切去看別的來源再切回來不會弄丟它）
function validate() {
  markUserInput(props.column);
  validateColumn(props.column, props.columnDb);
}
</script>

<style scoped>
/* 每題＝左側狀態邊界條 ＋ 右側內容。邊界條是一條細線（撐滿題高，當「這題到哪為止」的界線——
   長問卷裡題與題原本黏成一片），頂端一個圖示標填答狀態；狀態文字走 tooltip，不佔版面。
   顏色一律走配色表變數（用 currentColor 讓線與圖示同色），不寫死 hex。 */
.form-field {
  display: flex;
  align-items: stretch;
  width: 100%;
}
.form-field__body {
  flex: 1;
  min-width: 0; /* 不讓長字串把 flex 子項撐爆 */
}
.form-field__status {
  flex: 0 0 auto;
  width: 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 0 4px;
}
.form-field__status-icon {
  font-size: 14px;
  line-height: 1;
  cursor: help;
}
/* 「與上次送出不同」永遠是 warning 色，不跟著 .is-* 的狀態色走
   （它講的是「這次改了什麼」，跟「填得對不對」是兩回事） */
.form-field__diff-icon {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1;
  cursor: help;
  color: var(--el-color-warning-dark-2);
}
.form-field__status-line {
  flex: 1;
  width: 3px;
  margin-top: 4px;
  border-radius: 2px;
  background: currentColor;
  opacity: 0.55; /* 線比圖示淡一階：圖示是重點，線只是界線 */
}
.form-field__status.is-success {
  color: var(--el-color-success-dark-2);
}
.form-field__status.is-danger {
  color: var(--el-color-danger-dark-2);
}
.form-field__status.is-warning {
  color: var(--el-color-warning-dark-2);
}
.form-field__status.is-info {
  color: var(--el-text-color-secondary);
}

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
