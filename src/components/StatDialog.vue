<template>
  <el-drawer
    :show-close="false"
    v-model="dialog.show"
    direction="ttb"
    size="60%"
    :title="sheetName + '目前總填答率為：' + completeRate + '%'"
  >
    <el-space direction="vertical" fill wrap style="width: 100%">
      <ErrorAlert :message="errorMessage" />
      <el-table :data="stats" stripe style="width: 100%" :border="true" :highlight-current-row="true">
        <el-table-column prop="classno" label="" min-width="10%" />
        <el-table-column prop="rate" label="填答率" sortable :sort-method="rateSort" min-width="20%">
          <template #default="scope">
            <el-progress :percentage="scope.row.rate" :color="progressColor" />
          </template>
        </el-table-column>
        <el-table-column prop="unfinished" label="未完成者" min-width="70%" resizable />
      </el-table>
      <el-button
        class="ma1 pa2 xs12"
        size="large"
        type="primary"
        v-on:click="downloadCSV(stats, sheetName + '填寫率統計.csv', loadTick)"
        >匯出統計表</el-button
      >
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="close()"
        >關閉對話框</el-button
      >
    </el-space>
  </el-drawer>
</template>

<script setup>
import { ref, reactive, computed } from 'vue';
import dayjs from 'dayjs';
import _ from 'lodash';
import { gasRun } from '../composables/useGasRpc';
import { beginLoading } from '../composables/useLoadingGame';
import { downloadCSV } from '../utils/formatters';
import ErrorAlert from './ErrorAlert.vue';

const props = defineProps({
  // 目前開啟的問卷（compareSheets 需要 refer/record）
  sheet: { type: Object, default: null },
  sheetName: { type: String, default: '' },
});

const dialog = reactive({ show: false });
const stats = ref([]);
const loadTick = ref(0);
const errorMessage = ref('');

const progressColor = [
  { color: '#F56C6C', percentage: 20 },
  { color: '#FF9900', percentage: 40 },
  { color: '#E6A23C', percentage: 60 },
  { color: '#CCCC00', percentage: 80 },
  { color: '#67C23A', percentage: 100 },
];

const completeRate = computed(() => {
  if (stats.value.length > 0) {
    return _.meanBy(stats.value, (item) => {
      return parseInt(item.rate);
    }).toFixed(2);
  }
  return 0;
});

// 統計對話框的進入點；App 經 template ref 呼叫
async function open() {
  if (!props.sheet) {
    return;
  }
  // compareSheets 要掃整份 record 算填答率，跑得久——掛 loading 遊戲，進度不再另發 toast
  const endLoading = beginLoading('填答率統計計算中');
  try {
    const statsObj = await gasRun('compareSheets', props.sheet.refer, props.sheet.record);
    errorMessage.value = '';
    stats.value = statsObj;
    loadTick.value = dayjs().valueOf();
    dialog.show = true;
  } catch (err) {
    errorMessage.value = err && err.message ? err.message : '載入統計失敗';
    dialog.show = true;
  } finally {
    endLoading();
  }
}

defineExpose({ open });

function rateSort(a, b) {
  return parseFloat(a.rate) - parseFloat(b.rate);
}

function close() {
  stats.value = [];
  dialog.show = false;
}
</script>
