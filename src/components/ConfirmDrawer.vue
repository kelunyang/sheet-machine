<template>
  <el-drawer
    v-model="state.show"
    direction="ttb"
    :size="state.size"
    :show-close="false"
    :title="state.title"
    @close="onClose"
  >
    <el-space direction="vertical" fill wrap style="width: 100%">
      <div class="confirm-message">{{ state.message }}</div>
      <template v-if="state.mode === 'prompt'">
        <el-input
          v-model="state.inputValue"
          size="large"
          class="xs12"
          :placeholder="state.inputPlaceholder"
          clearable
          @keyup.enter="settleConfirm()"
        />
        <div class="alertWord" v-if="state.inputError !== ''">{{ state.inputError }}</div>
      </template>
      <el-button class="ma1 pa2 xs12" size="large" :type="confirmType" @click="settleConfirm()">
        {{ state.confirmButtonText }}
      </el-button>
      <el-button class="ma1 pa2 xs12" size="large" type="info" @click="settleCancel()">
        {{ state.cancelButtonText }}
      </el-button>
    </el-space>
  </el-drawer>
</template>

<script setup>
import { computed } from 'vue';
import {
  useConfirmDrawerState,
  settleConfirm,
  settleCancel,
} from '../composables/useConfirmDrawer';

// ElMessageBox 的 drawer 替代品（單例，App.vue 掛一顆）：
// 狀態與 Promise 的 settle 全在 useConfirmDrawer，本元件只負責畫面
const state = useConfirmDrawerState();

// warning 型的確認（作廢簽名/覆蓋暫存等不可逆動作）確認鈕用 danger 紅，其餘藍
const confirmType = computed(() => (state.type === 'warning' ? 'danger' : 'primary'));

// ESC / 點遮罩關閉視同取消；settle 過的話 pending 已清空，這裡是 no-op
function onClose() {
  settleCancel();
}
</script>

<style scoped>
.confirm-message {
  font-size: 1.2em;
  line-height: 1.6;
  white-space: pre-line;
}
</style>
