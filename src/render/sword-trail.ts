import * as THREE from 'three';

/**
 * 剣筋（トレイル）。刃の根元側と先の 2 点を毎描画フレームに記録し、時間順に並べたリボンとして描く。
 * 剣先は最高 85m/s（1 描画フレームで約 1.4m）で動くので、記録した点どうしを直線でつなぐと角ばる。
 * 点の間は Catmull-Rom 曲線で補間する（SUB 分割）。古い部分ほど透明になり、根元側へ細くなる（先端側だけが尾を引く）。
 *
 * 記録の時間はアニメの時間（ヒットストップで止まる）。トレイルを出す区間が途切れたら「ストロークの切れ目」を打ち、
 * 次に記録した点とは線でつながない（1 段目と 2 段目の剣筋がつながって見えないように）。
 * 世界座標の点を持つので、メッシュは scene の直下（変形なし）に置く。
 */

const SUB = 4;
const COLOR_TIP = new THREE.Color(0xf4fbff);
const COLOR_BASE = new THREE.Color(0x8fd0ff);

interface Sample {
  tip: THREE.Vector3;
  base: THREE.Vector3;
  age: number;
  /** この点から新しいストローク（前の点とつながない） */
  brk: boolean;
}

export class SwordTrail {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.BufferGeometry();
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly index: Uint16Array;
  private readonly samples: Sample[];
  /** samples は循環バッファ。oldest が最古の位置、count が有効数 */
  private oldest = 0;
  private count = 0;
  /** 次に記録する点を新しいストロークの始まりにする */
  private needBreak = true;
  /** 描いた三角形の頂点数（テスト・デバッグ用） */
  drawnIndices = 0;
  readonly life: number;

