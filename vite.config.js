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
  --sm-page-bg: ${SURFACE_COLORS.page};
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

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [generateThemeScssPlugin(), vue(), viteSingleFile()],
})
