<template>
  <input
    type="file"
    ref="tempFileInput"
    accept=".smtemp"
    style="display: none"
    @change="onFileSelected"
  />
  <el-drawer v-model="exportDrawer.show" title="匯出暫存答案" direction="btt" size="100%" :with-header="false" body-class="drawer-flow-body">
    <div class="drawer-flow-title">
      <span>匯出暫存答案</span>
      <el-button text circle aria-label="關閉" @click="exportDrawer.show = false">
        <el-icon><i class="fa-solid fa-xmark"></i></el-icon>
      </el-button>
    </div>
    <JwtCountdownBar
      v-if="jwtVisible"
      class="drawer-sticky-top"
      :remaining-time="remainingTime"
      :session-percentage="sessionPercentage"
      :renewing="renewing"
      @renew="emit('renew')"
    />
    <el-alert title="注意事項" type="warning" show-icon>
      <template #default>
        <span style="font-size: 1.2em">
          匯出內容包含：文字、選單、已上傳的檔案連結。 匯出的檔案經過 AES-256
          加密，打開後會看到亂碼。
          解密需要「用同一組身分登入本問卷 + 你現在輸入的密碼」，兩者缺一不可。
        </span>
      </template>
    </el-alert>
    <el-space direction="vertical" fill wrap style="width: 100%; margin-top: 20px">
      <div>請設定匯出密碼（匯入時需要輸入）：</div>
      <el-input
        v-model="exportDrawer.password"
        type="password"
        placeholder="請輸入密碼"
        show-password
        size="large"
      />
      <el-button
        size="large"
        type="primary"
        style="width: 100%"
        :disabled="exportDrawer.password.length === 0"
        @click="exportTemp()"
      >
        確認匯出
      </el-button>
    </el-space>
  </el-drawer>
  <el-drawer v-model="importDrawer.show" title="匯入暫存答案" direction="btt" size="100%" :with-header="false" body-class="drawer-flow-body">
    <div class="drawer-flow-title">
      <span>匯入暫存答案</span>
      <el-button text circle aria-label="關閉" @click="importDrawer.show = false">
        <el-icon><i class="fa-solid fa-xmark"></i></el-icon>
      </el-button>
    </div>
    <JwtCountdownBar
      v-if="jwtVisible"
      class="drawer-sticky-top"
      :remaining-time="remainingTime"
      :session-percentage="sessionPercentage"
      :renewing="renewing"
      @renew="emit('renew')"
    />
    <el-alert title="注意事項" type="info" show-icon>
      <template #default>
        <span style="font-size: 1.2em">
          匯入的檔案經過 AES-256 加密。 解密需要「用同一組身分登入本問卷 +
          匯出時設定的密碼」。 如果登入身分不同或密碼錯誤，將無法解密。
        </span>
      </template>
    </el-alert>
    <el-space direction="vertical" fill wrap style="width: 100%; margin-top: 20px">
      <div>已選擇檔案：{{ importDrawer.file?.name || '無' }}</div>
      <div>請輸入匯出時設定的密碼：</div>
      <el-input
        v-model="importDrawer.password"
        type="password"
        placeholder="請輸入密碼"
        show-password
        size="large"
      />
      <el-button
        size="large"
        type="primary"
        style="width: 100%"
        :disabled="importDrawer.password.length === 0"
        @click="importTemp()"
      >
        確認匯入
      </el-button>
    </el-space>
  </el-drawer>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { ElMessage } from 'element-plus';
import dayjs from 'dayjs';
import { findPrimaryKey } from '../utils/columnRules';
import {
  buildQueuePayload,
  filterImportableQueue,
  applyQueueToColumns,
} from '../utils/tempQueue';
import { loadQueue, saveQueue } from '../utils/tempStorage';
import { encrypt, decrypt } from '../composables/useCrypto';
import JwtCountdownBar from './JwtCountdownBar.vue';

const props = defineProps({
  authDb: { type: Array, required: true },
  // 整份 columnDB：匯入時就地回寫欄位值
  columnDb: { type: Array, required: true },
  // 暫存金鑰對 { id, enc }（Phase 20）：id 假名進匯出檔加密金鑰料與 localStorage key，
  // enc 給本機暫存層加解密；null＝尚未登入
  draftKeys: { type: Object, default: null },
  // 問卷清單列 id（匯出 payload 的 formId）
  sid: { type: String, default: '' },
  // 問卷名稱（匯出檔名用）
  sheetName: { type: String, default: '' },
  // sticky JWT 倒數條（Phase 9）：狀態由 App 的 useJwtSession 下傳，續約事件上拋
  jwtVisible: { type: Boolean, default: false },
  remainingTime: { type: Number, default: 0 },
  sessionPercentage: { type: Number, default: 0 },
  renewing: { type: Boolean, default: false },
});

