// 像素小學生共用素材：LoadingGame（側面跑者）與 FieldTimeline（正面 indicator）共用。
// sprite 以字串陣列描述，一字元一像素，'.' 為透明，其餘查 PAL。
// 側面跑者為四幀（觸地A→過渡→觸地B→過渡）；正面 indicator 維持兩幀。
// 兩個 timeline 只取 frame 0/1 當立定/踏步，不受側面加幀影響。
import { THEME_COLORS, SURFACE_COLORS } from '../theme/colors.config.js';

// ==== 人物調色盤（對映 colors.config.js）====
export const PAL = {
  k: '#1c1c22', // 頭髮/黑
  s: '#f2c79c', // 皮膚
  w: SURFACE_COLORS.alert.background, // 制服 = 奶油米
  t: THEME_COLORS.primary.background, // 領帶 = 校徽深藍
  g: THEME_COLORS.info.background, // 褲/裙 = 石墨灰
  b: '#2c2c34', // 黑絲襪
  d: SURFACE_COLORS.alert.text, // 鞋 = 深棕
};

// ==== 側面朝右，12 寬 15 列，四幀跑步（LoadingGame 水平捲軸用）====
// 幀序：0 觸地A（前腿伸出）→ 1 過渡 → 2 觸地B（後腿蹬開）→ 3 過渡；
// 手臂在第 7 列前後擺。跨步不對稱才看得出在跑，不是站著微動。
// 男學生：奶油米襯衫+深藍領帶+石墨灰長褲
export const BOY = [
  [
    '...kkkkkk...',
    '..kkkkkkkk..',
    '..kkkkssss..',
    '..kkkssskss.',
    '..kkkssssss.',
    '..kkkkssss..',
    '..wwwwwwtt..',
    '..wwwwwwtss.',
    '..wwwwwwww..',
    '..wwwwwwww..',
    '..gggggggg..',
    '..gggggggg..',
    '..gg..gggg..',
    '..gg.....gg.',
    '..dd.....dd.',
  ],
  [
    '...kkkkkk...',
    '..kkkkkkkk..',
    '..kkkkssss..',
    '..kkkssskss.',
    '..kkkssssss.',
    '..kkkkssss..',
    '..wwwwwwtt..',
    '.swwwwwwwts.',
    '..wwwwwwww..',
    '..wwwwwwww..',
    '..gggggggg..',
    '..gggggggg..',
    '...gg.ggg...',
    '...gg..gg...',
    '...dd..dd...',
  ],
  [
    '...kkkkkk...',
    '..kkkkkkkk..',
    '..kkkkssss..',
    '..kkkssskss.',
    '..kkkssssss.',
    '..kkkkssss..',
    '..wwwwwwtt..',
    '.sswwwwwwt..',
    '..wwwwwwww..',
    '..wwwwwwww..',
    '..gggggggg..',
    '..gggggggg..',
    '.gggg..gg...',
    '.gg....gg...',
    '.dd....dd...',
  ],
  [
    '...kkkkkk...',
    '..kkkkkkkk..',
    '..kkkkssss..',
    '..kkkssskss.',
    '..kkkssssss.',
    '..kkkkssss..',
    '..wwwwwwtt..',
    '.swwwwwwwts.',
    '..wwwwwwww..',
    '..wwwwwwww..',
    '..gggggggg..',
    '..gggggggg..',
    '..ggg.ggg...',
    '..gg...gg...',
    '..dd...dd...',
  ],
];
// 女學生：鮑伯頭側臉+奶油米襯衫+石墨灰百褶裙+黑絲襪
export const GIRL = [
  [
    '...kkkkkk...',
    '..kkkkkkkk..',
    '..kkkkssss..',
    '..kkkssskss.',
    '..kkkssssss.',
    '..kkkkssss..',
    '..kkwwwwww..',
    '..wwwwwwss..',
    '..wwwwwwww..',
    '..gggggggg..',
    '.gggggggggg.',
    '.gggggggggg.',
    '..bb....bb..',
    '..bb.....bb.',
    '..dd.....dd.',
  ],
  [
    '...kkkkkk...',
    '..kkkkkkkk..',
    '..kkkkssss..',
    '..kkkssskss.',
    '..kkkssssss.',
    '..kkkkssss..',
    '..kkwwwwww..',
    '.swwwwwwss..',
    '..wwwwwwww..',
    '..gggggggg..',
    '.gggggggggg.',
    '.gggggggggg.',
    '...bb..bb...',
    '...bb..bb...',
    '...dd..dd...',
  ],
  [
    '...kkkkkk...',
    '..kkkkkkkk..',
    '..kkkkssss..',
    '..kkkssskss.',
    '..kkkssssss.',
    '..kkkkssss..',
    '..kkwwwwww..',
    '.sswwwwww...',
    '..wwwwwwww..',
    '..gggggggg..',
    '.gggggggggg.',
    '.gggggggggg.',
    '.bb....bb...',
    '.bb....bb...',
    '.dd....dd...',
  ],
  [
    '...kkkkkk...',
    '..kkkkkkkk..',
    '..kkkkssss..',
    '..kkkssskss.',
    '..kkkssssss.',
    '..kkkkssss..',
    '..kkwwwwww..',
    '.swwwwwwss..',
    '..wwwwwwww..',
    '..gggggggg..',
    '.gggggggggg.',
    '.gggggggggg.',
    '..bb...bb...',
    '..bb...bb...',
    '..dd...dd...',
  ],
];

