<template>
  <el-dialog
    :show-close="false"
    v-model="dialog.show"
    :fullscreen="dialog.fullscreen"
    title="最後一位填寫者以及你是否填過"
  >
    <el-space direction="vertical" fill wrap style="width: 100%">
      <ErrorAlert :message="errorMessage" />
      <div class="qTitle">最後一位填寫者</div>
      <div>
        [{{ lastSender.modified ? '有修改' : '無修改' }}]{{ lastSender.pkey }}（{{
          dateConverter(lastSender.tick)
        }}）
      </div>
      <div class="qTitle" v-if="pkeyName !== ''">查詢你填過沒有（請輸入{{ pkeyName }}）</div>
      <el-input
        v-if="pkeyName !== ''"
        size="large"
        class="xs12"
        :label="'輸入你想查詢的使用者的' + pkeyName"
        v-model="requestedUser"
        outline
      >
      </el-input>
      <div v-if="queryResult.pkey !== ''">
        [最後一次{{ queryResult.modified ? '有修改' : '無修改' }}]{{ queryResult.pkey }}（寫了{{
          queryResult.length
        }}次，最後一次寫的時間是 {{ dateConverter(queryResult.lastTick) }} ）
      </div>
      <el-button
        class="ma1 pa2 xs12"
        size="large"
        type="danger"
        :disabled="requestedUser === ''"
        v-on:click="queryExist()"
        >按此查詢是否填過</el-button
      >
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="close()"
        >關閉對話框</el-button
      >
    </el-space>
  </el-dialog>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { ElMessage } from 'element-plus';
import { gasRun } from '../composables/useGasRpc';
import { dateConverter } from '../utils/formatters';
import ErrorAlert from './ErrorAlert.vue';

const props = defineProps({
  // 目前開啟的問卷（latestSubmits／duplicateSubmits 需要 record）
  sheet: { type: Object, default: null },
  // 主鍵欄位名稱（查詢提示用）
  pkeyName: { type: String, default: '' },
});

const dialog = reactive({ show: false, fullscreen: true });
const lastSender = ref({ tick: 0, modified: true, pkey: '' });
const queryResult = ref({ pkey: '', modified: false, length: 0, lastTick: 0 });
const requestedUser = ref('');
const errorMessage = ref('');

// 最後填寫者查詢對話框的進入點；目前列表頁按鈕停用中，App 經 defineExpose 保留供還原
async function open() {
  if (!props.sheet) {
    return;
  }
  ElMessage('載入問卷最後存取資訊中，請稍後');
  try {
    const latest = await gasRun('latestSubmits', props.sheet.record);
    errorMessage.value = '';
    latest.tick = parseInt(latest.tick);
    latest.modified = /true|TRUE/.test(latest.modified) ? true : false;
    lastSender.value = latest;
    dialog.show = true;
  } catch (err) {
    errorMessage.value = err && err.message ? err.message : '載入最後存取資訊失敗';
    dialog.show = true;
  }
}

defineExpose({ open });

async function queryExist() {
  if (!props.sheet) {
    return;
  }
  ElMessage('查詢指定用戶是否填寫過問卷中，請稍後');
  try {
    const requested = await gasRun('duplicateSubmits', props.sheet.record, requestedUser.value);
    errorMessage.value = '';
    requestedUser.value = '';
    requested.modified = /true|TRUE/.test(requested.modified) ? true : false;
    requested.lastTick = parseInt(requested.lastTick);
    queryResult.value = requested;
  } catch (err) {
    errorMessage.value = err && err.message ? err.message : '查詢失敗';
  }
}

function close() {
  queryResult.value.pkey = '';
  dialog.show = false;
}
</script>
