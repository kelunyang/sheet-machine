// LoadingGame 的共用素材與尺寸常數：2D（loadingScene2d.js）與 3D（loadingScene3d.js）
// 兩個 renderer 讀同一份，美術與碰撞尺寸才不會走鐘。
// 遊戲座標系一律用 240x80 的「螢幕像素」；3D 換算成世界座標（1 px = 1 unit）。
// 小人 sprite 在 utils/pixelSprites.js（與兩個 timeline 共用），這裡只放遊戲自己的道具。
import { THEME_COLORS, SURFACE_COLORS } from '../theme/colors.config.js';

export const SCREEN_W = 240;
export const SCREEN_H = 80;
export const SCALE = 3; // 2D 緩衝放大倍率（240x80 → 720x240）
export const GROUND_Y = 66;
export const BIRD_Y = GROUND_Y - 17; // 站著會撞頭、蹲下（矮 3px）剛好鑽過

// ==== 場景配色（校舍/招牌走配色表，其餘天空樹木等像素畫用色沿用既有字面值）====
export const BRICK = THEME_COLORS.danger.background; // 校舍紅磚 = 珊瑚紅
export const BRICK_DARK = THEME_COLORS.danger.gradient.end; // 陰影/屋簷
export const CREAM = SURFACE_COLORS.alert.background; // 建築米色橫帶
export const WINDOW = '#5b7a8c'; // 窗玻璃（背光）
export const WINDOW_LIT = '#ffd98a'; // 亮燈的窗
export const MSG_BONUS = THEME_COLORS.success.gradient.start; // 深色卡上的加分訊息（亮綠）
export const MSG_PENALTY = THEME_COLORS.danger.gradient.start; // 扣分訊息（亮紅）
// 穿上外套：制服(w)換紅、領帶(t)收進外套變深色
export const JACKET_ON = { w: THEME_COLORS.danger.background, t: '#2c2c34' };

// ==== 障礙物：跨欄（跳）/ 小黑狗（跳）/ 台灣藍鵲（蹲）====
export const OBSTACLE_NAMES = { hurdle: '跨欄', dog: '小黑狗', bird: '藍鵲' };
// 小黑狗：面朝左、白鼻子，蹲坐在跑道上（11x6，兩幀）
export const DOG_PAL = { K: '#1c1c22', W: '#f4f0e0' };
export const DOG = [
  ['.K.......K.', '.KKK.....KK', 'WKKKKKKKKK.', '.KKKKKKKKK.', '..KK...KK..', '..KK...KK..'],
  ['.K.......K.', '.KKK.....KK', 'WKKKKKKKKK.', '.KKKKKKKKK.', '.KK.....KK.', '.KK.....KK.'],
];
// 台灣藍鵲：黑頭紅嘴、藍身、長尾白尾尖，飛在頭部高度（14x4，兩幀拍翅）
export const BIRD_PAL = { B: '#2f6bd8', K: '#1c1c22', R: '#d84c30', W: '#f4f0e0' };
export const BIRD = [
  ['...BB.........', 'RKKBBBB.......', '.KBBBBBBBBBBW.', '..............'],
  ['..............', 'RKKBBBB.......', '.KBBBBBBBBBBW.', '...BB.........'],
];

// ==== 加分物件 ====
// 書包：黑色後背包，上蓋+銀色扣具+中央反光條
const BAG_PAL = { K: '#1c1c22', G: '#c8c8c4', W: '#f4f0e0' };
const BAG = [
  '..KKKK..',
  '.KKKKKK.',
  '.KKGGKK.',
  '.KKKKKK.',
  '.KKWKKK.',
  '.KKWKKK.',
  '.KKWKKK.',
  '..KKKK..',
];
// 射擊隊外套：紅底、深色肩袖、白色拉鍊
const JACKET_PAL = { R: THEME_COLORS.danger.background, K: '#2c2c34', W: '#f4f0e0' };
const JACKET = ['.RRRRRR.', 'KRRWWRRK', 'KR.WW.RK', 'KR.WW.RK', '.R.RR.R.'];
// 競賽氣手槍：黑色長槍管、金色氣瓶、木紋握把
const PISTOL_PAL = { K: '#2c2c34', Y: '#c8a048', B: '#5a4632' };
const PISTOL = ['KKKKKKKKKK.', 'YYYYYYYYKK.', '........KK.', '.......BBB.', '.......BB..'];
// 天文望遠鏡：斜指天空的鏡筒（白色鏡頭端）+ 三腳架
const SCOPE_PAL = { G: '#8c98a8', K: '#2c2c34', W: '#f4f0e0' };
const SCOPE = [
  '.........GW',
  '........GGG',
  '.......GGG.',
  '......GGG..',
  '.....GGG...',
  '....KGG....',
  '....KK.....',
  '...K.K.K...',
  '..K..K..K..',
];
export const PICKUP_DEFS = [
  { key: 'bag', name: '書包', rows: BAG, pal: BAG_PAL, w: 8, h: 8 },
  { key: 'jacket', name: '射擊隊外套', rows: JACKET, pal: JACKET_PAL, w: 8, h: 5 },
  { key: 'pistol', name: '氣手槍', rows: PISTOL, pal: PISTOL_PAL, w: 11, h: 5 },
  { key: 'scope', name: '天文望遠鏡', rows: SCOPE, pal: SCOPE_PAL, w: 11, h: 9 },
];

// ==== 校園段落寬度：2D 的 SEGMENTS 與 3D 的建物群共用同一份排列與循環長度 ====
// 依序：行政大樓／樹帶／教學樓C／籃球場／教學樓D＋花圃／樹帶（短）／圖書館／科學館
export const SEGMENT_WIDTHS = [150, 56, 130, 90, 120, 40, 112, 132];
export const CYCLE = SEGMENT_WIDTHS.reduce((sum, w) => sum + w, 0);