// ==== 蹲下（鑽藍鵲）專用姿勢：12 寬 12 列，比站姿矮 3px ====
// 舊做法是把站姿頂端 3 列切掉（squashTop），視覺上是「頭頂被削掉一塊」很怪；
// 改成獨立低姿勢圖——頭完整，只是壓低前傾、大腿/膝/小腿/鞋各一列，蹲得出膝蓋。
export const STAND_H = 15;
export const DUCK_H = 12;
export const BOY_DUCK = [
  [
    '.....kkkkk..',
    '....kkkkssss',
    '....kkksskss',
    '....kkssssss',
    '.....kssss..',
    '..wwwwwwwss.',
    '.wwwwwwwtt..',
    '.wwwwwwww...',
    '.gggggggg...',
    '..ggg.ggg...',
    '..gg...gg...',
    '..dd...dd...',
  ],
  [
    '.....kkkkk..',
    '....kkkkssss',
    '....kkksskss',
    '....kkssssss',
    '.....kssss..',
    '..wwwwwwwss.',
    '.wwwwwwwtt..',
    '.wwwwwwww...',
    '.gggggggg...',
    '..gg..gggg..',
    '..gg....gg..',
    '..dd....dd..',
  ],
];
export const GIRL_DUCK = [
  [
    '.....kkkkk..',
    '....kkkkssss',
    '....kkksskss',
    '....kkssssss',
    '...kkkssss..',
    '..kwwwwwwss.',
    '.wwwwwwww...',
    '.wwwwwwww...',
    'gggggggggg..',
    '.ggggggggg..',
    '..bb...bb...',
    '..dd...dd...',
  ],
  [
    '.....kkkkk..',
    '....kkkkssss',
    '....kkksskss',
    '....kkssssss',
    '...kkkssss..',
    '..kwwwwwwss.',
    '.wwwwwwww...',
    '.wwwwwwww...',
    'gggggggggg..',
    '.ggggggggg..',
    '..bb..bb....',
    '..dd..dd....',
  ],
];

// ==== 正面朝向使用者，8 寬 10 列，兩幀：立定/踏步（FieldTimeline 垂直導航用）====
// 男學生正面：短髮露臉頰+領帶+長褲，踏步幀抬右腳
export const BOY_FRONT = [
  [
    '..kkkk..',
    '.kkkkkk.',
    '.skssks.',
    '.ssssss.',
    'wwwttwww',
    '.wwttww.',
    '.gggggg.',
    '.gg..gg.',
    '.gg..gg.',
    '.dd..dd.',
  ],
  [
    '..kkkk..',
    '.kkkkkk.',
    '.skssks.',
    '.ssssss.',
    '.wwttww.',
    'wwwttwww',
    '.gggggg.',
    '.gg..gg.',
    '.gg..dd.',
    '.dd.....',
  ],
];
// 女學生正面：鮑伯頭包住臉側+百褶裙+黑絲襪，踏步幀抬右腳
export const GIRL_FRONT = [
  [
    '..kkkk..',
    '.kkkkkk.',
    'kskssksk',
    'kssssssk',
    '.wwwwww.',
    '.wwwwww.',
    '.gggggg.',
    'gggggggg',
    '.bb..bb.',
    '.dd..dd.',
  ],
  [
    '..kkkk..',
    '.kkkkkk.',
    'kskssksk',
    'kssssssk',
    '.wwwwww.',
    '.wwwwww.',
    '.gggggg.',
    'gggggggg',
    '.bb..dd.',
    '.dd.....',
  ],
];

// override：換色（LoadingGame 撿到外套換制服色 { w, t }）。
// 舊的 squashTop 參數已移除——蹲下改用 BOY_DUCK/GIRL_DUCK 獨立姿勢
export function drawSprite(ctx, rows, x, y, override = null) {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      const color = (override && override[ch]) || PAL[ch];
      if (ch !== '.' && color) {
        ctx.fillStyle = color;
        ctx.fillRect(x + c, y + r, 1, 1);
      }
    }
  }
}
