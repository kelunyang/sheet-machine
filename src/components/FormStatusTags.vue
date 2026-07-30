<template>
  <div class="status-tags" v-if="tags.length > 0">
    <el-tooltip v-for="tag in tags" :key="tag.key" :content="tag.tip" placement="bottom">
      <el-tag
        :type="tag.type"
        size="large"
        effect="light"
        class="status-tag"
        :class="{ 'is-shrunk': !isExpanded(tag.key) }"
        @click="peekLabel(tag.key)"
      >
        <i class="fa-solid" :class="tag.icon"></i>
        <span class="status-tag__label">{{ tag.label }}</span>
        <span v-if="tag.badge !== ''" class="status-tag__badge">{{ tag.badge }}</span>
      </el-tag>
    </el-tooltip>
  </div>
</template>

<script setup>
import { computed, reactive, watch, onBeforeUnmount } from 'vue';
import { dateConverter } from '../utils/formatters';

// 填寫狀態 tag 群（Phase 27）：取代原本填寫 drawer 頂端那條 1.5em 的「填寫狀態」el-alert。
// 三顆 tag（已送出／本機備份／遠端備份），沒送出過又沒備份＝一顆都不出。
// 兩態：出現 60 秒內顯示文字，之後文字收掉只留 icon（＋次數數字）——「已填過 N 次」看久了是廢話，
// 但 icon 與數字永遠留著，狀態仍可辨識；tooltip 兩態都有，資訊不因縮圖而消失。
// 狀態變化（例如剛按下線上暫存）會讓那顆 tag 重新展開並重新計時，不然使用者看不出變化。
// FormToolbar 在「按鈕列」與 CollapsibleControls 的 #peek 各放一份，兩份各自計時、外觀一致。
const props = defineProps({
  // 已送出次數（requestCount.length）與最後一次送出時間（ms）
  submitCount: { type: Number, default: 0 },
  lastSubmitAt: { type: [Number, String], default: 0 },
  // 本機（localStorage）有沒有暫存；localDraftAt 為本次登入期間最後一次自動存檔時間
  // （tempStorage 的 queue 沒有時間戳，登入時載到的舊暫存給 0＝只說「有」不給時間）
  tempFound: { type: Boolean, default: false },
  localDraftAt: { type: Number, default: 0 },
  // 雲端暫存時間（ms，0＝沒有）
  onlineDraftAt: { type: Number, default: 0 },
});

const SHRINK_MS = 60 * 1000; // 出現後多久把文字收掉
const PEEK_MS = 5 * 1000; // 縮圖態點一下暫時展開多久

const tags = computed(() => {
  const list = [];
  if (props.submitCount > 0) {
    list.push({
      key: 'submitted',
      type: 'success',
      icon: 'fa-circle-check',
      label: '已填過',
      badge: props.submitCount + ' 次',
      // sig＝「值得重新展開文字」的離散狀態（見下方 watch）：次數變了才算變化
      sig: 'n' + props.submitCount,
      tip: '你已經送出過 ' + props.submitCount + ' 次，最後一次：' + dateConverter(props.lastSubmitAt),
    });
  }
  if (props.tempFound) {
    list.push({
      key: 'local',
      type: 'warning',
      icon: 'fa-mobile-screen',
      label: '本機備份',
      badge: '',
      // 刻意不把 localDraftAt 放進 sig：本機是每次打字都自動存，時間一直在動，
      // 拿它當變化訊號會讓這顆 tag 永遠停在展開態、永遠縮不回去
      sig: 'on',
      tip:
        (props.localDraftAt > 0
          ? '本機自動存檔於 ' + dateConverter(props.localDraftAt) + '。'
          : '本機有你之前沒送出的存檔。') + '檔案欄位不會存檔，換裝置看不到；正式結果以送出的紀錄為準',
    });
  }
  if (props.onlineDraftAt > 0) {
    list.push({
      key: 'online',
      type: 'primary',
      icon: 'fa-cloud',
      label: '遠端備份',
      badge: '',
      // 線上暫存是離散事件（手動按或登入時探到），時間一變就代表「剛剛存上去了」——
      // 重新亮出文字讓使用者看得到變化
      sig: 't' + props.onlineDraftAt,
      tip:
        '雲端暫存於 ' +
        dateConverter(props.onlineDraftAt) +
        '，用同一組身分在別的裝置登入即可還原（簽名需重簽）',
    });
  }
  return list;
});

