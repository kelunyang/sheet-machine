<template>
  <div class="loading-game-overlay"></div>
  <!-- 「我不要再看到遊戲了」：極簡文字卡，保留 loading 回饋與反悔入口 -->
  <div v-if="state.hidden" class="loading-game-card loading-game-card--plain">
    <div class="loading-game-label" role="status">{{ plainLabel }}</div>
    <button class="loading-game-restore" type="button" @click="setHidden(false)">
      重新顯示 loading 小遊戲
    </button>
  </div>
  <div v-else class="loading-game-card">
    <canvas
      ref="canvasRef"
      width="720"
      height="240"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    ></canvas>
    <div
      class="loading-game-label"
      role="status"
      :style="eventMsg ? { color: eventColor } : undefined"
    >
      {{ labelLine }}
    </div>
    <div class="loading-game-controls">
      <el-switch v-model="keepPlayingModel" size="small" active-text="載入完成也不結束遊戲" />
      <el-switch v-model="hiddenModel" size="small" active-text="我不要再看到遊戲了" />
      <el-button
        v-if="state.overtime"
        class="loading-game-close"
        size="small"
        type="danger"
        plain
        @click="closeLoadingGame()"
      >
        關閉遊戲
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { THEME_COLORS, SURFACE_COLORS } from '../theme/colors.config.js';
import { BOY, GIRL, drawSprite } from '../utils/pixelSprites.js';
import {
  useLoadingGame,
  useLoadingGameState,
  getGameSession,
  setKeepPlaying,
  setHidden,
  closeLoadingGame,
} from '../composables/useLoadingGame';

// Phase 8：8-bit loading game（規格見 plan/plan.md，程式碼與 demoloading.html 同步）。
// 兩個林口高中制服小人在校園裡跑步跨欄，藏 Chrome 小恐龍式的操控彩蛋：
// WASD／方向鍵／空白鍵，觸控＝拖曳移動、上滑跳、下拉蹲。
// 血條式計分：兩人各 100 分起跳，撞到跨欄/小黑狗/藍鵲扣隨機 10+x 分、
// 撿到加分物件（書包/射擊隊外套/氣手槍/天文望遠鏡，天上或地上隨機出現）加隨機 10+x 分，
// 書包/外套撿到會穿上；有人歸零出記分板問要不要再玩一次。
// 「資料傳輸中」文字列兼遊戲事件看板（撞到/撿到訊息顯示約 1 秒後變回 loading 文案）。
// 隨 useLoadingGame 的 v-if 掛載/卸載，rAF 與鍵盤監聽在生命週期內啟停（防洩漏）；
// 比賽狀態（分數/角色分配/穿戴）存 module 層（getGameSession），跨顯示延續。

const state = useLoadingGameState();
const { loadingGameLabel } = useLoadingGame();
const session = getGameSession();

const canvasRef = ref(null);
const dots = ref('');
const eventMsg = ref('');
const eventColor = ref('');

// 兩個 el-switch 綁 localStorage 開關
const keepPlayingModel = computed({
  get: () => state.keepPlaying,
  set: (value) => setKeepPlaying(value),
});
const hiddenModel = computed({
  get: () => state.hidden,
  set: (value) => setHidden(value),
});

// 看板文字：事件訊息優先，其次依狀態顯示 loading 文案/結算/加班提示
const baseLabel = computed(() => {
  if (state.jobs.length > 0) {
    return loadingGameLabel.value + dots.value;
  }
  if (state.settling) {
    return '載入完成！';
  }
  if (state.overtime) {
    return '載入完成，想玩多久玩多久';
  }
  return loadingGameLabel.value;
});
const labelLine = computed(() => eventMsg.value || baseLabel.value);
const plainLabel = computed(() => loadingGameLabel.value + dots.value);

// ==== 低解析度緩衝：全部畫在 240x80，再放大 3 倍到 720x240（保持像素感）====
const SCREEN_W = 240;
const SCREEN_H = 80;
const SCALE = 3;

// 調色盤與小人 sprite 已抽到 utils/pixelSprites.js（與 FieldTimeline 共用）
const BRICK = THEME_COLORS.danger.background; // 校舍紅磚 = 珊瑚紅
const BRICK_DARK = THEME_COLORS.danger.gradient.end; // 陰影/屋簷
const CREAM = SURFACE_COLORS.alert.background; // 建築米色橫帶
const MSG_BONUS = THEME_COLORS.success.gradient.start; // 深色卡上的加分訊息（亮綠）
const MSG_PENALTY = THEME_COLORS.danger.gradient.start; // 扣分訊息（亮紅）

