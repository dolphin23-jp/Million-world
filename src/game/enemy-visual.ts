import * as THREE from 'three';
import type { Enemy } from '../ai/enemy';
import type { EnemyId } from '../ai/data/enemies';
import { clamp, easeOutCubic, lerp, lerpAngle } from '../core/math';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addOutline, createToonMaterial, type ToonMaterial } from '../render/toon';
import { PROJECTILES, PROJECTILE_HEIGHT } from '../combat/data/projectiles';
import { WISP_COLORS, glowTexture } from '../render/projectiles';

/**
 * 敵（子鬼・暴れ猪・提灯・岩鬼・小蝙蝠）の見た目。プリミティブ製の仮モデルだが、トゥーン着色・輪郭線・影の枠の中に置く（CLAUDE.md 原則 3）。
 * 種類（kind）ごとに部品とポーズの付け方が違い（子鬼は腕を振り上げて叩きつける。暴れ猪は前脚で地面を掻いて頭を下げ、突進で脚を回す。
 * 小蝙蝠は宙を羽ばたいて浮き、予備動作で翼を広げて仰け反り、急降下で噛みつく。提灯は宙に浮いて、予備動作で前に鬼火を溜め、撃つ反動で前のめりになる。岩鬼は金棒を頭上へ振りかぶって地面へ叩きつけ、体勢が減るほど体の割れ目が光り、崩れると膝をつく）、
 * 被弾・のけぞり・倒れ・弾かれの反応と発光は共通。
 * 原点は足元、正面は +Z。体（pivot）は被弾でのけぞり・つぶれ、死亡で倒れる。
 *
 * sim の状態（hitSerial / state / stateFrame）を読んで見た目を決める。
 * ヒットストップ中は animDt が 0 になるが、被弾の揺れは実時間（frameDt）で続ける（止まった絵の中で震えるのが手触りのコツ）。
 */

const WHITE = new THREE.Color(0xffffff);
/** 予備動作の発光色（赤。紫の体の上で「これから攻撃する」が読める色） */
const DANGER = new THREE.Color(1, 0.22, 0.16);
/** パリィで弾かれて動けないあいだ（体勢を崩す・倒れる）の発光色（水色。予備動作の赤・被弾の白と見分ける） */
const STAGGER = new THREE.Color(0.45, 0.88, 1);
/** 提灯の予備動作の発光色（紫。紙の赤い体の上で、溜めている鬼火と同じ色の「これから撃つ」が読める） */
const LANTERN_WINDUP = new THREE.Color(0.62, 0.45, 1);
/** ガード不能の予備動作の発光色（赤紫。床の予告の円と同じ色。防げる攻撃の赤と見分ける） */
const UNBLOCKABLE_WINDUP = new THREE.Color(1, 0.3, 0.68);
/** 倒れたときの後ろ向きの傾き（rad。ほぼ仰向け）と、そのときの持ち上げ（m。胴の半径ぶん） */
const FALL_PITCH = 1.42;
/** 暴れ猪が倒れるときの横倒しの角度（rad。ほぼ真横） */
const BOAR_ROLL = 1.5;
const FALL_LIFT = 0.34;
/** 岩鬼が倒れて仰向けに寝るときの持ち上げ（m。胴の半径ぶん） */
const OGRE_FALL_LIFT = 0.62;
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
const _crackHot = new THREE.Color();
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

export const BOAR_COLORS = {
  body: 0x2f8a8f,
  bodyRim: 0xc9f4f1,
  cream: 0xf2e7c9,
  accent: 0xf2a03d,
  eye: 0xffe45c,
  dark: 0x1d3a3d,
} as const;

export const LANTERN_COLORS = {
  paper: 0xd9473b,
  paperRim: 0xffd9a8,
  rib: 0x8a2420,
  dark: 0x2a1f2d,
  gold: 0xe9b64a,
  eye: 0xfff3c4,
  mouth: 0x3a0f1c,
  tongue: 0xff7fa8,
} as const;

export const BAT_COLORS = {
  body: 0x35407a,
  wing: 0x5a68c8,
  wingRim: 0xd0d8ff,
  belly: 0xf0c6d8,
  dark: 0x1a1f40,
  eye: 0xffe45c,
  fang: 0xfff6e0,
} as const;

/** 小蝙蝠の体の中心の高さ（宙に浮く）と体の半径。倒れて落ちるときの落下量に使う */
const BAT_Y = 1.0;
const BAT_R = 0.2;

export const OGRE_COLORS = {
  skin: 0xc98b4e,
  skinRim: 0xffe0b8,
  armor: 0x8d94a6,
  dark: 0x2e3040,
  metal: 0x4a4f60,
  cream: 0xf2e7c9,
  gold: 0xe3b04b,
  eye: 0xffe45c,
  /** 体勢が減るほど光る割れ目（溶岩のような橙） */
  crackDim: 0x6a2a14,
  crackHot: 0xffb347,
} as const;

/** 提灯の体の中心の高さ（宙に浮く。足元の影との間が空く）と、紙の胴の半径。倒れる（落ちて横たわる）ときの落下量に使う */
const LANTERN_Y = 1.05;
const LANTERN_R = 0.42;
/** 暴れ猪の胴の中心の高さと半径（倒れて横たわるとき、地面にめり込まないよう持ち上げる量に使う） */
const BOAR_BODY_Y = 0.66;
const BOAR_BODY_R = 0.42;

export class EnemyVisual {
  readonly root = new THREE.Group();
  /** 体全体（足元が原点）。のけぞり・つぶれ・倒れを掛ける */
  private readonly pivot = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  /** 暴れ猪の脚（前左・前右・後左・後右。腰の付け根が軸）。子鬼では使わない */
  private readonly legs: THREE.Group[] = [];
  private readonly flashables: Flashable[] = [];
  /** 提灯の房（体の下で揺れる）と、予備動作で前に溜める鬼火。提灯以外では使わない */
  private readonly tassel = new THREE.Group();
  private charge: THREE.Group | null = null;
  /** 岩鬼の体勢の割れ目の材質（体勢が減るほど明るくする）。岩鬼以外では使わない */
  private crackMat: THREE.MeshBasicMaterial | null = null;

