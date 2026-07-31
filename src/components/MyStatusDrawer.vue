<template>
  <el-drawer
    v-model="show"
    title="查詢我填答了沒"
    direction="btt"
    size="100%"
    :with-header="false"
    body-class="drawer-flow-body"
  >
    <div class="drawer-flow-title">
      <span>你在「{{ sheetName }}」的填答紀錄</span>
      <el-button text circle aria-label="關閉" @click="close()">
        <el-icon><i class="fa-solid fa-xmark"></i></el-icon>
      </el-button>
    </div>
    <el-space direction="vertical" fill wrap style="width: 100%">
      <ErrorAlert :message="errorMessage" />
      <!-- 總結：次數＋最後一次時間 -->
      <el-alert v-if="result !== null" title="填答狀態" type="info" show-icon :closable="false">
        <template #default>
          <span style="font-size: 1.5em" v-if="result.length > 0">
            你送出過 {{ result.length }} 次，最後一次是在 {{ dateConverter(result.lastTick) }}
            送出的（{{ result.modified ? '該次為修改' : '該次為首次送出' }}）。線上暫存不代表最終結果，正式結果以已送出的紀錄為準。
          </span>
          <span style="font-size: 1.5em" v-else>
            你還沒有送出過這份問卷（線上／本機暫存不算送出）。
          </span>
        </template>
      </el-alert>
      <!-- 送出與登入合併的倒序時間線（最新在最上面） -->
      <template v-if="result !== null && events.length > 0">
        <div class="qTitle">你的活動紀錄（最新在上）</div>
        <div class="captionWord">{{ logNote }}</div>
        <el-timeline>
          <el-timeline-item
            v-for="item in recentEvents"
            :key="item.key"
            :timestamp="dateConverter(item.tick)"
            placement="top"
            :type="item.type"
            :hollow="item.kind === 'login'"
          >
            <i class="fa-solid event-icon" :class="item.icon"></i>{{ item.text }}
          </el-timeline-item>
        </el-timeline>
        <el-collapse v-if="olderEvents.length > 0">
          <el-collapse-item :title="'展開較早的 ' + olderEvents.length + ' 筆紀錄'" name="older">
            <el-timeline>
              <el-timeline-item
                v-for="item in olderEvents"
                :key="item.key"
                :timestamp="dateConverter(item.tick)"
                placement="top"
                :type="item.type"
                :hollow="item.kind === 'login'"
              >
                <i class="fa-solid event-icon" :class="item.icon"></i>{{ item.text }}
              </el-timeline-item>
            </el-timeline>
          </el-collapse-item>
        </el-collapse>
      </template>
      <!-- 最後一次的簽名 -->
      <template v-if="result !== null && result.length > 0 && result.hasSignatureSlot">
        <div class="qTitle">最後一次送出的簽名</div>
        <div v-if="result.signatures.length > 0" class="sign-list">
          <div v-for="(img, index) in result.signatures" :key="index" class="sign-item">
            <div class="sign-item__label">{{ signatureLabel(index) }}</div>
            <img :src="img" :alt="signatureLabel(index)" class="sign-item__img" />
          </div>
        </div>
        <div v-else class="captionWord">這次送出沒有附上簽名。</div>
      </template>
    </el-space>
    <template #footer>
      <div class="formFooter">
        <div class="formFooter__buttons">
          <el-button
            v-if="canDownload"
            size="large"
            type="success"
            @click="downloadLastResult()"
          >
            <el-icon class="el-icon--left"><i class="fa-solid fa-download"></i></el-icon>
            下載我上次填寫的結果
          </el-button>
          <el-button size="large" type="primary" @click="close()">關閉</el-button>
        </div>
      </div>
    </template>
  </el-drawer>
</template>

<script setup>
import { ref, computed } from 'vue';
import { gasRun } from '../composables/useGasRpc';
import { beginLoading } from '../composables/useLoadingGame';
import { dateConverter, downloadCSV } from '../utils/formatters';
import ErrorAlert from './ErrorAlert.vue';

// 「查詢我填答了沒」：登入頁上與填答率統計並排的第二顆按鈕。走需認證的 mySubmitStatus——
// 只回自己的送出統計（次數／每次時間／最後一次簽名），不發 token、不進填寫問卷的 drawer。
// 後端沿用 readRecord_ 的認證骨架（冷卻＋_logins 稽核＋O 欄「開放進入」判斷），
// 所以被冷卻時要跟登入一樣顯示倒數、不區分帳號存不存在
const props = defineProps({
  // 目前開啟的問卷（mySubmitStatus 需要 refer/record）
  sheet: { type: Object, default: null },
  sheetName: { type: String, default: '' },
  // 該問卷的簽名格名稱（currentSheet.signatures）；已截止問卷後端會清空，此時退回「簽名 N」
  signatureNames: { type: Array, default: () => [] },
  // 問卷自訂的登入失敗提示（與登入流程同一份文案）
  loginFailTip: { type: String, default: '' },
});

const show = ref(false);
const result = ref(null);
const errorMessage = ref('');

// 活動時間線：送出（寫入紀錄表）與登入嘗試合併成一條，最新在上。
// 預設只列最近 8 筆，更早的收進 el-collapse（登入紀錄筆數多，不然會灌滿畫面）；
// 12 筆以內全部直接列出（收合反而多一次點擊）
const RECENT_MAX = 8;
const EVENTS_INLINE_MAX = 12;

