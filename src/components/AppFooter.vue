<template>
  <div class="footerText">
    Developer:
    <a class="cleanLink" href="mailto:kelunyang@outlook.com">Kelunyang</a>@LKSH {{ year }}
    · by claude since 2026 with
    <i class="fa-solid fa-heart" aria-label="愛心"></i>
    ·
    <a
      style="color: #ccc"
      target="_blank"
      href="https://github.com/kelunyang/sheet-machine"
    >
      <i class="fa-brands fa-github" aria-label="GitHub"></i>
    </a>
  </div>
</template>

<script setup>
import dayjs from 'dayjs';

// footer 版權列單一來源（原本 App.vue 兩處硬編碼）：年份用 dayjs 自動取當年，跨年不需手改。
// 圖示走 FontAwesome CDN（愛心 fa-heart、GitHub fa-brands fa-github），github 連結沿用舊值。
const year = dayjs().format('YYYY');
</script>
