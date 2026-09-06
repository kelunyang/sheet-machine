<template>
  <el-drawer
    v-model="dialog.show"
    :show-close="false"
    title="填答率統計"
    direction="btt"
    size="100%"
    :with-header="false"
    body-class="drawer-flow-body"
  >
    <div class="drawer-flow-title">
      <span>「{{ sheetName }}」的填答率</span>
      <el-button text circle aria-label="關閉" @click="close()">
        <el-icon><i class="fa-solid fa-xmark"></i></el-icon>
      </el-button>
    </div>
    <el-space direction="vertical" fill wrap style="width: 100%">
      <!-- 總結：無論哪種 mode 都給同一組數字（總填答率＝sum(已填)/sum(應填)，不是各組平均） -->
      <el-alert v-if="stats !== null" title="總填答率" type="info" show-icon :closable="false">
        <template #default>
          <span class="stat-headline">
            已填 {{ stats.filled }} / {{ stats.total }} 人（{{ stats.rate }}%）
          </span>
          <div class="stat-caption">
            統計於 {{ dateConverter(loadTick) }}。這是查詢當下的即時結果，關掉再查一次就是最新的。
          </div>
        </template>
      </el-alert>

      <!-- 總體模式（名冊無分組欄）：只有一個數字，不畫表格也不列未完成者 -->
      <RateBar
        v-if="stats !== null && stats.mode === 'overall'"
        :percentage="stats.rate"
        :label="'已填 ' + stats.filled + ' / ' + stats.total + ' 人（' + stats.rate + '%）'"
      />
      <el-alert
        v-if="stats !== null && stats.mode === 'overall'"
        title="這份問卷的名冊沒有分組欄位，因此只能給整體填答率，無法列出未完成者。"
        type="info"
        :closable="false"
      />

      <!-- 分組模式 -->
      <el-table
        v-if="stats !== null && stats.mode === 'grouped'"
        :data="stats.groups"
        stripe
        style="width: 100%"
        :border="true"
        :highlight-current-row="true"
      >
        <el-table-column prop="classno" label="" min-width="10%" />
        <el-table-column prop="rate" label="填答率" sortable :sort-method="rateSort" min-width="20%">
          <template #default="scope">
            <RateBar
              :percentage="scope.row.rate"
              :label="scope.row.filled + '/' + scope.row.total + '（' + scope.row.rate + '%）'"
            />
          </template>
        </el-table-column>
        <el-table-column prop="unfinished" label="未完成者" min-width="70%" resizable />
      </el-table>

      <el-button
        v-if="stats !== null"
        class="ma1 pa2 xs12"
        size="large"
        type="primary"
        v-on:click="exportCSV()"
        >匯出統計表</el-button
      >
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="close()"
        >關閉</el-button
      >
    </el-space>
  </el-drawer>
</template>

<script setup>
import { ref, reactive } from 'vue';
import dayjs from 'dayjs';
import { downloadCSV, dateConverter } from '../utils/formatters';
import RateBar from './RateBar.vue';

const props = defineProps({
  sheetName: { type: String, default: '' },
});

const dialog = reactive({ show: false });
// null＝還沒查過；查過就是 compareSheets 的整包物件（含 mode/filled/total/rate/groups）
const stats = ref(null);
const loadTick = ref(0);

// 資料由 App.vue 抓好後推進來（RPC 的發動與防競態都在 App.vue，這裡只負責呈現）
// ——Phase 29 起本元件不自己打 RPC：入口按鈕本身要吃同一份數字當填充比例，
// 兩邊各抓一次會多花一次全表掃描，且可能不一致。
function open(payload, tick) {
  stats.value = payload;
  loadTick.value = tick || dayjs().valueOf();
  dialog.show = true;
}

defineExpose({ open });

function rateSort(a, b) {
  return a.rate - b.rate;
}

function exportCSV() {
  if (stats.value === null) {
    return;
  }
  const rows =
    stats.value.mode === 'grouped'
      ? stats.value.groups
      : [{ classno: '全體', filled: stats.value.filled, total: stats.value.total, rate: stats.value.rate }];
  downloadCSV(rows, props.sheetName + '填寫率統計.csv', loadTick.value);
}

function close() {
  dialog.show = false;
}
</script>

<style scoped>
.stat-headline {
  font-size: 1.5em;
}

.stat-caption {
  margin-top: 4px;
  font-size: 0.85em;
  opacity: 0.85;
}
</style>