// key → 展開到什麼時候（ms timestamp）；到期即縮圖。用 reactive 物件而非 ref(Map)，
// 讓模板的 isExpanded 依 key 逐顆反應
const expandUntil = reactive({});
const timers = {};
// key → 上一次看到的 sig；變了就代表狀態有離散變化（新送出一次、剛線上暫存成功），
// 重新展開並重新計時。不用 tooltip 文字比對——它含每次打字都在動的本機存檔時間
const trackedSigs = {};

function scheduleShrink(key, ms) {
  if (timers[key]) {
    clearTimeout(timers[key]);
  }
  expandUntil[key] = Date.now() + ms;
  timers[key] = setTimeout(() => {
    expandUntil[key] = 0;
    timers[key] = null;
  }, ms);
}

function isExpanded(key) {
  return (expandUntil[key] || 0) > 0;
}

// 縮圖態點一下暫時展開（桌機 hover 由 CSS 負責，這裡管點擊——手機沒有 hover）
function peekLabel(key) {
  if (!isExpanded(key)) {
    scheduleShrink(key, PEEK_MS);
  }
}

// 每顆 tag 各自從「出現」起算 60 秒；sig 變了（新送出一次、剛線上暫存成功）也重新展開計時
watch(
  tags,
  (list) => {
    const seen = {};
    list.forEach((tag) => {
      seen[tag.key] = true;
      if (!(tag.key in trackedSigs) || trackedSigs[tag.key] !== tag.sig) {
        scheduleShrink(tag.key, SHRINK_MS);
      }
      trackedSigs[tag.key] = tag.sig;
    });
    // 消失的 tag：清掉計時器與狀態，下次出現重新展開
    Object.keys(trackedSigs).forEach((key) => {
      if (!(key in seen)) {
        if (timers[key]) {
          clearTimeout(timers[key]);
          timers[key] = null;
        }
        delete trackedSigs[key];
        expandUntil[key] = 0;
      }
    });
  },
  { immediate: true, deep: true }
);

onBeforeUnmount(() => {
  Object.keys(timers).forEach((key) => {
    if (timers[key]) {
      clearTimeout(timers[key]);
    }
  });
});
</script>

<style scoped>
.status-tags {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
}

.status-tag {
  cursor: default;
}

/* 排版要設在 el-tag 的**內容 span**上：icon/文字/數字都在 .el-tag__content 裡，
   設在 el-tag 根元素上管不到它們（原本的負 margin 就是這樣把數字拉去壓住 icon 的） */
.status-tag :deep(.el-tag__content) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* icon 與次數數字永不收、永不被壓縮 */
.status-tag :deep(.el-tag__content) > i,
.status-tag__badge {
  flex: 0 0 auto;
}

/* 文字收放：max-width 0↔8em ＋ opacity，不用 display:none 才收得平滑；
   nowrap + overflow hidden 防收放過程換行抖動 */
.status-tag__label {
  display: inline-block;
  flex: 0 1 auto;
  max-width: 8em;
  overflow: hidden;
  white-space: nowrap;
  opacity: 1;
  transition:
    max-width 0.4s ease,
    opacity 0.4s ease;
}

.status-tag.is-shrunk .status-tag__label {
  max-width: 0;
  opacity: 0;
}

/* 桌機 hover 暫時看回文字（手機沒有 hover，靠點擊的 peekLabel） */
@media (hover: hover) {
  .status-tag.is-shrunk:hover .status-tag__label {
    max-width: 8em;
    opacity: 1;
  }
}

.status-tag__badge {
  font-weight: bold;
}

/* 尊重系統的減少動態設定：直接切換、不做過渡 */
@media (prefers-reduced-motion: reduce) {
  .status-tag__label {
    transition: none;
  }
}
</style>
