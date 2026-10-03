import * as THREE from 'three';
import type { Enemy } from '../ai/enemy';
import { clamp, easeOutCubic, lerp, lerpAngle } from '../core/math';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addOutline, createToonMaterial, type ToonMaterial } from '../render/toon';

/**
 * 敵（子鬼）の見た目。プリミティブ製の仮モデルだが、トゥーン着色・輪郭線・影の枠の中に置く（CLAUDE.md 原則 3）。
 * 原点は足元、正面は +Z。体（pivot）は被弾でのけぞり・つぶれ、死亡で倒れる。
 *
 * sim の状態（hitSerial / state / stateFrame）を読んで見た目を決める。
 * ヒットストップ中は animDt が 0 になるが、被弾の揺れは実時間（frameDt）で続ける（止まった絵の中で震えるのが手触りのコツ）。
 */

const WHITE = new THREE.Color(0xffffff);
/** 予備動作の発光色（赤。紫の体の上で「これから攻撃する」が読める色） */
const DANGER = new THREE.Color(1, 0.22, 0.16);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();

/** フラッシュ・予備動作の発光に使うマテリアルと、元の発光色 */
interface Flashable {
  mat: ToonMaterial;
  baseEmissive: THREE.Color;
  baseIntensity: number;
}

/** 1 つの部品: ジオメトリ + 位置・回転（Euler XYZ）・拡大 + 頂点色。mergeParts で 1 つのジオメトリにまとめる */
interface Part {
  geo: THREE.BufferGeometry;
  color: number;
  pos: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
}

const _m = new THREE.Matrix4();
const _pp = new THREE.Vector3();
const _qq = new THREE.Quaternion();
const _ee = new THREE.Euler();
const _ss = new THREE.Vector3();

/** 部品を変形して頂点色を付け、1 つのジオメトリに統合する。元の部品のジオメトリは解放する */
function mergeParts(parts: Part[]): THREE.BufferGeometry {
  const geos = parts.map((p) => {
    const g = p.geo.clone();
    const r = p.rot ?? [0, 0, 0];
    const sc = p.scale ?? [1, 1, 1];
    _m.compose(_pp.set(p.pos[0], p.pos[1], p.pos[2]), _qq.setFromEuler(_ee.set(r[0], r[1], r[2])), _ss.set(sc[0], sc[1], sc[2]));
    g.applyMatrix4(_m);
    const c = new THREE.Color(p.color);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    p.geo.dispose();
    return g;
  });
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) throw new Error('部品の統合に失敗しました');
  return merged;
}

export const IMP_COLORS = {
  body: 0x6a4fb3,
  bodyRim: 0xdccfff,
  cream: 0xf2e7c9,
  eye: 0xffe45c,
  dark: 0x2c2150,
} as const;

export class EnemyVisual {
  readonly root = new THREE.Group();
  /** 体全体（足元が原点）。のけぞり・つぶれ・倒れを掛ける */
  private readonly pivot = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly flashables: Flashable[] = [];

  private seenHit = 0;
  /** 被弾の演出（0..1 で減衰）。実時間で減らす */
  private flash = 0;
  private squash = 0;
  private lean = 0;
  private shake = 0;
  private shakeSeed = 0;
  /** 待機のゆらぎ用の時間（ヒットストップで止まる） */
  private idleTime = Math.random() * 10;

