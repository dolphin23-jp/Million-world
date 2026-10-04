import * as THREE from 'three';

/**
 * 命中エフェクト。アニメのヒットマーク（星形の閃光）と飛び散る火花。
 * どちらも加算合成のスプライト（常に手前に描く）で、使い回すプール。実時間（描画の dt）で進める
 * （ヒットストップで sim が止まっていても、止まった絵の中で閃光が弾ける）。
 * 見た目だけの乱数なので Math.random でよい（sim には影響しない）。
 */

const STAR_LIFE = 0.2;
const SPARK_GRAVITY = 9;

interface Star {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  age: number;
  size: number;
  active: boolean;
}
interface Spark {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  age: number;
  life: number;
  size: number;
  vx: number;
  vy: number;
  vz: number;
  active: boolean;
}

/** 8 本のとがった星 + 中心の核（白〜黄）を描いたテクスチャ */
function makeStarTexture(): THREE.CanvasTexture {
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const cx = n / 2;
  // 外側のにじみ
  const glow = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
  glow.addColorStop(0, 'rgba(255,240,170,0.95)');
  glow.addColorStop(0.35, 'rgba(255,200,90,0.35)');
  glow.addColorStop(1, 'rgba(255,160,60,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, n, n);
  // とがった星（長短を交互に）
  g.beginPath();
  const spikes = 8;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? cx * 0.96 : cx * 0.2;
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * r * (i % 4 === 0 ? 1 : 0.72);
    const y = cx + Math.sin(a) * r * (i % 4 === 0 ? 1 : 0.72);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fillStyle = '#fffbe6';
  g.fill();
  // 核
  const core = g.createRadialGradient(cx, cx, 0, cx, cx, cx * 0.35);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, n, n);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** やわらかい丸（火花） */
function makeDotTexture(): THREE.CanvasTexture {
  const n = 32;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,230,150,0.9)');
  grad.addColorStop(1, 'rgba(255,170,70,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeMaterial(map: THREE.Texture): THREE.SpriteMaterial {
  return new THREE.SpriteMaterial({
    map,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false, // 敵の体や床に隠れず、常に手前に出す
    depthWrite: false,
    fog: false,
  });
}

const WHITE = new THREE.Color(1, 1, 1);
/** パリィの閃光（水色がかった白）・ガードの閃光（暖かい白）。スプライトの色は加算合成のテクスチャに掛かる */
export const FX_TINT = {
  parry: new THREE.Color(0.55, 0.9, 1),
  guard: new THREE.Color(1, 0.93, 0.75),
  /** 鬼火が消える・斬り落とされたときの閃光（紫がかった白） */
  orb: new THREE.Color(0.78, 0.66, 1),
} as const;

export class HitFx {
  readonly group = new THREE.Group();
  private readonly stars: Star[] = [];
  private readonly sparks: Spark[] = [];
  private nextStar = 0;
  private nextSpark = 0;
  private readonly starTex = makeStarTexture();
  private readonly dotTex = makeDotTexture();

  constructor(starCount = 6, sparkCount = 96) {
    this.group.name = 'hit-fx';
    for (let i = 0; i < starCount; i++) {
      const mat = makeMaterial(this.starTex);
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 20;
      this.group.add(sprite);
      this.stars.push({ sprite, mat, age: 0, size: 1, active: false });
    }
    for (let i = 0; i < sparkCount; i++) {
      const mat = makeMaterial(this.dotTex);
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 19;
      this.group.add(sprite);
      this.sparks.push({ sprite, mat, age: 0, life: 0.3, size: 0.1, vx: 0, vy: 0, vz: 0, active: false });
    }
  }

  /**
   * 命中の位置 (x, y, z) で弾ける。dir は攻撃の向き（XZ の単位ベクトル、火花はこの向きへ飛ぶ）。
   * power はエフェクトの強さ（0.3〜1.2。星の大きさと火花の数・速さ）。tint は色味（既定は白 = 元の暖色の星と火花。FX_TINT）
   */
  burst(x: number, y: number, z: number, dirX: number, dirZ: number, power: number, tint: THREE.Color = WHITE): void {
    const star = this.stars[this.nextStar]!;
    star.mat.color.copy(tint);
    this.nextStar = (this.nextStar + 1) % this.stars.length;
    star.active = true;
    star.age = 0;
    star.size = 0.85 + power * 1.0;
    star.sprite.position.set(x, y, z);
    star.mat.rotation = Math.random() * Math.PI;
    star.sprite.visible = true;

    const count = Math.round(7 + power * 7);
    for (let i = 0; i < count; i++) {
      const sp = this.sparks[this.nextSpark]!;
      this.nextSpark = (this.nextSpark + 1) % this.sparks.length;
      sp.mat.color.copy(tint);
      // 攻撃の向きを中心に、横へ ±70° ばらけて飛ぶ
      const a = Math.atan2(dirX, dirZ) + (Math.random() - 0.5) * 2.4;
      const speed = (2.5 + Math.random() * 3.5) * (0.7 + power * 0.5);
      sp.active = true;
      sp.age = 0;
      sp.life = 0.22 + Math.random() * 0.22;
      sp.size = (0.06 + Math.random() * 0.07) * (0.8 + power * 0.4);
      sp.vx = Math.sin(a) * speed;
      sp.vz = Math.cos(a) * speed;
      sp.vy = 0.8 + Math.random() * 2.6;
      sp.sprite.position.set(x, y, z);
      sp.sprite.visible = true;
    }
  }

  /** 毎描画フレーム（実時間） */
  update(frameDt: number): void {
    for (const s of this.stars) {
      if (!s.active) continue;
      s.age += frameDt;
      const t = s.age / STAR_LIFE;
      if (t >= 1) {
        s.active = false;
        s.sprite.visible = false;
        continue;
      }
      // 一気に開いて（0 → 0.3）、そのあと少しずつ大きくなりながら消える
      const open = t < 0.3 ? 1 - Math.pow(1 - t / 0.3, 3) : 1 + (t - 0.3) * 0.25;
      s.sprite.scale.setScalar(s.size * open);
      s.mat.opacity = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
    }
    for (const p of this.sparks) {
      if (!p.active) continue;
      p.age += frameDt;
      if (p.age >= p.life) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      p.vy -= SPARK_GRAVITY * frameDt;
      p.sprite.position.x += p.vx * frameDt;
      p.sprite.position.y += p.vy * frameDt;
      p.sprite.position.z += p.vz * frameDt;
      const t = p.age / p.life;
      p.sprite.scale.setScalar(p.size * (1 - t * 0.7));
      p.mat.opacity = 1 - t * t;
    }
  }

  clear(): void {
    for (const s of this.stars) {
      s.active = false;
      s.sprite.visible = false;
    }
    for (const p of this.sparks) {
      p.active = false;
      p.sprite.visible = false;
    }
  }
}