// 匯入成功時 emit imported（App 更新 tempFound）；renew = JWT 條點擊續約
const emit = defineEmits(['imported', 'renew']);

const exportDrawer = reactive({ show: false, password: '' });
const importDrawer = reactive({ show: false, password: '', file: null });
const tempFileInput = ref(null);

// App 的「匯出／匯入暫存答案」按鈕經由這兩個方法觸發
function openExport() {
  exportDrawer.password = '';
  exportDrawer.show = true;
}

function openImport() {
  tempFileInput.value.click();
}

defineExpose({ openExport, openImport });

function onFileSelected(event) {
  const file = event.target.files[0];
  if (file) {
    importDrawer.file = file;
    importDrawer.password = '';
    importDrawer.show = true;
  }
  event.target.value = '';
}

async function exportTemp() {
  if (props.draftKeys === null) {
    ElMessage.error('找不到暫存金鑰，無法匯出');
    return;
  }
  let queue = await loadQueue(props.draftKeys);
  if (!queue || queue.length === 0) {
    ElMessage.error('沒有可以匯出的暫存資料');
    return;
  }
  // 組成匯出物件（與線上暫存同一格式）
  let exportData = buildQueuePayload(props.sid, queue);
  try {
    // 加密金鑰 = id 假名 + 密碼（Phase 20：明文主鍵值不再進金鑰料；
    // 跨裝置在另一台登入會拿到同一把假名，照樣解得開）
    const encryptPassword = props.draftKeys.id + exportDrawer.password;
    const encrypted = await encrypt(exportData, encryptPassword);
    // 下載檔案
    const blob = new Blob([encrypted], { type: 'application/octet-stream' });
    const url = window.URL.createObjectURL(blob);
    const element = document.createElement('a');
    element.setAttribute('href', url);
    element.setAttribute(
      'download',
      `問卷暫存_${props.sheetName}_${dayjs().format('YYYYMMDD_HHmmss')}.smtemp`
    );
    element.click();
    window.URL.revokeObjectURL(url);
    exportDrawer.show = false;
    exportDrawer.password = '';
    ElMessage.success('暫存資料已匯出！請將檔案傳送到其他裝置後匯入');
  } catch (error) {
    ElMessage.error('匯出失敗：' + error.message);
  }
}

function importTemp() {
  if (!importDrawer.file) {
    ElMessage.error('請先選擇檔案');
    return;
  }
  if (props.draftKeys === null) {
    ElMessage.error('找不到暫存金鑰，無法匯入');
    return;
  }
  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      // 解密金鑰 = id 假名 + 密碼；舊格式匯出檔 fallback = 主鍵值 + 密碼
      // （Phase 5 決策本就保留 P 欄值在記憶體，登入後仍在 authDb）
      let importData;
      try {
        importData = await decrypt(e.target.result, props.draftKeys.id + importDrawer.password);
      } catch (firstErr) {
        let primaryKey = findPrimaryKey(props.authDb);
        if (primaryKey === undefined) {
          throw firstErr;
        }
        importData = await decrypt(e.target.result, primaryKey.value + importDrawer.password);
      }
      // 驗證檔案格式
      if (!importData.version || !importData.data || !importData.data.queue) {
        ElMessage.error('匯入檔案格式不正確');
        return;
      }
      // 檢查 formId 是否相符
      if (importData.formId && importData.formId !== props.sid) {
        ElMessage.warning('注意：匯入的資料來自不同的問卷，部分欄位可能不相容');
      }
      // 過濾只匯入存在的欄位（包含檔案欄位）
      let importedQueue = filterImportableQueue(importData.data.queue, props.columnDb);
      let skippedCount = importData.data.queue.length - importedQueue.length;
      if (importedQueue.length === 0) {
        ElMessage.error('匯入失敗：沒有任何欄位可以匯入（欄位結構可能已變更）');
        return;
      }
      // 加密存回 localStorage 並直接更新 columnDB，讓畫面立即反應
      saveQueue(props.draftKeys, importedQueue);
      applyQueueToColumns(importedQueue, props.columnDb, 'import');
      emit('imported');
      // 顯示結果訊息
      let message = `成功匯入 ${importedQueue.length} 個欄位的暫存資料`;
      if (skippedCount > 0) {
        message += `，${skippedCount} 個欄位因不存在而略過`;
      }
      ElMessage.success(message);
      importDrawer.show = false;
      importDrawer.password = '';
      importDrawer.file = null;
    } catch {
      ElMessage.error('匯入失敗：密碼錯誤或身分不符');
    }
  };
  reader.onerror = function () {
    ElMessage.error('檔案讀取失敗');
  };
  reader.readAsText(importDrawer.file);
}
</script>