// ==== 障礙物：跨欄（跳）/ 小黑狗（跳）/ 台灣藍鵲（蹲）====
// 小黑狗：面朝左、白鼻子，蹲坐在跑道上（11x6）
const DOG_PAL = { K: '#1c1c22', W: '#f4f0e0' };
const DOG = [
  [
    '.K.......K.',
    '.KKK.....KK',
    'WKKKKKKKKK.',
    '.KKKKKKKKK.',
    '..KK...KK..',
    '..KK...KK..',
  ],
  [
    '.K.......K.',
    '.KKK.....KK',
    'WKKKKKKKKK.',
    '.KKKKKKKKK.',
    '.KK.....KK.',
    '.KK.....KK.',
  ],
];
// 台灣藍鵲：黑頭紅嘴、藍身、長尾白尾尖，飛在頭部高度（14x4，兩幀拍翅）
const BIRD_PAL = { B: '#2f6bd8', K: '#1c1c22', R: '#d84c30', W: '#f4f0e0' };
const BIRD = [
  ['...BB.........', 'RKKBBBB.......', '.KBBBBBBBBBBW.', '..............'],
  ['..............', 'RKKBBBB.......', '.KBBBBBBBBBBW.', '...BB.........'],
];

const GROUND_Y = 66;
const BIRD_Y = GROUND_Y - 17; // 站著會撞頭、蹲下（矮 3px）剛好鑽過

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
const PICKUP_DEFS = [
  { key: 'bag', name: '書包', rows: BAG, pal: BAG_PAL, w: 8, h: 8 },
  { key: 'jacket', name: '射擊隊外套', rows: JACKET, pal: JACKET_PAL, w: 8, h: 5 },
  { key: 'pistol', name: '氣手槍', rows: PISTOL, pal: PISTOL_PAL, w: 11, h: 5 },
  { key: 'scope', name: '天文望遠鏡', rows: SCOPE, pal: SCOPE_PAL, w: 11, h: 9 },
];

// ==== 生命週期內的遊戲實體 ====
let rafHandle = 0;
let vctx = null;
let ctx = null;
let buf = null;

let t = 0;
let farScroll = 0;
let midScroll = 0;
let groundScroll = 0;
let gameOver = false;

// 角色：分配/分數/穿戴自 module 層延續——user 控其中一個，另一個電腦隨機控制。
// 上一場已分出勝負（有人歸零）就自動開新的一場
if (session.playerScore <= 0 || session.cpuScore <= 0) {
  session.playerScore = 100;
  session.cpuScore = 100;
  session.playerBag = false;
  session.playerJacket = false;
  session.cpuBag = false;
  session.cpuJacket = false;
}

function makeRunner(sprite, label, x, score, bag, jacket) {
  return { sprite, label, x, y: 0, vy: 0, ducking: false, blink: 0, score, bag, jacket };
}
const player = makeRunner(
  session.playerIsGirl ? GIRL : BOY,
  session.playerIsGirl ? '女' : '男',
  92,
  session.playerScore,
  session.playerBag,
  session.playerJacket
);
const cpu = makeRunner(
  session.playerIsGirl ? BOY : GIRL,
  session.playerIsGirl ? '男' : '女',
  48,
  session.cpuScore,
  session.cpuBag,
  session.cpuJacket
);

const obstacles = []; // { type: 'hurdle'|'dog'|'bird', x, w, passedBy: Set, cpuFails }
let nextObstacle = 200;
const pickups = []; // { def, x, y }
let nextPickup = 320;

// ==== 事件看板：撞到/撿到訊息顯示約 1 秒後變回 loading 文案 ====
let msgTimeout = null;
function announce(text, color) {
  eventMsg.value = text;
  eventColor.value = color;
  if (msgTimeout !== null) {
    clearTimeout(msgTimeout);
  }
  msgTimeout = setTimeout(() => {
    msgTimeout = null;
    eventMsg.value = '';
  }, 1000);
}

// ==== 彩蛋輸入：WASD / 方向鍵 / 觸控（只控制 player）；遊戲結束時任一操作＝再玩一次 ====
const keys = {};
const CONTROL_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '];

function onKeyDown(e) {
  const k = e.key.toLowerCase();
  if (gameOver) {
    if ([' ', 'enter', 'w', 'arrowup'].includes(k)) {
      resetGame();
      e.preventDefault();
    }
    return;
  }
  if (CONTROL_KEYS.includes(k)) {
    keys[k] = true;
    session.controlled = true;
    e.preventDefault();
  }
}

function onKeyUp(e) {
  keys[e.key.toLowerCase()] = false;
}

let touchStart = null;

function onPointerDown(e) {
  if (gameOver) {
    resetGame();
    return;
  }
  touchStart = { x: e.clientX, y: e.clientY };
}

