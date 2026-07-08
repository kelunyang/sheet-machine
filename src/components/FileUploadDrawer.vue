<template>
  <el-drawer
    v-model="show"
    title="你正在處理檔案欄位"
    direction="btt"
    :show-close="false"
    size="90%"
  >
    <ErrorAlert :message="uploadErrors" />
    <el-alert title="檔案限制" type="warning" show-icon>
      <template #default>
        <span style="font-size: 1.5em"
          >檔案類型：{{ mimeAlt === '' ? '無限制' : mimeAlt }}／檔案大小：{{
            maxSize
          }}MB／只能選擇1個檔案</span
        >
      </template>
    </el-alert>
    <el-alert title="上傳中" type="info" show-icon v-if="uploading">
      <template #default>
        <span style="font-size: 1.5em">
          上傳可能會花上一段時間，在本訊息結束之前，請不要關閉視窗
        </span>
      </template>
    </el-alert>
    <div>欄位名稱：{{ columnName }}</div>
    <el-space direction="vertical" fill wrap style="width: 100%">
      <el-upload
        :limit="1"
        :auto-upload="false"
        v-model:file-list="fileList"
        :on-exceed="exceedLimit"
        class="ma1 pa2 xs12"
      >
        <template #trigger>
          <el-button type="primary">請選擇1個檔案</el-button>
        </template>
      </el-upload>
      <el-button
        class="ma1 pa2 xs12"
        size="large"
        type="danger"
        v-on:click="startUpload()"
        :disabled="fileList.length === 0"
        v-if="!uploading"
        >上傳檔案！</el-button
      >
      <el-button
        class="ma1 pa2 xs12"
        size="large"
        type="primary"
        v-on:click="show = false"
        v-if="!uploading"
        >關閉對話框</el-button
      >
    </el-space>
  </el-drawer>
</template>

<script setup>
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import _ from 'lodash';
import { gasRun } from '../composables/useGasRpc';
import ErrorAlert from './ErrorAlert.vue';

const show = defineModel('show', { type: Boolean, default: false });

const props = defineProps({
  // F-F 欄位（content = "類型說明;mime正則;大小上限MB"）
  column: { type: Object, default: null },
  // 目前開啟的問卷（saveFile 需要 refer/record）
  sheet: { type: Object, default: null },
  // 登入後的 JWT（saveFile 的身分憑證）
  authToken: { type: String, required: true },
});

// 上傳成功時 emit uploaded（App 負責回寫 columnDB）；token 逾時 emit token-expired
const emit = defineEmits(['uploaded', 'token-expired']);

const columnId = ref('');
const columnName = ref('');
const mimeAlt = ref('');
const mimeType = ref('');
const maxSize = ref(1);
const fileList = ref([]);
const uploadErrors = ref('');
const uploading = ref(false);

// 每次打開 drawer 都從 column 重新初始化
watch(show, (open) => {
  if (open && props.column) {
    columnId.value = props.column.id;
    columnName.value = props.column.name;
    maxSize.value = 1;
    mimeType.value = '';
    mimeAlt.value = '';
    if (props.column.content !== '') {
      let contentConfig = props.column.content.split(';');
      if (contentConfig[0] !== '') {
        mimeAlt.value = contentConfig[0];
      }
      if (contentConfig[1] !== '') {
        mimeType.value = contentConfig[1];
      }
      if (contentConfig[2] !== '') {
        maxSize.value = parseInt(contentConfig[2]);
      }
    }
    fileList.value = [];
    uploadErrors.value = '';
  }
});

function exceedLimit(file) {
  ElMessage('只能接受一個檔案！');
  fileList.value = file;
}

function startUpload() {
  uploadErrors.value = '';
  if (fileList.value.length === 0 || !props.sheet) {
    return;
  }
  let firstList = fileList.value[0];
  let file = 'raw' in firstList ? firstList.raw : firstList;
  const fr = new FileReader();
  ElMessage('檔案編碼中！');
  fr.onload = async function (e) {
    const obj = {
      filename: file.name,
      mimeType: file.type,
      bytes: [...new Int8Array(e.target.result)],
    };
    if (new RegExp(mimeType.value, 'i').test(file.type)) {
      if (file.size <= maxSize.value * 1000000) {
        ElMessage('檔案上傳中！');
        uploading.value = true;
        try {
          const report = await gasRun(
            'saveFile',
            props.sheet.refer,
            props.sheet.record,
            props.authToken,
            columnId.value,
            obj
          );
          if (report.tokenExpired) {
            uploading.value = false;
            show.value = false;
            emit('token-expired');
            return;
          }
          if (report.status) {
            emit('uploaded', {
              columnId: columnId.value,
              fileID: report.fileID,
              fileURL: report.fileURL,
            });
            uploading.value = false;
            show.value = false;
            ElMessage('上傳成功！');
          } else {
            uploadErrors.value = _.join(report.errorLog, '、');
            uploading.value = false;
          }
        } catch (err) {
          uploadErrors.value = err && err.message ? err.message : '上傳失敗，請稍後再試';
          uploading.value = false;
        }
      } else {
        uploadErrors.value = '檔案超過大小限制！';
      }
    } else {
      uploadErrors.value = '無法接受你的檔案格式！';
    }
  };
  fr.readAsArrayBuffer(file);
}
</script>
