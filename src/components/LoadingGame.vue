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
    <!-- 舞台：2D 與 3D 兩個 canvas 疊在同一個位置，只顯示這次抽中的那個 -->
    <div
      class="loading-game-stage"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <canvas ref="canvasRef" width="720" height="240" :hidden="scene3dActive"></canvas>
      <canvas ref="canvas3dRef" :hidden="!scene3dActive"></canvas>
      <!-- 3D 的 HUD／記分板走 DOM（小字比畫在 canvas 裡清楚） -->
      <template v-if="scene3dActive">
        <div class="loading-game-hud3d">
          <div class="row">
            <span>{{ youTag }}{{ player.label }}</span>
            <span class="bar" :class="{ low: hud.playerScore <= 40 }">
              <i :style="{ width: barWidth(hud.playerScore) }"></i>
            </span>
            <span>{{ hud.playerScore }}</span>
          </div>
          <div class="row">
            <span>電腦{{ cpu.label }}</span>
            <span class="bar" :class="{ low: hud.cpuScore <= 40 }">
              <i :style="{ width: barWidth(hud.cpuScore) }"></i>
            </span>
            <span>{{ hud.cpuScore }}</span>
          </div>
        </div>
        <div v-if="boardText" class="loading-game-board3d">
          <div class="win">{{ boardText.title }}</div>
          <div class="sub">
            <span>{{ youTag }}{{ player.label }} {{ hud.playerScore }}分</span>
            <span>電腦{{ cpu.label }} {{ hud.cpuScore }}分</span>
          </div>
          <div class="tip">{{ boardText.prompt }}</div>
        </div>
      </template>
    </div>
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
import { BOY, GIRL, BOY_DUCK, GIRL_DUCK } from '../utils/pixelSprites.js';
import {
  SCREEN_W,
  SCREEN_H,
  SCALE,
  GROUND_Y,
  MSG_BONUS,
  MSG_PENALTY,
  OBSTACLE_NAMES,
  PICKUP_DEFS,
} from '../utils/loadingArt.js';
import { createLoadingScene2d } from '../utils/loadingScene2d.js';
import { createLoadingScene3d } from '../utils/loadingScene3d.js';
import {
  useLoadingGame,
  useLoadingGameState,
  getGameSession,
  setKeepPlaying,
  setHidden,
  closeLoadingGame,
} from '../composables/useLoadingGame';

// Phase 8：8-bit loading game（規格見 plan/plan.md，原型在 demoloading.html）。
// 兩個林口高中制服小人在校園裡跑步跨欄，藏 Chrome 小恐龍式的操控彩蛋：
// WASD／方向鍵／空白鍵，觸控＝拖曳移動、上滑跳、下拉蹲。
// 血條式計分：兩人各 100 分起跳，撞到跨欄/小黑狗/藍鵲扣隨機 10+x 分、
// 撿到加分物件（書包/射擊隊外套/氣手槍/天文望遠鏡，天上或地上隨機出現）加隨機 10+x 分，
// 書包/外套撿到會穿上；有人歸零出記分板問要不要再玩一次。
// 「資料傳輸中」文字列兼遊戲事件看板（撞到/撿到訊息顯示約 1 秒後變回 loading 文案）。
//
// 這支只負責「模擬 + 狀態編排 + 生命週期」，畫面交給兩個 renderer：
//   - utils/loadingScene2d.js：像素 240x80 緩衝放大 3 倍
//   - utils/loadingScene3d.js：three.js voxel、側面正交鏡頭
// 每次掛載隨機抽一種（各半）。3D 的 three 是動態 import（走 CDN import map），
// 抽中 3D 時先照常跑 2D，模組到位才切過去；載入失敗就整場留在 2D（不會白畫面）。
//
// 隨 useLoadingGame 的 v-if 掛載/卸載，rAF 與鍵盤監聽在生命週期內啟停（防洩漏）；
// 比賽狀態（分數/角色分配/穿戴）存 module 層（getGameSession），跨顯示延續。

const state = useLoadingGameState();
const { loadingGameLabel } = useLoadingGame();
const session = getGameSession();

const canvasRef = ref(null);
const canvas3dRef = ref(null);
const dots = ref('');
const eventMsg = ref('');
const eventColor = ref('');
const scene3dActive = ref(false);

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

// ==== 角色：分配/分數/穿戴自 module 層延續 ====
// user 控其中一個，另一個電腦隨機控制。上一場已分出勝負（有人歸零）就自動開新的一場
if (session.playerScore <= 0 || session.cpuScore <= 0) {
  session.playerScore = 100;
  session.cpuScore = 100;
  session.playerBag = false;
  session.playerJacket = false;
  session.cpuBag = false;
  session.cpuJacket = false;
}