// 後端 history 是時間順（紀錄表列序），先標「第 N 次」再合併；logins 後端已是新到舊
const events = computed(() => {
  if (result.value === null) {
    return [];
  }
  const submits = result.value.history.map((item, index) => ({
    key: 's' + index,
    kind: 'submit',
    tick: item.tick,
    type: item.modified ? 'primary' : 'success',
    icon: item.modified ? 'fa-pen-to-square' : 'fa-paper-plane',
    text: '第 ' + (index + 1) + ' 次送出' + (item.modified ? '（修改）' : '（首次送出）'),
  }));
  const logins = (result.value.logins || []).map((item, index) => ({
    key: 'l' + index,
    kind: 'login',
    tick: item.tick,
    type: item.success ? 'info' : 'danger',
    icon: item.success ? 'fa-right-to-bracket' : 'fa-triangle-exclamation',
    text: item.success ? '登入／查詢成功' : '登入／查詢失敗（認證欄位不符）',
  }));
  // 同一毫秒時讓送出排在登入之上（送出必定發生在該次登入之後）
  return submits
    .concat(logins)
    .sort((a, b) => b.tick - a.tick || (a.kind === 'submit' ? -1 : 1));
});

const recentEvents = computed(() =>
  events.value.length <= EVENTS_INLINE_MAX ? events.value : events.value.slice(0, RECENT_MAX)
);

const olderEvents = computed(() =>
  events.value.length <= EVENTS_INLINE_MAX ? [] : events.value.slice(RECENT_MAX)
);

// 時間線的說明文字：登入紀錄的來源與邊界（沒開線上暫存就沒有 _logins 可查；
// 回掃列數有上限，更早的登入不會出現；這次查詢本身也算一次登入嘗試）
const logNote = computed(() => {
  if (result.value === null) {
    return '';
  }
  if (!result.value.loginLogAvailable) {
    return '這份問卷沒有啟用登入紀錄，時間線只列出你送出的紀錄。';
  }
  return (
    '登入／查詢的成功與失敗都會被記錄，本次查詢本身也算一次。' +
    (result.value.loginLogTruncated ? '較早的登入紀錄不在此列出。' : '')
  );
});

// 有送出過且後端回了答案才給下載（沒送出過沒東西可下載）
const canDownload = computed(
  () => result.value !== null && result.value.length > 0 && (result.value.lastAnswers || []).length > 0
);

// 下載最後一次送出的結果：欄位名稱＋值的 CSV，格式與填寫 drawer 的「下載上次結果」一致
// （同一支 downloadCSV，檔案欄的值是後端拼好的 Drive 連結）
function downloadLastResult() {
  const rows = (result.value.lastAnswers || []).map((item) => ({
    欄位名稱: item.name,
    你填寫的值: item.value,
  }));
  downloadCSV(rows, '你填寫的結果', result.value.lastTick);
}

function signatureLabel(index) {
  const name = props.signatureNames[index];
  return name === undefined || name === '' ? '簽名 ' + (index + 1) : name;
}

// 進入點；App 經 template ref 呼叫並帶入認證欄位（plainClone 過的 authDB）。
// 這支要驗身分＋掃整份紀錄表＋逐張讀 Drive 簽名圖，跑得久——掛 loading 小遊戲，
// 查詢期間不另發 toast（比照 StatDialog 對 compareSheets 的做法）
async function open(auth) {
  if (!props.sheet) {
    return;
  }
  result.value = null;
  errorMessage.value = '';
  const endLoading = beginLoading('查詢你的填答紀錄中');
  try {
    const status = await gasRun('mySubmitStatus', props.sheet.refer, props.sheet.record, auth);
    if (status && status.throttled) {
      // Phase 21：被冷卻——與登入頁同一套說法，不區分被鎖與一般失敗
      errorMessage.value =
        '連續多次驗證失敗，請等 ' + status.cooldownSeconds + ' 秒後再試（登入也會一併等待）';
    } else if (!status) {
      errorMessage.value =
        props.loginFailTip !== '' ? props.loginFailTip : '查不到你的紀錄，請確認認證欄位是否填對';
    } else {
      result.value = status;
    }
    show.value = true;
  } catch (err) {
    errorMessage.value = err && err.message ? err.message : '查詢填答紀錄失敗';
    show.value = true;
  } finally {
    endLoading();
  }
}

defineExpose({ open });

function close() {
  // 清空結果：避免下次開啟殘留上一次查詢的資料
  result.value = null;
  errorMessage.value = '';
  show.value = false;
}
</script>

<style scoped>
/* footer 單顆按鈕撐滿（比照 SubmitDiffDrawer 自帶一份同規格樣式） */
.formFooter__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.formFooter__buttons .el-button {
  flex: 1 1 auto;
  margin-left: 0;
}
/* 時間線每一列的類型圖示（走 FA，不用 emoji）：顏色跟著 el-timeline-item 的文字色 */
.event-icon {
  margin-right: 6px;
  color: var(--el-text-color-secondary);
}
.sign-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.sign-item {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  overflow: hidden;
  background: var(--el-bg-color);
}
.sign-item__label {
  padding: 6px 12px;
  background: var(--el-fill-color-lighter);
  border-bottom: 1px solid var(--el-border-color-lighter);
  color: var(--el-text-color-secondary);
}
/* 簽名圖：白底簽名在深色主題下也要看得清，維持白底（反白色例外）＋窄螢幕自動縮 */
.sign-item__img {
  display: block;
  max-width: 100%;
  max-height: 240px;
  background: #fff;
}
</style>
