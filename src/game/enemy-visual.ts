import * as THREE from 'three';
import type { Enemy } from '../ai/enemy';
import { clamp, easeOutCubic, lerp, lerpAngle } from '../core/math';
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

  private add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: ToonMaterial, x: number, y: number, z: number, outline = 0.025): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    if (outline > 0) addOutline(mesh, { thickness: outline });
    return mesh;
  }

  private build(): void {
    const body = this.toon(IMP_COLORS.body);
    const cream = this.toon(IMP_COLORS.cream, { steps: 2, shadowLevel: 0.65, rimStrength: 0.25 });
    const dark = this.toon(IMP_COLORS.dark, { steps: 2, shadowLevel: 0.6, rimStrength: 0.2 });
    const eye = this.toon(IMP_COLORS.eye, { steps: 2, shadowLevel: 0.9, rimStrength: 0, emissive: IMP_COLORS.eye, emissiveIntensity: 0.9 });

    // 胴（カプセル）と、腹のクリーム色の模様
    const torso = this.add(this.pivot, new THREE.CapsuleGeometry(0.36, 0.42, 6, 14), body, 0, 0.82, 0);
    torso.scale.set(1, 1, 0.9);
    const belly = this.add(this.pivot, new THREE.SphereGeometry(0.25, 12, 10), cream, 0, 0.78, 0.2, 0);
    belly.scale.set(1, 1.15, 0.5);

    // 頭と目・角・耳
    const head = new THREE.Group();
    head.position.set(0, 1.42, 0.02);
    this.pivot.add(head);
    const skull = this.add(head, new THREE.SphereGeometry(0.31, 16, 12), body, 0, 0, 0);
    skull.scale.set(1.1, 0.95, 1);
    for (const s of [-1, 1]) {
      const white = this.add(head, new THREE.SphereGeometry(0.085, 10, 8), eye, s * 0.13, 0.03, 0.27, 0);
      white.scale.set(1, 1.25, 0.6);
      const pupil = this.add(head, new THREE.SphereGeometry(0.04, 8, 6), dark, s * 0.13, 0.025, 0.305, 0);
      pupil.scale.set(1, 1.3, 0.5);
      const horn = this.add(head, new THREE.ConeGeometry(0.075, 0.3, 8), cream, s * 0.17, 0.3, -0.02, 0.02);
      horn.rotation.z = -s * 0.35;
      const ear = this.add(head, new THREE.ConeGeometry(0.07, 0.24, 6), body, s * 0.33, 0.06, 0, 0.02);
      ear.rotation.z = -s * 1.25;
    }
    // 口（暗い細い楕円）
    const mouth = this.add(head, new THREE.SphereGeometry(0.07, 10, 6), dark, 0, -0.12, 0.28, 0);
    mouth.scale.set(1.5, 0.5, 0.4);

    // 腕: 肩を軸にして動かす
    for (const [grp, s] of [[this.armL, -1], [this.armR, 1]] as const) {
      grp.position.set(s * 0.42, 1.08, 0);
      grp.rotation.z = s * 0.28; // 少し開いて垂らす
      this.pivot.add(grp);
      this.add(grp, new THREE.CapsuleGeometry(0.085, 0.36, 4, 8), body, 0, -0.26, 0);
      this.add(grp, new THREE.SphereGeometry(0.11, 10, 8), cream, 0, -0.52, 0);
    }

    // 脚
    for (const s of [-1, 1]) {
      this.add(this.pivot, new THREE.CapsuleGeometry(0.11, 0.18, 4, 8), dark, s * 0.17, 0.22, 0.02);
      const foot = this.add(this.pivot, new THREE.SphereGeometry(0.14, 10, 8), cream, s * 0.17, 0.07, 0.09);
      foot.scale.set(1, 0.55, 1.35);
    }

    // しっぽ
    const tail = this.add(this.pivot, new THREE.ConeGeometry(0.07, 0.5, 8), body, 0, 0.55, -0.4);
    tail.rotation.x = -1.1;
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
