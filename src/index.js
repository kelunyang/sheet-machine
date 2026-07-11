import { createApp } from 'vue'
import ElementPlus from 'element-plus'
// Element Plus CSS 改由 index.html 的 CDN <link> 供應（見單檔紅線已解除、改走 CDN），
// 主題覆寫（style.scss）由 Vite 內聯進 <head>，排在 EP CSS <link> 之後才吃得到
import './style.scss'
import App from './App.vue'

// 圖示改用 FontAwesome CDN（index.html 掛 cdnjs，模板用 <i class="fa-solid/fa-brands">），
// 不再全域註冊 @element-plus/icons-vue；el-icon 外殼仍由 element-plus 提供、其內部 chrome 圖示自帶。

// 走到這行代表 vendor library 已從 CDN 載完（import 都 resolve 了）→ 首屏載入條衝到 80%；
// 罩幕的淡出交給 App.vue mount 後呼叫 window.hideInitialLoading（見 index.html 的載入動畫）
if (typeof window.appLoadingProgress === 'function') {
  window.appLoadingProgress()
}

const app = createApp(App)
app.use(ElementPlus)
app.mount('#app')
