/**
 * 主題配色單一來源（WCAG AA 合規）
 *
 * 架構參考 scoringSystem-cf 的主題系統：本檔是唯一的配色定義，
 * vite.config.js 的 generateThemeScssPlugin 會在建置時讀取本檔，
 * 生成 src/styles/_theme-generated.scss（:root CSS 變數 + Element Plus 變數覆寫）；
 * JS 元件（如問卷列表 tag 取色）也從本檔的 getter 取同一套色。
 *
 * 色盤來源：像素化的學校 logo（#020180 深藍、#00A000 綠、#FFFFFF 白）
 * + 補色（#EAB88F 蜜桃橘、#EFE0C8 奶油米、#5B5B5D 石墨灰），2026-07-08 定案。
 * contrast 欄位為 background 與 text 的 WCAG 實測對比度（AA 需 ≥ 4.5:1）。
 */

export const THEME_COLORS = {
  primary: {
    background: '#020180',
    text: '#ffffff',
    hover: '#01015c',
    contrast: 15.9,
    description: '校徽深藍 - 主要操作（WCAG AA 合規）',
    gradient: {
      start: '#4b4bd8',
      end: '#01004d',
    },
  },
  success: {
    background: '#008000',
    text: '#ffffff',
    contrast: 5.1,
    hover: '#006700',
    description: '校徽綠（#00A000 配白字僅 3.5:1，加深至 AA 合規）',
    gradient: {
      start: '#3fbf3f',
      end: '#005900',
    },
  },
  warning: {
    background: '#eab88f',
    text: '#4a2b12',
    contrast: 7.1,
    hover: '#e2a672',
    // 淺底色的 warning 在淺色背景（alert light-9）上當文字色會不及格，
    // 另備深化版給「淺底深字」場合使用（對 light-9 底實測 5.0:1）
    onLight: '#a05a20',
    description: '蜜桃橘 - 警告操作（淺底配深棕字，WCAG AA 合規）',
    gradient: {
      start: '#f7d6b8',
      end: '#d98e4f',
    },
  },
  danger: {
    background: '#c0392b',
    text: '#ffffff',
    contrast: 5.4,
    hover: '#a93226',
    description: '珊瑚紅 - 送出/危險操作（色盤補色，與蜜桃橘協調，WCAG AA 合規）',
    gradient: {
      start: '#ff8a75',
      end: '#8e2418',
    },
  },
  info: {
    background: '#5b5b5d',
    text: '#ffffff',
    contrast: 6.8,
    hover: '#4a4a4c',
    description: '石墨灰 - 資訊/查看操作（WCAG AA 合規）',
    gradient: {
      start: '#8c8c90',
      end: '#3a3a3c',
    },
  },
};

/** 頁面層級色（非語義色） */
export const SURFACE_COLORS = {
  // 2026-07-10 配色語意重整（plan/plan.md Phase 7）：頁面底色回歸白（反正被全螢幕 drawer 遮住），
  // 奶油米轉職為 el-alert 專用底色（info/warning 提示），配深棕字（實測對比 9.8:1，AA 合規）
  alert: {
    background: '#efe0c8',
    text: '#4a2b12',
    contrast: 9.8,
  },
};

/**
 * 問卷列表 tag 的循環色盤（取代 randomcolor）
 *
 * 只收「底色 + 文字色」都合規的組合；奶油米太接近頁面底色故不納入。
 *
 * @returns {Array<{background: string, text: string}>}
 */
export function getTagPalette() {
  return ['primary', 'success', 'danger', 'info', 'warning'].map((type) => ({
    background: THEME_COLORS[type].background,
    text: THEME_COLORS[type].text,
  }));
}

/**
 * 取得語義色完整設定
 *
 * @param {string} type - primary | success | warning | danger | info
 * @returns {object} 色彩設定（查無時回傳 info）
 */
export function getThemeColorConfig(type) {
  return THEME_COLORS[type] || THEME_COLORS.info;
}

/**
 * 糖果漸層（邊緣融合版）：[主色 0%] → [亮色 15%] → [深色 85%] → [主色 100%]
 *
 * @param {string} type - primary | success | warning | danger | info
 * @returns {string} CSS linear-gradient 字串
 */
export function getThemeGradient(type) {
  const config = getThemeColorConfig(type);
  return `linear-gradient(90deg, ${config.background} 0%, ${config.gradient.start} 15%, ${config.gradient.end} 85%, ${config.background} 100%)`;
}
