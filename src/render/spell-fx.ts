import * as THREE from 'three';
import type { ConeSpell, SpellDef, SpellElement, StrikeSpell } from '../combat/data/spells';
import { BEAM_LINGER_FRAMES, SpellSystem, type RegenFx, type StrikeFx, type StrikePoint } from '../combat/spell-system';
import { glowTexture } from './projectiles';

/**
 * 杖の魔法（ADR-048）の見た目。sim は src/combat/spell-system.ts（効果の状態 strikes / cones / beams / rings / regen）で、ここはそれを**読んで描くだけ**
 * （毎フレーム、状態から作り直す = 描画側に状態を持たない。例外は雷の稲妻の形と、粒の発生の端数）。
 *
 * - 落雷・爆発: 予告の輪（床。ターゲットを追い、着弾の少し前に止まる）→ 着弾（雷 = 縦のぎざぎざの稲妻 + 閃光 + 衝撃の輪、爆発 = 膨らむ火球 + 衝撃の輪 + 火の粉）
 * - 吹雪: 前方の扇（床の薄い氷色）+ 吹きつける雪・氷の粒
 * - 火炎放射: 杖の先から伸びる炎の芯 + 勢いよく飛ぶ火の粒（障害物で止まる長さに合わせる）
 * - 旋風: 内から外へ広がる風の壁（輪ごとに薄い円筒 2 枚 + 床の輪）+ 渦を巻く粒
 * - 再生: 術者の足元から立ちのぼる緑の光の粒 + 足元の輪
 * - 詠唱中: 足元の魔法陣（魔法の色。放つ瞬間まで回りながら濃くなる）
 * 色は系統（SpellElement）で決まる。プールを最初に作って使い回す（毎フレームの確保なし）。粒・陣は実時間（描画の dt）で進める。
 */

// ---------------------------------------------------------------- 色

interface Palette {
  /** 芯（明るい）・本体・縁（暗い）・床の予告 */
  core: THREE.Color;
  main: THREE.Color;
  edge: THREE.Color;
  floor: THREE.Color;
}

const pal = (core: number, main: number, edge: number, floor: number): Palette => ({ core: new THREE.Color(core), main: new THREE.Color(main), edge: new THREE.Color(edge), floor: new THREE.Color(floor) });

/**
 * 床も空も明るい（加算で白を重ねると白飛びする）ので、粒・床の模様は通常の合成で彩度のある色にし、加算は小さな火花・稲妻・光の球だけに使う。
 * core = 芯（明るい）、main = 本体、edge = 縁（暗い）、floor = 床の模様（予告の輪・陣・扇）
 */
const PALETTE: Record<SpellElement, Palette> = {
  arcane: pal(0xffffff, 0x8fb4ff, 0x3a5ad0, 0x6f98ff),
  lightning: pal(0xfffbd0, 0xffe040, 0x6f7dff, 0xf5c518),
  ice: pal(0xf2fbff, 0x9fdcff, 0x4a90e0, 0x57b8f5),
  fire: pal(0xffe070, 0xff7a1f, 0xb8260c, 0xff6a1a),
  blast: pal(0xffe8a0, 0xff8a2a, 0xc03008, 0xff5a1a),
  heal: pal(0xeaffef, 0x7ff0a8, 0x2fb86a, 0x3fd47f),
  wind: pal(0xf2fff6, 0xa8f0cc, 0x3fb88a, 0x4fd8a0),
};

// ---------------------------------------------------------------- テクスチャ

