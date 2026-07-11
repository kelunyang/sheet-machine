import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

// Google Apps Script 執行環境的全域物件（後端 Code.js 與 tools/ 手動腳本用）
const gasGlobals = {
  SpreadsheetApp: 'readonly',
  PropertiesService: 'readonly',
  HtmlService: 'readonly',
  Session: 'readonly',
  LockService: 'readonly',
  DriveApp: 'readonly',
  CacheService: 'readonly',
  UrlFetchApp: 'readonly',
  Utilities: 'readonly',
  MailApp: 'readonly',
  ScriptApp: 'readonly',
  Logger: 'readonly',
  LodashGS: 'readonly',
  console: 'readonly',
};

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'appscript/**', 'index.html'],
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    // 前端：GAS web app 內嵌頁面（google.script 橋接 + CDN 載入的 PapaParse）
    files: ['src/**/*.{js,vue}'],
    ignores: ['src/Code.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        google: 'readonly',
        Papa: 'readonly',
      },
    },
  },
  {
    // 模板綁定完整性：script setup 沒宣告的識別字直接視為錯誤
    files: ['src/**/*.vue'],
    rules: {
      'vue/no-undef-properties': 'error',
      // 欄位物件（column）由父層共享、子元件就地驗證與寫值是本專案既有資料流
      'vue/no-mutating-props': ['error', { shallowOnly: true }],
    },
  },
  {
    // 後端：Google Apps Script（clasp 推送，非 ES module）
    files: ['src/Code.js', 'tools/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: gasGlobals,
    },
    rules: {
      // GAS 的 RPC 進入點由平台呼叫、最上層函數跨檔案共用：只檢查區域變數
      'no-unused-vars': ['warn', { args: 'none', vars: 'local' }],
    },
  },
  {
    // Node 環境：建置設定與測試
    files: ['vite.config.js', 'vitest.config.js', 'eslint.config.js', 'tests/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  prettierConfig,
];