  private seenHit = 0;
  /** 被弾の演出（0..1 で減衰）。実時間で減らす */
  private flash = 0;
  private squash = 0;
  private lean = 0;
  private shake = 0;
  private shakeSeed = 0;
  /** 待機のゆらぎ用の時間（ヒットストップで止まる） */
  private idleTime = Math.random() * 10;

  constructor(private readonly kind: EnemyId = 'imp') {
    this.root.name = `enemy-${kind}`;
    this.root.add(this.pivot);
    if (kind === 'boar') this.buildBoar();
    else if (kind === 'lantern') this.buildLantern();
    else if (kind === 'ogre') this.buildOgre();
    else if (kind === 'bat') this.buildBat();
    else this.build();
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
      // スプライト（溜めの鬼火のにじみ）のマテリアル。テクスチャは全体で共有しているので解放しない
      const sp = o as THREE.Sprite;
      if (sp.isSprite) sp.material.dispose();
    });
  }

  private toon(color: number, over: Partial<Parameters<typeof createToonMaterial>[0]> = {}): ToonMaterial {
    const rim = this.kind === 'boar' ? BOAR_COLORS.bodyRim : this.kind === 'lantern' ? LANTERN_COLORS.paperRim : this.kind === 'ogre' ? OGRE_COLORS.skinRim : this.kind === 'bat' ? BAT_COLORS.wingRim : IMP_COLORS.bodyRim;
    const m = createToonMaterial({ color, steps: 3, shadowLevel: 0.5, rimColor: rim, rimStrength: 0.4, ...over });
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

  /**
   * 暴れ猪の部品。低く長い胴（+Z が前）、頭と牙、背の鬣（オレンジ）、4 本の脚（腰の付け根が軸）。子鬼（縦長・紫）と並べてシルエットと色で見分けがつく（青緑の横長）。
   * 描画呼び出しは、動かない部分（輪郭線あり）・細部・目・脚 4 本の 7 メッシュ。
   */
  private buildBoar(): void {
    const C = BOAR_COLORS;
    const body = this.toon(0xffffff, { vertexColors: true });
    const eyeMat = this.toon(0xffffff, { vertexColors: true, steps: 2, shadowLevel: 0.9, rimStrength: 0, emissive: C.eye, emissiveIntensity: 0.9 });
    const Y = BOAR_BODY_Y;
    const solid: Part[] = [
      // 胴（長軸を Z へ寝かせる）と、尻・肩の盛り上がり
      { geo: new THREE.CapsuleGeometry(BOAR_BODY_R, 0.62, 6, 14), color: C.body, pos: [0, Y, -0.05], rot: [Math.PI / 2, 0, 0], scale: [1.05, 1, 0.95] },
      { geo: new THREE.SphereGeometry(0.4, 14, 10), color: C.body, pos: [0, Y + 0.04, -0.5], scale: [1.05, 1, 1] },
      { geo: new THREE.SphereGeometry(0.4, 14, 10), color: C.body, pos: [0, Y + 0.12, 0.4], scale: [1.08, 1.02, 1] },
      // 頭・鼻先・牙・耳
      { geo: new THREE.SphereGeometry(0.34, 14, 10), color: C.body, pos: [0, Y - 0.02, 0.92], scale: [1, 0.95, 1.05] },
      { geo: new THREE.CylinderGeometry(0.17, 0.21, 0.34, 10), color: C.cream, pos: [0, Y - 0.1, 1.2], rot: [Math.PI / 2, 0, 0] },
      { geo: new THREE.ConeGeometry(0.055, 0.32, 8), color: C.cream, pos: [-0.18, Y - 0.12, 1.18], rot: [1.05, 0, 0.3] },
      { geo: new THREE.ConeGeometry(0.055, 0.32, 8), color: C.cream, pos: [0.18, Y - 0.12, 1.18], rot: [1.05, 0, -0.3] },
      { geo: new THREE.ConeGeometry(0.1, 0.24, 6), color: C.body, pos: [-0.22, Y + 0.32, 0.82], rot: [-0.25, 0, 0.5] },
      { geo: new THREE.ConeGeometry(0.1, 0.24, 6), color: C.body, pos: [0.22, Y + 0.32, 0.82], rot: [-0.25, 0, -0.5] },
      // 背の鬣（オレンジ）と、しっぽ
      ...[-0.7, -0.4, -0.1, 0.2, 0.5].map((z, i): Part => ({ geo: new THREE.ConeGeometry(0.075, 0.26 - i * 0.012, 6), color: C.accent, pos: [0, Y + 0.45 + (i > 2 ? 0.08 : 0), z], rot: [-0.2, 0, 0] })),
      { geo: new THREE.ConeGeometry(0.05, 0.34, 6), color: C.body, pos: [0, Y + 0.18, -0.95], rot: [-1.05, 0, 0] },
    ];
    this.mesh(this.pivot, mergeParts(solid), body, 0.03);

    // 輪郭線のない細部: 鼻の穴・瞳・額の模様
    const detail: Part[] = [
      { geo: new THREE.SphereGeometry(0.03, 8, 6), color: C.dark, pos: [-0.07, Y - 0.06, 1.37], scale: [1, 1.4, 0.6] },
      { geo: new THREE.SphereGeometry(0.03, 8, 6), color: C.dark, pos: [0.07, Y - 0.06, 1.37], scale: [1, 1.4, 0.6] },
      { geo: new THREE.SphereGeometry(0.035, 8, 6), color: C.dark, pos: [-0.2, Y + 0.12, 1.2], scale: [1, 1.3, 0.5] },
      { geo: new THREE.SphereGeometry(0.035, 8, 6), color: C.dark, pos: [0.2, Y + 0.12, 1.2], scale: [1, 1.3, 0.5] },
      { geo: new THREE.SphereGeometry(0.13, 10, 8), color: C.accent, pos: [0, Y + 0.24, 1.02], scale: [1.2, 0.35, 1] },
    ];
    this.mesh(this.pivot, mergeParts(detail), body, 0);

    // 目（発光する）
    const eyes: Part[] = [
      { geo: new THREE.SphereGeometry(0.075, 10, 8), color: C.eye, pos: [-0.2, Y + 0.12, 1.14], scale: [1, 1.2, 0.6] },
      { geo: new THREE.SphereGeometry(0.075, 10, 8), color: C.eye, pos: [0.2, Y + 0.12, 1.14], scale: [1, 1.2, 0.6] },
    ];
    this.mesh(this.pivot, mergeParts(eyes), eyeMat, 0);

    // 脚: 腰（肩）の付け根が軸。左右・前後で同じジオメトリ
    const leg = mergeParts([
      { geo: new THREE.CapsuleGeometry(0.1, 0.3, 4, 8), color: C.body, pos: [0, -0.24, 0] },
      { geo: new THREE.SphereGeometry(0.115, 10, 8), color: C.cream, pos: [0, -0.5, 0.02], scale: [1, 0.7, 1.2] },
    ]);
    for (const [x, z] of [[-0.27, 0.5], [0.27, 0.5], [-0.27, -0.55], [0.27, -0.55]] as const) {
      const g = new THREE.Group();
      g.position.set(x, 0.56, z);
      this.pivot.add(g);
      this.mesh(g, leg, body, 0.025);
      this.legs.push(g);
    }
  }

  /**
   * 提灯の部品（ADR-026）。紙の胴（赤。縦に長い楕円）+ 上下の黒い蓋 + 持ち手の輪 + 骨組みの横線 + 大きな一つ目と舌 + 下に房。宙に浮く。
   * 部品の座標は体の中心（LANTERN_Y の高さ）が原点で、pivot ごと中心を軸に傾く（落ちるときも中心まわりに転がる）。
   * 胴は内側の火で薄く発光している（emissive）。描画呼び出しは、動かない部分・細部・目・房・溜めの鬼火で 5 メッシュ前後。
   */
  private buildLantern(): void {
    const C = LANTERN_COLORS;
    const body = this.toon(0xffffff, { vertexColors: true, emissive: 0xff7a3a, emissiveIntensity: 0.3 });
    const eyeMat = this.toon(0xffffff, { vertexColors: true, steps: 2, shadowLevel: 0.9, rimStrength: 0, emissive: C.eye, emissiveIntensity: 0.9 });
    // 紙の胴の高さ方向の半径: 楕円（縦 1.18 倍）
    const ribR = (y: number): number => LANTERN_R * Math.sqrt(Math.max(0, 1 - (y / (LANTERN_R * 1.18)) ** 2)) * 1.01;
    const solid: Part[] = [
      { geo: new THREE.SphereGeometry(LANTERN_R, 20, 14), color: C.paper, pos: [0, 0, 0], scale: [1, 1.18, 1] },
      { geo: new THREE.CylinderGeometry(0.2, 0.26, 0.1, 14), color: C.dark, pos: [0, 0.52, 0] },
      { geo: new THREE.CylinderGeometry(0.26, 0.2, 0.1, 14), color: C.dark, pos: [0, -0.52, 0] },
      { geo: new THREE.TorusGeometry(0.1, 0.022, 8, 14), color: C.gold, pos: [0, 0.68, 0] },
    ];
    this.mesh(this.pivot, mergeParts(solid), body, 0.025);

    // 輪郭線のない細部: 骨組みの横線・口・舌・瞳（輪郭線を付けると黒くつぶれる）
    const detail: Part[] = [
      ...[-0.24, 0, 0.24].map((y): Part => ({ geo: new THREE.TorusGeometry(ribR(y), 0.016, 6, 24), color: C.rib, pos: [0, y, 0], rot: [Math.PI / 2, 0, 0] })),
      { geo: new THREE.SphereGeometry(0.1, 12, 8), color: C.mouth, pos: [0, -0.2, 0.36], scale: [1.7, 0.55, 0.35] },
      { geo: new THREE.CapsuleGeometry(0.045, 0.13, 4, 8), color: C.tongue, pos: [0.05, -0.31, 0.39], rot: [0.2, 0, 0.2] },
      { geo: new THREE.SphereGeometry(0.07, 10, 8), color: C.dark, pos: [0, 0.05, 0.43], scale: [0.85, 1.35, 0.45] },
    ];
    this.mesh(this.pivot, mergeParts(detail), body, 0);

    // 目（発光する白目。胴の正面）
    const eyes: Part[] = [{ geo: new THREE.SphereGeometry(0.15, 14, 10), color: C.eye, pos: [0, 0.05, 0.385], scale: [1, 1.1, 0.45] }];
    this.mesh(this.pivot, mergeParts(eyes), eyeMat, 0);

    // 房: 下の蓋の真ん中から垂れて揺れる（付け根が軸）
    const tassel = mergeParts([
      { geo: new THREE.CylinderGeometry(0.012, 0.012, 0.28, 6), color: C.gold, pos: [0, -0.14, 0] },
      { geo: new THREE.SphereGeometry(0.045, 8, 6), color: C.gold, pos: [0, -0.31, 0] },
    ]);
    this.tassel.position.set(0, -0.57, 0);
    this.pivot.add(this.tassel);
    this.mesh(this.tassel, tassel, body, 0.02);

    // 予備動作で前（撃つ位置）に溜める鬼火。体の傾きに付き合わせず root に付ける
    const ch = new THREE.Group();
    const wisp = WISP_COLORS.enemy;
    const projectile = PROJECTILES.wisp;
    const coreMat = new THREE.MeshBasicMaterial({ color: wisp.core, toneMapped: false, fog: false });
    const core = new THREE.Mesh(new THREE.SphereGeometry(projectile.radius * 0.85, 14, 10), coreMat);
    addOutline(core, { color: wisp.outline, thickness: 0.03 });
    ch.add(core);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: wisp.halo, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.7 }));
    halo.scale.set(1.7, 1.7, 1);
    halo.renderOrder = 7;
    ch.add(halo);
    ch.visible = false;
    this.root.add(ch);
    this.charge = ch;
  }

  /**
   * 岩鬼の部品（ADR-027）: 石の鎧をまとった大鬼。ずんぐりした胴と肩当て（灰青の石）・黄土色の肌・兜に 2 本の角・牙・右手に大きな金棒（トゲ付き）。
   * 体には割れ目が走り、体勢が減るほど溶岩のように光る（体勢を崩す目安）。腕は肩が軸で、金棒は右腕に付く（下ろすと先が床すれすれ）。
   * 子鬼と同じ腕の動かし方（肩を軸に振り上げて叩きつける）で、振りかぶりは頭上まで上げる。描画呼び出しは、動かない部分・細部・目・割れ目・腕 2 本の 5 メッシュ前後。
   */
  private buildOgre(): void {
    const C = OGRE_COLORS;
    const body = this.toon(0xffffff, { vertexColors: true });
    const eyeMat = this.toon(0xffffff, { vertexColors: true, steps: 2, shadowLevel: 0.9, rimStrength: 0, emissive: C.eye, emissiveIntensity: 0.9 });
    const H = { x: 0, y: 2.26, z: 0.06 };
    const onHead = (x: number, y: number, z: number): [number, number, number] => [H.x + x, H.y + y, H.z + z];

    const solid: Part[] = [
      // 脚・ブーツ・腰
      { geo: new THREE.CapsuleGeometry(0.24, 0.42, 5, 10), color: C.skin, pos: [-0.38, 0.6, 0] },
      { geo: new THREE.CapsuleGeometry(0.24, 0.42, 5, 10), color: C.skin, pos: [0.38, 0.6, 0] },
      { geo: new THREE.SphereGeometry(0.31, 12, 9), color: C.armor, pos: [-0.38, 0.17, 0.1], scale: [1, 0.58, 1.4] },
      { geo: new THREE.SphereGeometry(0.31, 12, 9), color: C.armor, pos: [0.38, 0.17, 0.1], scale: [1, 0.58, 1.4] },
      { geo: new THREE.CapsuleGeometry(0.5, 0.2, 5, 12), color: C.dark, pos: [0, 1.05, 0], scale: [1.15, 1, 0.9] },
      // 胴（肌）と前後の胸当て・肩当て
      { geo: new THREE.CapsuleGeometry(0.62, 0.5, 6, 14), color: C.skin, pos: [0, 1.52, 0], scale: [1.2, 1, 0.95] },
      { geo: new THREE.SphereGeometry(0.66, 14, 10), color: C.armor, pos: [0, 1.56, 0.3], scale: [1.12, 0.86, 0.62] },
      { geo: new THREE.SphereGeometry(0.66, 14, 10), color: C.armor, pos: [0, 1.56, -0.3], scale: [1.12, 0.86, 0.6] },
      { geo: new THREE.SphereGeometry(0.44, 12, 9), color: C.armor, pos: [-0.9, 2.0, 0], scale: [1, 0.8, 1] },
      { geo: new THREE.SphereGeometry(0.44, 12, 9), color: C.armor, pos: [0.9, 2.0, 0], scale: [1, 0.8, 1] },
      // 頭・兜・角・牙
      { geo: new THREE.SphereGeometry(0.34, 14, 10), color: C.skin, pos: onHead(0, 0, 0), scale: [1.1, 0.95, 1] },
      { geo: new THREE.SphereGeometry(0.39, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), color: C.armor, pos: onHead(0, 0.06, -0.01) },
      { geo: new THREE.ConeGeometry(0.1, 0.42, 8), color: C.cream, pos: onHead(-0.3, 0.38, 0), rot: [0, 0, 0.55] },
      { geo: new THREE.ConeGeometry(0.1, 0.42, 8), color: C.cream, pos: onHead(0.3, 0.38, 0), rot: [0, 0, -0.55] },
      { geo: new THREE.ConeGeometry(0.06, 0.2, 6), color: C.cream, pos: onHead(-0.14, -0.16, 0.3), rot: [0, 0, 3.14] },
      { geo: new THREE.ConeGeometry(0.06, 0.2, 6), color: C.cream, pos: onHead(0.14, -0.16, 0.3), rot: [0, 0, 3.14] },
    ];
    this.mesh(this.pivot, mergeParts(solid), body, 0.03);

    // 輪郭線のない細部: 眉・口・胸当ての金の縁・帯
    const detail: Part[] = [
      { geo: new THREE.SphereGeometry(0.2, 10, 6), color: C.dark, pos: onHead(0, 0.07, 0.3), scale: [1.6, 0.28, 0.4] },
      { geo: new THREE.SphereGeometry(0.1, 10, 6), color: C.dark, pos: onHead(0, -0.15, 0.3), scale: [1.8, 0.45, 0.4] },
      { geo: new THREE.TorusGeometry(0.62, 0.035, 6, 20), color: C.gold, pos: [0, 1.2, 0.05], rot: [Math.PI / 2, 0, 0], scale: [1.15, 0.9, 1] },
      { geo: new THREE.SphereGeometry(0.1, 8, 6), color: C.gold, pos: [0, 1.58, 0.67] },
    ];
    this.mesh(this.pivot, mergeParts(detail), body, 0);

    // 目（発光する細い目）
    const eyes: Part[] = [
      { geo: new THREE.SphereGeometry(0.06, 8, 6), color: C.eye, pos: onHead(-0.14, 0.0, 0.31), scale: [1.5, 0.8, 0.5] },
      { geo: new THREE.SphereGeometry(0.06, 8, 6), color: C.eye, pos: onHead(0.14, 0.0, 0.31), scale: [1.5, 0.8, 0.5] },
    ];
    this.mesh(this.pivot, mergeParts(eyes), eyeMat, 0);

    // 体の割れ目（溶岩のように光る）: 胸当て・肩当て・兜に走る細い線。体勢が減るほど明るくする（update で色を替える）
    const crack = (x: number, y: number, z: number, len: number, rot: [number, number, number]): Part => ({ geo: new THREE.BoxGeometry(0.035, len, 0.035), color: 0xffffff, pos: [x, y, z], rot });
    const cracks: Part[] = [
      crack(-0.18, 1.62, 0.665, 0.5, [0.1, 0, 0.5]),
      crack(0.22, 1.5, 0.645, 0.4, [0.1, 0, -0.6]),
      crack(0.05, 1.82, 0.52, 0.3, [0.5, 0, 0.2]),
      crack(-0.88, 2.1, 0.22, 0.34, [0.5, 0, 0.7]),
      crack(0.9, 2.1, 0.22, 0.3, [0.5, 0, -0.7]),
      crack(-0.12, 2.5, 0.2, 0.22, [0.6, 0, 0.3]),
      crack(0.0, 1.5, -0.62, 0.55, [-0.1, 0, 0.4]),
    ];
    const crackMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: C.crackDim, toneMapped: false, fog: false });
    const crackMesh = new THREE.Mesh(mergeParts(cracks), crackMat);
    this.pivot.add(crackMesh);
    this.crackMat = crackMat;

    // 腕: 肩が軸（左は素手、右は金棒を持つ）。下ろしたとき、金棒の先が床すれすれになる長さ
    const armParts = (club: boolean): Part[] => [
      { geo: new THREE.CapsuleGeometry(0.2, 0.34, 4, 8), color: C.skin, pos: [0, -0.4, 0] },
      { geo: new THREE.CylinderGeometry(0.25, 0.22, 0.3, 10), color: C.armor, pos: [0, -0.56, 0] },
      { geo: new THREE.SphereGeometry(0.26, 10, 8), color: C.skin, pos: [0, -0.76, 0] },
      ...(club
        ? [
            { geo: new THREE.CylinderGeometry(0.07, 0.085, 0.8, 8), color: C.dark, pos: [0, -1.0, 0] } as Part,
            { geo: new THREE.CylinderGeometry(0.28, 0.2, 0.6, 10), color: C.metal, pos: [0, -1.58, 0] } as Part,
            ...[0, 1, 2, 3].map((i): Part => ({ geo: new THREE.ConeGeometry(0.07, 0.2, 6), color: C.cream, pos: [Math.sin((i * Math.PI) / 2) * 0.3, -1.58, Math.cos((i * Math.PI) / 2) * 0.3], rot: [Math.cos((i * Math.PI) / 2) * 1.57, 0, -Math.sin((i * Math.PI) / 2) * 1.57] })),
          ]
        : []),
    ];
    const armL = mergeParts(armParts(false));
    const armR = mergeParts(armParts(true));
    for (const [grp, s, geo] of [[this.armL, -1, armL], [this.armR, 1, armR]] as const) {
      grp.position.set(s * 0.9, 1.98, 0);
      grp.rotation.z = s * 0.28;
      this.pivot.add(grp);
      this.mesh(grp, geo, body, 0.03);
    }
  }

  /**
   * 小蝙蝠の部品（ADR-028）: 丸い胴・頭・とがった耳・牙・発光する目、薄く平たい翼 2 枚（肩が軸。羽ばたく）。部品の座標は体の中心（BAT_Y の高さ）が原点で、
   * pivot ごと中心を軸に傾く（急降下の前傾・仰け反り・落ちるときの回転）。翼は armL / armR を使う。群れで 6〜7 体出るので、描画呼び出しは 1 体あたり 5 メッシュ前後に抑える。
   */
  private buildBat(): void {
    const C = BAT_COLORS;
    const body = this.toon(0xffffff, { vertexColors: true });
    const eyeMat = this.toon(0xffffff, { vertexColors: true, steps: 2, shadowLevel: 0.9, rimStrength: 0, emissive: C.eye, emissiveIntensity: 0.9 });
    const solid: Part[] = [
      { geo: new THREE.SphereGeometry(BAT_R, 12, 9), color: C.body, pos: [0, 0, 0], scale: [1, 0.95, 1.25] },
      { geo: new THREE.SphereGeometry(0.15, 12, 9), color: C.body, pos: [0, 0.06, 0.23] },
      { geo: new THREE.ConeGeometry(0.06, 0.18, 6), color: C.body, pos: [-0.09, 0.22, 0.2], rot: [0, 0, 0.22] },
      { geo: new THREE.ConeGeometry(0.06, 0.18, 6), color: C.body, pos: [0.09, 0.22, 0.2], rot: [0, 0, -0.22] },
      { geo: new THREE.ConeGeometry(0.03, 0.1, 5), color: C.fang, pos: [-0.05, -0.06, 0.34], rot: [0, 0, Math.PI] },
      { geo: new THREE.ConeGeometry(0.03, 0.1, 5), color: C.fang, pos: [0.05, -0.06, 0.34], rot: [0, 0, Math.PI] },
      { geo: new THREE.ConeGeometry(0.03, 0.1, 5), color: C.body, pos: [-0.07, -0.2, -0.1] },
      { geo: new THREE.ConeGeometry(0.03, 0.1, 5), color: C.body, pos: [0.07, -0.2, -0.1] },
    ];
    this.mesh(this.pivot, mergeParts(solid), body, 0.02);
    // 輪郭線のない細部: 腹の淡い色・耳の内側
    const detail: Part[] = [
      { geo: new THREE.SphereGeometry(0.14, 10, 7), color: C.belly, pos: [0, -0.07, 0.1], scale: [1, 0.8, 1.2] },
      { geo: new THREE.ConeGeometry(0.03, 0.1, 5), color: C.belly, pos: [-0.09, 0.21, 0.23], rot: [0.2, 0, 0.22] },
      { geo: new THREE.ConeGeometry(0.03, 0.1, 5), color: C.belly, pos: [0.09, 0.21, 0.23], rot: [0.2, 0, -0.22] },
    ];
    this.mesh(this.pivot, mergeParts(detail), body, 0);
    const eyes: Part[] = [
      { geo: new THREE.SphereGeometry(0.04, 8, 6), color: C.eye, pos: [-0.065, 0.1, 0.355], scale: [1, 1.2, 0.6] },
      { geo: new THREE.SphereGeometry(0.04, 8, 6), color: C.eye, pos: [0.065, 0.1, 0.355], scale: [1, 1.2, 0.6] },
    ];
    this.mesh(this.pivot, mergeParts(eyes), eyeMat, 0);

    // 翼: 肩が軸の平たい楕円 + 翼の骨（濃い線）。左右で同じジオメトリ（右側。左は group の向きで反転して使う）
    const wing = mergeParts([
      { geo: new THREE.SphereGeometry(0.4, 12, 6), color: C.wing, pos: [0.42, 0, -0.04], scale: [1, 0.07, 0.62] },
      { geo: new THREE.CylinderGeometry(0.012, 0.012, 0.78, 5), color: C.dark, pos: [0.4, 0.03, 0.12], rot: [0, 0, Math.PI / 2] },
      { geo: new THREE.ConeGeometry(0.035, 0.12, 5), color: C.dark, pos: [0.82, 0.03, 0.12], rot: [0, 0, -Math.PI / 2] },
    ]);
    for (const [grp, s] of [[this.armL, -1], [this.armR, 1]] as const) {
      grp.position.set(s * 0.12, 0.06, 0);
      this.pivot.add(grp);
      const m = this.mesh(grp, wing, body, 0.012);
      m.scale.x = s; // 左は鏡写し
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
    const boar = this.kind === 'boar';
    const lantern = this.kind === 'lantern';
    const ogre = this.kind === 'ogre';
    const bat = this.kind === 'bat';

    // --- 攻撃の予備動作（テレグラフ）と攻撃 ---
    // windup: 腕を振り上げ、体が赤く光り、しゃがんで後ろへ反る。attack: 腕を前へ叩きつけて前のめり、そのあと硬直で戻る
    let raise = 0; // 腕の振り上げ 0..1
    let swing = 0; // 腕の叩きつけ 0..1
    let danger = 0; // 赤い発光 0..1
    let crouch = 0; // しゃがみ 0..1（縦に縮む）
    let pitch = 0; // 前後の傾き（+ で前のめり）
    let stagger = 0; // パリィで弾かれて動けない度合い 0..1（水色の発光に使う。stagger・down 共通）
    let fallen = 0; // 倒れている度合い 0..1（down。後ろへ倒れて、地面に寝る）
    let wobble = 0; // 崩れているあいだのふらつき（左右の傾き。rad）
    if (e.state === 'windup') {
      const w = clamp(e.stateFrame / atk.windupFrames, 0, 1);
      raise = easeOutCubic(clamp(w * 1.5, 0, 1));
      danger = 0.25 + 0.45 * w + 0.12 * Math.sin(e.stateFrame * 0.9);
      if (boar) {
        // 前脚で地面を掻き（raise）、頭を下げて沈む（突進の構え）
        crouch = 0.1 * w;
        pitch = 0.16 * w;
      } else if (lantern) {
        // 鬼火を溜めながら、後ろへ反ってふくらむ（撃つ前のため）
        crouch = -0.1 * w;
        pitch = -0.22 * w;
      } else if (bat) {
        // 翼を高く広げて、鼻先を上げて仰け反る（急降下の構え）
        pitch = -0.55 * w;
      } else {
        crouch = 0.12 * w;
        pitch = -0.28 * w;
      }
    } else if (e.state === 'attack' && boar) {
      // 突進: 判定のあいだ（startup + active）は全力で脚を回して前傾し、そのあとの硬直で息を切らして収まる
      const dash = atk.startupFrames + atk.activeFrames;
      const settle = clamp((e.stateFrame - dash) / 28, 0, 1);
      swing = e.stateFrame <= dash ? 1 : 1 - easeOutCubic(settle);
      danger = 0.4 * (1 - clamp(e.stateFrame / dash, 0, 1));
      pitch = 0.1 * swing + 0.035 * Math.sin(e.stateFrame * 0.5) * settle * (1 - settle * 0.5);
      crouch = 0.04 + 0.05 * settle * (1 - settle);
    } else if (e.state === 'attack' && bat) {
      // 急降下: 判定のあいだ（startup + active）は鼻先を下げて翼をたたみ、そのあとの硬直で体を起こして羽ばたきに戻る
      const dive = atk.startupFrames + atk.activeFrames;
      const back = clamp((e.stateFrame - dive) / atk.recoverFrames, 0, 1);
      swing = e.stateFrame <= dive ? 1 : 1 - easeOutCubic(back);
      danger = 0.35 * (1 - clamp(e.stateFrame / dive, 0, 1));
      pitch = 0.75 * swing;
    } else if (e.state === 'attack' && lantern) {
      // 撃った反動: 前へのめって（pitch）縮み、硬直のあいだにゆっくり戻る。撃った瞬間は紫に光る
      const back = clamp((e.stateFrame - atk.startupFrames - atk.activeFrames) / atk.recoverFrames, 0, 1);
      swing = 1 - easeOutCubic(back);
      danger = 0.45 * (1 - clamp(e.stateFrame / 12, 0, 1));
      pitch = 0.34 * swing;
      crouch = 0.08 * swing;
    } else if (e.state === 'attack') {
      const swingEnd = atk.startupFrames + 1;
      const t = clamp(e.stateFrame / swingEnd, 0, 1);
      const back = clamp((e.stateFrame - atk.startupFrames - atk.activeFrames) / atk.recoverFrames, 0, 1);
      swing = t * (1 - easeOutCubic(back));
      raise = (1 - t) * (1 - easeOutCubic(back));
      danger = 0.4 * (1 - t);
      pitch = 0.45 * swing;
      crouch = 0.05 * (1 - back);
    } else if (e.state === 'stagger') {
      // 弾かれた直後に一気にのけぞって腕が跳ね上がり（6f）、ふらつきながら保ち、最後の 14f で立て直す
      const into = clamp(e.stateFrame / 6, 0, 1);
      const out = clamp((e.stateFrame - (e.parryEffect.frames - 14)) / 14, 0, 1);
      stagger = easeOutCubic(into) * (1 - out);
      if (ogre) {
        // 体勢崩し（岩鬼）: 弾かれたのけぞりではなく、膝をついて前へうなだれ、金棒を落としかける
        raise = 0;
        pitch = 0.3 * stagger;
        crouch = 0.2 * stagger;
        wobble = Math.sin(e.stateFrame * 0.2) * 0.05 * stagger;
      } else {
        raise = stagger * 0.95;
        pitch = (boar ? -0.32 : -0.5) * stagger;
        crouch = -0.04 * stagger; // 伸び上がる
        wobble = Math.sin(e.stateFrame * 0.32) * 0.14 * stagger;
      }
    } else if (e.state === 'down') {
      // 大剣に弾き飛ばされて後ろへ倒れ（14f）、腕を投げ出して寝たまま動けず、最後の 26f で起き上がる
      const fall = easeOutCubic(clamp(e.stateFrame / 14, 0, 1));
      const up = clamp((e.stateFrame - (e.parryEffect.frames - 26)) / 26, 0, 1);
      fallen = fall * (1 - up * up * (3 - 2 * up));
      stagger = fall * (1 - up);
      raise = fallen * 0.6;
      // 子鬼は仰向けに倒れ、四足の猪は横倒しになる（wobble = 前後軸まわりの傾きに足す）
      if (boar) wobble += BOAR_ROLL * fallen;
      else pitch = -FALL_PITCH * fallen;
    }

    // 白（被弾）が強いあいだは白、そうでなければ赤（予備動作）。崩れているあいだは水色が脈打つ（反撃のチャンスの合図）
    const white = this.flash * 0.7;
    const red = Math.max(0, danger);
    const blue = stagger > 0 ? stagger * (0.4 + 0.2 * Math.sin(e.stateFrame * 0.55)) : 0;
    // 岩鬼は体が大きく、全身が発光で塗りつぶされると鎧と肌が読めなくなるので、予備動作・崩れの発光は控えめにする
    if (blue > white && blue > red) this.setGlow(blue * (ogre ? 0.45 : 1), STAGGER);
    else if (white >= red) this.setGlow(white * (ogre ? 0.7 : 1));
    else this.setGlow(red * (lantern ? 0.45 : ogre ? 0.3 : 0.8), lantern ? LANTERN_WINDUP : atk.unblockable ? UNBLOCKABLE_WINDUP : DANGER);
    // 岩鬼の割れ目: 体勢が減るほど明るい（満タンはほぼ消えた暗い橙。崩れると白熱して脈打つ）
    if (this.crackMat) {
      const hot = e.poise ? 1 - e.poise.ratio : 0;
      const pulse = e.state === 'stagger' ? 0.15 * Math.sin(e.stateFrame * 0.5) : 0;
      this.crackMat.color.setHex(OGRE_COLORS.crackDim).lerp(_crackHot.setHex(OGRE_COLORS.crackHot), clamp(hot + pulse, 0, 1));
    }

    // 待機のゆらぎ（上下・腕）と、腕の姿勢
    // 提灯は宙に浮いているので、ゆったり大きく上下する
    const bob = bat ? Math.sin(this.idleTime * 5) * 0.06 + Math.sin(this.idleTime * 8.3) * 0.03 : lantern ? Math.sin(this.idleTime * 2.4) * 0.06 : Math.sin(this.idleTime * 3.2) * 0.025 * (1 - raise) * (1 - fallen);
    const sway = 1 - Math.max(raise, swing);
    const armBase = 0.28 + Math.sin(this.idleTime * 3.2) * 0.05 * sway;
    if (boar) {
      // 脚: 予備動作は前脚を交互に持ち上げて地面を掻く、突進は 4 本を回す（対角が同じ向き）、弾かれ・倒れでは前脚を蹴り上げる
      const [fl, fr, bl, br] = this.legs;
      const phase = e.state === 'attack' ? e.stateFrame * 0.85 : this.idleTime * 6;
      const gallop = swing * Math.sin(phase) * 0.95;
      const paw = e.state === 'windup' ? 0.5 + 0.5 * Math.sin(e.stateFrame * 0.5) : 1;
      const pawR = e.state === 'windup' ? 0.5 + 0.5 * Math.sin(e.stateFrame * 0.5 + Math.PI) : 1;
      fl!.rotation.x = -raise * 0.9 * paw + gallop;
      fr!.rotation.x = -raise * 0.9 * pawR - gallop;
      bl!.rotation.x = -gallop * 0.9 + raise * 0.15;
      br!.rotation.x = gallop * 0.9 + raise * 0.15;
    } else if (bat) {
      // 羽ばたき: 普段は大きく上下に（14 rad/s）、予備動作は高く広げて小刻みに、急降下ではたたむ。弾かれて動けないあいだは力なく垂れる
      const t = this.idleTime;
      let flap = 0.1 + Math.sin(t * 14) * 0.75;
      if (e.state === 'windup') flap = 0.95 + Math.sin(t * 30) * 0.12;
      else if (e.state === 'attack') flap = lerp(0.1 + Math.sin(t * 14) * 0.75, -0.55, swing);
      else if (e.state === 'stagger' || e.state === 'down') flap = -0.5 + Math.sin(t * 6) * 0.1;
      else if (dead) flap = -0.7;
      this.armL.rotation.z = -flap;
      this.armR.rotation.z = flap;
    } else if (lantern) {
      // 房は体の動きに遅れて揺れる（下がるとき・撃った反動で振れる）
      this.tassel.rotation.set(Math.sin(this.idleTime * 3.1) * 0.18 - pitch * 0.9, 0, Math.sin(this.idleTime * 2.3) * 0.2);
    } else if (ogre) {
      // 金棒を頭上へ（腕を前から真上へ回す）→ 真下へ叩きつける。下ろすときは少し開く
      const armX = -0.1 - raise * 2.8 - swing * 0.27;
      const open = armBase * (1 - Math.max(raise, swing)) + 0.2 * raise;
      this.armL.rotation.set(armX, 0, -open);
      this.armR.rotation.set(armX, 0, open);
    } else {
      const spread = lerp(armBase, 2.55, raise);
      const spreadSwing = lerp(spread, 0.3, swing);
      this.armL.rotation.set(-swing * 1.5, 0, -spreadSwing);
      this.armR.rotation.set(-swing * 1.5, 0, spreadSwing);
    }

    // つぶれ（被弾直後に縦に縮んで横に広がり、戻る）と、しゃがみ
    const sq = this.squash * this.squash * (ogre ? 0.07 : 0.22) + crouch * 0.5;
    this.pivot.scale.set(1 + sq, 1 - sq * 1.1, 1 + sq + (boar ? 0.06 * swing : 0));

    // のけぞり（攻撃の向きへ頭が傾く）。死亡では倒れる。予備動作・攻撃の前後の傾きは別に掛ける
    // 倒れているあいだは被弾でのけぞらない（寝たまま、揺れとフラッシュだけ）
    let tilt = this.lean * (e.state === 'down' || ogre ? 0.08 : 0.4);
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
    if (wobble !== 0) {
      _q.setFromAxisAngle(AXIS_Z, wobble);
      this.pivot.quaternion.multiply(_q);
    }
    this.pivot.scale.multiplyScalar(shrink);

    // 揺れ（実時間で減衰する小さな振動）
    let sx = 0;
    let sz = 0;
    if (this.shake > 0) {
      const amp = this.shake * this.shake * (ogre ? 0.03 : 0.07);
      sx = Math.sin(this.shakeSeed + this.shake * 90) * amp;
      sz = Math.cos(this.shakeSeed * 1.7 + this.shake * 77) * amp;
    }
    // 倒れたとき、足元を軸に回すと胴が地面にめり込むので、胴の太さのぶん持ち上げる
    if (lantern || bat) {
      // 体の中心（pivot の原点）を高さ（提灯 LANTERN_Y・小蝙蝠 BAT_Y）に置く。倒れたら（死亡）真下へ落ちて、胴の半径ぶんの高さで横たわる
      const cy = lantern ? LANTERN_Y : BAT_Y;
      const cr = lantern ? LANTERN_R : BAT_R;
      let drop = 0;
      if (dead) {
        const t = clamp(e.stateFrame / (lantern ? 16 : 12), 0, 1);
        drop = t * t * (cy - cr);
      }
      this.pivot.position.set(sx, cy + bob - drop - sink, sz);
    } else if (boar) {
      // 横倒しになると、胴の中心が足元を軸に横へ回るので、体の下に戻し、胴の半径ぶん持ち上げる
      const roll = BOAR_ROLL * fallen;
      this.pivot.position.set(sx + BOAR_BODY_Y * Math.sin(roll), bob - sink + fallen * (BOAR_BODY_R - BOAR_BODY_Y * Math.cos(BOAR_ROLL)), sz);
    } else {
      // 岩鬼は胴が太いので、倒れる（死亡）とき地面にめり込まないよう、倒れるのに合わせて持ち上げる
      const lift = ogre ? OGRE_FALL_LIFT * clamp(dead ? e.stateFrame / 22 : 0, 0, 1) : FALL_LIFT * fallen;
      this.pivot.position.set(sx, bob - sink + lift, sz);
    }

    // 溜めている鬼火（提灯の予備動作〜撃つ瞬間）。撃つ位置（銃口）に、小さく生まれて膨らみ、ちらつく
    if (this.charge) {
      const proj = atk.projectile ? PROJECTILES[atk.projectile] : null;
      const charging = !dead && proj !== null && (e.state === 'windup' || (e.state === 'attack' && e.stateFrame <= atk.startupFrames + 1));
      this.charge.visible = charging;
      if (charging && proj) {
        const w = e.state === 'windup' ? clamp(e.stateFrame / atk.windupFrames, 0, 1) : 1;
        const s = (0.12 + 0.88 * easeOutCubic(w)) * (1 + 0.1 * Math.sin(e.stateFrame * 0.9));
        this.charge.scale.setScalar(s);
        this.charge.position.set(0, PROJECTILE_HEIGHT + bob * 0.6, proj.muzzle);
      }
    }
  }
}