function onPointerMove(e) {
  if (!touchStart) {
    return;
  }
  session.controlled = true;
  const dx = e.clientX - touchStart.x;
  const dy = e.clientY - touchStart.y;
  if (dy < -24 && player.y === 0) {
    player.vy = -2.6; // 上滑跳
    touchStart.y = e.clientY;
  }
  player.ducking = dy > 24; // 下拉蹲
  if (Math.abs(dx) > 6) {
    player.x += dx > 0 ? 2 : -2; // 左右拖
    touchStart.x = e.clientX;
  }
}

function onPointerUp() {
  touchStart = null;
  player.ducking = false;
}

// ==== 繪圖 ====
// drawSprite 在 utils/pixelSprites.js（收 ctx 的純函數）

function drawCritter(rows, pal, x, y) {
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const ch = rows[r][c];
      if (ch !== '.' && pal[ch]) {
        ctx.fillStyle = pal[ch];
        ctx.fillRect(x + c, y + r, 1, 1);
      }
    }
  }
}

function drawSky() {
  const bands = ['#9cd4f0', '#aadcf4', '#bce4f8', '#d0eefb'];
  for (let i = 0; i < bands.length; i++) {
    ctx.fillStyle = bands[i];
    ctx.fillRect(0, i * 10, SCREEN_W, 10);
  }
  ctx.fillStyle = '#d0eefb';
  ctx.fillRect(0, 40, SCREEN_W, GROUND_Y - 40);
  ctx.fillStyle = '#ffffff';
  const cx = SCREEN_W - ((t * 0.1) % (SCREEN_W + 60)) - 30;
  ctx.fillRect(cx, 8, 16, 4);
  ctx.fillRect(cx + 4, 5, 10, 3);
  ctx.fillRect(cx + 90, 16, 14, 4);
  ctx.fillRect(cx + 94, 13, 8, 3);
}

// ==== 校園遠景：照空拍圖排成多段循環 ====
function brickBody(x, y, w, h) {
  ctx.fillStyle = BRICK;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = CREAM;
  ctx.fillRect(x, y + 8, w, 2);
  ctx.fillStyle = '#5b7a8c';
  for (let wx = x + 4; wx < x + w - 6; wx += 10) {
    ctx.fillRect(wx, y + 11, 5, 5);
    ctx.fillRect(wx, y + 21, 5, 5);
  }
}

// 教學大樓（照 teacharea.jpg）：紅瓦屋頂、磚身每層陰影開口 + 白欄杆，
// 左角樓掛棟別紅字（照片裡的 C/D 棟）
function teachBody(x, y, w, h, letter) {
  ctx.fillStyle = '#d84c30';
  ctx.fillRect(x - 2, y - 3, w + 4, 3); // 紅瓦屋頂（出簷）
  ctx.fillStyle = BRICK_DARK;
  ctx.fillRect(x - 2, y - 1, w + 4, 1); // 簷下陰影
  ctx.fillStyle = BRICK;
  ctx.fillRect(x, y, w, h);
  for (let fy = y + 3; fy < y + h - 7; fy += 9) {
    ctx.fillStyle = '#5b7a8c';
    for (let wx = x + 10; wx < x + w - 10; wx += 8) {
      ctx.fillRect(wx, fy, 5, 5); // 柱廊開口
    }
    ctx.fillStyle = '#f4f0e0';
    ctx.fillRect(x + 8, fy + 5, w - 16, 1); // 白欄杆帶
  }
  ctx.fillStyle = CREAM;
  ctx.fillRect(x + 1, y + 4, 7, 9); // 角樓字牌
  ctx.fillStyle = BRICK;
  ctx.font = '7px monospace';
  ctx.fillText(letter, x + 2, y + 11);
}

