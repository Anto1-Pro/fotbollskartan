/* penalty-scene.js — 3D-scenen för straffsparksspelet på Fotbollskarta.
 *
 * Bygger en nattmatch under flodljus: gräsmatta med klippta ränder och målade
 * linjer, mål med nät, läktare med publik, boll, målvakt och skytt.
 * All spellogik ligger i straffliga.js — den här filen ritar och animerar bara.
 */

import * as THREE from "./vendor/three/three.module.min.js";

/* ---------- Måtten är riktiga fotbollsmått, i meter ---------- */
const GOAL_W = 7.32;
const GOAL_H = 2.44;
const POST_R = 0.06;
const NET_DEPTH = 1.9;
const SPOT_Z = 11; // straffpunkten, 11 m från mållinjen
const BALL_R = 0.11;
const PITCH = 70; // gräsplanet är 70×70 m med mållinjen i mitten

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);

/* =====================================================================
   Texturer — allt ritas i canvas så att sidan inte behöver bildfiler
   ===================================================================== */

function grassTexture() {
  const S = 2048;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d");
  const px = S / PITCH; // pixlar per meter
  const toX = (x) => (x + PITCH / 2) * px;
  const toY = (z) => (z + PITCH / 2) * px;

  g.fillStyle = "#2f6b2c";
  g.fillRect(0, 0, S, S);

  // Klippta ränder på tvären, som på en riktig arena
  const stripe = 5; // meter
  for (let z = -PITCH / 2; z < PITCH / 2; z += stripe * 2) {
    g.fillStyle = "#356f30";
    g.fillRect(0, toY(z), S, stripe * px);
  }

  // Slitage och variation
  for (let i = 0; i < 26000; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const a = Math.random() * 0.05;
    g.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    g.fillRect(x, y, 3 + Math.random() * 6, 2 + Math.random() * 4);
  }
  // Nedtrampat område kring straffpunkten
  const wear = g.createRadialGradient(toX(0), toY(SPOT_Z), 0, toX(0), toY(SPOT_Z), 2.2 * px);
  wear.addColorStop(0, "rgba(120,105,70,0.30)");
  wear.addColorStop(1, "rgba(120,105,70,0)");
  g.fillStyle = wear;
  g.fillRect(toX(-4), toY(SPOT_Z - 4), 8 * px, 8 * px);

  // Målade linjer (12 cm breda)
  g.strokeStyle = "rgba(255,255,255,0.92)";
  g.lineWidth = Math.max(4, 0.12 * px);
  g.lineCap = "butt";

  const line = (x1, z1, x2, z2) => {
    g.beginPath();
    g.moveTo(toX(x1), toY(z1));
    g.lineTo(toX(x2), toY(z2));
    g.stroke();
  };

  line(-34, 0, 34, 0); // mållinje
  // Straffområde: 16,5 m djupt, 40,32 m brett
  line(-20.16, 0, -20.16, 16.5);
  line(20.16, 0, 20.16, 16.5);
  line(-20.16, 16.5, 20.16, 16.5);
  // Målområde: 5,5 m djupt, 18,32 m brett
  line(-9.16, 0, -9.16, 5.5);
  line(9.16, 0, 9.16, 5.5);
  line(-9.16, 5.5, 9.16, 5.5);
  // Sidlinjer
  line(-34, 0, -34, 35);
  line(34, 0, 34, 35);

  // Straffområdesbågen — bara den del som ligger utanför straffområdet
  g.save();
  g.beginPath();
  g.rect(toX(-34), toY(16.5), 68 * px, 20 * px);
  g.clip();
  g.beginPath();
  g.arc(toX(0), toY(SPOT_Z), 9.15 * px, 0, Math.PI * 2);
  g.stroke();
  g.restore();

  // Straffpunkten
  g.fillStyle = "rgba(255,255,255,0.95)";
  g.beginPath();
  g.arc(toX(0), toY(SPOT_Z), 0.12 * px, 0, Math.PI * 2);
  g.fill();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function crowdTexture() {
  const W = 1024;
  const H = 256;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = "#131a1d";
  g.fillRect(0, 0, W, H);

  // Sittande publik: rader av små färgklickar som ljusnar uppåt
  const palette = [
    "#d8dde0", "#c94b3c", "#2f5fa8", "#e0c34a", "#3f8a4a",
    "#8a4fa8", "#e08a3c", "#1f2a33", "#b8bcc0", "#6b3f2a",
  ];
  const rows = 30;
  for (let r = 0; r < rows; r++) {
    const y = H - 10 - (r * (H - 20)) / rows;
    const jitter = 1 + r * 0.04;
    for (let c = 0; c < 170; c++) {
      if (Math.random() < 0.08) continue; // tomma platser
      const x = (c + (r % 2) * 0.5) * (W / 170) + (Math.random() - 0.5) * 2.5;
      g.fillStyle = palette[(Math.random() * palette.length) | 0];
      g.globalAlpha = 0.5 + Math.random() * 0.4;
      g.beginPath();
      g.ellipse(x, y, 2.2 * jitter, 3.1 * jitter, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  // Skugga nedåt så de nedre raderna hamnar i mörker
  const shade = g.createLinearGradient(0, H, 0, 0);
  shade.addColorStop(0, "rgba(0,0,0,0.55)");
  shade.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function ballTexture() {
  const S = 512;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d");
  g.fillStyle = "#f5f6f4";
  g.fillRect(0, 0, S, S);

  const poly = (cx, cy, r, n, rot, fill) => {
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = "rgba(30,30,30,0.35)";
    g.lineWidth = 3;
    g.stroke();
  };

  // Approximation av klassiskt svartvitt mönster
  const r = S * 0.085;
  const rows = [
    { y: S * 0.17, n: 5, off: 0 },
    { y: S * 0.4, n: 5, off: 0.5 },
    { y: S * 0.62, n: 5, off: 0 },
    { y: S * 0.85, n: 5, off: 0.5 },
  ];
  rows.forEach((row) => {
    for (let i = 0; i < row.n; i++) {
      const cx = ((i + row.off) / row.n) * S;
      poly(cx, row.y, r, 5, -Math.PI / 2, "#22262b");
      poly(cx + S / row.n / 2, row.y, r * 0.55, 6, 0, "rgba(200,205,200,0.35)");
    }
  });
  // Sömmar
  g.strokeStyle = "rgba(120,125,120,0.35)";
  g.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    g.beginPath();
    g.moveTo(0, (i / 8) * S);
    g.lineTo(S, (i / 8) * S);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function skyTexture() {
  const cv = document.createElement("canvas");
  cv.width = 32;
  cv.height = 512;
  const g = cv.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, "#050b16");
  grad.addColorStop(0.55, "#0d1c31");
  grad.addColorStop(0.85, "#1b3550");
  grad.addColorStop(1, "#2b4a63");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 512);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* =====================================================================
   Spelarfigurer — byggda av primitiver, med grupper för att kunna animera
   ===================================================================== */

function buildPlayer(colors, opts) {
  const isKeeper = !!(opts && opts.keeper);
  const root = new THREE.Group();

  const skin = new THREE.MeshStandardMaterial({ color: 0xc98c62, roughness: 0.75 });
  const shirt = new THREE.MeshStandardMaterial({ color: colors.shirt, roughness: 0.68 });
  const shorts = new THREE.MeshStandardMaterial({ color: colors.shorts, roughness: 0.7 });
  const socks = new THREE.MeshStandardMaterial({ color: colors.socks, roughness: 0.7 });
  const boots = new THREE.MeshStandardMaterial({ color: 0x15181a, roughness: 0.45 });
  const gloves = new THREE.MeshStandardMaterial({ color: colors.gloves || 0xe8e8e8, roughness: 0.6 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x2c2018, roughness: 0.9 });

  const add = (geo, mat, x, y, z, parent) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    (parent || root).add(m);
    return m;
  };

  // Bål — hoftgrupp så hela överkroppen kan böjas
  const hips = new THREE.Group();
  hips.position.y = 0.92;
  root.add(hips);

  const torso = add(new THREE.CapsuleGeometry(0.19, 0.4, 4, 12), shirt, 0, 0.28, 0, hips);
  torso.scale.set(1.15, 1, 0.75);

  // Axelparti
  const chest = add(new THREE.CapsuleGeometry(0.17, 0.16, 4, 12), shirt, 0, 0.5, 0, hips);
  chest.rotation.z = Math.PI / 2;
  chest.scale.set(1, 1.5, 0.85);

  // Huvud
  const head = new THREE.Group();
  head.position.set(0, 0.68, 0);
  hips.add(head);
  add(new THREE.SphereGeometry(0.115, 18, 14), skin, 0, 0, 0, head);
  const hairMesh = add(new THREE.SphereGeometry(0.12, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), hair, 0, 0.015, 0, head);
  hairMesh.rotation.x = -0.15;

  // Armar — egna grupper med axeln som pivot
  const arms = {};
  [["left", -1], ["right", 1]].forEach(([side, s]) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.235, 0.5, 0);
    hips.add(shoulder);
    const upper = add(new THREE.CapsuleGeometry(0.058, 0.24, 4, 8), shirt, 0, -0.14, 0, shoulder);
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.28, 0);
    shoulder.add(elbow);
    add(new THREE.CapsuleGeometry(0.05, 0.22, 4, 8), skin, 0, -0.13, 0, elbow);
    const hand = add(new THREE.SphereGeometry(isKeeper ? 0.085 : 0.062, 12, 10), isKeeper ? gloves : skin, 0, -0.27, 0, elbow);
    hand.scale.set(1, 1.25, 0.7);
    arms[side] = { shoulder, elbow, upper, hand };
  });

  // Ben
  const legs = {};
  [["left", -1], ["right", 1]].forEach(([side, s]) => {
    const hip = new THREE.Group();
    hip.position.set(s * 0.105, 0, 0);
    hips.add(hip);
    add(new THREE.CapsuleGeometry(0.085, 0.26, 4, 10), shorts, 0, -0.17, 0, hip);
    const knee = new THREE.Group();
    knee.position.set(0, -0.42, 0);
    hip.add(knee);
    add(new THREE.CapsuleGeometry(0.07, 0.28, 4, 10), socks, 0, -0.18, 0, knee);
    const boot = add(new THREE.BoxGeometry(0.11, 0.075, 0.25), boots, 0, -0.36, 0.05, knee);
    legs[side] = { hip, knee, boot };
  });

  return { root, hips, head, arms, legs, materials: { shirt, shorts, socks, gloves } };
}

/* =====================================================================
   Scenen
   ===================================================================== */

export class PenaltyScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.running = false;
    this.time = 0;
    this.phase = "idle";
    this._anim = null;
    this._cam = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this._camGoal = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this._shake = 0;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog(0x0d1c31, 45, 165);

    this.camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 400);
    this.camera.position.set(0, 1.55, 14.6);

    this._buildLights();
    this._buildPitch();
    this._buildGoal();
    this._buildStadium();
    this._buildBall();
    this._buildAim();

    this.keeper = null;
    this.shooter = null;
    this.teams = {
      home: { shirt: 0x1a7a3c, shorts: 0xffffff, socks: 0x1a7a3c, gloves: 0xe8e8e8 },
      away: { shirt: 0xc9352b, shorts: 0x1c231f, socks: 0xc9352b, gloves: 0xffe066 },
    };

    this.raycaster = new THREE.Raycaster();
    this._aimPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(GOAL_W * 2.2, 4.2),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this._aimPlane.position.set(0, 1.3, 0);
    this.scene.add(this._aimPlane);

    this.setPhase("shoot", true);
    this.resize();
  }

  /* ---------- Ljus: flodljus på natten ---------- */
  _buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x9fb8d0, 0x22331f, 0.45));

    // Huvudljuset kastar skuggorna
    const key = new THREE.DirectionalLight(0xf2f6ff, 2.6);
    key.position.set(-16, 26, 20);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 90;
    key.shadow.camera.left = -26;
    key.shadow.camera.right = 26;
    key.shadow.camera.top = 26;
    key.shadow.camera.bottom = -14;
    key.shadow.bias = -0.0009;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);
    this.scene.add(key.target);
    key.target.position.set(0, 0, 6);

    const fill = new THREE.DirectionalLight(0xbfd4ff, 1.05);
    fill.position.set(20, 22, -8);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xdce8ff, 0.8);
    rim.position.set(4, 14, -24);
    this.scene.add(rim);

    // Flodljusmaster i hörnen
    this.pylons = [];
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.7, metalness: 0.3 });
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfff4d6,
      emissiveIntensity: 3.2,
      roughness: 0.4,
    });
    [[-30, -12], [30, -12], [-30, 30], [30, 30]].forEach(([x, z]) => {
      const g = new THREE.Group();
      const h = 24;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.42, h, 10), mastMat);
      mast.position.y = h / 2;
      g.add(mast);
      const rig = new THREE.Mesh(new THREE.BoxGeometry(5.4, 2.6, 0.5), mastMat);
      rig.position.y = h + 1.2;
      g.add(rig);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 2; j++) {
          const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.5, 12), lampMat);
          lamp.position.set(-2 + i * 1.35, h + 0.55 + j * 1.2, z > 0 ? -0.3 : 0.3);
          lamp.rotation.y = z > 0 ? Math.PI : 0;
          g.add(lamp);
        }
      }
      // Ljusdimma runt masten
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this._glowTexture(),
          color: 0xfff0cc,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      glow.position.set(0, h + 1.2, 0);
      glow.scale.set(16, 16, 1);
      g.add(glow);
      g.position.set(x, 0, z);
      this.scene.add(g);
      this.pylons.push(g);
    });
  }

  _glowTexture() {
    if (this._glowTex) return this._glowTex;
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const g = cv.getContext("2d");
    const rad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    rad.addColorStop(0, "rgba(255,248,225,0.9)");
    rad.addColorStop(0.35, "rgba(255,240,200,0.28)");
    rad.addColorStop(1, "rgba(255,235,190,0)");
    g.fillStyle = rad;
    g.fillRect(0, 0, 128, 128);
    this._glowTex = new THREE.CanvasTexture(cv);
    return this._glowTex;
  }

  /* ---------- Gräsmattan ---------- */
  _buildPitch() {
    const pitch = new THREE.Mesh(
      new THREE.PlaneGeometry(PITCH, PITCH),
      new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 0.92, metalness: 0 })
    );
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    this.scene.add(pitch);

    // Mörkt underlag längre bort så kanten inte syns
    const around = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 260),
      new THREE.MeshStandardMaterial({ color: 0x16301a, roughness: 1 })
    );
    around.rotation.x = -Math.PI / 2;
    around.position.y = -0.02;
    this.scene.add(around);
  }

  /* ---------- Målet med stolpar, ribba och nät ---------- */
  _buildGoal() {
    const goal = new THREE.Group();
    this.scene.add(goal);
    this.goal = goal;

    const white = new THREE.MeshStandardMaterial({ color: 0xf4f7f8, roughness: 0.42, metalness: 0.12 });

    const post = new THREE.CylinderGeometry(POST_R, POST_R, GOAL_H, 16);
    [-1, 1].forEach((s) => {
      const p = new THREE.Mesh(post, white);
      p.position.set((s * GOAL_W) / 2, GOAL_H / 2, 0);
      p.castShadow = true;
      goal.add(p);
    });
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(POST_R, POST_R, GOAL_W + POST_R * 2, 16), white);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, GOAL_H, 0);
    bar.castShadow = true;
    goal.add(bar);

    // Bakre stödrör
    const backBottomY = 0.05;
    [-1, 1].forEach((s) => {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, Math.hypot(NET_DEPTH, GOAL_H - backBottomY), 10), white);
      strut.position.set((s * GOAL_W) / 2, GOAL_H / 2, -NET_DEPTH / 2);
      strut.rotation.x = Math.atan2(NET_DEPTH, GOAL_H - backBottomY);
      goal.add(strut);
    });
    const backBar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, GOAL_W, 10), white);
    backBar.rotation.z = Math.PI / 2;
    backBar.position.set(0, backBottomY, -NET_DEPTH);
    goal.add(backBar);

    this._buildNet(goal);
  }

  _buildNet(parent) {
    const step = 0.13; // maskstorlek
    const pts = [];
    const hw = GOAL_W / 2;

    // Baksidan lutar bakåt och nätet hänger med en lätt sväng
    const backZ = (y) => -NET_DEPTH * (0.55 + 0.45 * (1 - y / GOAL_H));
    const sag = (t) => Math.sin(t * Math.PI) * 0.06;

    const push = (x1, y1, z1, x2, y2, z2) => pts.push(x1, y1, z1, x2, y2, z2);

    // Bakre panel
    for (let x = -hw; x <= hw + 0.001; x += step) {
      push(x, 0, backZ(0), x, GOAL_H, backZ(GOAL_H));
    }
    for (let y = 0; y <= GOAL_H + 0.001; y += step) {
      push(-hw, y, backZ(y), hw, y, backZ(y));
    }
    // Sidopaneler
    [-1, 1].forEach((s) => {
      for (let y = 0; y <= GOAL_H + 0.001; y += step) {
        push(s * hw, y, 0, s * hw, y, backZ(y));
      }
      const zs = [];
      for (let z = 0; z >= -NET_DEPTH - 0.001; z -= step) zs.push(z);
      zs.forEach((z) => {
        const t = clamp(-z / NET_DEPTH, 0, 1);
        const topY = GOAL_H - t * 0.02;
        push(s * hw, 0, z, s * hw, topY, z);
      });
    });
    // Tak
    for (let x = -hw; x <= hw + 0.001; x += step) {
      push(x, GOAL_H, 0, x, GOAL_H - 0.02, backZ(GOAL_H));
    }
    for (let z = 0; z >= -NET_DEPTH - 0.001; z -= step) {
      const t = clamp(-z / NET_DEPTH, 0, 1);
      const y = GOAL_H - sag(t) - t * 0.02;
      push(-hw, y, z, hw, y, z);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this._netBase = Float32Array.from(pts);
    const net = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })
    );
    parent.add(net);
    this.net = net;
  }

  /* ---------- Läktare, publik och reklamskyltar ---------- */
  _buildStadium() {
    const crowd = crowdTexture();
    const concrete = new THREE.MeshStandardMaterial({ color: 0x2b3238, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1b2126, roughness: 0.8, metalness: 0.2 });

    const stand = (w, x, z, rotY, height) => {
      const g = new THREE.Group();
      const depth = height * 1.35;

      // Publiken på ett lutande plan som reser sig bort från planen
      const tex = crowd.clone();
      tex.needsUpdate = true;
      tex.repeat.set(Math.max(1, w / 24), 1);
      const seats = new THREE.Mesh(
        new THREE.PlaneGeometry(w, Math.hypot(depth, height)),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 })
      );
      seats.rotation.x = -Math.atan2(depth, height);
      seats.position.set(0, height / 2 + 1.2, -depth / 2);
      g.add(seats);

      // Framkant och bakvägg
      const front = new THREE.Mesh(new THREE.BoxGeometry(w, 1.4, 0.6), concrete);
      front.position.set(0, 0.7, 0.3);
      g.add(front);
      const back = new THREE.Mesh(new THREE.BoxGeometry(w, height + 2, 1.2), concrete);
      back.position.set(0, (height + 2) / 2, -depth - 0.4);
      g.add(back);

      // Tak, en bit ovanför översta raden
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 1.5, 0.45, depth + 2.5), roofMat);
      roof.position.set(0, height + 3.9, -depth / 2 - 0.5);
      roof.rotation.x = 0.06;
      g.add(roof);
      [-1, 1].forEach((s) => {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.7, height + 3.9, 0.9), roofMat);
        pillar.position.set((s * (w - 1.5)) / 2, (height + 3.9) / 2, -depth - 0.7);
        g.add(pillar);
      });

      g.position.set(x, 0, z);
      g.rotation.y = rotY;
      this.scene.add(g);
      return g;
    };

    stand(62, 0, -20, 0, 7.5); // bakom målet
    stand(76, -32, 14, Math.PI / 2, 13); // långsida vänster
    stand(76, 32, 14, -Math.PI / 2, 13); // långsida höger

    // Reklamskyltar bakom mållinjen
    const boardMat = new THREE.MeshStandardMaterial({
      map: this._boardTexture(),
      roughness: 0.55,
      emissive: 0x1a2a20,
      emissiveIntensity: 0.25,
    });
    const boards = new THREE.Mesh(new THREE.PlaneGeometry(58, 1.05), boardMat);
    boards.position.set(0, 0.53, -14);
    this.scene.add(boards);
    [-1, 1].forEach((s) => {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(46, 1.05), boardMat);
      side.position.set(s * 29.5, 0.53, 12);
      side.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      this.scene.add(side);
    });
  }

  _boardTexture() {
    const cv = document.createElement("canvas");
    cv.width = 2048;
    cv.height = 64;
    const g = cv.getContext("2d");
    g.fillStyle = "#0f2c1a";
    g.fillRect(0, 0, 2048, 64);
    const words = ["FOTBOLLSKARTA.SE", "STRAFFLIGAN", "ALLA NORDENS KLUBBAR"];
    g.font = "bold 34px -apple-system, Helvetica, Arial, sans-serif";
    g.textBaseline = "middle";
    for (let i = 0; i < 6; i++) {
      const x = i * 342 + 24;
      g.fillStyle = i % 2 ? "#1a7a3c" : "#0f5227";
      g.fillRect(x - 24, 0, 342, 64);
      g.fillStyle = "rgba(255,255,255,0.92)";
      g.fillText(words[i % words.length], x, 34);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /* ---------- Bollen ---------- */
  _buildBall() {
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 32, 24),
      new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.45, metalness: 0.02 })
    );
    this.ball.castShadow = true;
    this.scene.add(this.ball);
    this.resetBall();
  }

  /* ---------- Siktet ---------- */
  _buildAim() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.21, 28),
      new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
    );
    g.add(ring);
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.05, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    );
    g.add(dot);
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(
        new THREE.PlaneGeometry(0.02, 0.13),
        new THREE.MeshBasicMaterial({ color: 0xffe066, side: THREE.DoubleSide })
      );
      tick.position.set(Math.cos((i * Math.PI) / 2) * 0.3, Math.sin((i * Math.PI) / 2) * 0.3, 0);
      tick.rotation.z = (i * Math.PI) / 2;
      g.add(tick);
    }
    g.position.set(0, GOAL_H * 0.5, 0.06);
    g.visible = false;
    this.scene.add(g);
    this.aim = g;
    this._aimRing = ring;
  }

  /* =====================================================================
     Publikt API
     ===================================================================== */

  setTeams(home, away) {
    this.teams.home = Object.assign({}, this.teams.home, home || {});
    this.teams.away = Object.assign({}, this.teams.away, away || {});
    this._rebuildPlayers();
  }

  _rebuildPlayers() {
    if (this.keeper) this.scene.remove(this.keeper.root);
    if (this.shooter) this.scene.remove(this.shooter.root);

    // I skjutläget är motståndaren målvakt, i räddningsläget är det vi själva
    const keeperColors = this.phase === "save" ? this.teams.home : this.teams.away;
    const shooterColors = this.phase === "save" ? this.teams.away : this.teams.home;

    // Målvakten bär klubbens egen tröjfärg, så man ser vilket lag som står i mål
    this.keeper = buildPlayer(
      {
        shirt: keeperColors.shirt,
        shorts: keeperColors.shorts,
        socks: keeperColors.socks,
        gloves: 0xf2f2f2,
      },
      { keeper: true }
    );
    this.keeper.root.position.set(0, 0, 0.22);
    this.scene.add(this.keeper.root);

    this.shooter = buildPlayer(shooterColors, {});
    this.scene.add(this.shooter.root);

    this._resetPoses();
  }

  _resetPoses() {
    if (!this.keeper) return;
    const k = this.keeper;
    k.root.position.set(0, 0, 0.22);
    k.root.rotation.set(0, 0, 0);
    k.hips.rotation.set(0, 0, 0);
    k.hips.position.y = 0.92;
    // Målvaktens grundställning: lätt böjda knän, armarna ut
    k.legs.left.hip.rotation.set(0.1, 0, -0.22);
    k.legs.right.hip.rotation.set(0.1, 0, 0.22);
    k.legs.left.knee.rotation.x = 0.3;
    k.legs.right.knee.rotation.x = 0.3;
    k.arms.left.shoulder.rotation.set(0, 0, 0.95);
    k.arms.right.shoulder.rotation.set(0, 0, -0.95);
    k.arms.left.elbow.rotation.set(0, 0, -0.5);
    k.arms.right.elbow.rotation.set(0, 0, 0.5);

    const s = this.shooter;
    s.root.rotation.set(0, 0, 0);
    s.hips.rotation.set(0, 0, 0);
    s.hips.position.y = 0.92;
    Object.values(s.legs).forEach((l) => {
      l.hip.rotation.set(0, 0, 0);
      l.knee.rotation.set(0, 0, 0);
    });
    s.arms.left.shoulder.rotation.set(0, 0, 0.16);
    s.arms.right.shoulder.rotation.set(0, 0, -0.16);
    s.arms.left.elbow.rotation.set(0, 0, 0);
    s.arms.right.elbow.rotation.set(0, 0, 0);
    // Startposition för upploppet, snett bakom bollen
    s.root.position.set(-2.6, 0, SPOT_Z + 4.2);
    s.root.rotation.y = Math.PI + 0.5;
    // I skjutläget står man bakom sin egen spelare — han göms tills upploppet
    // börjar, så att han inte skymmer målet medan man siktar.
    s.root.visible = this.phase !== "shoot";
  }

  setPhase(phase, immediate) {
    this.phase = phase;
    if (phase === "shoot") {
      // Bakom skytten, som på tv:ns straffkamera
      this._camGoal.pos.set(0.4, 2.1, SPOT_Z + 9);
      this._camGoal.target.set(0, 1.25, 0);
      this.camera.fov = 32;
    } else if (phase === "save") {
      // Bakom och över målet, så hela målramen och skytten syns
      // Låg kamera strax bakom nätet — målramen hamnar mitt i bild och
      // skytten syns genom målmunnen, som en riktig målkamera.
      this._camGoal.pos.set(0, 1.3, -5.6);
      this._camGoal.target.set(0, 1.3, 12);
      this.camera.fov = 48;
    } else {
      this._camGoal.pos.set(9.5, 3.1, 11.5);
      this._camGoal.target.set(0, 1.2, 1);
      this.camera.fov = 42;
    }
    this.camera.updateProjectionMatrix();
    if (immediate) {
      this._cam.pos.copy(this._camGoal.pos);
      this._cam.target.copy(this._camGoal.target);
    }
    if (this.keeper) this._rebuildPlayers();
  }

  /**
   * Ger +1 om världens positiva x-axel hamnar till höger i bild, annars -1.
   * Målvaktsvyn ligger bakom målet, där sidorna byter plats — den här
   * funktionen låter knapparna alltid betyda vänster/höger så som det ser ut
   * på skärmen.
   */
  worldXScreenSign() {
    const a = new THREE.Vector3(3, 1.2, 0).project(this.camera);
    const b = new THREE.Vector3(-3, 1.2, 0).project(this.camera);
    return a.x >= b.x ? 1 : -1;
  }

  showAim(visible) {
    this.aim.visible = !!visible;
  }

  setAim(tx, ty) {
    this._aimTx = tx;
    this._aimTy = ty;
    this.aim.position.set(tx * (GOAL_W / 2), ty * GOAL_H, 0.07);
  }

  /** Omvandlar en pekarposition på canvasen till normaliserat sikte i målet. */
  pickAim(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this._aimPlane, false)[0];
    if (!hit) return null;
    return {
      tx: clamp(hit.point.x / (GOAL_W / 2), -1.45, 1.45),
      ty: clamp(hit.point.y / GOAL_H, 0.02, 1.5),
    };
  }

  resetBall() {
    this.ball.position.set(0, BALL_R, SPOT_Z);
    this.ball.rotation.set(0, 0, 0);
    this._netOffset = 0;
    this._restoreNet();
  }

  _restoreNet() {
    const pos = this.net.geometry.attributes.position;
    pos.array.set(this._netBase);
    pos.needsUpdate = true;
  }

  /** Låter nätet buckla ut där bollen träffade. */
  _bulgeNet(point, amount) {
    const pos = this.net.geometry.attributes.position;
    const base = this._netBase;
    for (let i = 0; i < base.length; i += 3) {
      const dx = base[i] - point.x;
      const dy = base[i + 1] - point.y;
      const d = Math.hypot(dx, dy);
      const w = Math.exp(-(d * d) / 1.1);
      pos.array[i] = base[i] + dx * 0.06 * w * amount;
      pos.array[i + 1] = base[i + 1] + dy * 0.06 * w * amount;
      pos.array[i + 2] = base[i + 2] - 0.55 * w * amount;
    }
    pos.needsUpdate = true;
  }

  /**
   * Spelar upp en straff.
   * @param {object} o
   *   tx, ty      – sikte, normaliserat (tx: -1..1 över målet, ty: 0..1 höjd)
   *   power       – 0..1
   *   keeperZone  – {col:-1|0|1, row:0|1} dit målvakten kastar sig
   *   outcome     – "goal" | "save" | "miss" | "post"
   */
  playShot(o) {
    const self = this;
    this.showAim(false);
    this._restoreNet();
    this.shooter.root.visible = true;

    const power = clamp(o.power == null ? 0.7 : o.power, 0.15, 1);
    const flightTime = lerp(0.95, 0.52, power);
    const targetX = o.tx * (GOAL_W / 2);
    const targetY = Math.max(0.05, o.ty * GOAL_H);
    const start = new THREE.Vector3(0, BALL_R, SPOT_Z);

    // Slutpunkt: i nätet vid mål, förbi målet vid miss
    let endZ = -NET_DEPTH * 0.62;
    if (o.outcome === "miss") endZ = -3.4;
    if (o.outcome === "post") endZ = -0.1;
    const end = new THREE.Vector3(targetX, targetY, endZ);
    if (o.outcome === "miss") {
      // Utanför ramen — antingen vid sidan eller över ribban
      const overBar = o.ty > 0.95;
      end.x = overBar ? targetX : Math.sign(o.tx || 1) * (GOAL_W / 2 + 1.1);
      end.y = overBar ? Math.max(GOAL_H + 0.9, targetY) : targetY;
    }

    // Kurva och lyft
    const curve = (o.curve == null ? 0 : o.curve) * lerp(1.4, 0.55, power);
    const apex = lerp(0.55, 1.15, Math.max(0, targetY / GOAL_H - 0.15)) + power * 0.35;
    const mid = new THREE.Vector3(
      (start.x + end.x) / 2 + curve,
      Math.max(start.y, targetY) + apex * 0.42,
      (start.z + end.z) / 2
    );
    const path = new THREE.QuadraticBezierCurve3(start, mid, end);

    // Målvaktens mål: bollen om han räddar, annars mitten av den valda rutan
    const kz = o.keeperZone || { col: 0, row: 0 };
    let diveTo;
    if (o.outcome === "save") {
      const t = clamp(0.9, 0, 1);
      diveTo = path.getPoint(t);
    } else {
      diveTo = new THREE.Vector3(kz.col * (GOAL_W / 2) * 0.78, kz.row ? GOAL_H * 0.78 : GOAL_H * 0.22, 0.1);
    }

    const runUp = 0.72;
    const dive = 0.42;
    const settle = o.outcome === "goal" ? 1.25 : 1.15;
    const total = runUp + flightTime + settle;

    return new Promise((resolve) => {
      self._anim = {
        t: 0,
        t0: null,
        total,
        resolve,
        update(dt) {
          // Tiden räknas i verklig tid, inte i bildrutor, så att animationen
          // tar lika lång tid även på en enhet som ritar få bilder per sekund.
          if (this.t0 === null) this.t0 = performance.now();
          this.t = (performance.now() - this.t0) / 1000;
          const t = this.t;
          const s = self.shooter;
          const k = self.keeper;

          /* --- Upploppet --- */
          if (t < runUp) {
            const p = t / runUp;
            const e = easeInOut(p);
            s.root.position.set(lerp(-2.6, -0.42, e), 0, lerp(SPOT_Z + 4.2, SPOT_Z + 0.34, e));
            s.root.rotation.y = lerp(Math.PI + 0.5, Math.PI + 0.12, e);
            // Springsteg
            const stride = Math.sin(p * Math.PI * 5) * 0.85;
            s.legs.left.hip.rotation.x = stride * 0.6;
            s.legs.right.hip.rotation.x = -stride * 0.6;
            s.legs.left.knee.rotation.x = Math.max(0, -stride) * 1.1;
            s.legs.right.knee.rotation.x = Math.max(0, stride) * 1.1;
            s.arms.left.shoulder.rotation.x = -stride * 0.5;
            s.arms.right.shoulder.rotation.x = stride * 0.5;
            s.hips.position.y = 0.92 + Math.abs(Math.sin(p * Math.PI * 5)) * 0.035;
            s.hips.rotation.x = 0.1 * p;

            // Sista steget: svingen bakåt
            if (p > 0.72) {
              const q = (p - 0.72) / 0.28;
              s.legs.right.hip.rotation.x = lerp(s.legs.right.hip.rotation.x, -1.15, q);
              s.legs.right.knee.rotation.x = lerp(s.legs.right.knee.rotation.x, 1.5, q);
              s.arms.left.shoulder.rotation.z = lerp(0.16, 1.15, q);
            }

            // Målvakten studsar på plats
            const b = Math.sin(t * 9) * 0.03;
            k.hips.position.y = 0.92 + b;
            k.arms.left.shoulder.rotation.z = 0.95 + b * 2;
            k.arms.right.shoulder.rotation.z = -0.95 - b * 2;
            return;
          }

          /* --- Kontakt och bollflykt --- */
          const rawFt = (t - runUp) / flightTime;
          const ft = clamp(rawFt, 0, 1);
          if (rawFt < 1) {
            const p = path.getPoint(easeOut(ft) * 0.35 + ft * 0.65);
            self.ball.position.copy(p);
            const spin = flightTime > 0 ? (1 / flightTime) * 12 : 12;
            self.ball.rotation.x -= dt * spin;
            self.ball.rotation.y -= dt * spin * (o.curve || 0) * 2.5;

            // Sparkbenet svingar igenom
            const kick = clamp(ft * 4.2, 0, 1);
            s.legs.right.hip.rotation.x = lerp(-1.15, 0.85, easeOut(kick));
            s.legs.right.knee.rotation.x = lerp(1.5, 0.05, easeOut(kick));
            s.legs.left.hip.rotation.x = lerp(0, -0.25, kick);
            s.arms.left.shoulder.rotation.z = lerp(1.15, 0.5, kick);
            s.hips.rotation.y = lerp(0, -0.35, kick);
            s.hips.position.y = 0.92 - 0.05 * Math.sin(kick * Math.PI);

            // Målvaktens dyk
            const dp = clamp((t - runUp - 0.03) / dive, 0, 1);
            if (dp > 0) {
              const e = easeOut(dp);
              const dir = Math.sign(diveTo.x) || 0;
              const lateral = diveTo.x * 0.82;
              const high = diveTo.y > GOAL_H * 0.5;
              k.root.position.set(lateral * e, 0, 0.22 - 0.15 * e);
              k.hips.position.y = 0.92 + (high ? 0.62 : -0.34) * e;
              k.root.rotation.z = -dir * (high ? 0.95 : 1.32) * e;
              k.root.rotation.y = -dir * 0.25 * e;
              k.hips.rotation.x = (high ? -0.25 : 0.35) * e;
              // Armarna sträcks mot bollen
              k.arms.left.shoulder.rotation.z = lerp(0.95, dir < 0 ? 2.6 : 1.5, e);
              k.arms.right.shoulder.rotation.z = lerp(-0.95, dir > 0 ? -2.6 : -1.5, e);
              k.arms.left.elbow.rotation.z = lerp(-0.5, -0.05, e);
              k.arms.right.elbow.rotation.z = lerp(0.5, 0.05, e);
              k.arms.left.shoulder.rotation.x = lerp(0, -0.5, e);
              k.arms.right.shoulder.rotation.x = lerp(0, -0.5, e);
              k.legs.left.hip.rotation.x = lerp(0.1, high ? -0.7 : 0.15, e);
              k.legs.right.hip.rotation.x = lerp(0.1, high ? -0.7 : 0.15, e);
              k.legs.left.knee.rotation.x = lerp(0.3, 0.1, e);
              k.legs.right.knee.rotation.x = lerp(0.3, 0.1, e);
            }

            return;
          }

          /* --- Efter träffen --- */
          if (!this._impact) {
            this._impact = true;
            self._shake = o.outcome === "goal" ? 0.05 : 0.08;
          }
          const st = clamp((t - runUp - flightTime) / settle, 0, 1);
          if (o.outcome === "goal") {
            // Bollen sätter sig i nätet, nätet svänger ut och tillbaka
            const bulge = Math.exp(-st * 5.5) * Math.cos(st * 26) * 0.5 + Math.exp(-st * 3.2) * 0.5;
            self._bulgeNet(new THREE.Vector3(targetX, targetY, 0), Math.max(0, bulge));
            self.ball.position.set(
              targetX * (1 - st * 0.28),
              Math.max(BALL_R, targetY - st * st * targetY * 1.15),
              lerp(endZ, -NET_DEPTH * 0.5, st)
            );
            self.ball.rotation.x -= dt * 3;
          } else if (o.outcome === "save") {
            // Bollen slås undan i den riktning målvakten kom ifrån
            const dir = Math.sign(diveTo.x) || 1;
            self.ball.position.set(
              diveTo.x + dir * st * 5.2,
              Math.max(BALL_R, diveTo.y + st * 1.2 - st * st * 3.4),
              lerp(diveTo.z, 3.6, st)
            );
            self.ball.rotation.z -= dt * 8 * dir;
            // Målvakten landar
            k.root.position.y = -0.02 * Math.sin(st * Math.PI);
          } else if (o.outcome === "post") {
            const dir = Math.sign(o.tx) || 1;
            self.ball.position.set(
              end.x - dir * st * 3.1,
              Math.max(BALL_R, end.y + st * 0.9 - st * st * 2.6),
              lerp(end.z, 4.2, st)
            );
            self.ball.rotation.y -= dt * 9;
          } else {
            self.ball.position.set(
              lerp(end.x, end.x * 1.5, st),
              Math.max(BALL_R, end.y + st * 1.1 - st * st * 2.2),
              lerp(end.z, end.z - 7, st)
            );
            self.ball.rotation.x -= dt * 6;
          }

          // Målvakten reser sig långsamt
          if (o.outcome !== "save" && st > 0.55) {
            const r = (st - 0.55) / 0.45;
            k.root.rotation.z *= 1 - r * 0.5;
          }

          if (t >= total) {
            self._anim = null;
            resolve();
          }
        },
      };
    });
  }

  /** Kameran svänger ut för en repris-liknande vinkel. */
  celebrate() {
    this._camGoal.pos.set(-6.4, 2.4, 4.5);
    this._camGoal.target.set(0, 1.1, -0.8);
  }

  /* ---------- Renderloop ---------- */

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.getDelta();
    const loop = () => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      this._frame();
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _frame() {
    // raw = verklig tid sedan förra bildrutan, dt = samma men tak för att inte
    // få hopp i animationerna om webbläsaren varit borta en stund.
    const raw = Math.min(this.clock.getDelta(), 0.5);
    const dt = Math.min(raw, 0.05);
    this.time += dt;

    if (this._anim) this._anim.update(dt);

    // Kameran glider mjukt mot sitt mål — i verklig tid, så bytet mellan
    // skjut- och målvaktsläge går lika snabbt även på en långsam enhet.
    const k = 1 - Math.pow(0.0004, raw);
    this._cam.pos.lerp(this._camGoal.pos, k);
    this._cam.target.lerp(this._camGoal.target, k);

    let shakeX = 0;
    let shakeY = 0;
    if (this._shake > 0.0005) {
      shakeX = (Math.random() - 0.5) * this._shake;
      shakeY = (Math.random() - 0.5) * this._shake;
      this._shake *= Math.pow(0.02, raw);
    }
    this.camera.position.copy(this._cam.pos);
    this.camera.position.x += shakeX;
    this.camera.position.y += shakeY;
    this.camera.lookAt(this._cam.target);

    if (this.aim.visible) {
      const pulse = 0.9 + Math.sin(this.time * 5) * 0.1;
      this.aim.scale.setScalar(pulse);
    }

    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 450;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.stop();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
    this.renderer.dispose();
  }
}

export const GOAL = { W: GOAL_W, H: GOAL_H };
