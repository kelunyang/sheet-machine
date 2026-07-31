// LoadingGame 的 3D renderer（three.js，側面正交鏡頭）。
// 工廠函數（無 module 層狀態）：createLoadingScene3d(THREE, canvas, world) → { render, resize, dispose }。
// three 由呼叫端動態 import 後傳進來（CDN 掛掉時 LoadingGame 就留在 2D，不會白畫面）。
//
// 美術與 2D 同源：像素圖（小人/狗/藍鵲/加分物件）直接堆成 voxel InstancedMesh，
// 校園段落沿用 loadingArt 的 SEGMENT_WIDTHS 與 CYCLE，兩種模式跑的是同一座校園。
// HUD 與記分板不畫在 canvas 裡，由 LoadingGame.vue 用 DOM 疊（小字比較清楚）。
import { PAL } from './pixelSprites.js';
import {
  SCREEN_W,
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

// 遊戲座標 → 世界座標（1 px = 1 unit，地面 y = 0，畫面中心 x = 0）
const toWorldX = (x) => x - SCREEN_W / 2;
const toWorldY = (screenY) => GROUND_Y - screenY;

// 正交鏡頭半寬要 >= 遊戲場寬的一半（120），否則玩家跑到最右邊會出畫面
const HALF_W = 122;
// 正交鏡頭不會因為推遠而變小，所以校舍要自己縮一號，跑者才有主角感
const CAMPUS_S = 0.72;

export function createLoadingScene3d(THREE, canvas, world) {
  // GPU 資源回收：卸載時走訪整個 scene 收 geometry/material/貼圖，
  // 中途離場的障礙/加分物件則在 syncObjects 就地收掉（loading 可能開很久）
  function disposeDeep(obj) {
    obj.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) {
        return;
      }
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.map) {
          m.map.dispose();
        }
        m.dispose();
      }
    });
  }

  // 把像素圖轉成 voxel：一個 InstancedMesh、逐格上色，只吃一個 draw call
  function voxel(rows, pal, depth) {
    const cells = [];
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const ch = rows[r][c];
        const color = (pal && pal[ch]) || null;
        if (ch !== '.' && color) {
          cells.push([c, r, color]);
        }
      }
    }
    const geo = new THREE.BoxGeometry(1, 1, depth);
    const mat = new THREE.MeshLambertMaterial();
    const mesh = new THREE.InstancedMesh(geo, mat, cells.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    const offX = -rows[0].length / 2;
    for (let i = 0; i < cells.length; i++) {
      const [c, r, color] = cells[i];
      m.makeTranslation(offX + c + 0.5, rows.length - r - 0.5, 0);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.set(color));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    return mesh;
  }

  function box(w, h, d, color, x, y, z, emissive) {
    const mat = new THREE.MeshLambertMaterial({ color });
    if (emissive) {
      mat.emissive = new THREE.Color(emissive);
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  // 招牌字：畫在離屏 canvas 上當貼圖貼在建物正面
  // （不補字的話整排紅磚盒子認不出是哪一棟）
  function textPlane(text, w, h, fg, x, y, z) {
    const c = document.createElement('canvas');
    c.width = Math.max(32, Math.round(w * 20));
    c.height = Math.max(32, Math.round(h * 20));
    const g = c.getContext('2d');
    g.font =
      '900 ' + Math.floor(c.height * 0.78) + 'px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // 字很小，描邊一圈同色把筆畫加粗，遠看才不會糊掉
    g.lineWidth = Math.max(2, c.height * 0.05);
    g.strokeStyle = fg;
    g.strokeText(text, c.width / 2, c.height * 0.54, c.width * 0.9);
    g.fillStyle = fg;
    g.fillText(text, c.width / 2, c.height * 0.54, c.width * 0.9);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    mesh.position.set(x, y, z);
    return mesh;
  }

  function treeMesh(g, x, z) {
    g.add(box(2, 6, 2, '#5a4632', x, 0, z));
    g.add(box(12, 10, 12, '#2f5e2c', x, 6, z));
    g.add(box(8, 5, 8, '#4b8c42', x, 15, z));
  }

  function teachMesh(g, x, topY, letter) {
    const h = toWorldY(topY);
    g.add(box(116, h, 40, BRICK, x, 0, -78));
    g.add(box(122, 3, 46, '#d84c30', x, h, -78)); // 紅瓦出簷
    // 角樓棟別字牌（C/D 棟）
    g.add(box(15, 16, 1, CREAM, x - 51, h - 21, -57.5));
    g.add(textPlane(letter, 13, 13, BRICK_DARK, x - 51, h - 13, -56.4));
    for (let f = 0; f < 3; f++) {
      const fy = 6 + f * 10;
      if (fy + 6 > h) {
        break;
      }
      g.add(box(100, 1, 42, '#f4f0e0', x, fy + 5, -78)); // 白欄杆
      for (let i = 0; i < 11; i++) {
        const lit = (i + f) % 7 === 0;
        g.add(box(5, 5, 1, lit ? WINDOW_LIT : '#4d6b7c', x - 50 + i * 10, fy, -57.5, lit && '#5a4310'));
      }
    }
  }

  // 3D 校園：與 2D 的 SEGMENT_WIDTHS 同序同寬，疊兩輪讓捲動不露餡
  function buildingsGroup() {
    const strip = new THREE.Group();
    const BUILD = [
      (g, x) => {
        // 行政大樓
        g.add(box(118, toWorldY(22), 46, BRICK, x + 67, 0, -80));
        g.add(box(52, 8, 48, BRICK_DARK, x + 66, toWorldY(22), -80));
        g.add(textPlane('林口高中', 46, 7, CREAM, x + 66, toWorldY(22) + 4, -55.4));
        g.add(box(122, 3, 50, CREAM, x + 67, toWorldY(22) - 11, -80));
        for (let i = 0; i < 10; i++) {
          const lit = i % 5 === 0;
          g.add(
            box(5, 5, 1, lit ? WINDOW_LIT : WINDOW, x + 16 + i * 11, toWorldY(22) - 22, -56.5, lit && '#5a4310')
          );
        }
        g.add(box(14, 8, 12, '#c8c8c4', x + 137, 0, -46)); // 門口大石
      },
      (g, x) => {
        treeMesh(g, x + 14, -40);
        treeMesh(g, x + 40, -44);
      },
      (g, x) => teachMesh(g, x + 62, 26, 'C'),
      (g, x) => {
        // 籃球場
        g.add(box(82, 1, 40, '#4a9c6e', x + 45, 0, -50));
        g.add(box(1, 16, 1, '#e8e8e0', x + 45, 0, -34));
        g.add(box(6, 4, 1, '#e8e8e0', x + 45, 16, -34));
        for (let i = 0; i < 6; i++) {
          g.add(box(1, 18, 1, '#9caab4', x + 6 + i * 16, 0, -30));
        }
      },
      (g, x) => {
        // 教學樓 D + 花圃
        teachMesh(g, x + 54, 24, 'D');
        g.add(box(12, 5, 12, '#2f5e2c', x + 111, 0, -40));
        g.add(box(5, 5, 5, '#bce4f8', x + 111, 5, -40, '#204050'));
      },
      (g, x) => treeMesh(g, x + 18, -40),
      (g, x) => {
        // 圖書館：高塔 + 主樓
        g.add(box(16, toWorldY(14), 22, BRICK, x + 14, 0, -70));
        g.add(box(20, 2, 26, BRICK_DARK, x + 14, toWorldY(14), -70));
        g.add(box(84, toWorldY(24), 44, BRICK, x + 64, 0, -80));
        g.add(box(88, 3, 46, CREAM, x + 64, toWorldY(24) - 10, -80));
        g.add(box(26, 9, 1, CREAM, x + 63, toWorldY(35), -57.5));
        g.add(textPlane('圖書館', 24, 8, BRICK_DARK, x + 63, toWorldY(35) + 4.5, -56.4));
        for (let i = 0; i < 7; i++) {
          const lit = i === 2;
          g.add(
            box(5, 5, 1, lit ? WINDOW_LIT : WINDOW, x + 26 + i * 11, toWorldY(24) - 22, -57.5, lit && '#5a4310')
          );
        }
      },
      (g, x) => {
        // 科學館 + 天文台圓頂
        g.add(box(108, toWorldY(22), 44, BRICK, x + 64, 0, -80));
        for (let f = 0; f < 3; f++) {
          g.add(box(104, 6, 46, CREAM, x + 64, 6 + f * 11, -80)); // 柱廊
        }
        g.add(box(26, 9, 4, '#b8c4cc', x + 64, toWorldY(56), -57)); // 石砌門面
        g.add(textPlane('科學館', 24, 8, BRICK_DARK, x + 64, toWorldY(56) + 4.5, -54.4));
        g.add(box(16, 5, 16, '#8c98a8', x + 64, toWorldY(22), -80));
        g.add(box(12, 3, 12, '#c8ccd4', x + 64, toWorldY(22) + 5, -80));
        g.add(box(8, 3, 8, '#e8e8e0', x + 64, toWorldY(22) + 8, -80));
        g.add(box(2, 10, 9, '#2c2c34', x + 64, toWorldY(22) + 2, -76)); // 觀測縫
      },
    ];
    for (let cycle = 0; cycle < 2; cycle++) {
      let x = cycle * CYCLE;
      for (let i = 0; i < BUILD.length; i++) {
        BUILD[i](strip, x);
        x += SEGMENT_WIDTHS[i];
      }
    }
    return strip;
  }

  // 跑道貼圖：紅色 PU + 分道線 + 橫向刻痕（純縱線捲動時看不出來在動），
  // 靠 texture.offset 捲動
  function trackTexture() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#b8432f';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 1; i < 4; i++) {
      g.fillRect(0, i * 16, 64, 1);
    }
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillRect(0, 4, 10, 2);
    g.fillRect(32, 36, 10, 2);
    g.fillStyle = 'rgba(0,0,0,0.10)';
    for (let i = 0; i < 64; i += 8) {
      g.fillRect(i, 0, 1, 64);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(12, 2);
    tex.magFilter = THREE.NearestFilter;
    return tex;
  }

  // ==== 場景組裝 ====
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#a2d7f3');
  // 霧只用來讓最遠的山淡出；起霧點要在校舍之後（相機 z=180、校舍 z≈-80，距離約 265）
  scene.fog = new THREE.Fog('#c7e8fa', 270, 460);

  // 側面正交鏡頭：只給一點側移角與俯角，讓方塊讀得出體積又維持側視
  const camera = new THREE.OrthographicCamera(-HALF_W, HALF_W, HALF_W / 3, -HALF_W / 3, 1, 600);
  camera.position.set(28, 54, 180);
  camera.lookAt(0, 20, 0);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene.add(new THREE.HemisphereLight('#cfe9f8', '#6b5a4a', 1.5));
  const sun = new THREE.DirectionalLight('#fff3d0', 1.9);
  sun.position.set(60, 90, 70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const shadowCam = sun.shadow.camera;
  shadowCam.left = -130;
  shadowCam.right = 130;
  shadowCam.top = 90;
  shadowCam.bottom = -40;
  shadowCam.near = 1;
  shadowCam.far = 320;
  scene.add(sun);
  scene.add(sun.target);

  const trackMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 70),
    new THREE.MeshLambertMaterial({ map: trackTexture() })
  );
  trackMesh.rotation.x = -Math.PI / 2;
  trackMesh.position.set(0, 0, 18);
  trackMesh.receiveShadow = true;
  scene.add(trackMesh);

  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 200),
    new THREE.MeshLambertMaterial({ color: '#3f7a3a' })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(0, -0.1, -85);
  grass.receiveShadow = true;
  scene.add(grass);

  // 跑道外側草皮：補住畫面最下緣，不然會露出天空底色
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 140),
    new THREE.MeshLambertMaterial({ color: '#4a8c42' })
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(0, -0.1, 120);
  apron.receiveShadow = true;
  scene.add(apron);

  const hills = new THREE.Group();
  for (let i = 0; i < 14; i++) {
    const h = 26 + (i % 3) * 10;
    const mesh = new THREE.Mesh(
      new THREE.ConeGeometry(28, h, 4),
      new THREE.MeshLambertMaterial({ color: '#93b8c9' })
    );
    mesh.position.set(-240 + i * 40, h / 2 - 4, -190);
    mesh.rotation.y = Math.PI / 4;
    hills.add(mesh);
  }
  scene.add(hills);

  const campus = buildingsGroup();
  campus.scale.setScalar(CAMPUS_S);
  campus.position.z = -26;
  scene.add(campus);

  const shrubs = new THREE.Group();
  for (let i = 0; i < 40; i++) {
    shrubs.add(box(10, 5, 8, '#2f5e2c', i * 34, 0, -26));
  }
  scene.add(shrubs);

  const clouds = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const c = new THREE.Group();
    c.add(box(22, 5, 10, '#ffffff', 0, 0, 0));
    c.add(box(12, 5, 10, '#ffffff', 4, 4, 0));
    c.position.set(i * 60, 52 + (i % 3) * 9, -150);
    c.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });
    clouds.add(c);
  }
  scene.add(clouds);

  // 跑者：站姿／蹲姿 × 沒外套／穿外套，四套 voxel 切 visible
  // （不做壓扁——壓扁一樣是把頭擠掉，蹲姿走獨立圖）
  function poseGroup(sprite, override) {
    const g = new THREE.Group();
    const pal = override ? Object.assign({}, PAL, override) : PAL;
    g.userData.frames = sprite.map((rows) => {
      const m = voxel(rows, pal, 4);
      m.visible = false;
      g.add(m);
      return m;
    });
    return g;
  }

  function makeRunner3d(r) {
    const g = new THREE.Group();
    const poses = {
      stand: poseGroup(r.sprite, null),
      standJacket: poseGroup(r.sprite, JACKET_ON),
      duck: poseGroup(r.duck, null),
      duckJacket: poseGroup(r.duck, JACKET_ON),
    };
    for (const key of Object.keys(poses)) {
      poses[key].visible = false;
      g.add(poses[key]);
    }
    const bag = box(3, 6, 5, '#1c1c22', -6.5, 5, 0); // 背包（撿到才顯示）
    bag.visible = false;
    g.add(bag);
    g.userData = { poses, bag };
    scene.add(g);
    return g;
  }
  const runnerMeshes = new Map([
    [world.player, makeRunner3d(world.player)],
    [world.cpu, makeRunner3d(world.cpu)],
  ]);

  // 障礙／加分物件：依模擬物件動態建立、離場即釋放
  const objMeshes = new Map();

  function hurdleMesh() {
    const g = new THREE.Group();
    g.add(box(1.5, 7, 1.5, '#2c2c34', -3, 0, -3));
    g.add(box(1.5, 7, 1.5, '#2c2c34', 3, 0, -3));
    g.add(box(1.5, 7, 1.5, '#2c2c34', -3, 0, 3));
    g.add(box(1.5, 7, 1.5, '#2c2c34', 3, 0, 3));
    g.add(box(9, 3, 1, '#ffffff', 0, 7, 0));
    g.add(box(2, 3, 1.2, BRICK, -2, 7, 0));
    g.add(box(2, 3, 1.2, BRICK, 2, 7, 0));
    return g;
  }

  function twoFrameMesh(rows2, pal, depth) {
    const g = new THREE.Group();
    g.userData.frames = rows2.map((rows) => {
      const m = voxel(rows, pal, depth);
      m.visible = false;
      g.add(m);
      return m;
    });
    return g;
  }

  // 3D 粒子：小方塊池（撞擊/撿取/落地）
  const fx = [];
  const fxGeo = new THREE.BoxGeometry(1.1, 1.1, 1.1);
  function spawnFx(ev) {
    const conf =
      ev.type === 'hit'
        ? { n: 14, colors: ['#ff8a75', '#ffd98a'], spd: 1.5, up: 0.6 }
        : ev.type === 'pickup'
          ? { n: 12, colors: ['#3fbf3f', '#d0ffd0'], spd: 1.2, up: 0.4 }
          : { n: 6, colors: ['#e8dcc8', '#ffffff'], spd: 0.7, up: 0.2 };
    for (let i = 0; i < conf.n; i++) {
      const mesh = new THREE.Mesh(
        fxGeo,
        new THREE.MeshBasicMaterial({ color: conf.colors[i % conf.colors.length], transparent: true })
      );
      mesh.position.set(toWorldX(ev.x), toWorldY(ev.y), (Math.random() - 0.5) * 6);
      scene.add(mesh);
      const a = Math.random() * Math.PI * 2;
      fx.push({
        mesh,
        vx: Math.cos(a) * conf.spd,
        vy: Math.random() * conf.spd + conf.up,
        vz: Math.sin(a) * conf.spd * 0.6,
        life: 26,
        max: 26,
      });
    }
  }

  function updateFx() {
    for (let i = fx.length - 1; i >= 0; i--) {
      const p = fx[i];
      p.mesh.position.x += p.vx;
      p.mesh.position.y += p.vy;
      p.mesh.position.z += p.vz;
      p.vy -= 0.09;
      p.life--;
      const k = p.life / p.max;
      p.mesh.material.opacity = Math.max(0, k);
      p.mesh.scale.setScalar(0.4 + k * 0.9);
      if (p.life <= 0) {
        scene.remove(p.mesh);
        p.mesh.material.dispose();
        fx.splice(i, 1);
      }
    }
  }

  function syncObjects() {
    const alive = new Set();
    for (const o of world.obstacles) {
      alive.add(o);
      let g = objMeshes.get(o);
      if (!g) {
        g =
          o.type === 'hurdle'
            ? hurdleMesh()
            : o.type === 'dog'
              ? twoFrameMesh(DOG, DOG_PAL, 6)
              : twoFrameMesh(BIRD, BIRD_PAL, 3);
        scene.add(g);
        objMeshes.set(o, g);
      }
      g.position.x = toWorldX(o.x + o.w / 2);
      if (o.type === 'dog') {
        const f = Math.floor(world.t / 10) % 2;
        g.userData.frames.forEach((m, i) => {
          m.visible = i === f;
        });
      } else if (o.type === 'bird') {
        g.position.y = toWorldY(BIRD_Y + BIRD.length) + Math.sin(world.t / 9) * 1.2;
        const f = Math.floor(world.t / 6) % 2;
        g.userData.frames.forEach((m, i) => {
          m.visible = i === f;
        });
      }
    }
    for (const p of world.pickups) {
      alive.add(p);
      let g = objMeshes.get(p);
      if (!g) {
        g = voxel(p.def.rows, p.def.pal, 3);
        scene.add(g);
        objMeshes.set(p, g);
      }
      g.position.x = toWorldX(p.x + p.def.w / 2);
      g.position.y = toWorldY(p.y + p.def.h) + Math.sin(world.t / 10) * 0.8;
      g.rotation.y = Math.sin(world.t / 22) * 0.5; // 微微擺動，好認
    }
    for (const [key, g] of objMeshes) {
      if (alive.has(key)) {
        continue;
      }
      scene.remove(g);
      disposeDeep(g); // loading 可能開很久，離場物件的 GPU 資源要收乾淨
      objMeshes.delete(key);
    }
  }

  function syncRunners() {
    for (const r of [world.cpu, world.player]) {
      const g = runnerMeshes.get(r);
      g.visible = !(r.blink % 4 >= 2); // 撞欄閃爍
      g.position.x = toWorldX(r.x + 6);
      g.position.y = -r.y;
      g.rotation.z = r.y < 0 ? -0.12 : 0; // 騰空時身體微微前傾
      const ducked = r.ducking && r.y === 0;
      const key = (ducked ? 'duck' : 'stand') + (r.jacket ? 'Jacket' : '');
      const poses = g.userData.poses;
      for (const name of Object.keys(poses)) {
        poses[name].visible = name === key;
      }
      const active = poses[key];
      const f = Math.floor(world.t / (ducked ? 8 : 6)) % active.userData.frames.length;
      active.userData.frames.forEach((m, i) => {
        m.visible = i === f;
      });
      g.userData.bag.visible = r.bag;
      g.userData.bag.position.y = ducked ? 3.5 : 5;
    }
  }

  const trackTex = trackMesh.material.map;

  function render() {
    while (world.events.length) {
      spawnFx(world.events.shift());
    }
    updateFx();
    // 校園有縮放，捲動位移也要跟著縮，接縫才不會露餡
    campus.position.x = -SCREEN_W / 2 - (world.farScroll % CYCLE) * CAMPUS_S;
    shrubs.position.x = -SCREEN_W / 2 - (world.midScroll % 34);
    clouds.position.x = -300 - (world.cloudScroll % 60);
    hills.position.x = -(world.hillScroll % 40);
    // 跑道貼圖捲動速度對齊地面速度（400 世界單位 / 12 個 repeat）
    trackTex.offset.x = world.groundScroll / (400 / 12);
    syncObjects();
    syncRunners();
    renderer.render(scene, camera);
  }

  function resize() {
    const w = canvas.clientWidth || 720;
    const h = canvas.clientHeight || 240;
    renderer.setSize(w, h, false);
    const halfH = HALF_W * (h / w);
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
  }

  function dispose() {
    for (const p of fx) {
      scene.remove(p.mesh);
      p.mesh.material.dispose();
    }
    fx.length = 0;
    fxGeo.dispose();
    disposeDeep(scene); // 還掛在場上的全部收掉（含 objMeshes 裡的）
    objMeshes.clear();
    renderer.dispose();
  }

  resize();
  return { render, resize, dispose };
}
