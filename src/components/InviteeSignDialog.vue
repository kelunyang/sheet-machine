<template>
  <el-drawer
    v-model="show"
    direction="btt"
    size="100%"
    :with-header="false"
    body-class="drawer-flow-body"
    :title="'簽名邀請' + (sheetName !== '' ? '：' + sheetName : '')"
  >
    <div class="drawer-flow-title">簽名邀請{{ sheetName !== '' ? '：' + sheetName : '' }}</div>
    <JwtCountdownBar
      v-if="sessionToken !== ''"
      class="drawer-sticky-top"
      :remaining-time="remainingTime"
      :session-percentage="sessionPercentage"
      :renewing="renewing"
      @renew="handleRenewClick"
    />
    <el-space direction="vertical" fill wrap style="width: 100%">
      <ErrorAlert :message="errorMessage" />
      <template v-if="loaded">
        <LifecycleTimeline
          :start-at="inviteCreatedAt"
          :end-at="expireAt"
          start-label="邀請發出"
          end-label="邀請到期"
          ended-text="邀請已過期"
          quiet
        />
        <el-alert title="簽名者模式" type="warning" show-icon>
          <template #default>
            <span style="font-size: 1.5em">
              你正在為 {{ maskedPkey }} 的問卷簽署「{{ signName }}」欄位（邀請有效至
              {{ dateConverter(expireAt) }}）。下方問卷內容為唯讀，僅供你簽名前確認；
              <span style="font-weight: bold">如對問卷填答內容有異議，請使用帳號密碼登入後修改</span
              >。
            </span>
          </template>
        </el-alert>
        <el-alert title="你的簽名已完成" type="success" show-icon v-if="signed">
          <template #default>
            <span style="font-size: 1.5em">你的簽名已完成，請提醒填寫者回來檢查後送出！</span>
            <div v-if="myImage !== ''">
              <img :src="myImage" :alt="signName + '的簽名'" class="savedSignatureImg" />
            </div>
          </template>
        </el-alert>
        <el-alert title="問卷提示" type="info" show-icon v-if="comment !== ''">
          <template #default>
            <span style="font-size: 1.5em" v-html="HTMLConverter(comment)"></span>
          </template>
        </el-alert>
        <FormField
          v-for="column in columnDB"
          :key="column.tid"
          :column="column"
          :column-db="columnDB"
          :enable-modify="false"
        />
        <template v-if="!signed">
          <el-alert :title="'請在灰框內簽下「' + signName + '」的簽名'" type="warning" show-icon>
            <template #default>
              <span style="font-size: 1.5em">
                請注意，簽名需親簽（或得到授權），否則可能違反刑法217條偽造署押罪
              </span>
            </template>
          </el-alert>
          <div v-if="signatures.length > 0">
            <el-progress
              :percentage="signatures[0].percentage"
              :status="signatures[0].progressStatus"
            >
              <template #default="{ percentage }">
                <span>{{ percentage }}%</span>
                <span v-if="signatures[0].showWarning" style="color: red">
                  簽名須佔有簽名板的0.5%以上面積
                </span>
              </template>
            </el-progress>
            <div class="inviteeSignPad">
              <canvas class="signaturePad" :width="signatureWidth" :height="signatureHeight" />
            </div>
          </div>
          <el-button class="ma1 pa1 xs12" size="large" type="success" v-on:click="clearSignature()">
            清除簽名
          </el-button>
          <el-button
            class="ma1 pa2 xs12"
            size="large"
            type="danger"
            :disabled="signatureSubmitStatus.isDisabled"
            :loading="submitting"
            v-on:click="submitSignature()"
          >
            {{
              signatureSubmitStatus.isDisabled
                ? '簽名須佔簽名板的0.5%以上面積才可提交'
                : '送出「' + signName + '」的簽名'
            }}
          </el-button>
        </template>
      </template>
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="closeDialog()">
        {{ loaded && !signed ? '不簽了，回問卷列表' : '關閉，回問卷列表' }}
      </el-button>
    </el-space>
  </el-drawer>
</template>

