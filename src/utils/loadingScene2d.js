// LoadingGame 的 2D 像素 renderer：全部畫在 240x80 的離屏緩衝，由呼叫端放大 3 倍貼上去。
// 工廠函數（無 module 層狀態）：createLoadingScene2d(ctx, world) → { render }。
// world 由 LoadingGame.vue 持有並每幀更新（見該檔的模擬段）：捲動量、跑者、障礙、
// 加分物件、事件佇列（撞擊/撿取/落地，這裡消化成粒子）、記分板文案。
import { drawSprite, STAND_H, DUCK_H } from './pixelSprites.js';
import {
  SCREEN_W,
  SCREEN_H,
  GROUND_Y,
  BIRD_Y,
  BRICK,
  BRICK_DARK,
  CREAM,
  WINDOW,
  WINDOW_LIT,
  JACKET_ON,
  DOG,
  DOG_PAL,
  BIRD,
  BIRD_PAL,
  SEGMENT_WIDTHS,
  CYCLE,
} from './loadingArt.js';

export function createLoadingScene2d(ctx, world) {
  const particles = []; // { x, y, vx, vy, life, max, color }
  let shake = 0;

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

  // ==== 粒子：撞擊星星（含畫面微震）/ 撿取閃光 / 落地與跑步塵土 ====
  function spawnParticles(ev) {
    if (ev.type === 'land') {
      for (let i = 0; i < 5; i++) {
        particles.push({
          x: ev.x + (Math.random() * 8 - 4),
          y: ev.y - 1,
          vx: (Math.random() - 0.5) * 1.1,
          vy: -Math.random() * 0.5,
          life: 14,
          max: 14,
          color: '#cfd8e0',
        });
      }
    } else if (ev.type === 'hit') {
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2;
        particles.push({
          x: ev.x,
          y: ev.y,
          vx: Math.cos(a) * 1.4,
          vy: Math.sin(a) * 1.4 - 0.5,
          life: 20,
          max: 20,
          color: i % 2 ? '#ff8a75' : '#ffd98a',
        });
      }
      shake = 4;
    } else {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        particles.push({
          x: ev.x,
          y: ev.y,
          vx: Math.cos(a) * 1.1,
          vy: Math.sin(a) * 1.1,
          life: 16,
          max: 16,
          color: '#3fbf3f',
        });
      }
    }
  }

  function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.06;
      p.life--;
      if (p.life <= 0) {
        particles.splice(i, 1);
      }
    }
    if (shake > 0) {
      shake -= 0.5;
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  // ==== 天空：漸層帶 + 太陽 + 兩層雲（各自視差）====
  const SKY_BANDS = ['#7cc4ea', '#8fceef', '#a2d7f3', '#b5e0f7', '#c7e8fa', '#d8f0fc'];
  function drawSky() {
    for (let i = 0; i < SKY_BANDS.length; i++) {
      ctx.fillStyle = SKY_BANDS[i];
      ctx.fillRect(0, i * 7, SCREEN_W, 7);
    }
    ctx.fillStyle = '#d8f0fc';
    ctx.fillRect(0, 42, SCREEN_W, GROUND_Y - 42);
    // 太陽擺畫面中上（左右上角讓給 HUD）
    ctx.fillStyle = 'rgba(255,236,170,0.55)';
    ctx.fillRect(104, 5, 14, 14);
    ctx.fillRect(102, 7, 18, 10);
    ctx.fillStyle = '#fff3c4';
    ctx.fillRect(106, 7, 10, 10);
    ctx.fillRect(105, 8, 12, 8);
    ctx.fillRect(107, 6, 8, 12);
  }

  function cloud(x, y) {
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(x, y + 2, 16, 3);
    ctx.fillRect(x + 3, y, 9, 3);
    ctx.fillStyle = 'rgba(214,236,250,0.9)';
    ctx.fillRect(x, y + 5, 16, 1);
  }

  function drawClouds(scroll) {
    const W = 96;
    for (let base = -(scroll % W); base < SCREEN_W; base += W) {
      cloud(base + 4, 6);
      cloud(base + 52, 14);
    }
    const W2 = 130;
    for (let base = -((scroll * 1.8) % W2); base < SCREEN_W; base += W2) {
      cloud(base + 20, 22);
    }
  }

  // 遠山：比校舍更慢的剪影層，把畫面拉出景深
  function drawHills(scroll) {
    const W = 120;
    ctx.fillStyle = '#93b8c9';
    for (let base = -(scroll % W); base < SCREEN_W; base += W) {
      for (let i = 0; i < 3; i++) {
        const hx = base + i * 40;
        const peak = 34 + (i % 2) * 5;
        for (let dx = 0; dx < 34; dx++) {
          const h = Math.round((17 - Math.abs(dx - 17)) * 0.75);
          ctx.fillRect(hx + dx, peak + (8 - h), 1, GROUND_Y - (peak + (8 - h)));
        }
      }
    }
    ctx.fillStyle = '#a8c8d6';
    ctx.fillRect(0, 44, SCREEN_W, GROUND_Y - 44);
  }

  // ==== 校園遠景：照空拍圖排成多段循環（段寬取自 loadingArt 的 SEGMENT_WIDTHS）====
  // 亮燈與否由位置決定（穩定不閃爍）
  function windowGrid(x, y, w, cols, rows, gapX, gapY) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const wx = x + c * gapX;
        const wy = y + r * gapY;
        if (wx + 5 > x + w) {
          continue;
        }
        ctx.fillStyle = (c * 7 + r * 13) % 11 === 0 ? WINDOW_LIT : WINDOW;
        ctx.fillRect(wx, wy, 5, 5);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(wx, wy, 5, 1);
      }
    }
  }

  function brickBody(x, y, w, h) {
    ctx.fillStyle = BRICK;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = BRICK_DARK; // 右側背光面 + 落地陰影
    ctx.fillRect(x + w - 3, y, 3, h);
    ctx.fillRect(x, y + h - 2, w, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.16)'; // 左側受光邊
    ctx.fillRect(x, y, 2, h);
    ctx.fillStyle = CREAM;
    ctx.fillRect(x, y + 8, w, 2);
    windowGrid(x + 4, y + 11, w - 6, Math.floor((w - 8) / 10), 2, 10, 10);
  }

  // 教學大樓：紅瓦屋頂、磚身每層陰影開口 + 白欄杆，左角樓掛棟別紅字（C/D 棟）
  function teachBody(x, y, w, h, letter) {
    ctx.fillStyle = '#d84c30';
    ctx.fillRect(x - 2, y - 3, w + 4, 3); // 紅瓦屋頂（出簷）
    ctx.fillStyle = '#f0755a';
    ctx.fillRect(x - 2, y - 3, w + 4, 1); // 瓦頂受光邊
    ctx.fillStyle = BRICK_DARK;
    ctx.fillRect(x - 2, y - 1, w + 4, 1); // 簷下陰影
    ctx.fillStyle = BRICK;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = BRICK_DARK;
    ctx.fillRect(x + w - 3, y, 3, h);
    ctx.fillRect(x, y + h - 2, w, 2);
    for (let fy = y + 3; fy < y + h - 7; fy += 9) {
      for (let wx = x + 10; wx < x + w - 10; wx += 8) {
        ctx.fillStyle = (wx + fy) % 23 === 0 ? WINDOW_LIT : '#4d6b7c';
        ctx.fillRect(wx, fy, 5, 5); // 柱廊開口
      }
      ctx.fillStyle = '#f4f0e0';
      ctx.fillRect(x + 8, fy + 5, w - 16, 1); // 白欄杆帶
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x + 8, fy + 6, w - 16, 1); // 欄杆下陰影
    }
    ctx.fillStyle = CREAM;
    ctx.fillRect(x + 1, y + 4, 7, 9); // 角樓字牌
    ctx.fillStyle = BRICK;
    ctx.font = '7px monospace';
    ctx.fillText(letter, x + 2, y + 11);
  }

  function tree(x, groundY) {
    ctx.fillStyle = '#5a4632';
    ctx.fillRect(x + 7, groundY - 5, 2, 5);
    ctx.fillStyle = '#2f5e2c';
    ctx.fillRect(x, groundY - 16, 16, 11);
    ctx.fillRect(x + 3, groundY - 20, 10, 5);
    ctx.fillStyle = '#4b8c42'; // 受光面
    ctx.fillRect(x + 1, groundY - 15, 7, 5);
    ctx.fillRect(x + 4, groundY - 19, 5, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(x + 2, groundY - 1, 12, 1); // 樹影
  }

  const SEGMENT_DRAWS = [
    // 行政大樓：頂樓招牌 + 門口大石
    (x) => {
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
    // 樹帶
    (x) => {
      tree(x + 6, 60);
      tree(x + 32, 60);
    },
    // 教學樓 C 棟
    (x) => teachBody(x + 4, 26, 116, 30, 'C'),
    // 籃球場：圍網 + 籃架
    (x) => {
      ctx.fillStyle = '#4a9c6e';
      ctx.fillRect(x + 4, 50, 82, 6);
      ctx.fillStyle = '#3d8259';
      ctx.fillRect(x + 4, 54, 82, 2);
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
    // 教學樓 D 棟 + 中庭圓形花圃與玻璃金字塔
    (x) => {
      teachBody(x + 4, 24, 100, 32, 'D');
      ctx.fillStyle = '#2f5e2c';
      ctx.fillRect(x + 106, 50, 10, 6);
      ctx.fillRect(x + 108, 48, 6, 2);
      ctx.fillStyle = '#6ab04c';
      ctx.fillRect(x + 108, 51, 6, 3);
      ctx.fillStyle = '#bce4f8';
      ctx.fillRect(x + 110, 46, 2, 2);
    },
    // 樹帶（短）
    (x) => tree(x + 10, 60),
    // 圖書館：左側高塔 + 紅字招牌 + 門口雨遮
    (x) => {
      ctx.fillStyle = BRICK_DARK;
      ctx.fillRect(x + 5, 12, 18, 2); // 塔頂簷
      ctx.fillStyle = BRICK;
      ctx.fillRect(x + 6, 14, 16, 42);
      ctx.fillStyle = BRICK_DARK;
      ctx.fillRect(x + 19, 14, 3, 42);
      ctx.fillStyle = CREAM;
      ctx.fillRect(x + 6, 20, 16, 2); // 塔身橫帶
      ctx.fillStyle = WINDOW;
      ctx.fillRect(x + 10, 25, 3, 5);
      ctx.fillRect(x + 15, 25, 3, 5);
      ctx.fillStyle = WINDOW_LIT;
      ctx.fillRect(x + 10, 36, 3, 5);
      ctx.fillStyle = WINDOW;
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
    // 科學館：弧形樓身 + 柱廊 + 石砌門面 + 頂樓天文台圓頂
    (x) => {
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
      ctx.fillRect(bx + bw - 6, by + 4, 4, bh - 4);
      ctx.fillRect(bx + 6, by + bh - 2, bw - 12, 2);
      for (let fy = by + 6; fy < by + bh - 6; fy += 9) {
        ctx.fillStyle = CREAM;
        ctx.fillRect(bx + 8, fy, bw - 16, 6); // 柱廊
        for (let wx = bx + 11; wx < bx + bw - 12; wx += 7) {
          ctx.fillStyle = (wx + fy) % 29 === 0 ? WINDOW_LIT : WINDOW;
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
  ];

  function drawCampus(scroll) {
    let x = -(scroll % CYCLE);
    let i = 0;
    while (x < SCREEN_W) {
      const index = i % SEGMENT_DRAWS.length;
      if (x + SEGMENT_WIDTHS[index] > 0) {
        SEGMENT_DRAWS[index](x);
      }
      x += SEGMENT_WIDTHS[index];
      i++;
    }
  }

  function drawShrubs(scroll) {
    const W = 34;
    for (let base = -(scroll % W); base < SCREEN_W; base += W) {
      ctx.fillStyle = '#2f5e2c';
      ctx.fillRect(base + 4, 58, 10, 5);
      ctx.fillRect(base + 6, 56, 6, 2);
      ctx.fillStyle = '#4b8c42';
      ctx.fillRect(base + 5, 57, 5, 2);
    }
  }

  // 跑道：紅色 PU + 三條透視分道線（越近越長、捲動越快，做出速度感）
  const LANES = [
    { y: GROUND_Y + 4, dash: 14, gap: 8, speed: 1.0, color: 'rgba(255,255,255,0.55)' },
    { y: GROUND_Y + 8, dash: 18, gap: 10, speed: 1.4, color: 'rgba(255,255,255,0.75)' },
    { y: GROUND_Y + 12, dash: 24, gap: 12, speed: 1.9, color: '#ffffff' },
  ];
  function drawTrack(scroll) {
    ctx.fillStyle = '#b8432f';
    ctx.fillRect(0, GROUND_Y, SCREEN_W, SCREEN_H - GROUND_Y);
    ctx.fillStyle = '#8e3222';
    ctx.fillRect(0, GROUND_Y, SCREEN_W, 3); // 跑道最遠端偏暗
    ctx.fillStyle = '#e8f0f8';
    ctx.fillRect(0, GROUND_Y, SCREEN_W, 1); // 內圈白邊
    for (const lane of LANES) {
      const W = lane.dash + lane.gap;
      ctx.fillStyle = lane.color;
      for (let base = -((scroll * lane.speed) % W); base < SCREEN_W; base += W) {
        ctx.fillRect(base, lane.y, lane.dash, 1);
      }
    }
  }

  function groundShadow(cx, r) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(Math.round(cx - r), GROUND_Y - 1, r * 2, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fillRect(Math.round(cx - r - 1), GROUND_Y, r * 2 + 2, 1);
  }

  function drawObstacles() {
    for (const o of world.obstacles) {
      if (o.type === 'hurdle') {
        groundShadow(o.x + 4, 5);
        ctx.fillStyle = '#2c2c34';
        ctx.fillRect(o.x, GROUND_Y - 7, 2, 7);
        ctx.fillRect(o.x + 6, GROUND_Y - 7, 2, 7);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(o.x, GROUND_Y - 9, 8, 3);
        ctx.fillStyle = BRICK;
        ctx.fillRect(o.x + 2, GROUND_Y - 9, 2, 3);
        ctx.fillRect(o.x + 6, GROUND_Y - 9, 2, 3);
      } else if (o.type === 'dog') {
        groundShadow(o.x + 5, 5);
        drawCritter(DOG[Math.floor(world.t / 10) % 2], DOG_PAL, o.x, GROUND_Y - 6);
      } else {
        groundShadow(o.x + 7, 4);
        drawCritter(BIRD[Math.floor(world.t / 6) % 2], BIRD_PAL, o.x, BIRD_Y);
      }
    }
  }

  function drawPickups() {
    const bob = Math.floor(world.t / 12) % 2; // 上下飄的小動態
    for (const p of world.pickups) {
      if (p.y + p.def.h < GROUND_Y - 15) {
        // 空中物件加一圈呼吸光暈，好認
        ctx.fillStyle = 'rgba(255,246,190,' + (0.18 + 0.1 * Math.sin(world.t / 8)) + ')';
        ctx.fillRect(p.x - 1, p.y + bob - 1, p.def.w + 2, p.def.h + 2);
      }
      drawCritter(p.def.rows, p.def.pal, p.x, p.y + bob);
    }
  }

  function drawRunner(r) {
    if (r.blink % 4 >= 2) {
      return; // 撞欄閃爍
    }
    const ducked = r.ducking && r.y === 0;
    const frames = ducked ? r.duck : r.sprite;
    const frame = ducked
      ? frames[Math.floor(world.t / 8) % frames.length]
      : frames[Math.floor(world.t / 6) % frames.length];
    const height = ducked ? DUCK_H : STAND_H;
    const X = Math.round(r.x);
    // 落地陰影：跳越高陰影越小越淡
    const lift = Math.min(1, -r.y / 24);
    ctx.fillStyle = 'rgba(0,0,0,' + (0.26 - lift * 0.18) + ')';
    ctx.fillRect(X + 2 + Math.round(lift * 2), GROUND_Y - 1, 8 - Math.round(lift * 4), 1);
    drawSprite(ctx, frame, X, GROUND_Y - height + Math.round(r.y), r.jacket ? JACKET_ON : null);
    if (r.bag) {
      // 背上的書包：貼在背側（朝左）軀幹處；蹲下時身體壓低前傾，往下貼一格
      const ty = GROUND_Y - height + Math.round(r.y) + (ducked ? 7 : 6);
      ctx.fillStyle = '#1c1c22';
      ctx.fillRect(X, ty, 2, 5);
      ctx.fillStyle = '#c8c8c4';
      ctx.fillRect(X, ty + 2, 1, 1); // 扣具
    }
    // 跑步塵土：貼地時每隔幾幀噴一顆
    if (r.y === 0 && !r.ducking && world.t % 9 === 0) {
      particles.push({
        x: X + 2,
        y: GROUND_Y - 1,
        vx: -0.6 - Math.random() * 0.4,
        vy: -0.2,
        life: 10,
        max: 10,
        color: 'rgba(255,255,255,0.9)',
      });
    }
  }

  // HUD：右上角血條 + 分數，標出哪個是「你」——user 未操作前顯示「？」，
  // 被電腦海放的分數就是發現彩蛋的鉤子，不寫操作說明
  function scoreBar(x, y, w, score, label) {
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x, y, w, 3);
    const ratio = Math.max(0, Math.min(1, score / 160));
    ctx.fillStyle = score <= 40 ? '#ff8a75' : '#3fbf3f';
    ctx.fillRect(x, y, Math.round(w * ratio), 3);
    ctx.fillStyle = '#f4f0e0';
    ctx.font = '7px monospace';
    ctx.fillText(label, x - 22, y + 3);
    ctx.fillText(String(score), x + w + 2, y + 3);
  }

  function drawHud() {
    ctx.fillStyle = 'rgba(20,20,28,0.55)';
    ctx.fillRect(SCREEN_W - 84, 2, 82, 20);
    const youTag = world.controlled ? '你' : '？';
    scoreBar(SCREEN_W - 58, 6, 34, world.player.score, youTag + world.player.label);
    scoreBar(SCREEN_W - 58, 14, 34, world.cpu.score, '電' + world.cpu.label);
  }

  function drawScoreboard(title, prompt) {
    ctx.fillStyle = 'rgba(20,20,28,0.82)';
    ctx.fillRect(46, 12, 148, 56);
    ctx.fillStyle = CREAM;
    ctx.fillRect(46, 12, 148, 1);
    ctx.fillRect(46, 67, 148, 1);
    ctx.fillStyle = '#f4f0e0';
    ctx.font = '9px monospace';
    ctx.fillText(title, 120 - title.length * 4.5, 26);
    ctx.font = '7px monospace';
    const youTag = world.controlled ? '你' : '？';
    ctx.fillText(youTag + world.player.label + ' ' + world.player.score + '分', 64, 40);
    ctx.fillText('電腦' + world.cpu.label + ' ' + world.cpu.score + '分', 124, 40);
    ctx.fillText(prompt, 120 - prompt.length * 3.5, 58);
  }

  // 呼叫端每幀跑一次；回傳畫面震動位移（撞擊時晃一下，貼上主 canvas 時用）
  function render() {
    while (world.events.length) {
      spawnParticles(world.events.shift());
    }
    updateParticles();

    drawSky();
    drawClouds(world.cloudScroll);
    drawHills(world.hillScroll);
    drawCampus(world.farScroll);
    drawShrubs(world.midScroll);
    drawTrack(world.groundScroll);
    drawObstacles();
    drawPickups();
    drawRunner(world.cpu);
    drawRunner(world.player);
    drawParticles();
    drawHud();
    if (world.scoreboard) {
      drawScoreboard(world.scoreboard.title, world.scoreboard.prompt);
    }
    return shake > 0 ? shake : 0;
  }

  return { render };
}
