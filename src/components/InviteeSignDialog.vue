<template>
  <JwtCountdownBar
    v-if="sessionToken !== ''"
    :remaining-time="remainingTime"
    :session-percentage="sessionPercentage"
    :renewing="renewing"
    @renew="handleRenewClick"
  />
  <el-dialog
    v-model="show"
    fullscreen
    :show-close="false"
    :title="'簽名邀請' + (sheetName !== '' ? '：' + sheetName : '')"
  >
    <el-space direction="vertical" fill wrap style="width: 100%">
      <ErrorAlert :message="errorMessage" />
      <el-alert title="驗證中" type="info" show-icon v-if="loading">
        <template #default>
          <span style="font-size: 1.5em">正在確認你的簽名邀請，請稍候</span>
        </template>
      </el-alert>
      <template v-if="loaded">
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
      <el-button
        class="ma1 pa2 xs12"
        size="large"
        type="primary"
        v-if="!loading"
        v-on:click="closeDialog()"
      >
        {{ loaded && !signed ? '不簽了，回問卷列表' : '關閉，回問卷列表' }}
      </el-button>
    </el-space>
  </el-dialog>
</template>

<script setup>
import { ref, nextTick, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import _ from 'lodash';
import FormField from './FormField.vue';
import ErrorAlert from './ErrorAlert.vue';
import JwtCountdownBar from './JwtCountdownBar.vue';
import { gasRun } from '../composables/useGasRpc';
import { useSignatures } from '../composables/useSignatures';
import { useJwtSession } from '../composables/useJwtSession';
import { prepareColumnsForDisplay } from '../utils/columnPrep';
import { dateConverter } from '../utils/formatters';
import { htmlConverter } from '../utils/markdown';

// 受邀簽名者的完整流程（獨立於填寫者主流程）：open(邀請token) → inviteeLogin 換 session JWT →
// read-only 問卷 + 單格簽名板 → submitInviteSignature（帶 session token，後端 Lock 內重查邀請列）。
// 自建一份 useSignatures 實例：受邀模式下主畫面所有對話框都不開，canvas selector 不會相撞。
const emit = defineEmits(['closed']);

const show = ref(false);
const loading = ref(false);
const loaded = ref(false);
const submitting = ref(false);
const errorMessage = ref('');
const sheetName = ref('');
const comment = ref('');
const signName = ref('');
const maskedPkey = ref('');
const expireAt = ref(0);
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

async function open(inviteToken) {
  show.value = true;
  loading.value = true;
  loaded.value = false;
  errorMessage.value = '';
  try {
    const result = await gasRun('inviteeLogin', inviteToken);
    loading.value = false;
    if (!result) {
      errorMessage.value =
        '這個驗證碼無效，或邀請已過期／被撤回。請聯絡填寫者重新發送邀請，或確認你完整複製了驗證碼';
      return;
    }
    sheetName.value = result.sheetName;
    comment.value = result.comment;
    signName.value = result.signName;
    maskedPkey.value = result.maskedPkey;
    expireAt.value = result.expireAt;
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
  } catch (err) {
    loading.value = false;
    errorMessage.value = err && err.message ? err.message : '載入簽名邀請失敗，請稍後再試';
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

// 點倒數條續約：後端會重讀邀請列，被撤回/重發/已簽就不給續
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

// session 過期：受邀者沒有帳號密碼可重登，只能重新用邀請連結/驗證碼進入
function handleSessionExpired() {
  sessionToken.value = '';
  loaded.value = false;
  errorMessage.value = '簽名時間已逾時，請重新點開邀請信中的連結（或重新貼上驗證碼）再簽一次';
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