function makeRunner(sprite, duck, label, x, score, bag, jacket) {
  return {
    sprite,
    duck,
    label,
    x,
    y: 0,
    vy: 0,
    ducking: false,
    blink: 0,
    score,
    bag,
    jacket,
    grounded: true,
  };
}
const player = makeRunner(
  session.playerIsGirl ? GIRL : BOY,
  session.playerIsGirl ? GIRL_DUCK : BOY_DUCK,
  session.playerIsGirl ? '女' : '男',
  92,
  session.playerScore,
  session.playerBag,
  session.playerJacket
);
const cpu = makeRunner(
  session.playerIsGirl ? BOY : GIRL,
  session.playerIsGirl ? BOY_DUCK : GIRL_DUCK,
  session.playerIsGirl ? '男' : '女',
  48,
  session.cpuScore,
  session.cpuBag,
  session.cpuJacket
);

// renderer 讀的世界狀態（兩種 renderer 共用同一份，切換模式不影響比賽）
const world = {
  t: 0,
  cloudScroll: 0,
  hillScroll: 0,
  farScroll: 0,
  midScroll: 0,
  groundScroll: 0,
  player,
  cpu,
  obstacles: [], // { type: 'hurdle'|'dog'|'bird', x, w, passedBy: Set, cpuFails }
  pickups: [], // { def, x, y }
  events: [], // 粒子事件 { type: 'hit'|'pickup'|'land', x, y }，由 renderer 消化
  controlled: session.controlled,
  scoreboard: null, // { title, prompt } 或 null
};
let nextObstacle = 200;
let nextPickup = 320;
let gameOver = false;

function emit(type, x, y) {
  world.events.push({ type, x, y });
}

// HUD（3D 的 DOM 版）：分數存在非響應式的 runner 上，每幾幀鏡射一次進 ref 推畫面
const youTag = ref(session.controlled ? '你' : '？');
const hud = ref({ playerScore: player.score, cpuScore: cpu.score });
const boardText = ref(null);
function barWidth(score) {
  return Math.max(0, Math.min(100, (score / 160) * 100)) + '%';
}

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

function takeControl() {
  session.controlled = true;
  world.controlled = true;
  youTag.value = '你';
}

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
    takeControl();
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
  takeControl();
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

// ==== 模擬 ====
function applyPhysics(r) {
  if (r.y < 0 || r.vy !== 0) {
    r.y += r.vy;
    r.vy += 0.22;
    if (r.y >= 0) {
      r.y = 0;
      r.vy = 0;
      if (!r.grounded) {
        emit('land', r.x + 6, GROUND_Y); // 落地塵土
      }
      r.grounded = true;
    } else {
      r.grounded = false;
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
  const next = world.obstacles.find((o) => o.x + o.w > cpu.x - 4 && o.x < cpu.x + 30);
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
    const wantPickup = world.pickups.find(
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
function judge(r, o) {
  const cleared = o.type === 'bird' ? r.ducking && r.y === 0 : r.y < -6;
  if (cleared) {
    return;
  }
  const loss = 10 + Math.floor(Math.random() * 10);
  r.score = Math.max(0, r.score - loss);
  r.blink = 20;
  emit('hit', r.x + 6, GROUND_Y - 10 + r.y);
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
    world.obstacles.push({
      type,
      x: SCREEN_W + 10,
      w: type === 'bird' ? 14 : type === 'dog' ? 11 : 8,
      passedBy: new Set(),
      cpuFails: Math.random() < 0.18,
    });
    nextObstacle = 150 + Math.random() * 140;
  }
  for (let i = world.obstacles.length - 1; i >= 0; i--) {
    const o = world.obstacles[i];
    o.x -= 1.6;
    for (const r of [player, cpu]) {
      if (!o.passedBy.has(r) && o.x < r.x + 10 && o.x + o.w > r.x) {
        judge(r, o);
        o.passedBy.add(r);
      }
    }
    if (o.x < -16) {
      world.obstacles.splice(i, 1);
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
    world.pickups.push({
      def,
      x: SCREEN_W + 10,
      y: airborne ? GROUND_Y - 24 - def.h - Math.floor(Math.random() * 5) : GROUND_Y - def.h,
    });
    nextPickup = 260 + Math.random() * 300;
  }
  for (let i = world.pickups.length - 1; i >= 0; i--) {
    const p = world.pickups[i];
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
        emit('pickup', p.x + p.def.w / 2, p.y + p.def.h / 2);
        if (r === player) {
          announce('撿到' + p.def.name + ' +' + gain + '分！', MSG_BONUS);
        }
        taken = true;
        break;
      }
    }
    if (taken || p.x < -16) {
      world.pickups.splice(i, 1);
    }
  }
}

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
    r.grounded = true;
  }
  world.obstacles.length = 0;
  world.pickups.length = 0;
  world.events.length = 0;
  nextObstacle = 200;
  nextPickup = 320;
  announce('再來一場！', MSG_BONUS);
}

// ==== renderer ====
let rafHandle = 0;
let vctx = null;
let buf = null;
let scene2d = null;
let scene3d = null;
let want3d = false;
let loading3d = false;

