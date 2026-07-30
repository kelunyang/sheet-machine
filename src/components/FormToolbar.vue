<template>
  <div class="form-toolbar drawer-sticky-top">
    <JwtCountdownBar
      v-if="showJwt"
      :remaining-time="remainingTime"
      :session-percentage="sessionPercentage"
      :renewing="renewing"
      @renew="emit('renew')"
    />
    <CollapsibleControls :active="!viewOnly || hasLastSubmit">
      <div class="form-toolbar__controls">
        <!-- 「暫存 ▾」與狀態 tag 群同一列左右對開（Phase 27）：按鈕靠左、tag 靠右，
             手機也維持同一列（不套用下方 @media 的整寬規則） -->
        <div class="form-toolbar__row">
          <el-dropdown v-if="!viewOnly" trigger="click" @command="onCommand">
            <el-button size="large" type="info">
              暫存<el-icon class="el-icon--right"><i class="fa-solid fa-chevron-down"></i></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-if="draftEnabled"
                  command="draft"
                  :disabled="!tempFound || draftSaving"
                >
                  {{ draftSaving ? '線上暫存中，請稍候…' : '線上暫存（存到雲端跨裝置用）' }}
                </el-dropdown-item>
                <el-dropdown-item command="export" :disabled="!tempFound">
                  匯出暫存答案（加密檔）
                </el-dropdown-item>
                <el-dropdown-item command="import">匯入暫存答案</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <FormStatusTags
            :submit-count="submitCount"
            :last-submit-at="lastSubmitAt"
            :temp-found="tempFound"
            :local-draft-at="localDraftAt"
            :online-draft-at="onlineDraftAt"
          />
        </div>
        <el-button v-if="hasLastSubmit" size="large" type="success" @click="emit('download-result')">
          下載上次結果
        </el-button>
        <el-button
          v-if="!viewOnly"
          size="large"
          :type="enableModify ? 'success' : 'primary'"
          @click="emit('update:enableModify', !enableModify)"
        >
          <el-icon class="el-icon--left"><i v-if="enableModify" class="fa-solid fa-pen-to-square"></i><i v-else class="fa-solid fa-lock"></i></el-icon>
          {{ enableModify ? '修改中，點我鎖回唯讀' : '目前唯讀，點我修改' }}
        </el-button>
      </div>
      <!-- 手機收合後仍露出狀態 tag（#peek）：填答次數與備份狀態不該被 handle 藏起來。
           與上面那份各自計時、外觀一致（同一個元件、同一組 props） -->
      <template #peek>
        <FormStatusTags
          :submit-count="submitCount"
          :last-submit-at="lastSubmitAt"
          :temp-found="tempFound"
          :local-draft-at="localDraftAt"
          :online-draft-at="onlineDraftAt"
        />
      </template>
    </CollapsibleControls>
  </div>
</template>

<script setup>
import JwtCountdownBar from './JwtCountdownBar.vue';
import CollapsibleControls from './CollapsibleControls.vue';
import FormStatusTags from './FormStatusTags.vue';

// 填問卷 drawer 的 sticky 控制列（Phase 9）：JWT 倒數條＋「暫存 ▾」dropdown＋
// 下載上次結果＋編輯/唯讀雙態按鈕。drawer 為 with-header=false
// （標題是 body 內會捲走的 .drawer-flow-title），捲動時整條升到視窗最頂 y=0
// （.drawer-sticky-top）。viewOnly 時只剩 JWT 條與（若有）下載鈕。
// Phase 22：按鈕群包進 CollapsibleControls——手機往下捲時自動收成 handle
// （JWT 條留著），點 handle 展開；桌機/平板不受影響。
defineProps({
  showJwt: { type: Boolean, default: false },
  remainingTime: { type: Number, default: 0 },
  sessionPercentage: { type: Number, default: 0 },
  renewing: { type: Boolean, default: false },
  tempFound: { type: Boolean, default: false },
  draftEnabled: { type: Boolean, default: false },
  draftSaving: { type: Boolean, default: false },
  viewOnly: { type: Boolean, default: false },
  hasLastSubmit: { type: Boolean, default: false },
  // 雙態按鈕（不用 el-switch，按鈕外觀直接反映狀態）雙向綁定
  enableModify: { type: Boolean, default: false },
  // 狀態 tag 群（Phase 27）：已送出次數／最後送出時間／本機與雲端暫存時間
  submitCount: { type: Number, default: 0 },
  lastSubmitAt: { type: [Number, String], default: 0 },
  localDraftAt: { type: Number, default: 0 },
  onlineDraftAt: { type: Number, default: 0 },
});

const emit = defineEmits([
  'update:enableModify',
  'renew',
  'save-draft',
  'export-temp',
  'import-temp',
  'download-result',
]);

function onCommand(command) {
  if (command === 'draft') {
    emit('save-draft');
  } else if (command === 'export') {
    emit('export-temp');
  } else if (command === 'import') {
    emit('import-temp');
  }
}
</script>

<style scoped>
.form-toolbar {
  background: var(--el-bg-color, #fff);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
}

.form-toolbar__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px var(--el-drawer-padding-primary, 20px);
}

/* 間距交給 flex gap，抵銷 Element Plus 相鄰按鈕的預設 margin */
.form-toolbar__controls .el-button + .el-button {
  margin-left: 0;
}

/* 「暫存 ▾」＋狀態 tag 群：桌機不獨佔一列——寬度貼齊內容，讓後面的
   「下載上次結果」「鎖定/修改」接在同一列（暫存→tags→下載→鎖定）。
   手機才變成整寬左右對開（見下方 @media） */
.form-toolbar__row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

/* 手機直式：按鈕撐滿寬度平均分配，避免擠成一團 */
@media (max-width: 768px) {
  .form-toolbar__controls > * {
    flex: 1 1 auto;
  }

  .form-toolbar__controls :deep(.el-button) {
    width: 100%;
  }

  /* 手機：暫存鈕與 tag 群整寬左右對開（暫存靠左、tag 靠右），
     「下載上次結果」「鎖定/修改」維持各佔整列 */
  .form-toolbar__row {
    width: 100%;
    justify-content: space-between;
  }

  .form-toolbar__row :deep(.el-button) {
    width: auto;
  }
}
</style>