  constructor() {
    this.root.name = 'enemy-imp';
    this.root.add(this.pivot);
    this.build();
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        // ジオメトリは共有しない作りなので解放する。マテリアルも個別に作っている
        m.geometry.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat.dispose();
      }
    });
  }

  private toon(color: number, over: Partial<Parameters<typeof createToonMaterial>[0]> = {}): ToonMaterial {
    const m = createToonMaterial({ color, steps: 3, shadowLevel: 0.5, rimColor: IMP_COLORS.bodyRim, rimStrength: 0.4, ...over });
    this.flashables.push({ mat: m, baseEmissive: m.emissive.clone(), baseIntensity: m.emissiveIntensity });
    return m;
  }

  private mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: ToonMaterial, outline: number): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    parent.add(mesh);
    if (outline > 0) addOutline(mesh, { thickness: outline });
    return mesh;
  }

  /**
   * 色違いの部品を頂点色で 1 つにまとめて作る。部品ごとにメッシュを作ると 21 個（影・本体・輪郭線で約 55 回の描画呼び出し）になり、
   * iPad の 60fps を削るので、動かない部品は「輪郭線あり / 輪郭線なし / 目（発光）」の 3 つ、動く腕は 1 本 1 メッシュに統合する（約 13 回）。
   */
  private build(): void {
    const body = this.toon(0xffffff, { vertexColors: true });
    const eyeMat = this.toon(0xffffff, { vertexColors: true, steps: 2, shadowLevel: 0.9, rimStrength: 0, emissive: IMP_COLORS.eye, emissiveIntensity: 0.9 });
    const C = IMP_COLORS;
    // 頭の原点（部品の位置は体（足元が原点）の座標で書く）
    const H = { x: 0, y: 1.42, z: 0.02 };
    const onHead = (x: number, y: number, z: number): [number, number, number] => [H.x + x, H.y + y, H.z + z];

    // 輪郭線のある動かない部分: 胴・頭・角・耳・脚・足・しっぽ
    const solid: Part[] = [
      { geo: new THREE.CapsuleGeometry(0.36, 0.42, 6, 14), color: C.body, pos: [0, 0.82, 0], scale: [1, 1, 0.9] },
      { geo: new THREE.SphereGeometry(0.31, 16, 12), color: C.body, pos: onHead(0, 0, 0), scale: [1.1, 0.95, 1] },
      { geo: new THREE.ConeGeometry(0.075, 0.3, 8), color: C.cream, pos: onHead(-0.17, 0.3, -0.02), rot: [0, 0, 0.35] },
      { geo: new THREE.ConeGeometry(0.075, 0.3, 8), color: C.cream, pos: onHead(0.17, 0.3, -0.02), rot: [0, 0, -0.35] },
      { geo: new THREE.ConeGeometry(0.07, 0.24, 6), color: C.body, pos: onHead(-0.33, 0.06, 0), rot: [0, 0, 1.25] },
      { geo: new THREE.ConeGeometry(0.07, 0.24, 6), color: C.body, pos: onHead(0.33, 0.06, 0), rot: [0, 0, -1.25] },
      { geo: new THREE.CapsuleGeometry(0.11, 0.18, 4, 8), color: C.dark, pos: [-0.17, 0.22, 0.02] },
      { geo: new THREE.CapsuleGeometry(0.11, 0.18, 4, 8), color: C.dark, pos: [0.17, 0.22, 0.02] },
      { geo: new THREE.SphereGeometry(0.14, 10, 8), color: C.cream, pos: [-0.17, 0.07, 0.09], scale: [1, 0.55, 1.35] },
      { geo: new THREE.SphereGeometry(0.14, 10, 8), color: C.cream, pos: [0.17, 0.07, 0.09], scale: [1, 0.55, 1.35] },
      { geo: new THREE.ConeGeometry(0.07, 0.5, 8), color: C.body, pos: [0, 0.55, -0.4], rot: [-1.1, 0, 0] },
    ];
    this.mesh(this.pivot, mergeParts(solid), body, 0.025);

    // 輪郭線のない細部: 腹の模様・瞳・口（輪郭線を付けると黒くつぶれる）
    const detail: Part[] = [
      { geo: new THREE.SphereGeometry(0.25, 12, 10), color: C.cream, pos: [0, 0.78, 0.2], scale: [1, 1.15, 0.5] },
      { geo: new THREE.SphereGeometry(0.04, 8, 6), color: C.dark, pos: onHead(-0.13, 0.025, 0.305), scale: [1, 1.3, 0.5] },
      { geo: new THREE.SphereGeometry(0.04, 8, 6), color: C.dark, pos: onHead(0.13, 0.025, 0.305), scale: [1, 1.3, 0.5] },
      { geo: new THREE.SphereGeometry(0.07, 10, 6), color: C.dark, pos: onHead(0, -0.12, 0.28), scale: [1.5, 0.5, 0.4] },
    ];
    this.mesh(this.pivot, mergeParts(detail), body, 0);

    // 目（発光する白目）
    const eyes: Part[] = [
      { geo: new THREE.SphereGeometry(0.085, 10, 8), color: C.eye, pos: onHead(-0.13, 0.03, 0.27), scale: [1, 1.25, 0.6] },
      { geo: new THREE.SphereGeometry(0.085, 10, 8), color: C.eye, pos: onHead(0.13, 0.03, 0.27), scale: [1, 1.25, 0.6] },
    ];
    this.mesh(this.pivot, mergeParts(eyes), eyeMat, 0);

    // 腕: 肩を軸にして動かす（左右で同じジオメトリ）
    const arm = mergeParts([
      { geo: new THREE.CapsuleGeometry(0.085, 0.36, 4, 8), color: C.body, pos: [0, -0.26, 0] },
      { geo: new THREE.SphereGeometry(0.11, 10, 8), color: C.cream, pos: [0, -0.52, 0] },
    ]);
    for (const [grp, s] of [[this.armL, -1], [this.armR, 1]] as const) {
      grp.position.set(s * 0.42, 1.08, 0);
      grp.rotation.z = s * 0.28; // 少し開いて垂らす
      this.pivot.add(grp);
      this.mesh(grp, arm, body, 0.025);
    }
  }

  /** 発光（被弾のフラッシュ・予備動作の予告）。amount 0..1、color は発光の色（既定は白） */
  setGlow(amount: number, color: THREE.Color = WHITE): void {
    for (const f of this.flashables) {
      f.mat.emissive.copy(f.baseEmissive).lerp(color, amount);
      f.mat.emissiveIntensity = lerp(f.baseIntensity, 1.1, amount);
    }
  }

  /** 毎描画フレーム。animDt はヒットストップで止まる時間、frameDt は実時間 */
  update(e: Enemy, alpha: number, animDt: number, frameDt: number): void {
    this.root.position.set(lerp(e.prevX, e.body.x, alpha), 0, lerp(e.prevZ, e.body.z, alpha));
    this.root.rotation.y = lerpAngle(e.prevYaw, e.yaw, alpha);

    // 被弾を検出して演出を起こす
    if (e.hitSerial !== this.seenHit) {
      this.seenHit = e.hitSerial;
      this.flash = 1;
      this.squash = 1;
      this.lean = 1;
      this.shake = 1;
      this.shakeSeed = e.hitSerial * 12.9898;
    }
    this.flash = Math.max(0, this.flash - frameDt / 0.11);
    this.squash = Math.max(0, this.squash - frameDt / 0.28);
    this.lean = Math.max(0, this.lean - frameDt / 0.45);
    this.shake = Math.max(0, this.shake - frameDt / 0.22);
    this.idleTime += animDt;

    const dead = e.dead;
    const atk = e.def.attack;

    // --- 攻撃の予備動作（テレグラフ）と攻撃 ---
    // windup: 腕を振り上げ、体が赤く光り、しゃがんで後ろへ反る。attack: 腕を前へ叩きつけて前のめり、そのあと硬直で戻る
    let raise = 0; // 腕の振り上げ 0..1
    let swing = 0; // 腕の叩きつけ 0..1
    let danger = 0; // 赤い発光 0..1
    let crouch = 0; // しゃがみ 0..1（縦に縮む）
    let pitch = 0; // 前後の傾き（+ で前のめり）
    if (e.state === 'windup') {
      const w = clamp(e.stateFrame / atk.windupFrames, 0, 1);
      raise = easeOutCubic(clamp(w * 1.5, 0, 1));
      danger = 0.25 + 0.45 * w + 0.12 * Math.sin(e.stateFrame * 0.9);
      crouch = 0.12 * w;
      pitch = -0.28 * w;
    } else if (e.state === 'attack') {
      const swingEnd = atk.startupFrames + 1;
      const t = clamp(e.stateFrame / swingEnd, 0, 1);
      const back = clamp((e.stateFrame - atk.startupFrames - atk.activeFrames) / atk.recoverFrames, 0, 1);
      swing = t * (1 - easeOutCubic(back));
      raise = (1 - t) * (1 - easeOutCubic(back));
      danger = 0.4 * (1 - t);
      pitch = 0.45 * swing;
      crouch = 0.05 * (1 - back);
    }

    // 白（被弾）が強いあいだは白、そうでなければ赤（予備動作）
    const white = this.flash * 0.7;
    const red = Math.max(0, danger);
    if (white >= red) this.setGlow(white);
    else this.setGlow(red * 0.8, DANGER);

    // 待機のゆらぎ（上下・腕）と、腕の姿勢
    const bob = Math.sin(this.idleTime * 3.2) * 0.025 * (1 - raise);
    const sway = 1 - Math.max(raise, swing);
    const armBase = 0.28 + Math.sin(this.idleTime * 3.2) * 0.05 * sway;
    const spread = lerp(armBase, 2.55, raise);
    const spreadSwing = lerp(spread, 0.3, swing);
    this.armL.rotation.set(-swing * 1.5, 0, -spreadSwing);
    this.armR.rotation.set(-swing * 1.5, 0, spreadSwing);

    // つぶれ（被弾直後に縦に縮んで横に広がり、戻る）と、しゃがみ
    const sq = this.squash * this.squash * 0.22 + crouch * 0.5;
    this.pivot.scale.set(1 + sq, 1 - sq * 1.1, 1 + sq);

    // のけぞり（攻撃の向きへ頭が傾く）。死亡では倒れる。予備動作・攻撃の前後の傾きは別に掛ける
    let tilt = this.lean * 0.4;
    let sink = 0;
    let shrink = 1;
    if (dead) {
      const t = clamp(e.stateFrame / 22, 0, 1);
      tilt = lerp(0.4, 1.45, 1 - (1 - t) * (1 - t));
      // 倒れたあと沈みながら縮み、最後は点滅して消える
      const fade = clamp((e.stateFrame - 34) / (e.def.deathFrames - 34), 0, 1);
      sink = fade * 0.35;
      shrink = 1 - fade * fade;
      this.pivot.visible = fade < 0.55 || Math.floor(e.stateFrame / 3) % 2 === 0;
    } else {
      this.pivot.visible = true;
    }
    const hit = e.lastHit;
    if (hit && (tilt > 0.001 || dead)) {
      // 回転軸は押される向きに垂直な水平軸。+tilt で頭が dir の側へ倒れる
      _axis.set(hit.dirZ, 0, -hit.dirX);
      // root は yaw で回っているので、ワールドの軸をローカルへ直す
      _axis.applyAxisAngle(THREE.Object3D.DEFAULT_UP, -this.root.rotation.y);
      _q.setFromAxisAngle(_axis, tilt);
      this.pivot.quaternion.copy(_q);
    } else {
      this.pivot.quaternion.identity();
    }
    if (pitch !== 0) {
      _q.setFromAxisAngle(AXIS_X, pitch);
      this.pivot.quaternion.multiply(_q);
    }
    this.pivot.scale.multiplyScalar(shrink);

    // 揺れ（実時間で減衰する小さな振動）
    let sx = 0;
    let sz = 0;
    if (this.shake > 0) {
      const amp = this.shake * this.shake * 0.07;
      sx = Math.sin(this.shakeSeed + this.shake * 90) * amp;
      sz = Math.cos(this.shakeSeed * 1.7 + this.shake * 77) * amp;
    }
    this.pivot.position.set(sx, bob - sink, sz);
  }
}
