import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { writeFileSync, mkdirSync } from 'fs'
import { THEME_COLORS, SURFACE_COLORS, getThemeGradient } from './src/theme/colors.config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// sass 的 mix()：weight 為第一色佔比
function mix(hexA, hexB, weight) {
  const parse = (h) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16))
  const [a, b] = [parse(hexA), parse(hexB)]
  return (
    '#' +
    a
      .map((v, i) =>
        Math.round(v * weight + b[i] * (1 - weight))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  )
}

// 依 Element Plus theme-chalk 的公式生成整組色階變數：
// light-N = mix(白, 主色, N*10%)、dark-2 = mix(黑, 主色, 20%)
function elColorFamily(name, base) {
  const lines = [`  --el-color-${name}: ${base};`]
  for (const i of [3, 5, 7, 8, 9]) {
    lines.push(`  --el-color-${name}-light-${i}: ${mix('#ffffff', base, i / 10)};`)
  }
  lines.push(`  --el-color-${name}-dark-2: ${mix('#000000', base, 0.2)};`)
  return lines.join('\n')
}

/**
 * 自動生成主題 SCSS 變數的 Vite 插件（架構搬自 scoringSystem-cf）
 *
 * buildStart 時讀 src/theme/colors.config.js 生成 src/styles/_theme-generated.scss，
 * 改配色只需改 config，不碰任何樣式檔。
 */
function generateThemeScssPlugin() {
  return {
    name: 'generate-theme-scss',
    buildStart() {
      const scssContent = `// ========================================
// 🎨 自動生成的主題變數 - 請勿手動編輯
// ========================================
// 來源: src/theme/colors.config.js
// 此檔由 vite.config.js 的 generateThemeScssPlugin 在建置時生成，
// 手動修改會在下次建置時被覆蓋。如需改配色請編輯 colors.config.js。
// ========================================

:root {
  // Element Plus 語義色覆寫（含 EP 衍生色階，el-button/el-alert/el-tag/el-steps 一次換色）
${Object.entries(THEME_COLORS)
  .map(([type, config]) => `  // ${type}: ${config.description}\n${elColorFamily(type, config.background)}`)
  .join('\n')}

  // EP 的 error 色系（el-alert type="error" 等）對齊 danger
${elColorFamily('error', THEME_COLORS.danger.background)}

  // 主題自有變數（文字色 / 糖果漸層 / 頁面底色）
${Object.entries(THEME_COLORS)
  .map(([type, config]) => {
    const lines = [
      `  --sm-${type}-text: ${config.text};`,
      `  --sm-${type}-gradient: ${getThemeGradient(type)};`,
    ]
    if (config.onLight) lines.push(`  --sm-${type}-on-light: ${config.onLight};`)
    return lines.join('\n')
  })
  .join('\n')}
  --sm-alert-bg: ${SURFACE_COLORS.alert.background};
  --sm-alert-text: ${SURFACE_COLORS.alert.text};
}
`
      const outputDir = resolve(__dirname, 'src/styles')
      mkdirSync(outputDir, { recursive: true })
      const outputPath = resolve(outputDir, '_theme-generated.scss')
      writeFileSync(outputPath, scssContent)
      console.log('✅ [Theme Plugin] 主題 SCSS 已生成:', outputPath)
    },
  }
}

// 執行期由 CDN 供應的依賴：建置時標成 external（不打進 bundle），
// 由下方注入的 import map 在瀏覽器端解析到 esm.sh。element-plus 帶 ?external=vue，
// 讓它 import 裸名 "vue" 由同一份 import map 解析，全站共用單一 vue 實例。
// @element-plus/icons-vue 未被 src 直接 import（僅 element-plus 內部相依），故不列入、
// 由 esm.sh 的 element-plus build 自行內含。
const CDN_IMPORT_MAP = {
  imports: {
    vue: 'https://esm.sh/vue@3.5.39',
    'element-plus': 'https://esm.sh/element-plus@2.14.2?external=vue',
    lodash: 'https://esm.sh/lodash@4.18.1',
    dayjs: 'https://esm.sh/dayjs@1.11.21',
    dompurify: 'https://esm.sh/dompurify@3.4.11',
    marked: 'https://esm.sh/marked@18.0.5',
    signature_pad: 'https://esm.sh/signature_pad@5.1.3',
    uuid: 'https://esm.sh/uuid@14.0.1',
  },
}

/**
 * 建置時把 import map 注入 <head> 最前面（head-prepend），排在 singlefile 內聯的
 * module script 之前，讓瀏覽器解析裸名 import。apply:'build' → dev 不注入
 * （dev 由 Vite 從 node_modules 解析，不需 import map）。
 */
function cdnImportMapPlugin() {
  return {
    name: 'cdn-import-map',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler() {
        return [
          {
            tag: 'script',
            attrs: { type: 'importmap' },
            children: JSON.stringify(CDN_IMPORT_MAP, null, 2),
            injectTo: 'head-prepend',
          },
        ]
      },
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [generateThemeScssPlugin(), cdnImportMapPlugin(), vue(), viteSingleFile()],
  build: {
    rollupOptions: {
      external: Object.keys(CDN_IMPORT_MAP.imports),
    },
  },
})
