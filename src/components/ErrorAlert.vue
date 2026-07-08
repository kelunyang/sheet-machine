<template>
  <el-alert title="發生錯誤" type="error" show-icon v-if="message !== ''">
    <template #default>
      <span style="font-size: 1.5em">{{ message }}</span>
    </template>
  </el-alert>
</template>

<script setup>
defineProps({
  // 錯誤訊息；空字串時整個 alert 不渲染
  message: { type: String, default: '' },
});
</script>