const SEGMENTS = [
  {
    // 行政大樓：頂樓招牌 + 門口大石
    w: 150,
    draw(x) {
      brickBody(x + 8, 22, 118, 34);
      ctx.fillStyle = BRICK_DARK;
      ctx.fillRect(x + 40, 14, 52, 8);
      ctx.fillStyle = CREAM;
      ctx.font = '7px monospace';
      ctx.fillText('林口高中', x + 52, 21);
      ctx.fillStyle = '#c8c8c4';
      ctx.fillRect(x + 130, 48, 14, 8);
      ctx.fillStyle = '#8c8c88';
      ctx.fillRect(x + 132, 50, 10, 2);
    },
  },
  {
    // 樹帶
    w: 56,
    draw(x) {
      for (let i = 0; i < 2; i++) {
        const bx = x + 6 + i * 26;
        ctx.fillStyle = '#3f7a3a';
        ctx.fillRect(bx, 44, 16, 12);
        ctx.fillRect(bx + 3, 40, 10, 5);
        ctx.fillStyle = '#5a4632';
        ctx.fillRect(bx + 7, 56, 2, 4);
      }
    },
  },
  {
    // 教學樓 C 棟（teacharea.jpg 樣式）
    w: 130,
    draw(x) {
      teachBody(x + 4, 26, 116, 30, 'C');
    },
  },
  {
    // 籃球場：圍網 + 籃架
    w: 90,
    draw(x) {
      ctx.fillStyle = '#4a9c6e';
      ctx.fillRect(x + 4, 50, 82, 6);
      ctx.fillStyle = '#9caab4';
      for (let fx = x + 4; fx <= x + 84; fx += 16) {
        ctx.fillRect(fx, 38, 1, 18);
      }
      ctx.fillStyle = '#b8c4cc';
      ctx.fillRect(x + 4, 38, 82, 1);
      ctx.fillRect(x + 4, 44, 82, 1);
      ctx.fillStyle = '#e8e8e0';
      ctx.fillRect(x + 42, 40, 1, 16);
      ctx.fillRect(x + 40, 40, 6, 4);
      ctx.fillStyle = '#d84c30';
      ctx.fillRect(x + 44, 44, 3, 1);
    },
  },
  {
    // 教學樓 D 棟（teacharea.jpg 樣式）＋中庭圓形花圃與玻璃金字塔
    w: 120,
    draw(x) {
      teachBody(x + 4, 24, 100, 32, 'D');
      ctx.fillStyle = '#3f7a3a';
      ctx.fillRect(x + 106, 50, 10, 6);
      ctx.fillRect(x + 108, 48, 6, 2);
      ctx.fillStyle = '#6ab04c';
      ctx.fillRect(x + 108, 51, 6, 3);
      ctx.fillStyle = '#bce4f8';
      ctx.fillRect(x + 110, 46, 2, 2); // 花圃上的玻璃金字塔尖
    },
  },
  {
    // 樹帶（短）
    w: 40,
    draw(x) {
      ctx.fillStyle = '#3f7a3a';
      ctx.fillRect(x + 10, 44, 16, 12);
      ctx.fillRect(x + 13, 40, 10, 5);
      ctx.fillStyle = '#5a4632';
      ctx.fillRect(x + 17, 56, 2, 4);
    },
  },
  {
    // 圖書館（library.jpg）：左側高塔 + 紅字招牌 + 門口雨遮
    w: 112,
    draw(x) {
      ctx.fillStyle = BRICK_DARK;
      ctx.fillRect(x + 5, 12, 18, 2); // 塔頂簷
      ctx.fillStyle = BRICK;
      ctx.fillRect(x + 6, 14, 16, 42);
      ctx.fillStyle = CREAM;
      ctx.fillRect(x + 6, 20, 16, 2); // 塔身橫帶
      ctx.fillStyle = '#5b7a8c';
      ctx.fillRect(x + 10, 25, 3, 5); // 塔窗
      ctx.fillRect(x + 15, 25, 3, 5);
      ctx.fillRect(x + 10, 36, 3, 5);
      ctx.fillRect(x + 15, 36, 3, 5);
      brickBody(x + 22, 24, 84, 32);
      ctx.fillStyle = CREAM;
      ctx.fillRect(x + 50, 26, 26, 9);
      ctx.fillStyle = BRICK;
      ctx.font = '7px monospace';
      ctx.fillText('圖書館', x + 52, 33);
      ctx.fillStyle = '#c8c8c4';
      ctx.fillRect(x + 52, 50, 22, 2); // 門口雨遮
      ctx.fillStyle = '#8c8c88';
      ctx.fillRect(x + 53, 52, 2, 4);
      ctx.fillRect(x + 71, 52, 2, 4);
    },
  },
  {
    // 科學館（science.jpg，圖書館隔壁）：弧形樓身 + 柱廊 + 石砌門面，
    // 頂樓補上照片沒拍到的天文台圓頂（深灰輪廓+受光亮面+觀測縫）
    w: 132,
    draw(x) {
      const bx = x + 4;
      const by = 22;
      const bw = 120;
      const bh = 34;
      ctx.fillStyle = BRICK;
      ctx.fillRect(bx + 6, by, bw - 12, bh); // 中段主體
      ctx.fillRect(bx + 2, by + 4, 4, bh - 4); // 兩側退階模擬圓弧
      ctx.fillRect(bx + bw - 6, by + 4, 4, bh - 4);
      ctx.fillStyle = BRICK_DARK;
      ctx.fillRect(bx + 6, by, bw - 12, 2); // 頂簷
      for (let fy = by + 6; fy < by + bh - 6; fy += 9) {
        ctx.fillStyle = CREAM;
        ctx.fillRect(bx + 8, fy, bw - 16, 6); // 柱廊
        ctx.fillStyle = '#5b7a8c';
        for (let wx = bx + 11; wx < bx + bw - 12; wx += 7) {
          ctx.fillRect(wx, fy + 1, 4, 5);
        }
        ctx.fillStyle = '#f4f0e0';
        ctx.fillRect(bx + 8, fy + 6, bw - 16, 1);
      }
      const dx = bx + Math.floor(bw / 2);
      ctx.fillStyle = '#b8c4cc';
      ctx.fillRect(dx - 13, 47, 26, 9); // 石砌門面
      ctx.fillStyle = BRICK;
      ctx.font = '7px monospace';
      ctx.fillText('科學館', dx - 11, 54);
      ctx.fillStyle = '#8c98a8';
      ctx.fillRect(dx - 8, 17, 16, 5); // 天文台圓頂輪廓
      ctx.fillRect(dx - 6, 14, 12, 3);
      ctx.fillRect(dx - 4, 12, 8, 2);
      ctx.fillStyle = '#e8e8e0';
      ctx.fillRect(dx - 6, 18, 10, 4); // 亮面偏左受光
      ctx.fillRect(dx - 4, 15, 8, 3);
      ctx.fillRect(dx - 2, 13, 4, 2);
      ctx.fillStyle = '#5b5b5d';
      ctx.fillRect(dx - 9, 21, 18, 1); // 圓頂基座
      ctx.fillStyle = '#2c2c34';
      ctx.fillRect(dx - 1, 12, 2, 10); // 觀測縫
    },
  },
];
const CYCLE = SEGMENTS.reduce((sum, seg) => sum + seg.w, 0);

