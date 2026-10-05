import * as THREE from 'three';

/**
 * 地面を叩いた演出（ADR-023）。剣が床に当たった位置で、衝撃の輪が広がり、砂ぼこりが舞い、破片が飛び、地面にひびが残って消える。
 * 輪・ひび割れは床に貼る平面、砂ぼこり・破片は使い回すスプライトのプール。実時間（描画の dt）で進める（ヒットストップで sim が止まっていても動く）。
 * 見た目だけの乱数なので Math.random でよい。1 回の burst で作るのは決まった数のプール枠の再利用だけ（毎フレームの生成はしない）。
 */

const RING_COUNT = 3;
const RING_LIFE = 0.34;
const CRACK_LIFE = 1.6;
const DUST_COUNT = 72;
const CHIP_COUNT = 40;
const FLOOR_Y = 0.03;

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  radius: number;
  active: boolean;
}
interface Puff {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  age: number;
  life: number;
  size: number;
  grow: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  peak: number;
  active: boolean;
}

/** やわらかい丸（砂ぼこり・破片の共通） */
function makeSoftDot(): THREE.CanvasTexture {
  const n = 64;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** ひび割れ: 中心から放射状に走るぎざぎざの線（暗い茶色）。中心が太く、先へ細くなる */
function makeCrackTexture(): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const cx = n / 2;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // 疑似乱数（固定。再現できるように）
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const arms = 9;
  for (let i = 0; i < arms; i++) {
    let a = (i / arms) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
    let x = cx;
    let y = cx;
    const len = cx * (0.55 + rnd() * 0.4);
    const steps = 9;
    for (let s = 0; s < steps; s++) {
      const step = len / steps;
      a += (rnd() - 0.5) * 0.7;
      const nx = x + Math.cos(a) * step;
      const ny = y + Math.sin(a) * step;
      g.strokeStyle = 'rgba(48,36,30,0.95)';
      g.lineWidth = Math.max(1.2, 6 * (1 - s / steps));
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(nx, ny);
      g.stroke();
      // 枝分かれ
      if (s > 1 && s < steps - 2 && rnd() < 0.4) {
        const ba = a + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5);
        g.lineWidth = Math.max(1, 3 * (1 - s / steps));
        g.beginPath();
        g.moveTo(nx, ny);
        g.lineTo(nx + Math.cos(ba) * step * 1.6, ny + Math.sin(ba) * step * 1.6);
        g.stroke();
      }
      x = nx;
      y = ny;
    }
  }
  // 中心の凹み（暗いにじみ）
  const hole = g.createRadialGradient(cx, cx, 0, cx, cx, cx * 0.22);
  hole.addColorStop(0, 'rgba(40,30,26,0.9)');
  hole.addColorStop(1, 'rgba(40,30,26,0)');
  g.fillStyle = hole;
  g.fillRect(0, 0, n, n);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class GroundFx {
  readonly group = new THREE.Group();
  private readonly rings: Ring[] = [];
  private readonly dust: Puff[] = [];
  private readonly chips: Puff[] = [];
  private readonly crack: THREE.Mesh;
  private readonly crackMat: THREE.MeshBasicMaterial;
  private crackAge = CRACK_LIFE;
  private crackPeak = 0;
  private nextRing = 0;
  private nextDust = 0;
  private nextChip = 0;
  private readonly dotTex = makeSoftDot();

  constructor() {
    this.group.name = 'ground-fx';
    const ringGeo = new THREE.RingGeometry(0.93, 1, 96);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < RING_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xfff0cc, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 8;
      this.group.add(mesh);
      this.rings.push({ mesh, mat, age: 0, radius: 1, active: false });
    }
    const crackGeo = new THREE.PlaneGeometry(1, 1);
    crackGeo.rotateX(-Math.PI / 2);
    this.crackMat = new THREE.MeshBasicMaterial({ map: makeCrackTexture(), transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.crack = new THREE.Mesh(crackGeo, this.crackMat);
    this.crack.visible = false;
    this.crack.renderOrder = 6;
    this.group.add(this.crack);
    const mk = (color: number, count: number, out: Puff[], order: number): void => {
      for (let i = 0; i < count; i++) {
        const mat = new THREE.SpriteMaterial({ map: this.dotTex, color, transparent: true, depthWrite: false, fog: false });
        const sprite = new THREE.Sprite(mat);
        sprite.visible = false;
        sprite.renderOrder = order;
        this.group.add(sprite);
        out.push({ sprite, mat, age: 0, life: 1, size: 0.2, grow: 0, vx: 0, vy: 0, vz: 0, gravity: 0, peak: 1, active: false });
      }
    };
    mk(0xcdbb9a, DUST_COUNT, this.dust, 7);
    mk(0x4a3b30, CHIP_COUNT, this.chips, 9);
  }

  /**
   * 床の (x, z) で弾ける。power は強さ（0.3〜1.5。輪の大きさ・砂ぼこりと破片の数と勢い・ひびの大きさ）。
   * 輪は 2 枚（少し遅れて 2 枚目が追う）、ひびは 1 枚（前のひびは消える）
   */
  burst(x: number, z: number, power: number): void {
    const radius = 1.2 + Math.min(power, 1.6) * 1.5;
    for (let k = 0; k < 2; k++) {
      const r = this.rings[this.nextRing]!;
      this.nextRing = (this.nextRing + 1) % this.rings.length;
      r.active = true;
      r.age = -k * 0.06; // 2 枚目は遅れて出る
      r.radius = radius * (k === 0 ? 1 : 0.72);
      r.mesh.position.set(x, FLOOR_Y, z);
      r.mesh.visible = false;
    }
    this.crack.position.set(x, FLOOR_Y - 0.005, z);
    this.crack.rotation.y = Math.random() * Math.PI * 2;
    this.crack.scale.setScalar(radius * 0.95);
    this.crack.visible = true;
    this.crackAge = 0;
    this.crackPeak = Math.min(0.95, 0.55 + power * 0.3);

    const nDust = Math.round(18 + Math.min(power, 1.6) * 20);
    for (let i = 0; i < nDust; i++) {
      const p = this.dust[this.nextDust]!;
      this.nextDust = (this.nextDust + 1) % this.dust.length;
      const a = Math.random() * Math.PI * 2;
      const speed = (1.2 + Math.random() * 2.6) * (0.7 + power * 0.45);
      const r0 = 0.25 + Math.random() * 0.5;
      p.active = true;
      p.age = 0;
      p.life = 0.55 + Math.random() * 0.5;
      p.size = 0.3 + Math.random() * 0.3;
      p.grow = 0.9 + Math.random() * 0.8;
      p.vx = Math.sin(a) * speed;
      p.vz = Math.cos(a) * speed;
      p.vy = 0.5 + Math.random() * 1.1;
      p.gravity = 0.6;
      p.peak = 0.5 + Math.random() * 0.15;
      p.sprite.position.set(x + Math.sin(a) * r0, 0.12, z + Math.cos(a) * r0);
      p.sprite.visible = true;
    }
    const nChip = Math.round(10 + Math.min(power, 1.6) * 10);
    for (let i = 0; i < nChip; i++) {
      const p = this.chips[this.nextChip]!;
      this.nextChip = (this.nextChip + 1) % this.chips.length;
      const a = Math.random() * Math.PI * 2;
      const speed = (1.6 + Math.random() * 3.4) * (0.7 + power * 0.5);
      p.active = true;
      p.age = 0;
      p.life = 0.45 + Math.random() * 0.35;
      p.size = 0.05 + Math.random() * 0.07;
      p.grow = 0;
      p.vx = Math.sin(a) * speed;
      p.vz = Math.cos(a) * speed;
      p.vy = 2.4 + Math.random() * 3.6 * (0.6 + power * 0.4);
      p.gravity = 12;
      p.peak = 1;
      p.sprite.position.set(x, 0.1, z);
      p.sprite.visible = true;
    }
  }

  /**
   * 足元の小さな砂ぼこり（ジャンプの踏み切り・着地。輪・ひび・破片なし）。足の高さ y（障害物の上に乗っているときの足場の高さ）で、
   * power（0〜1）に応じた数の砂が低く外へ広がる。大きな burst と同じ砂のスプライトの組を使う
   */
  puff(x: number, y: number, z: number, power: number): void {
    const k = Math.max(0, Math.min(1, power));
    const n = Math.round(5 + k * 9);
    for (let i = 0; i < n; i++) {
      const p = this.dust[this.nextDust]!;
      this.nextDust = (this.nextDust + 1) % this.dust.length;
      const a = Math.random() * Math.PI * 2;
      const speed = (0.6 + Math.random() * 1.2) * (0.7 + k * 0.7);
      p.active = true;
      p.age = 0;
      p.life = 0.35 + Math.random() * 0.3;
      p.size = 0.2 + Math.random() * 0.15;
      p.grow = 0.7 + Math.random() * 0.6;
      p.vx = Math.sin(a) * speed;
      p.vz = Math.cos(a) * speed;
      p.vy = 0.2 + Math.random() * 0.5;
      p.gravity = 0.5;
      p.peak = 0.4 + Math.random() * 0.12;
      p.sprite.position.set(x + Math.sin(a) * 0.2, y + 0.08, z + Math.cos(a) * 0.2);
      p.sprite.visible = true;
    }
  }

  /** 毎描画フレーム（実時間） */
  update(frameDt: number): void {
    for (const r of this.rings) {
      if (!r.active) continue;
      r.age += frameDt;
      if (r.age < 0) continue;
      const t = r.age / RING_LIFE;
      if (t >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      // 一気に広がって（先が速い）薄くなる
      const e = 1 - (1 - t) ** 3;
      r.mesh.visible = true;
      r.mesh.scale.setScalar(Math.max(0.05, r.radius * e));
      r.mat.opacity = 0.55 * (1 - t) ** 1.5;
    }
    if (this.crack.visible) {
      this.crackAge += frameDt;
      const t = this.crackAge / CRACK_LIFE;
      if (t >= 1) {
        this.crack.visible = false;
      } else {
        // 一瞬で入り、しばらく残って消える
        this.crackMat.opacity = this.crackPeak * (t < 0.04 ? t / 0.04 : t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45);
      }
    }
    for (const list of [this.dust, this.chips]) {
      for (const p of list) {
        if (!p.active) continue;
        p.age += frameDt;
        if (p.age >= p.life) {
          p.active = false;
          p.sprite.visible = false;
          continue;
        }
        p.vy -= p.gravity * frameDt;
        const drag = p.grow > 0 ? Math.exp(-2.2 * frameDt) : 1;
        p.vx *= drag;
        p.vz *= drag;
        p.sprite.position.x += p.vx * frameDt;
        p.sprite.position.y = Math.max(0.03, p.sprite.position.y + p.vy * frameDt);
        p.sprite.position.z += p.vz * frameDt;
        const t = p.age / p.life;
        p.sprite.scale.setScalar(p.size * (1 + p.grow * t));
        p.mat.opacity = p.peak * (1 - t) * (t < 0.1 ? t / 0.1 : 1);
      }
    }
  }

  clear(): void {
    for (const r of this.rings) {
      r.active = false;
      r.mesh.visible = false;
    }
    this.crack.visible = false;
    for (const list of [this.dust, this.chips]) {
      for (const p of list) {
        p.active = false;
        p.sprite.visible = false;
      }
    }
  }
}