  /** max は記録する点の数、life は尾が消えるまでの秒 */
  constructor(max = 16, life = 0.2) {
    this.life = life;
    this.samples = Array.from({ length: max }, () => ({ tip: new THREE.Vector3(), base: new THREE.Vector3(), age: 0, brk: false }));
    const maxPoints = max * SUB;
    this.pos = new Float32Array(maxPoints * 2 * 3);
    this.col = new Float32Array(maxPoints * 2 * 4);
    this.index = new Uint16Array(maxPoints * 6);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(this.index, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.name = 'sword-trail';
    this.mesh.frustumCulled = false; // 頂点が毎フレーム変わるので境界球を持たない
    this.mesh.renderOrder = 15;
  }

  get sampleCount(): number {
    return this.count;
  }

  /**
   * 毎描画フレーム。dt はアニメの時間（ヒットストップ中は 0）、active は剣筋を出す区間か、
   * base / tip は刃の根元側と先の世界座標。dt が 0 のときは記録も老化もしない（止まった絵のまま）
   */
  update(dt: number, active: boolean, base: THREE.Vector3, tip: THREE.Vector3): void {
    if (dt > 0) {
      // 老化と、寿命を超えた最古の点の取り除き
      for (let i = 0; i < this.count; i++) this.at(i).age += dt;
      while (this.count > 0 && this.at(0).age >= this.life) {
        this.oldest = (this.oldest + 1) % this.samples.length;
        this.count--;
      }
      if (active) {
        if (this.count === this.samples.length) {
          this.oldest = (this.oldest + 1) % this.samples.length;
          this.count--;
        }
        const s = this.samples[(this.oldest + this.count) % this.samples.length]!;
        s.tip.copy(tip);
        s.base.copy(base);
        s.age = 0;
        s.brk = this.needBreak || this.count === 0;
        this.needBreak = false;
        this.count++;
      } else {
        this.needBreak = true;
      }
    }
    this.rebuild();
  }

  clear(): void {
    this.count = 0;
    this.oldest = 0;
    this.needBreak = true;
    this.rebuild();
  }

  private at(i: number): Sample {
    return this.samples[(this.oldest + i) % this.samples.length]!;
  }

  private rebuild(): void {
    let pts = 0;
    let idx = 0;
    const n = this.count;
    // 記録した点（古い順）を、Catmull-Rom の SUB 分割でなめらかにして頂点にする
    for (let j = 0; j < n; j++) {
      const s = this.at(j);
      const connected = j > 0 && !s.brk;
      const steps = connected ? SUB : 1;
      for (let k = 1; k <= steps; k++) {
        const t = connected ? k / SUB : 1;
        if (connected) {
          const p1 = this.at(j - 1);
          const p0 = j >= 2 && !p1.brk ? this.at(j - 2) : p1;
          const p3 = j + 1 < n && !this.at(j + 1).brk ? this.at(j + 1) : s;
          this.emit(pts, p0, p1, s, p3, t);
        } else {
          this.emit(pts, s, s, s, s, 1);
        }
        if (connected) {
          // 直前の点と四角形でつなぐ
          const a = (pts - 1) * 2;
          const b = pts * 2;
          const ix = this.index;
          ix[idx] = a;
          ix[idx + 1] = a + 1;
          ix[idx + 2] = b;
          ix[idx + 3] = b;
          ix[idx + 4] = a + 1;
          ix[idx + 5] = b + 1;
          idx += 6;
        }
        pts++;
      }
    }
    this.drawnIndices = idx;
    this.geo.setDrawRange(0, idx);
    this.geo.getAttribute('position').needsUpdate = true;
    this.geo.getAttribute('color').needsUpdate = true;
    this.geo.index!.needsUpdate = true;
  }

  /** 点 pts（2 頂点: 先端側・根元側）を、p1 → p2 の区間の t の位置に作る */
  private emit(pts: number, p0: Sample, p1: Sample, p2: Sample, p3: Sample, t: number): void {
    const age = p1.age + (p2.age - p1.age) * t;
    const life01 = Math.min(1, Math.max(0, age / this.life));
    const alpha = Math.pow(1 - life01, 1.3);
    spline(_tip, p0.tip, p1.tip, p2.tip, p3.tip, t);
    spline(_base, p0.base, p1.base, p2.base, p3.base, t);
    // 古い部分ほど根元側が先端側へ寄って細くなる
    _base.lerp(_tip, life01 * 0.85);
    this.write(pts * 2, _tip, COLOR_TIP, alpha * 0.9); // 先端側は濃く（光る縁）
    this.write(pts * 2 + 1, _base, COLOR_BASE, alpha * 0.05); // 根元側はほぼ透明（溶ける）
  }

  private write(vertex: number, p: THREE.Vector3, c: THREE.Color, alpha: number): void {
    const pi = vertex * 3;
    this.pos[pi] = p.x;
    this.pos[pi + 1] = p.y;
    this.pos[pi + 2] = p.z;
    const ci = vertex * 4;
    this.col[ci] = c.r;
    this.col[ci + 1] = c.g;
    this.col[ci + 2] = c.b;
    this.col[ci + 3] = alpha;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

const _tip = new THREE.Vector3();
const _base = new THREE.Vector3();

/** 一様 Catmull-Rom の 1 成分。pb → pc の区間の t（t2 = t²、t3 = t³） */
function cr(pa: number, pb: number, pc: number, pd: number, t: number, t2: number, t3: number): number {
  return 0.5 * (2 * pb + (-pa + pc) * t + (2 * pa - 5 * pb + 4 * pc - pd) * t2 + (-pa + 3 * pb - 3 * pc + pd) * t3);
}

/** 点 b → c の区間の t（0..1）の位置を out に書く（a・d は両隣の点） */
function spline(out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, t: number): void {
  const t2 = t * t;
  const t3 = t2 * t;
  out.set(cr(a.x, b.x, c.x, d.x, t, t2, t3), cr(a.y, b.y, c.y, d.y, t, t2, t3), cr(a.z, b.z, c.z, d.z, t, t2, t3));
}