function drawCampus(scroll) {
  let x = -(scroll % CYCLE);
  let i = 0;
  while (x < SCREEN_W) {
    const seg = SEGMENTS[i % SEGMENTS.length];
    if (x + seg.w > 0) {
      seg.draw(x);
    }
    x += seg.w;
    i++;
  }
}

function drawShrubs(scroll) {
  const W = 34;
  for (let base = -(scroll % W); base < SCREEN_W; base += W) {
    ctx.fillStyle = '#356b32';
    ctx.fillRect(base + 4, 58, 10, 5);
    ctx.fillRect(base + 6, 56, 6, 2);
  }
}

function drawTrack(scroll) {
  ctx.fillStyle = '#3a78c8';
  ctx.fillRect(0, GROUND_Y, SCREEN_W, SCREEN_H - GROUND_Y);
  ctx.fillStyle = '#2c5ea0';
  ctx.fillRect(0, GROUND_Y, SCREEN_W, 2);
  ctx.fillStyle = '#e8f0f8';
  const W = 22;
  for (let base = -(scroll % W); base < SCREEN_W; base += W) {
    ctx.fillRect(base, GROUND_Y + 7, 10, 1);
  }
}

// ==== 更新 ====
function applyPhysics(r) {
  if (r.y < 0 || r.vy !== 0) {
    r.y += r.vy;
    r.vy += 0.22;
    if (r.y >= 0) {
      r.y = 0;
      r.vy = 0;
    }
  }
  if (r.blink > 0) {
    r.blink--;
  }
}

function updatePlayer() {
  if (session.controlled) {
    if (keys['a'] || keys['arrowleft']) {
      player.x -= 1.2;
    }
    if (keys['d'] || keys['arrowright']) {
      player.x += 1.2;
    }
    if ((keys['w'] || keys['arrowup'] || keys[' ']) && player.y === 0) {
      player.vy = -2.6;
    }
    player.ducking = !!(keys['s'] || keys['arrowdown']);
    player.x = Math.max(4, Math.min(SCREEN_W - 16, player.x));
  }
  applyPhysics(player);
}