/** 輪（床の予告・衝撃の輪・魔法陣の外周）: 縁に細い線と、内側にうっすらと満ちた面 */
function makeRingTexture(): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const mid = n / 2;
  g.clearRect(0, 0, n, n);
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 7;
  g.beginPath();
  g.arc(mid, mid, mid - 6, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.beginPath();
  g.arc(mid, mid, mid * 0.86, 0, Math.PI * 2);
  g.stroke();
  // 目盛り（外周の短い刻み）
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(mid + Math.cos(a) * mid * 0.86, mid + Math.sin(a) * mid * 0.86);
    g.lineTo(mid + Math.cos(a) * (mid - 6), mid + Math.sin(a) * (mid - 6));
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 魔法陣: 二重の輪 + 六芒星 + 内側の小さな輪。詠唱のあいだ足元で回る */
function makeCircleTexture(): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const mid = n / 2;
  g.clearRect(0, 0, n, n);
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineJoin = 'round';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(mid, mid, mid - 6, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 3;
  g.beginPath();
  g.arc(mid, mid, mid * 0.82, 0, Math.PI * 2);
  g.stroke();
  // 六芒星（正三角形 2 つ）
  g.lineWidth = 4;
  for (const off of [0, Math.PI]) {
    g.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = off - Math.PI / 2 + (i / 3) * Math.PI * 2;
      const x = mid + Math.cos(a) * mid * 0.8;
      const y = mid + Math.sin(a) * mid * 0.8;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.stroke();
  }
  g.lineWidth = 3;
  g.beginPath();
  g.arc(mid, mid, mid * 0.28, 0, Math.PI * 2);
  g.stroke();
  // 外周の目盛り
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const r0 = mid * 0.82;
    const r1 = mid * (i % 3 === 0 ? 0.94 : 0.89);
    g.beginPath();
    g.moveTo(mid + Math.cos(a) * r0, mid + Math.sin(a) * r0);
    g.lineTo(mid + Math.cos(a) * r1, mid + Math.sin(a) * r1);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 風の壁: 横に流れる細い筋（円筒の u 方向へ回る） */
function makeWindTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 64;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const y = rnd() * h;
    const x = rnd() * w;
    const len = 30 + rnd() * 90;
    const grad = g.createLinearGradient(x, 0, x + len, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, `rgba(255,255,255,${0.35 + rnd() * 0.5})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(x, y, len, 1.5 + rnd() * 2.5);
    if (x + len > w) g.fillRect(x - w, y, len, 2); // 継ぎ目の折り返し
  }
  // 上下の縁を消す（壁の上端・下端がやわらかく消える）
  const fade = g.createLinearGradient(0, 0, 0, h);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.18, 'rgba(0,0,0,0)');
  fade.addColorStop(0.82, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = fade;
  g.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 帯の濃淡: 幅の中央が濃く、両端へ向けて消える（火炎放射の床の焦げ跡。u = 幅方向）。長さ方向（v）は根元がやや濃い */
function makeStripTexture(): THREE.CanvasTexture {
  const w = 64;
  const h = 64;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = Math.abs((x + 0.5) / w - 0.5) * 2; // 0 = 中央
      const along = 1 - Math.pow(y / h, 1.6) * 0.5; // v = 0 が根元
      const a = Math.max(0, 1 - u * u) * along;
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 扇の濃淡: 中心から縁へ向かって薄くなる横 1 本のグラデーション（u = 中心からの距離） */
function makeFanTexture(): THREE.CanvasTexture {
  const w = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = 4;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.3)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- 粒

/** 粒の数: 通常の合成（ほとんどの粒）と、加算の合成（小さな火花・光）。通常のほうが先頭 */
const MAX_SOFT = 150;
const MAX_SPARK = 80;
const MAX_PARTICLES = MAX_SOFT + MAX_SPARK;

interface Particle {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  active: boolean;
  age: number;
  life: number;
  vx: number;
  vy: number;
  vz: number;
  drag: number;
  gravity: number;
  s0: number;
  s1: number;
  a0: number;
  c0: THREE.Color;
  c1: THREE.Color;
}

const _c = new THREE.Color();

// ---------------------------------------------------------------- 杖の先の閃光

const MAX_FLASHES = 5;

interface Flash {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  active: boolean;
  age: number;
  life: number;
  size: number;
}

// ---------------------------------------------------------------- 落雷・爆発の 1 点

const MAX_STRIKE_SLOTS = 14;
const BOLT_NODES = 11;
const BOLT_HEIGHT = 11;
/** 稲妻が見えている長さ（sim フレーム）と、着弾の光の長さ */
const BOLT_FRAMES = 16;
const FLASH_FRAMES = 22;
const SHOCK_FRAMES = 14;
const FIREBALL_FRAMES = 20;

interface StrikeSlot {
  /** 割り当てられた点（変わったら稲妻の形を作り直す） */
  owner: StrikePoint | null;
  landedSeen: boolean;
  tele: THREE.Mesh;
  teleMat: THREE.MeshBasicMaterial;
  tele2: THREE.Mesh;
  tele2Mat: THREE.MeshBasicMaterial;
  fill: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  bolt: THREE.Group;
  boltGeo: THREE.BufferGeometry;
  boltMat: THREE.MeshBasicMaterial;
  glow: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  shock: THREE.Mesh;
  shockMat: THREE.MeshBasicMaterial;
  ball: THREE.Mesh;
  ballMat: THREE.MeshBasicMaterial;
  flash: THREE.Sprite;
  flashMat: THREE.SpriteMaterial;
}

// ---------------------------------------------------------------- 風の壁

const MAX_RING_SLOTS = 8;
const WIND_HEIGHT = 1.7;

interface RingSlot {
  group: THREE.Group;
  outer: THREE.Mesh;
  inner: THREE.Mesh;
  outerMat: THREE.MeshBasicMaterial;
  innerMat: THREE.MeshBasicMaterial;
  floor: THREE.Mesh;
  floorMat: THREE.MeshBasicMaterial;
}

// ---------------------------------------------------------------- 扇・炎の芯

const MAX_CONES = 2;
const MAX_BEAMS = 2;
const CONE_SEGMENTS = 24;

interface ConeSlot {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  geo: THREE.BufferGeometry;
  /** 扇の開き（度）。変わったときだけ形を作り直す */
  half: number;
}

interface BeamSlot {
  /** 床に残る炎の帯（上から見たときも、後ろから見たときも、どこへ向かっているかが読める） */
  floor: THREE.Mesh;
  floorMat: THREE.MeshBasicMaterial;
  core: THREE.Mesh;
  coreMat: THREE.MeshBasicMaterial;
  mid: THREE.Mesh;
  midMat: THREE.MeshBasicMaterial;
  flash: THREE.Sprite;
  flashMat: THREE.SpriteMaterial;
  acc: number;
}

/** 術者の状態（SpellFx が足元の陣・再生の粒を置くために読む） */
export interface SpellFxCaster {
  x: number;
  y: number;
  z: number;
  /** 詠唱している魔法（魔法を放つ前だけ。それ以外は null）と、放つ時刻までの進み（0〜1） */
  casting: SpellDef | null;
  castProgress: number;
}

export class SpellFx {
  readonly group = new THREE.Group();
  private time = 0;

  private readonly particles: Particle[] = [];
  private nextSoft = 0;
  private nextSpark = 0;
  private readonly strikes: StrikeSlot[] = [];
  private readonly strikeOwner = new Map<StrikePoint, StrikeSlot>();
  private readonly seenPoints = new Set<StrikePoint>();
  private readonly rings: RingSlot[] = [];
  private readonly cones: ConeSlot[] = [];
  private readonly beams: BeamSlot[] = [];
  private readonly circle: THREE.Mesh;
  private readonly circleMat: THREE.MeshBasicMaterial;
  /** 魔法陣の濃さ（詠唱が始まったら立ち上がり、放ったら消えていく） */
  private circleK = 0;
  private circleElement: SpellElement = 'arcane';
  private regenAcc = 0;
  private coneAcc = 0;
  private ringAcc = 0;
  /** 杖の先の閃光（魔法を放った瞬間の小さな光の球）のプール */
  private readonly flashes: Flash[] = [];
  private nextFlash = 0;

  private readonly ringTex = makeRingTexture();
  private readonly circleTex = makeCircleTexture();
  private readonly windTex = makeWindTexture();
  private readonly fanTex = makeFanTexture();
  private readonly stripTex = makeStripTexture();
  private readonly dotTex = glowTexture();

  constructor() {
    this.group.name = 'spell-fx';
    this.buildParticles();
    for (let i = 0; i < MAX_FLASHES; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.dotTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false, opacity: 0 });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 12;
      this.group.add(sprite);
      this.flashes.push({ sprite, mat, active: false, age: 0, life: 0.15, size: 0.5 });
    }
    this.buildStrikes();
    this.buildRings();
    this.buildCones();
    this.buildBeams();
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    this.circleMat = this.floorMat(this.circleTex, 0xffffff, THREE.NormalBlending);
    this.circle = new THREE.Mesh(geo, this.circleMat);
    this.circle.visible = false;
    this.circle.renderOrder = 4;
    this.circle.frustumCulled = false;
    this.group.add(this.circle);
  }

  // ---------------------------------------------------------------- 部品の組み立て

  private floorMat(map: THREE.Texture, color: number, blending: THREE.Blending = THREE.NormalBlending): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity: 0, depthWrite: false, fog: false, blending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  }

  private buildParticles(): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const additive = i >= MAX_SOFT;
      const mat = new THREE.SpriteMaterial({ map: this.dotTex, transparent: true, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, fog: false, opacity: 0 });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 8;
      this.group.add(sprite);
      this.particles.push({ sprite, mat, active: false, age: 0, life: 1, vx: 0, vy: 0, vz: 0, drag: 0, gravity: 0, s0: 0.2, s1: 0.2, a0: 1, c0: new THREE.Color(), c1: new THREE.Color() });
    }
  }

  private buildStrikes(): void {
    const plane = new THREE.PlaneGeometry(2, 2);
    plane.rotateX(-Math.PI / 2);
    const sphere = new THREE.SphereGeometry(1, 16, 12);
    for (let i = 0; i < MAX_STRIKE_SLOTS; i++) {
      const floor = (map: THREE.Texture, order: number, blending: THREE.Blending): [THREE.Mesh, THREE.MeshBasicMaterial] => {
        const mat = this.floorMat(map, 0xffffff, blending);
        const mesh = new THREE.Mesh(plane, mat);
        mesh.visible = false;
        mesh.renderOrder = order;
        mesh.frustumCulled = false;
        this.group.add(mesh);
        return [mesh, mat];
      };
      const [tele, teleMat] = floor(this.ringTex, 3, THREE.NormalBlending);
      const [tele2, tele2Mat] = floor(this.ringTex, 3, THREE.NormalBlending);
      const [fill, fillMat] = floor(this.dotTex, 2, THREE.NormalBlending);
      const [shock, shockMat] = floor(this.ringTex, 5, THREE.NormalBlending);
      // 稲妻: 縦のぎざぎざの帯。同じ形を 90° 回した 2 枚（どの向きからも見える）
      const boltGeo = new THREE.BufferGeometry();
      boltGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLT_NODES * 2 * 3), 3));
      const idx: number[] = [];
      for (let k = 0; k < BOLT_NODES - 1; k++) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
      boltGeo.setIndex(idx);
      const boltMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
      const bolt = new THREE.Group();
      const b1 = new THREE.Mesh(boltGeo, boltMat);
      const b2 = new THREE.Mesh(boltGeo, boltMat);
      b2.rotation.y = Math.PI / 2;
      b1.frustumCulled = b2.frustumCulled = false;
      bolt.add(b1, b2);
      bolt.visible = false;
      bolt.renderOrder = 9;
      this.group.add(bolt);
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.NormalBlending, fog: false, toneMapped: false });
      // 稲妻の光の柱（細い円筒。稲妻の芯のまわりのにじみ）
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, BOLT_HEIGHT, 10, 1, true), glowMat);
      glow.position.y = BOLT_HEIGHT / 2;
      glow.visible = false;
      glow.renderOrder = 8;
      glow.frustumCulled = false;
      this.group.add(glow);
      // 火球
      const ballMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.NormalBlending, fog: false, toneMapped: false });
      const ball = new THREE.Mesh(sphere, ballMat);
      ball.visible = false;
      ball.renderOrder = 9;
      ball.frustumCulled = false;
      this.group.add(ball);
      const flashMat = new THREE.SpriteMaterial({ map: this.dotTex, color: 0xffffff, transparent: true, blending: THREE.NormalBlending, depthWrite: false, depthTest: false, fog: false, opacity: 0 });
      const flash = new THREE.Sprite(flashMat);
      flash.visible = false;
      flash.renderOrder = 12;
      this.group.add(flash);
      this.strikes.push({ owner: null, landedSeen: false, tele, teleMat, tele2, tele2Mat, fill, fillMat, bolt, boltGeo, boltMat, glow, glowMat, shock, shockMat, ball, ballMat, flash, flashMat });
    }
  }

  private buildRings(): void {
    const open = (r: number, h: number): THREE.CylinderGeometry => new THREE.CylinderGeometry(r, r, h, 40, 1, true);
    const plane = new THREE.PlaneGeometry(2, 2);
    plane.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_RING_SLOTS; i++) {
      const mk = (): [THREE.Mesh, THREE.MeshBasicMaterial] => {
        const map = this.windTex.clone();
        map.needsUpdate = true;
        map.repeat.set(3, 1);
        const mat = new THREE.MeshBasicMaterial({ map, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending, fog: false, toneMapped: false });
        const mesh = new THREE.Mesh(open(1, WIND_HEIGHT), mat);
        mesh.position.y = WIND_HEIGHT / 2;
        mesh.frustumCulled = false;
        mesh.renderOrder = 7;
        return [mesh, mat];
      };
      const [outer, outerMat] = mk();
      const [inner, innerMat] = mk();
      const floorM = this.floorMat(this.ringTex, 0xffffff, THREE.NormalBlending);
      const floor = new THREE.Mesh(plane, floorM);
      floor.position.y = 0.05;
      floor.frustumCulled = false;
      floor.renderOrder = 5;
      const group = new THREE.Group();
      group.add(outer, inner, floor);
      group.visible = false;
      this.group.add(group);
      this.rings.push({ group, outer, inner, outerMat, innerMat, floor, floorMat: floorM });
    }
  }

  private buildCones(): void {
    for (let i = 0; i < MAX_CONES; i++) {
      const geo = new THREE.BufferGeometry();
      const mat = new THREE.MeshBasicMaterial({ map: this.fanTex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.cones.push({ mesh, mat, geo, half: -1 });
    }
  }

  private buildBeams(): void {
    for (let i = 0; i < MAX_BEAMS; i++) {
      // 炎の芯: 原点（杖の先）が根元で、+Z へ長さ 1 の円錐（先へ向けて太くなる。広がる炎）
      const cone = new THREE.ConeGeometry(0.5, 1, 14, 1, true);
      cone.rotateX(Math.PI / 2); // 先端が +Z
      cone.rotateY(Math.PI);
      cone.translate(0, 0, 0.5);
      const mk = (color: number, opacity: number): [THREE.Mesh, THREE.MeshBasicMaterial] => {
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending, fog: false, toneMapped: false });
        const mesh = new THREE.Mesh(cone, mat);
        mesh.visible = false;
        mesh.frustumCulled = false;
        mesh.renderOrder = 8;
        this.group.add(mesh);
        return [mesh, mat];
      };
      const [mid, midMat] = mk(0xff7a1f, 0.5);
      const [core, coreMat] = mk(0xfff0b0, 0.6);
      const flashMat = new THREE.SpriteMaterial({ map: this.dotTex, color: 0xffb04a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0 });
      const flash = new THREE.Sprite(flashMat);
      flash.visible = false;
      flash.renderOrder = 9;
      this.group.add(flash);
      const floorMat = new THREE.MeshBasicMaterial({ map: this.stripTex, color: 0xff6a1a, transparent: true, opacity: 0, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      // 根元（原点）から +Z へ長さ 1、幅 1 の板（床に寝かせる）
      const strip = new THREE.PlaneGeometry(1, 1);
      strip.rotateX(-Math.PI / 2);
      strip.translate(0, 0, 0.5);
      const floor = new THREE.Mesh(strip, floorMat);
      floor.visible = false;
      floor.frustumCulled = false;
      floor.renderOrder = 3;
      this.group.add(floor);
      this.beams.push({ floor, floorMat, core, coreMat, mid, midMat, flash, flashMat, acc: 0 });
    }
  }

  // ---------------------------------------------------------------- 杖の先の閃光

  /**
   * 魔法を放った瞬間に、杖の先 (x, y, z) へ小さな光の球を出す（hitFx の星より小さく、短い。魔弾の連打で画面を覆わないように）。
   * size = 最大の大きさ（m）、life = 消えるまでの実時間（秒）。粒を少し散らす
   */
  flash(x: number, y: number, z: number, element: SpellElement, size: number, life = 0.16): void {
    const f = this.flashes[this.nextFlash]!;
    this.nextFlash = (this.nextFlash + 1) % this.flashes.length;
    const pal = PALETTE[element];
    f.active = true;
    f.age = 0;
    f.life = life;
    f.size = size;
    f.mat.color.copy(pal.main);
    f.sprite.position.set(x, y, z);
    f.sprite.visible = true;
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 1.2 + Math.random() * 2.2;
      this.emit(x, y, z, Math.cos(a) * v, (Math.random() - 0.3) * 2, Math.sin(a) * v, 0.25 + Math.random() * 0.2, 0.09, 0.02, 0.9, pal.core, pal.edge, 2.5, 3, true);
    }
  }

  private updateFlashes(dt: number): void {
    for (const f of this.flashes) {
      if (!f.active) continue;
      f.age += dt;
      const t = f.age / f.life;
      if (t >= 1) {
        f.active = false;
        f.sprite.visible = false;
        continue;
      }
      f.sprite.scale.setScalar(f.size * (0.5 + 0.7 * Math.sqrt(t)));
      f.mat.opacity = (1 - t) * (1 - t);
    }
  }

  // ---------------------------------------------------------------- 粒

  /** 粒を 1 つ出す（空きがなければ一番古いものを使い回す）。c0 → c1 へ色が移り、s0 → s1 へ大きさが移り、a0 から 0 へ消える。spark = 加算の合成（小さな火花・光。それ以外は通常の合成） */
  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, a0: number, c0: THREE.Color, c1: THREE.Color, drag = 0, gravity = 0, spark = false): void {
    let p: Particle;
    if (spark) {
      p = this.particles[MAX_SOFT + this.nextSpark]!;
      this.nextSpark = (this.nextSpark + 1) % MAX_SPARK;
    } else {
      p = this.particles[this.nextSoft]!;
      this.nextSoft = (this.nextSoft + 1) % MAX_SOFT;
    }
    p.active = true;
    p.age = 0;
    p.life = life;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.drag = drag;
    p.gravity = gravity;
    p.s0 = s0;
    p.s1 = s1;
    p.a0 = a0;
    p.c0.copy(c0);
    p.c1.copy(c1);
    p.sprite.position.set(x, y, z);
    p.sprite.visible = true;
    p.mat.rotation = Math.random() * Math.PI * 2;
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      const t = p.age / p.life;
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k - p.gravity * dt;
      p.vz *= k;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
      p.sprite.scale.setScalar(p.s0 + (p.s1 - p.s0) * t);
      _c.copy(p.c0).lerp(p.c1, t);
      p.mat.color.copy(_c);
      // 出た直後に一気に明るくなり、終わりへ向けて消える
      p.mat.opacity = p.a0 * Math.min(1, t * 9) * (1 - t) * (1 - t * 0.3);
    }
  }

  // ---------------------------------------------------------------- 毎描画フレーム

  /**
   * 効果の状態を読んで描く。alpha = sim の補間（効果の age に足して滑らかに）、frameDt = 実時間（粒の動き）。
   * 効果が無いとき（ほとんどの時間）は、すべて隠して粒だけを進める
   */
  update(sys: SpellSystem, alpha: number, frameDt: number, caster: SpellFxCaster): void {
    this.time += frameDt;
    this.updateCircle(caster, frameDt);
    this.updateStrikes(sys, alpha);
    this.updateCones(sys, alpha, frameDt);
    this.updateBeams(sys, alpha, frameDt);
    this.updateRings(sys, alpha, frameDt);
    this.updateRegen(sys, caster, frameDt);
    this.updateParticles(frameDt);
    this.updateFlashes(frameDt);
  }

  /** すべて消す（戦闘のやり直し） */
  clear(): void {
    for (const p of this.particles) {
      p.active = false;
      p.sprite.visible = false;
    }
    for (const f of this.flashes) {
      f.active = false;
      f.sprite.visible = false;
    }
    for (const s of this.strikes) {
      s.owner = null;
      this.hideStrike(s);
    }
    this.strikeOwner.clear();
    for (const r of this.rings) r.group.visible = false;
    for (const c of this.cones) c.mesh.visible = false;
    for (const b of this.beams) {
      b.floor.visible = b.core.visible = b.mid.visible = b.flash.visible = false;
    }
    this.circle.visible = false;
    this.circleK = 0;
  }

  // ---------------------------------------------------------------- 詠唱中の魔法陣

  private updateCircle(c: SpellFxCaster, dt: number): void {
    const spell = c.casting;
    // 魔弾（通常攻撃）は陣を出さない（連打のたびに出ると騒がしい）
    const on = spell !== null && spell.kind !== 'bolt';
    if (on) this.circleElement = spell.element;
    const target = on ? 1 : 0;
    this.circleK += (target - this.circleK) * Math.min(1, dt * (on ? 14 : 9));
    if (this.circleK < 0.02) {
      this.circle.visible = false;
      return;
    }
    const pal = PALETTE[this.circleElement];
    this.circle.visible = true;
    this.circle.position.set(c.x, c.y + 0.045, c.z);
    // 放つ時刻へ向けて、陣が少し大きく・速く回る
    const grow = 0.75 + 0.35 * c.castProgress;
    const r = 1.45 * grow * (0.4 + 0.6 * this.circleK);
    this.circle.scale.set(r, 1, r);
    this.circle.rotation.y = this.time * (1.4 + 2.2 * c.castProgress);
    this.circleMat.color.copy(pal.floor);
    this.circleMat.opacity = 0.9 * this.circleK;
  }

  // ---------------------------------------------------------------- 落雷・爆発

  private hideStrike(s: StrikeSlot): void {
    s.tele.visible = s.tele2.visible = s.fill.visible = s.bolt.visible = s.glow.visible = s.shock.visible = s.ball.visible = s.flash.visible = false;
  }

  private updateStrikes(sys: SpellSystem, alpha: number): void {
    this.seenPoints.clear();
    for (const fx of sys.strikes) {
      for (const p of fx.points) {
        this.seenPoints.add(p);
        let slot = this.strikeOwner.get(p);
        if (!slot) {
          slot = this.strikes.find((s) => s.owner === null);
          if (!slot) continue; // 空きがなければ、この点は描かない（sim は進む）
          slot.owner = p;
          slot.landedSeen = false;
          this.strikeOwner.set(p, slot);
          this.hideStrike(slot);
        }
        this.drawStrike(slot, fx, p, alpha);
      }
    }
    // 消えた点の枠を空ける
    for (const [p, slot] of this.strikeOwner) {
      if (this.seenPoints.has(p)) continue;
      slot.owner = null;
      this.hideStrike(slot);
      this.strikeOwner.delete(p);
    }
  }

  private drawStrike(s: StrikeSlot, fx: StrikeFx, p: StrikePoint, alpha: number): void {
    const sp = fx.spell;
    const pal = PALETTE[sp.element];
    const t = fx.age + alpha - p.delay; // 着弾からの sim フレーム（負 = 着弾前）
    const isBlast = sp.element === 'blast' || sp.element === 'arcane';
    if (t < 0) {
      // 予告: 床の輪（ターゲットを追う）+ 縮んでくる外側の輪 + 満ちていく円。着弾が近づくほど濃く・速く点滅する
      const warn = Math.max(1, p.delay);
      const k = Math.min(1, (fx.age + alpha) / warn);
      const blink = k > 0.6 ? 0.75 + 0.25 * Math.sin((fx.age + alpha) * 1.4) : 1;
      s.tele.visible = s.tele2.visible = s.fill.visible = true;
      s.tele.position.set(p.x, 0.05, p.z);
      s.tele.scale.set(p.radius, 1, p.radius);
      s.teleMat.color.copy(pal.floor);
      s.teleMat.opacity = (0.35 + 0.6 * k) * blink;
      // 外側の輪は 1.9 倍から縮んで、着弾の瞬間に本体の輪へ重なる
      const r2 = p.radius * (1 + 0.9 * (1 - k) * (1 - k));
      s.tele2.position.set(p.x, 0.052, p.z);
      s.tele2.scale.set(r2, 1, r2);
      s.tele2Mat.color.copy(pal.core);
      s.tele2Mat.opacity = 0.25 + 0.5 * k;
      const fr = Math.max(0.001, p.radius * (0.15 + 0.85 * k));
      s.fill.position.set(p.x, 0.048, p.z);
      s.fill.scale.set(fr, 1, fr);
      s.fillMat.color.copy(pal.floor);
      s.fillMat.opacity = 0.12 + 0.3 * k;
      s.bolt.visible = s.glow.visible = s.shock.visible = s.ball.visible = s.flash.visible = false;
      return;
    }
    s.tele2.visible = false;
    if (!s.landedSeen) {
      s.landedSeen = true;
      this.onLanded(s, sp, p, pal);
    }
    // 着弾後: 本体の輪と満ちた円が薄れていく
    const fade = Math.max(0, 1 - t / FLASH_FRAMES);
    s.tele.visible = fade > 0.02;
    s.tele.position.set(p.x, 0.05, p.z);
    s.tele.scale.set(p.radius, 1, p.radius);
    s.teleMat.opacity = 0.9 * fade * fade;
    s.fill.visible = fade > 0.02;
    s.fill.position.set(p.x, 0.048, p.z);
    s.fill.scale.set(p.radius, 1, p.radius);
    s.fillMat.opacity = 0.4 * fade;
    // 衝撃の輪: 中心から半径いっぱいまで素早く広がる
    const sk = Math.min(1, t / SHOCK_FRAMES);
    s.shock.visible = sk < 1;
    const sr = p.radius * (0.2 + 0.9 * (1 - (1 - sk) * (1 - sk)));
    s.shock.position.set(p.x, 0.06, p.z);
    s.shock.scale.set(sr, 1, sr);
    s.shockMat.color.copy(pal.core);
    s.shockMat.opacity = 0.9 * (1 - sk);
    // 着弾の閃光（地面の光の球）
    const fk = Math.min(1, t / FLASH_FRAMES);
    s.flash.visible = fk < 1;
    s.flash.position.set(p.x, isBlast ? 0.9 : 0.4, p.z);
    const fsz = p.radius * (isBlast ? 3 : 1.8) * (0.5 + 0.7 * Math.sqrt(fk));
    s.flash.scale.set(fsz, fsz, 1);
    s.flashMat.color.copy(pal.main);
    s.flashMat.opacity = (1 - fk) * (1 - fk) * (isBlast ? 0.8 : 0.55);
    if (isBlast) {
      // 火球: 膨らみながら、白 → 橙 → 暗い橙へ色が移って薄れる
      const bk = Math.min(1, t / FIREBALL_FRAMES);
      s.ball.visible = bk < 1;
      const br = p.radius * (0.25 + 0.7 * (1 - (1 - bk) * (1 - bk))) * (sp.id === 'explosion' ? 0.9 : 0.8);
      s.ball.position.set(p.x, br * 0.55, p.z);
      s.ball.scale.setScalar(Math.max(0.01, br));
      s.ballMat.color.copy(pal.core).lerp(pal.main, Math.min(1, bk * 1.6)).lerp(pal.edge, Math.max(0, bk - 0.5) * 1.4);
      s.ballMat.opacity = 0.85 * (1 - bk) * (1 - bk * 0.4);
      s.bolt.visible = s.glow.visible = false;
    } else {
      // 稲妻: 着弾の直後に一瞬だけ、細くなりながらちらつく
      const lk = Math.min(1, t / BOLT_FRAMES);
      const flick = lk < 1 ? (Math.floor(t / 2) % 2 === 0 ? 1 : 0.55) : 0;
      s.bolt.visible = lk < 1;
      s.bolt.position.set(p.x, 0, p.z);
      s.boltMat.color.copy(pal.core);
      s.boltMat.opacity = flick * (1 - lk * 0.7);
      s.glow.visible = lk < 1;
      s.glow.position.set(p.x, BOLT_HEIGHT / 2, p.z);
      const gw = 0.16 + 0.16 * (1 - lk);
      s.glow.scale.set(gw, 1, gw);
      s.glowMat.color.copy(pal.main);
      s.glowMat.opacity = 0.32 * flick * (1 - lk);
      s.ball.visible = false;
    }
  }

  /** 着弾した瞬間（点ごとに 1 回）: 稲妻の形を作り、火花・火の粉を出す */
  private onLanded(s: StrikeSlot, sp: StrikeSpell, p: StrikePoint, pal: Palette): void {
    if (sp.element === 'blast' || sp.element === 'arcane') {
      const n = sp.id === 'explosion' ? 26 : 10;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp2 = (2.5 + Math.random() * 5) * (0.6 + p.radius * 0.18);
        this.emit(p.x, 0.3, p.z, Math.cos(a) * sp2, 2 + Math.random() * 5, Math.sin(a) * sp2, 0.5 + Math.random() * 0.5, 0.22, 0.04, 1, pal.core, pal.edge, 0.6, 9, true);
      }
      return;
    }
    // 稲妻の形: 地面（y = 0）から上へ、横へ振れながら進む。根元ほど太い
    const pos = s.boltGeo.getAttribute('position') as THREE.BufferAttribute;
    let ox = 0;
    for (let k = 0; k < BOLT_NODES; k++) {
      const y = (k / (BOLT_NODES - 1)) * BOLT_HEIGHT;
      ox = k === 0 ? 0 : k === BOLT_NODES - 1 ? ox * 0.5 : ox + (Math.random() - 0.5) * 1.1;
      ox = Math.max(-0.9, Math.min(0.9, ox));
      const w = 0.035 + 0.07 * (1 - k / (BOLT_NODES - 1)) + (k === 0 ? 0.06 : 0);
      pos.setXYZ(k * 2, ox - w, y, 0);
      pos.setXYZ(k * 2 + 1, ox + w, y, 0);
    }
    pos.needsUpdate = true;
    s.boltGeo.computeBoundingSphere();
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 2 + Math.random() * 4;
      this.emit(p.x, 0.15, p.z, Math.cos(a) * v, 2.5 + Math.random() * 4, Math.sin(a) * v, 0.35 + Math.random() * 0.3, 0.14, 0.02, 1, pal.core, pal.edge, 1.2, 12, true);
    }
  }

  // ---------------------------------------------------------------- 吹雪

  private updateCones(sys: SpellSystem, alpha: number, dt: number): void {
    let n = 0;
    for (const fx of sys.cones) {
      if (n >= this.cones.length) break;
      const slot = this.cones[n++]!;
      const sp = fx.spell;
      const pal = PALETTE[sp.element];
      this.shapeCone(slot, sp);
      const fade = fx.ended ? Math.max(0, 1 - fx.age / BEAM_LINGER_FRAMES) : Math.min(1, (fx.age + alpha) / 8);
      slot.mesh.visible = fade > 0.01;
      slot.mesh.position.set(fx.x, 0.055, fx.z);
      slot.mesh.rotation.y = fx.yaw;
      slot.mesh.scale.set(sp.range, 1, sp.range);
      slot.mat.color.copy(pal.floor);
      slot.mat.opacity = 0.55 * fade * (0.85 + 0.15 * Math.sin(this.time * 14));
      if (fx.ended) continue;
      // 雪・氷の粒: 術者の前から、扇の中へ吹き出す
      this.coneAcc += dt * 70;
      const half = (sp.halfAngleDeg * Math.PI) / 180;
      while (this.coneAcc >= 1) {
        this.coneAcc -= 1;
        const a = fx.yaw + (Math.random() * 2 - 1) * half * 0.9;
        const speed = sp.range * (1.1 + Math.random() * 0.9);
        const life = 0.45 + Math.random() * 0.35;
        const big = Math.random() < 0.18;
        this.emit(
          fx.x + Math.sin(fx.yaw) * 0.7,
          0.9 + (Math.random() - 0.5) * 0.7,
          fx.z + Math.cos(fx.yaw) * 0.7,
          Math.sin(a) * speed,
          (Math.random() - 0.4) * 1.2,
          Math.cos(a) * speed,
          life,
          big ? 0.3 : 0.18,
          big ? 0.65 : 0.4,
          big ? 0.95 : 0.85,
          pal.main,
          pal.edge,
          1.6,
          0.4,
        );
      }
    }
    for (let i = n; i < this.cones.length; i++) this.cones[i]!.mesh.visible = false;
  }

  /** 扇の形（中心 (0,0)、半径 1、+Z 向き。開き half 度）を作る。開きが変わったときだけ */
  private shapeCone(slot: ConeSlot, sp: ConeSpell): void {
    if (slot.half === sp.halfAngleDeg) return;
    slot.half = sp.halfAngleDeg;
    const half = (sp.halfAngleDeg * Math.PI) / 180;
    const pos: number[] = [0, 0, 0];
    const uv: number[] = [0, 0.5];
    const idx: number[] = [];
    for (let i = 0; i <= CONE_SEGMENTS; i++) {
      const a = -half + (2 * half * i) / CONE_SEGMENTS;
      pos.push(Math.sin(a), 0, Math.cos(a));
      uv.push(1, 0.5);
      if (i > 0) idx.push(0, i, i + 1);
    }
    slot.geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    slot.geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    slot.geo.setIndex(idx);
    slot.geo.computeBoundingSphere();
  }

  // ---------------------------------------------------------------- 火炎放射

  private updateBeams(sys: SpellSystem, alpha: number, dt: number): void {
    let n = 0;
    for (const fx of sys.beams) {
      if (n >= this.beams.length) break;
      const slot = this.beams[n++]!;
      const sp = fx.spell;
      const pal = PALETTE[sp.element];
      const fade = fx.ended ? Math.max(0, 1 - fx.age / BEAM_LINGER_FRAMES) : Math.min(1, (fx.age + alpha) / 6);
      const flick = 0.85 + 0.15 * Math.sin(this.time * 47) + 0.08 * Math.sin(this.time * 83);
      const len = fx.len * (0.92 + 0.08 * flick);
      for (const m of [slot.mid, slot.core]) {
        m.visible = fade > 0.01;
        m.position.set(fx.x, 1.0, fx.z);
        m.rotation.set(0, fx.yaw, 0);
      }
      // 外側の芯（橙）と内側の芯（黄白）。先へ向けて太くなる炎（円錐は底が +Z 側の太い口になるよう向けてある）
      slot.mid.scale.set(sp.width * 0.9 * flick, sp.width * 0.9 * flick, len);
      slot.core.scale.set(sp.width * 0.45 * flick, sp.width * 0.45 * flick, len * 0.8);
      slot.midMat.color.copy(pal.main);
      slot.midMat.opacity = 0.5 * fade;
      slot.coreMat.color.copy(pal.core);
      slot.coreMat.opacity = 0.7 * fade;
      slot.floor.visible = fade > 0.01;
      slot.floor.position.set(fx.x, 0.05, fx.z);
      slot.floor.rotation.y = fx.yaw;
      slot.floor.scale.set(sp.width * (1.15 + 0.1 * flick), 1, len);
      slot.floorMat.color.copy(pal.floor);
      slot.floorMat.opacity = 0.5 * fade * (0.8 + 0.2 * flick);
      slot.flash.visible = fade > 0.01;
      slot.flash.position.set(fx.x, 1.0, fx.z);
      const fs = 1.5 * (0.8 + 0.3 * flick);
      slot.flash.scale.set(fs, fs, 1);
      slot.flashMat.opacity = 0.8 * fade;
      if (fx.ended) continue;
      // 火の粒: 杖の先から、勢いよく前へ。届く長さで消えるよう寿命を合わせる
      slot.acc += dt * 90;
      const dx = Math.sin(fx.yaw);
      const dz = Math.cos(fx.yaw);
      while (slot.acc >= 1) {
        slot.acc -= 1;
        const spread = (Math.random() - 0.5) * 0.36;
        const a = fx.yaw + spread;
        const speed = 11 + Math.random() * 7;
        const life = Math.min(0.75, (len / speed) * (0.7 + Math.random() * 0.35));
        const w = sp.width * 0.25;
        this.emit(
          fx.x + (Math.random() - 0.5) * w,
          1.0 + (Math.random() - 0.4) * 0.3,
          fx.z + (Math.random() - 0.5) * w,
          Math.sin(a) * speed,
          0.4 + Math.random() * 1.4,
          Math.cos(a) * speed,
          life,
          0.4,
          1.1 + Math.random() * 0.4,
          0.8,
          pal.core,
          pal.edge,
          0.3,
          -1.2, // わずかに浮く
        );
      }
      // 遮られて短いとき、先端に火花
      if (fx.len < sp.length - 0.5 && Math.random() < dt * 30) {
        this.emit(fx.x + dx * fx.len, 0.9, fx.z + dz * fx.len, (Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3, 0.3, 0.2, 0.02, 1, pal.core, pal.edge, 1, 6, true);
      }
    }
    for (let i = n; i < this.beams.length; i++) {
      const b = this.beams[i]!;
      b.floor.visible = b.core.visible = b.mid.visible = b.flash.visible = false;
    }
  }

  // ---------------------------------------------------------------- 旋風

  private updateRings(sys: SpellSystem, alpha: number, dt: number): void {
    let n = 0;
    for (const fx of sys.rings) {
      const sp = fx.spell;
      const pal = PALETTE[sp.element];
      for (let r = 0; r < sp.radii.length; r++) {
        const start = r * sp.staggerFrames;
        const t = fx.age + alpha - start;
        if (t < 0 || t > sp.expandFrames + 18) continue;
        if (n >= this.rings.length) break;
        const slot = this.rings[n++]!;
        const k = Math.min(1, t / sp.expandFrames);
        const outer = Math.max(0.05, SpellSystem.ringOuter(sp, r, Math.min(fx.age + alpha, start + sp.expandFrames)));
        const inner = Math.max(0.03, outer - sp.thickness);
        // 広がりきったあとは、そのまま薄れて消える
        const fade = t <= sp.expandFrames ? 1 : Math.max(0, 1 - (t - sp.expandFrames) / 18);
        slot.group.visible = true;
        slot.group.position.set(fx.x, 0, fx.z);
        const h = 0.7 + 0.5 * Math.min(1, k * 2);
        slot.outer.scale.set(outer, h, outer);
        slot.outer.position.y = (WIND_HEIGHT * h) / 2;
        slot.inner.scale.set(inner, h, inner);
        slot.inner.position.y = (WIND_HEIGHT * h) / 2;
        slot.outer.rotation.y = this.time * 5.5 + r;
        slot.inner.rotation.y = -this.time * 7 + r;
        slot.outerMat.color.copy(pal.floor);
        slot.innerMat.color.copy(pal.main);
        slot.outerMat.opacity = 0.75 * fade;
        slot.innerMat.opacity = 0.55 * fade;
        (slot.outerMat.map as THREE.Texture).offset.x = -this.time * 1.2;
        (slot.innerMat.map as THREE.Texture).offset.x = this.time * 1.6;
        slot.floor.scale.set(outer, 1, outer);
        slot.floorMat.color.copy(pal.floor);
        slot.floorMat.opacity = 0.6 * fade;
      }
    }
    for (let i = n; i < this.rings.length; i++) this.rings[i]!.group.visible = false;
    // 渦を巻く粒: 輪の縁を、回りながら外へ流れる
    for (const fx of sys.rings) {
      const sp = fx.spell;
      const pal = PALETTE[sp.element];
      this.ringAcc += dt * 55;
      while (this.ringAcc >= 1) {
        this.ringAcc -= 1;
        for (let r = 0; r < sp.radii.length; r++) {
          const t = fx.age - r * sp.staggerFrames;
          if (t < 0 || t > sp.expandFrames) continue;
          const rad = SpellSystem.ringOuter(sp, r, fx.age) - Math.random() * sp.thickness;
          const a = Math.random() * Math.PI * 2;
          const tang = 7 + Math.random() * 4;
          this.emit(
            fx.x + Math.sin(a) * rad,
            0.15 + Math.random() * 1.3,
            fx.z + Math.cos(a) * rad,
            Math.cos(a) * tang + Math.sin(a) * 2.5,
            0.6 + Math.random(),
            -Math.sin(a) * tang + Math.cos(a) * 2.5,
            0.35 + Math.random() * 0.25,
            0.28,
            0.08,
            0.8,
            pal.main,
            pal.edge,
            2,
            0,
          );
        }
      }
    }
  }

  // ---------------------------------------------------------------- 再生

  private updateRegen(sys: SpellSystem, c: SpellFxCaster, dt: number): void {
    const fx: RegenFx | null = sys.regen;
    if (!fx) return;
    const pal = PALETTE[fx.spell.element];
    this.regenAcc += dt * 14;
    const fadeOut = Math.min(1, (fx.spell.frames - fx.age) / 60);
    while (this.regenAcc >= 1) {
      this.regenAcc -= 1;
      if (Math.random() > fadeOut) continue;
      const a = Math.random() * Math.PI * 2;
      const r = 0.25 + Math.random() * 0.55;
      this.emit(c.x + Math.sin(a) * r, c.y + 0.1 + Math.random() * 0.4, c.z + Math.cos(a) * r, 0, 0.8 + Math.random() * 0.9, 0, 0.9 + Math.random() * 0.5, 0.2, 0.04, 0.9, pal.core, pal.main, 0.2, 0, true);
    }
  }
}