function frame() {
  world.t++;
  // 凍結時機：內部結束（記分板等重開）或 loading 結算 2 秒（看分數）
  const frozen = gameOver || state.settling;
  if (!frozen) {
    world.cloudScroll += 0.12;
    world.hillScroll += 0.2;
    world.farScroll += 0.35;
    world.midScroll += 0.8;
    world.groundScroll += 1.6;
    updatePlayer();
    updateCpu();
    updateObstacles();
    updatePickups();
  }

  // 記分板：內部結束（有人歸零）宣布贏家並問要不要再玩；
  // loading 結束的 2 秒結算宣布 loading 完成、分數保留
  if (gameOver) {
    world.scoreboard = {
      title: (player.score > 0 ? youTag.value : '電腦') + '贏了！',
      prompt: '再玩一次？點畫面或按空白鍵',
    };
  } else if (state.settling) {
    world.scoreboard = { title: '載入完成！', prompt: '分數保留，下次載入繼續' };
  } else {
    world.scoreboard = null;
  }

  if (scene3d) {
    scene3d.render();
    // DOM HUD 每 6 幀鏡射一次就夠（分數不是響應式資料）
    if (world.t % 6 === 0) {
      hud.value = { playerScore: player.score, cpuScore: cpu.score };
      boardText.value = world.scoreboard;
    }
  } else {
    const shake = scene2d.render();
    vctx.clearRect(0, 0, SCREEN_W * SCALE, SCREEN_H * SCALE);
    const sx = shake > 0 ? (Math.random() - 0.5) * shake * SCALE : 0;
    const sy = shake > 0 ? (Math.random() - 0.5) * shake * SCALE : 0;
    vctx.drawImage(buf, sx, sy, SCREEN_W * SCALE, SCREEN_H * SCALE);
  }
  rafHandle = requestAnimationFrame(frame);
}

// 抽中 3D 時動態 import three（走 CDN import map）。載入期間照常跑 2D，
// 到位才切；失敗就整場留在 2D——這是 CDN 掛掉時不會變白畫面的保險
async function tryStart3d() {
  if (loading3d || scene3d || !want3d) {
    return;
  }
  loading3d = true;
  try {
    const THREE = await import('three');
    if (!gameStarted || !canvas3dRef.value) {
      return; // 載入途中已卸載
    }
    scene3dActive.value = true;
    await nextTick(); // 先讓 canvas 顯示出來，才量得到尺寸
    scene3d = createLoadingScene3d(THREE, canvas3dRef.value, world);
    scene3d.resize();
  } catch (err) {
    console.error('[LoadingGame] 3D 模組載入失敗，留在 2D', err);
    want3d = false;
    scene3dActive.value = false;
  } finally {
    loading3d = false;
  }
}

function onResize() {
  if (scene3d) {
    scene3d.resize();
  }
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
  scene2d = createLoadingScene2d(buf.getContext('2d'), world);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', onResize);
  rafHandle = requestAnimationFrame(frame);
  tryStart3d();
}

function stopGame() {
  if (!gameStarted) {
    return;
  }
  gameStarted = false;
  cancelAnimationFrame(rafHandle);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('resize', onResize);
  if (scene3d) {
    scene3d.dispose();
    scene3d = null;
  }
  scene3dActive.value = false;
  scene2d = null;
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
  // 這次掛載抽 2D 還是 3D（各半）
  want3d = Math.random() < 0.5;
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

/* 舞台：兩個 canvas 疊在一起（3:1 比例），HUD/記分板絕對定位疊上去 */
.loading-game-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 1;
}

.loading-game-stage canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 4px;
}

/* 2D 是低解析度緩衝放大，要保持像素感；3D 交給 WebGL 自己抗鋸齒 */
.loading-game-stage canvas:first-child {
  image-rendering: pixelated;
}

/* 這些疊層自帶 display，不加這條 [hidden] 會被蓋掉、隱形擋住互動 */
.loading-game-stage [hidden] {
  display: none !important;
}

/* 3D 模式的 HUD：右上角血條 + 分數，標出哪個是「你」 */
.loading-game-hud3d {
  position: absolute;
  right: 6px;
  top: 6px;
  background: rgba(20, 20, 28, 0.55);
  border-radius: 4px;
  padding: 4px 7px;
  color: #f4f0e0;
  font-family: 'Courier New', monospace;
  font-size: 11px;
  line-height: 1.5;
  min-width: 118px;
  pointer-events: none;
}

.loading-game-hud3d .row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.loading-game-hud3d .bar {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.18);
  border-radius: 2px;
}

.loading-game-hud3d .bar i {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: #3fbf3f;
}

.loading-game-hud3d .bar.low i {
  background: #ff8a75;
}

/* 3D 模式的記分板 */
.loading-game-board3d {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgba(20, 20, 28, 0.72);
  border-radius: 4px;
  color: #f4f0e0;
  font-family: 'Courier New', monospace;
  pointer-events: none;
}

.loading-game-board3d .win {
  font-size: 18px;
  letter-spacing: 2px;
}

.loading-game-board3d .sub {
  display: flex;
  gap: 14px;
  font-size: 12px;
  opacity: 0.9;
}

.loading-game-board3d .tip {
  font-size: 11px;
  opacity: 0.7;
  margin-top: 4px;
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

  .loading-game-hud3d {
    font-size: 10px;
    min-width: 96px;
  }

  .loading-game-controls :deep(.el-switch__label) {
    font-size: 10px;
  }
}
</style>
