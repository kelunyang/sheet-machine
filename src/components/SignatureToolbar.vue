<template>
  <div class="signature-toolbar drawer-sticky-top">
    <JwtCountdownBar
      v-if="showJwt"
      :remaining-time="remainingTime"
      :session-percentage="sessionPercentage"
      :renewing="renewing"
      @renew="emit('renew')"
    />
    <CollapsibleControls :active="signatureCount > 0 || hasInvites">
      <div v-if="signatureCount > 0 || hasInvites" class="signature-toolbar__controls">
        <el-button v-if="signatureCount > 1" size="large" type="primary" @click="emit('next')">
          <el-icon class="el-icon--left"><i class="fa-solid fa-arrow-right"></i></el-icon>
          下一個簽名（{{ currentIndex + 1 }}／{{ signatureCount }}）
        </el-button>
        <el-button v-if="signatureCount > 0" size="large" type="success" @click="emit('clear')">
          <el-icon class="el-icon--left"><i class="fa-solid fa-trash-can"></i></el-icon>
          清除簽名
        </el-button>
        <el-button v-if="canInvite && signatureCount > 0" size="large" type="info" :loading="inviteBusy" @click="emit('invite')">
          <el-icon class="el-icon--left"><i class="fa-solid fa-paper-plane"></i></el-icon>
          遠端簽名
        </el-button>
        <el-button v-if="hasInvites" size="large" type="warning" :loading="inviteBusy" @click="emit('refresh')">
          <el-icon class="el-icon--left"><i class="fa-solid fa-arrows-rotate"></i></el-icon>
          更新邀請狀態
        </el-button>
      </div>
    </CollapsibleControls>
  </div>
</template>

<script setup>
import JwtCountdownBar from './JwtCountdownBar.vue';
import CollapsibleControls from './CollapsibleControls.vue';

// 簽名確認 drawer 的 sticky 控制列（比照 FormToolbar）：JWT 倒數條＋
// 「下一個簽名／清除簽名／遠端簽名」＋「更新邀請狀態」。前三顆作用於當前輪播格
// （簽誰由 body 內的警告 alert 說明），更新邀請狀態是全格共用；
// 本機沒有待簽格也沒有邀請時只剩 JWT 條。
// Phase 22：按鈕群包進 CollapsibleControls——手機往下捲時自動收成 handle
// （JWT 條留著），點 handle 展開；桌機/平板不受影響。
defineProps({
  showJwt: { type: Boolean, default: false },
  remainingTime: { type: Number, default: 0 },
  sessionPercentage: { type: Number, default: 0 },
  renewing: { type: Boolean, default: false },
  // 本機待簽格數；0 = 全部遠端簽完或無簽名格
  signatureCount: { type: Number, default: 0 },
  currentIndex: { type: Number, default: 0 },
  // 遠端簽名邀請與線上暫存綁定（draftEnabled && !viewOnly）
  canInvite: { type: Boolean, default: false },
  inviteBusy: { type: Boolean, default: false },
  // 有任何邀請卡（pending/expired/signed）才顯示「更新邀請狀態」
  hasInvites: { type: Boolean, default: false },
});

const emit = defineEmits(['renew', 'next', 'clear', 'invite', 'refresh']);
</script>

<style scoped>
.signature-toolbar {
  background: var(--el-bg-color, #fff);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
}

.signature-toolbar__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px var(--el-drawer-padding-primary, 20px);
}

/* 間距交給 flex gap，抵銷 Element Plus 相鄰按鈕的預設 margin */
.signature-toolbar__controls .el-button + .el-button {
  margin-left: 0;
}

/* 手機直式：按鈕撐滿寬度平均分配，避免擠成一團 */
@media (max-width: 768px) {
  .signature-toolbar__controls > * {
    flex: 1 1 auto;
  }

  .signature-toolbar__controls :deep(.el-button) {
    width: 100%;
  }
}
</style>