// 電腦隨機控制：每個障礙生成時就先擲骰決定電腦會不會失誤（18%），
// 地面障礙靠近時「大概」會跳（每幀 15% 機率起跳，太晚就撞）、藍鵲靠近會趴下，
// 沒事偶爾亂跳一下。不完美才有比賽感
function updateCpu() {
  const next = obstacles.find((o) => o.x + o.w > cpu.x - 4 && o.x < cpu.x + 30);
  if (next && !next.cpuFails) {
    if (next.type === 'bird') {
      cpu.ducking = next.x - cpu.x < 24;
    } else {
      cpu.ducking = false;
      if (cpu.y === 0 && next.x - cpu.x < 26 && Math.random() < 0.15) {
        cpu.vy = -2.6;
      }
    }
  } else {
    cpu.ducking = false;
    // 前方有飄在空中的加分物件時偶爾跳起來搶（10%/幀，搶不搶得到看運氣），
    // 落地的物件跑過去就會撿到不用跳；沒事亂跳的小動作照舊
    const wantPickup = pickups.find(
      (p) => p.x > cpu.x && p.x - cpu.x < 24 && p.y + p.def.h < GROUND_Y - 15
    );
    if (wantPickup && cpu.y === 0 && Math.random() < 0.1) {
      cpu.vy = -2.6;
    } else if (!next && cpu.y === 0 && Math.random() < 0.002) {
      cpu.vy = -2.2; // 沒事亂跳的小動作
    }
  }
  applyPhysics(cpu);
}

// 過關判定：地面障礙（欄/狗）要跳起 y < -6，藍鵲要蹲下。
// 撞到扣隨機 10+x 分並閃爍；玩家的碰撞打上事件看板；有人歸零遊戲結束出記分板
const OBSTACLE_NAMES = { hurdle: '跨欄', dog: '小黑狗', bird: '藍鵲' };
function judge(r, o) {
  const cleared = o.type === 'bird' ? r.ducking && r.y === 0 : r.y < -6;
  if (cleared) {
    return;
  }
  const loss = 10 + Math.floor(Math.random() * 10);
  r.score = Math.max(0, r.score - loss);
  r.blink = 20;
  if (r === player) {
    announce('撞到' + OBSTACLE_NAMES[o.type] + ' -' + loss + '分！', MSG_PENALTY);
  }
  if (r.score === 0) {
    gameOver = true;
  }
}

function updateObstacles() {
  nextObstacle -= 1.6;
  if (nextObstacle <= 0) {
    const roll = Math.random();
    const type = roll < 0.45 ? 'hurdle' : roll < 0.75 ? 'dog' : 'bird';
    obstacles.push({
      type,
      x: SCREEN_W + 10,
      w: type === 'bird' ? 14 : type === 'dog' ? 11 : 8,
      passedBy: new Set(),
      cpuFails: Math.random() < 0.18,
    });
    nextObstacle = 150 + Math.random() * 140;
  }
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    o.x -= 1.6;
    for (const r of [player, cpu]) {
      if (!o.passedBy.has(r) && o.x < r.x + 10 && o.x + o.w > r.x) {
        judge(r, o);
        o.passedBy.add(r);
      }
    }
    if (o.x < -16) {
      obstacles.splice(i, 1);
    }
  }
}

// 加分物件：獨立於障礙的生成節奏，隨機落地（跑過去撿）或飄在跳躍高度（跳起來拿），
// 誰先碰到誰拿走，加隨機 10+x 分；書包/外套撿到會穿在身上（pistol/scope 純加分）
function updatePickups() {
  nextPickup -= 1.6;
  if (nextPickup <= 0) {
    const def = PICKUP_DEFS[Math.floor(Math.random() * PICKUP_DEFS.length)];
    const airborne = Math.random() < 0.5;
    pickups.push({
      def,
      x: SCREEN_W + 10,
      y: airborne ? GROUND_Y - 24 - def.h - Math.floor(Math.random() * 5) : GROUND_Y - def.h,
    });
    nextPickup = 260 + Math.random() * 300;
  }
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.x -= 1.6;
    let taken = false;
    for (const r of [player, cpu]) {
      const top = GROUND_Y - 15 + r.y; // runner 頭頂（跳起時 r.y 為負）
      if (p.x < r.x + 10 && p.x + p.def.w > r.x + 2 && p.y + p.def.h > top) {
        const gain = 10 + Math.floor(Math.random() * 10);
        r.score += gain;
        if (p.def.key === 'bag') {
          r.bag = true;
        }
        if (p.def.key === 'jacket') {
          r.jacket = true;
        }
        if (r === player) {
          announce('撿到' + p.def.name + ' +' + gain + '分！', MSG_BONUS);
        }
        taken = true;
        break;
      }
    }
    if (taken || p.x < -16) {
      pickups.splice(i, 1);
    }
  }
}

function drawPickups() {
  const bob = Math.floor(t / 12) % 2; // 上下飄的小動態
  for (const p of pickups) {
    drawCritter(p.def.rows, p.def.pal, p.x, p.y + bob);
  }
}