<script setup>
import { ref, nextTick, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import _ from 'lodash';
import FormField from './FormField.vue';
import ErrorAlert from './ErrorAlert.vue';
import JwtCountdownBar from './JwtCountdownBar.vue';
import LifecycleTimeline from './LifecycleTimeline.vue';
import { gasRun } from '../composables/useGasRpc';
import { useSignatures } from '../composables/useSignatures';
import { useJwtSession } from '../composables/useJwtSession';
import { prepareColumnsForDisplay } from '../utils/columnPrep';
import { dateConverter } from '../utils/formatters';
import { htmlConverter } from '../utils/markdown';

// 受邀簽名者的簽名畫面：邀請碼＋email OTP 二段驗證在 App.vue 的邀請碼 drawer 完成，
// 這裡以 open(inviteeLogin 的回傳值) 接手——開啟時內容已就緒，顯示 read-only 問卷 +
// 單格簽名板 → submitInviteSignature（帶 session token，後端 Lock 內重查邀請列）。
// 自建一份 useSignatures 實例：受邀模式下主畫面所有對話框都不開，canvas selector 不會相撞。
const emit = defineEmits(['closed']);

const show = ref(false);
const loaded = ref(false);
const submitting = ref(false);
const errorMessage = ref('');
const sheetName = ref('');
const comment = ref('');
const signName = ref('');
const maskedPkey = ref('');
const expireAt = ref(0);
const inviteCreatedAt = ref(0);
const signed = ref(false);
const myImage = ref('');
const sessionToken = ref('');
const currentRefer = ref('');
const currentRecord = ref('');
const columnDB = ref([]);

const HTMLConverter = htmlConverter;

const {
  signatures,
  enableSignature,
  signatureWidth,
  signatureHeight,
  signatureSubmitStatus,
  resetSignatures,
  addSignatures,
  initSignaturePads,
  setupOrientationListener,
  clearSignature,
  findEmptySignatures,
  collectSignatures,
} = useSignatures();

const { remainingTime, sessionPercentage, renewing, handleRenewClick } = useJwtSession({
  token: sessionToken,
  onRenew: renewSession,
  onExpired: handleSessionExpired,
});

// result = inviteeLogin 通過 OTP 後的回傳值（App.vue 的邀請碼 drawer 驗完才呼叫）。
// initSignaturePads 內建 3 秒延遲才量尺寸，足以蓋過 drawer 開啟動畫（iPadOS 13 時機修復）
function open(result) {
  show.value = true;
  errorMessage.value = '';
  sheetName.value = result.sheetName;
  comment.value = result.comment;
  signName.value = result.signName;
  maskedPkey.value = result.maskedPkey;
  expireAt.value = result.expireAt;
  // 舊後端沒回這個欄位時退化為 0，時間軸整個不顯示
  inviteCreatedAt.value = result.inviteCreatedAt || 0;
  signed.value = result.alreadySigned;
  myImage.value = result.myImage || '';
  sessionToken.value = result.sessionToken || '';
  currentRefer.value = result.refer;
  currentRecord.value = result.record;
  let columns = _.filter(result.headers, (column) => {
    return /F|C|G/.test(column.type);
  });
  columnDB.value = prepareColumnsForDisplay(columns, []);
  loaded.value = true;
  if (!signed.value) {
    resetSignatures();
    addSignatures([signName.value]);
    enableSignature.value = true;
    nextTick(() => {
      initSignaturePads();
    });
  }
}
defineExpose({ open });

async function submitSignature() {
  if (submitting.value) {
    return;
  }
  if (findEmptySignatures().length > 0) {
    ElMessage.error('簽名不得留空！');
    return;
  }
  submitting.value = true;
  try {
    const blob = collectSignatures()[0].blob;
    const result = await gasRun('submitInviteSignature', sessionToken.value, blob);
    if (result && result.success) {
      signed.value = true;
      myImage.value = blob;
      errorMessage.value = '';
      ElMessage.success('簽名已送出！');
    } else if (result && result.tokenExpired) {
      handleSessionExpired();
    } else {
      // 含撤回/重發競態的明確錯誤（revoked）：簽名沒有送出，請受邀者聯絡填寫者
      errorMessage.value = result && result.message ? result.message : '簽名送出失敗，請稍後再試';
    }
  } catch (err) {
    errorMessage.value = err && err.message ? err.message : '簽名送出失敗，請稍後再試';
  } finally {
    submitting.value = false;
  }
}

// 點倒數條續約：後端會重讀邀請列，被撤回/重發/已簽就不給續（續約不需重跑 OTP）
async function renewSession() {
  if (sessionToken.value === '' || currentRefer.value === '') {
    return false;
  }
  try {
    const result = await gasRun(
      'renewToken',
      currentRefer.value,
      currentRecord.value,
      sessionToken.value
    );
    if (result && result.renewed && result.token) {
      sessionToken.value = result.token;
      ElMessage.success('已延長簽名時間');
      return true;
    }
    if (result && result.tokenExpired) {
      handleSessionExpired();
      return false;
    }
    ElMessage.error(result && result.message ? result.message : '延長簽名時間失敗');
    return false;
  } catch (err) {
    console.error('renewToken (invitee) failed', err);
    ElMessage.error('延長簽名時間失敗，請稍後再試');
    return false;
  }
}

// session 過期：受邀者沒有帳號密碼可重登，只能重新貼邀請碼走一次 OTP 流程
function handleSessionExpired() {
  sessionToken.value = '';
  loaded.value = false;
  errorMessage.value = '簽名時間已逾時，請重新貼上邀請碼進入，系統會再寄一組驗證碼';
}

function closeDialog() {
  show.value = false;
  sessionToken.value = '';
  loaded.value = false;
  emit('closed');
}

onMounted(() => {
  setupOrientationListener();
});
</script>

<style scoped>
/* 簽名板外框：initSignaturePads 以 canvas 的 parentElement 量尺寸，需有明確高度 */
.inviteeSignPad {
  width: 100%;
  height: 300px;
}
</style>
