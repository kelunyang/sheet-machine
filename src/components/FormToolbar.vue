<template>
  <div class="form-toolbar drawer-sticky-top">
    <JwtCountdownBar
      v-if="showJwt"
      :remaining-time="remainingTime"
      :session-percentage="sessionPercentage"
      :renewing="renewing"
      @renew="emit('renew')"
    />
    <div class="form-toolbar__controls">
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
  </div>
</template>

<script setup>
import JwtCountdownBar from './JwtCountdownBar.vue';

// 填問卷 drawer 的 sticky 控制列（Phase 9）：JWT 倒數條＋「暫存 ▾」dropdown＋
// 下載上次結果＋編輯/唯讀雙態按鈕。drawer 為 with-header=false
// （標題是 body 內會捲走的 .drawer-flow-title），捲動時整條升到視窗最頂 y=0
// （.drawer-sticky-top）。viewOnly 時只剩 JWT 條與（若有）下載鈕。
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

/* 手機直式：按鈕撐滿寬度平均分配，避免擠成一團 */
@media (max-width: 768px) {
  .form-toolbar__controls > * {
    flex: 1 1 auto;
  }

  .form-toolbar__controls :deep(.el-button) {
    width: 100%;
  }
}
</style>