function drawObstacles() {
  for (const o of obstacles) {
    if (o.type === 'hurdle') {
      // 田徑跨欄：深色欄架 + 白紅相間橫板（高對比）
      ctx.fillStyle = '#2c2c34';
      ctx.fillRect(o.x, GROUND_Y - 7, 2, 7);
      ctx.fillRect(o.x + 6, GROUND_Y - 7, 2, 7);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(o.x, GROUND_Y - 9, 8, 3);
      ctx.fillStyle = BRICK;
      ctx.fillRect(o.x + 2, GROUND_Y - 9, 2, 3);
      ctx.fillRect(o.x + 6, GROUND_Y - 9, 2, 3);
    } else if (o.type === 'dog') {
      drawCritter(DOG[Math.floor(t / 10) % 2], DOG_PAL, o.x, GROUND_Y - 6);
    } else {
      drawCritter(BIRD[Math.floor(t / 6) % 2], BIRD_PAL, o.x, BIRD_Y);
    }
  }
}

// 穿上外套：制服(w)換紅、領帶(t)收進外套變深色
const JACKET_ON = { w: THEME_COLORS.danger.background, t: '#2c2c34' };

function drawRunner(r) {
  if (r.blink % 4 >= 2) {
    return; // 撞欄閃爍
  }
  const frame = r.sprite[Math.floor(t / 8) % 2];
  const squash = r.ducking && r.y === 0 ? 3 : 0;
  const X = Math.round(r.x);
  drawSprite(
    ctx,
    frame,
    X,
    GROUND_Y - 15 + squash + Math.round(r.y),
    squash,
    r.jacket ? JACKET_ON : null
  );
  if (r.bag) {
    // 背上的書包：貼在背側（朝左）軀幹處；squash 已含在 baseY 內、上下抵銷，蹲下也跟著身體
    const ty = GROUND_Y - 15 + Math.round(r.y) + 6;
    ctx.fillStyle = '#1c1c22';
    ctx.fillRect(X, ty, 2, 5);
    ctx.fillStyle = '#c8c8c4';
    ctx.fillRect(X, ty + 2, 1, 1); // 扣具
  }
}

// ==== 遊戲結束與記分板 ====
function resetGame() {
  gameOver = false;
  for (const r of [player, cpu]) {
    r.score = 100;
    r.y = 0;
    r.vy = 0;
    r.ducking = false;
    r.blink = 0;
    r.bag = false;
    r.jacket = false;
  }
  obstacles.length = 0;
  pickups.length = 0;
  nextObstacle = 200;
  nextPickup = 320;
  announce('再來一場！', MSG_BONUS);
}

// 記分板：蓋在畫面中央。內部結束（有人歸零）宣布贏家並問要不要再玩；
// loading 結束的 2 秒結算（settling）宣布 loading 完成、分數保留
function drawScoreboard(title, prompt) {
  ctx.fillStyle = 'rgba(20,20,28,0.82)';
  ctx.fillRect(46, 12, 148, 56);
  ctx.fillStyle = '#f4f0e0';
  ctx.font = '9px monospace';
  ctx.fillText(title, 120 - title.length * 4.5, 26);
  ctx.font = '7px monospace';
  const youTag = session.controlled ? '你' : '？';
  ctx.fillText(youTag + player.label + ' ' + player.score + '分', 64, 40);
  ctx.fillText('電腦' + cpu.label + ' ' + cpu.score + '分', 124, 40);
  ctx.fillText(prompt, 120 - prompt.length * 3.5, 58);
}

// HUD 計分板：右上角，標出哪個是「你」——user 未操作前顯示「？」，
// 被電腦海放的分數就是發現彩蛋的鉤子，不寫操作說明
function drawHud() {
  ctx.fillStyle = 'rgba(20,20,28,0.55)';
  ctx.fillRect(SCREEN_W - 86, 2, 84, 10);
  ctx.fillStyle = '#f4f0e0';
  ctx.font = '7px monospace';
  const youTag = session.controlled ? '你' : '？';
  ctx.fillText(
    youTag + player.label + ' ' + player.score + '  電腦' + cpu.label + ' ' + cpu.score,
    SCREEN_W - 83,
    10
  );
}

function frame() {
  t++;
  // 凍結時機：內部結束（記分板等重開）或 loading 結算 2 秒（看分數）
  const frozen = gameOver || state.settling;
  if (!frozen) {
    farScroll += 0.35;
    midScroll += 0.8;
    groundScroll += 1.6;
    updatePlayer();
    updateCpu();
    updateObstacles();
    updatePickups();
  }

  drawSky();
  drawCampus(farScroll);
  drawShrubs(midScroll);
  drawTrack(groundScroll);
  drawObstacles();
  drawPickups();
  drawRunner(cpu);
  drawRunner(player);
  drawHud();
  if (gameOver) {
    drawScoreboard(
      player.score > 0 ? (session.controlled ? '你' : '？') + '贏了！' : '電腦贏了！',
      '再玩一次？點畫面或按空白鍵'
    );
  } else if (state.settling) {
    drawScoreboard('載入完成！', '分數保留，下次載入繼續');
  }

  vctx.clearRect(0, 0, SCREEN_W * SCALE, SCREEN_H * SCALE);
  vctx.drawImage(buf, 0, 0, SCREEN_W * SCALE, SCREEN_H * SCALE);
  rafHandle = requestAnimationFrame(frame);
}

