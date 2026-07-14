<template>
  <el-drawer
    v-model="innerShow"
    title="送出前確認"
    direction="btt"
    size="100%"
    :with-header="false"
    body-class="drawer-flow-body"
  >
    <div class="drawer-flow-title">
      <span>送出前確認：這次要送出的內容</span>
      <el-button text circle aria-label="關閉" @click="emit('back')">
        <el-icon><i class="fa-solid fa-xmark"></i></el-icon>
      </el-button>
    </div>
    <el-alert title="請先核對差異再往下走" type="warning" show-icon :closable="false">
      <template #default>
        <span style="font-size: 1.2em">
          左邊是{{ baselineLabel }}、右邊是這次要送出的內容（手機為上下對照）。
          <span class="diff-legend diff-legend--del">紅底</span>是原本的內容、
          <span class="diff-legend diff-legend--ins">綠底</span>是這次改成的內容。
        </span>
      </template>
    </el-alert>
    <div class="baseline-switch">
      <span class="baseline-switch__label">比對基準</span>
      <el-segmented v-model="baselineMode" :options="BASELINE_OPTIONS" size="default" />
    </div>
    <DiffText
      :old-text="oldText"
      :new-text="newText"
      :old-title="baselineLabel"
      :new-title="'這次要送出的內容'"
    />
    <!-- 檔案欄位：內容比不了，改左右對照（比照上方文字 diff 的左舊右新）——
         第一列題目，第二列兩欄：左＝之前的檔案、右＝這次要送出的 -->
    <div v-if="fileRows.length > 0" class="file-compare">
      <div class="qTitle">檔案欄位（內容無法逐行比對，只對照前後的檔案）</div>
      <div v-for="row in fileRows" :key="row.name" class="file-compare__row">
        <div class="file-compare__name">{{ row.name }}</div>
        <div class="file-compare__cols">
          <div class="file-compare__col is-before">
            <div class="file-compare__label">{{ baselineLabel }}</div>
            <el-link v-if="row.beforeUrl !== ''" :href="row.beforeUrl" target="_blank">
              <el-icon><i class="fa-solid fa-eye"></i></el-icon>開啟檔案
            </el-link>
            <span v-else class="file-compare__none">（原本沒有檔案）</span>
          </div>
          <div class="file-compare__col is-after">
            <div class="file-compare__label">這次要送出的</div>
            <template v-if="row.after.kind === 'new'">
              <el-tag type="success" size="small">這次新上傳</el-tag>
              <el-link v-if="row.after.url !== ''" :href="row.after.url" target="_blank">
                <el-icon><i class="fa-solid fa-eye"></i></el-icon>開啟檔案
              </el-link>
            </template>
            <template v-else-if="row.after.kind === 'reuse'">
              <el-tag type="info" size="small">沿用上次的檔案</el-tag>
              <el-link v-if="row.after.url !== ''" :href="row.after.url" target="_blank">
                <el-icon><i class="fa-solid fa-eye"></i></el-icon>開啟檔案
              </el-link>
            </template>
            <span v-else class="file-compare__none">（不附檔案）</span>
          </div>
        </div>
      </div>
    </div>
    <!-- footer 比照填問卷 drawer：兩顆按鈕各半寬，次要動作靠前、主要動作靠後 -->
    <template #footer>
      <div class="formFooter">
        <div class="formFooter__buttons">
          <el-button size="large" type="info" @click="emit('back')">
            有地方要改，回去修改
          </el-button>
          <el-button size="large" type="primary" @click="emit('confirm')">
            我核對過了，繼續下一步
          </el-button>
        </div>
      </div>
    </template>
  </el-drawer>
</template>

<script setup>
import { ref, computed } from 'vue';
import DiffText from './DiffText.vue';
import { buildDiffText, buildFileComparison } from '../utils/submitDiff';

// 送出前的差異對照（Phase 23）：驗證通過後、簽名／確認之前的必經一步（零差異時 App.vue 會直接
// 跳過不開這個 drawer）。文字題走逐行 diff，檔案欄走前後連結對照（比不了內容）。
// 基準預設「你上次送出的」（沒送出過的人在 submitDiff 內自動退回系統預設值），
// 可用 el-segmented 切成「系統預設值」——與題目上的答案來源切換器同一種控制項
const props = defineProps({
  show: { type: Boolean, default: false },
  // 整份 columnDB；哪些欄進文字 diff、哪些進檔案對照由 utils/submitDiff 決定
  columns: { type: Array, required: true },
});
const emit = defineEmits(['update:show', 'confirm', 'back']);

const innerShow = computed({
  get: () => props.show,
  set: (v) => emit('update:show', v),
});

// value 與 utils/submitDiff 的 mode 一致（'last' / 'saved'）；label 與題目上的來源切換器同名詞
const BASELINE_OPTIONS = [
  { label: '你上次的', value: 'last' },
  { label: '預設值', value: 'saved' },
];
const baselineMode = ref('last');
const baselineLabel = computed(() =>
  baselineMode.value === 'last' ? '你上次送出的答案' : '系統預設值'
);

const oldText = computed(() => buildDiffText(props.columns, baselineMode.value, 'baseline'));
const newText = computed(() => buildDiffText(props.columns, baselineMode.value, 'current'));
const fileRows = computed(() => buildFileComparison(props.columns, baselineMode.value));
</script>

<style scoped>
.diff-legend {
  padding: 0 4px;
  border-radius: 3px;
}
.diff-legend--ins {
  background-color: var(--el-color-success-light-9);
}
.diff-legend--del {
  background-color: var(--el-color-danger-light-9);
}
/* 基準切換（el-segmented）：與題目上的答案來源切換器同一種控制項 */
.baseline-switch {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0;
}
.baseline-switch__label {
  color: var(--el-text-color-secondary);
}
/* footer 兩顆按鈕各半寬（比照 App.vue 填問卷 drawer 的 .formFooter__buttons；
   那份樣式是 scoped 的，這裡自帶一份同規格的） */
.formFooter__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.formFooter__buttons .el-button {
  flex: 1 1 auto;
  margin-left: 0;
}
.file-compare {
  margin-top: 20px;
}
.file-compare__row {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 10px;
}
/* 第一列：題目 */
.file-compare__name {
  font-weight: bold;
  padding: 8px 12px;
  background: var(--el-fill-color-lighter);
  border-bottom: 1px solid var(--el-border-color-lighter);
}
/* 第二列：固定左右兩欄對照（左舊右新，與上方文字 diff 的方向一致），
   任何螢幕寬都不折行——內容是短標籤＋連結，窄欄放得下 */
.file-compare__cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.file-compare__col {
  min-width: 0; /* 不讓內容撐爆 grid 欄 */
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
}
/* 底色沿用 diff 的語意：舊＝紅底、新＝綠底（配色表變數，不寫死 hex） */
.file-compare__col.is-before {
  background: var(--el-color-danger-light-9);
}
.file-compare__col.is-after {
  background: var(--el-color-success-light-9);
}
.file-compare__label {
  color: var(--el-text-color-secondary);
  font-size: 0.9em;
}
.file-compare__none {
  color: var(--el-text-color-secondary);
}
</style>