// ==== 啟停：遊戲迴圈與鍵盤監聽跟著「遊戲卡是否在畫面上」走 ====
// hidden 開關會在同一個元件實例內切換遊戲卡/極簡卡兩種模板，
// 所以不能只靠 onMounted——watch hidden 補啟停
let dotsInterval = null;
let gameStarted = false;

function startGame() {
  if (gameStarted || !canvasRef.value) {
    return;
  }
  gameStarted = true;
  vctx = canvasRef.value.getContext('2d');
  vctx.imageSmoothingEnabled = false;
  buf = document.createElement('canvas');
  buf.width = SCREEN_W;
  buf.height = SCREEN_H;
  ctx = buf.getContext('2d');
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  rafHandle = requestAnimationFrame(frame);
}

function stopGame() {
  if (!gameStarted) {
    return;
  }
  gameStarted = false;
  cancelAnimationFrame(rafHandle);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  if (msgTimeout !== null) {
    clearTimeout(msgTimeout);
    msgTimeout = null;
    eventMsg.value = '';
  }
  // 比賽狀態寫回 module 層，下次 loading 延續同一場
  session.playerScore = player.score;
  session.cpuScore = cpu.score;
  session.playerBag = player.bag;
  session.playerJacket = player.jacket;
  session.cpuBag = cpu.bag;
  session.cpuJacket = cpu.jacket;
}

watch(
  () => state.hidden,
  (hidden) => {
    if (hidden) {
      stopGame();
    } else {
      nextTick(() => {
        startGame();
      });
    }
  }
);

onMounted(() => {
  // 點點動畫兩種卡都要
  dotsInterval = setInterval(() => {
    dots.value = '.'.repeat(Math.floor(Date.now() / 400) % 4);
  }, 200);
  if (!state.hidden) {
    startGame();
  }
});

onBeforeUnmount(() => {
  clearInterval(dotsInterval);
  stopGame();
});
</script>

<style scoped>
/* Element Plus 彈窗 z-index 從 2000 起跳逐次遞增；取夠高的值壓過 el-drawer 疊層，
   但低於 JwtCountdownBar（5000）——倒數條要一直可見可點 */
.loading-game-overlay {
  position: fixed;
  inset: 0;
  background: rgba(30, 30, 40, 0.35);
  z-index: 4800;
}

/* 載入遊戲卡：水平置中、垂直約在畫面腰部；寬度響應式（手機不超過 92vw） */
.loading-game-card {
  position: fixed;
  left: 50%;
  top: 32%;
  transform: translate(-50%, -50%);
  z-index: 4801;
  background: #14141c;
  border-radius: 10px;
  width: min(92vw, 560px);
  box-sizing: border-box;
  padding: 10px 12px 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  image-rendering: pixelated;
  touch-action: none;
}

/* 「我不要再看到遊戲了」的極簡文字卡 */
.loading-game-card--plain {
  width: min(92vw, 320px);
  text-align: center;
  padding: 14px 12px 10px;
}

.loading-game-restore {
  display: block;
  margin: 8px auto 0;
  background: none;
  border: none;
  color: #8a8a96;
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}

/* canvas 內部解析度固定 720x240，顯示尺寸跟著卡片縮放（3:1 比例） */
.loading-game-card canvas {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 3 / 1;
  image-rendering: pixelated;
  border-radius: 4px;
}

.loading-game-label {
  color: #fff;
  font-size: 13px;
  text-align: center;
  margin-top: 7px;
  font-family: 'Courier New', monospace;
  letter-spacing: 1px;
}

/* 兩個 el-switch + 加班模式的關閉鈕：深色卡上的淺色小字 */
.loading-game-controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 2px 16px;
  margin-top: 6px;
}

.loading-game-controls :deep(.el-switch__label) {
  color: #8a8a96;
  font-size: 11px;
}

.loading-game-controls :deep(.el-switch__label.is-active) {
  color: #efe0c8;
}

.loading-game-close {
  margin-left: 4px;
}

@media (max-width: 480px) {
  .loading-game-label {
    font-size: 11px;
    margin-top: 5px;
  }

  .loading-game-controls :deep(.el-switch__label) {
    font-size: 10px;
  }
}
</style>
