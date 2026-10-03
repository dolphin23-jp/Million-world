import * as THREE from 'three';
import { polarToVector, swordRotation, vectorToPolar } from './ik';
import { PoseSolver, createPoseOutput, type FootTarget, type PoseInput } from './pose-solver';
import { BONE, Rig, type ExtraBone } from './rig';

/**
 * 手付けアニメ（キーフレーム → IK → AnimationClip）。
 *
 * 攻撃のポーズを「どこに剣があり、体がどう向き、足がどこにあるか」で書き、pose-solver.ts が腕脚の IK で関節に直し、
 * 60fps で焼いて AnimationClip にする。Meshy のモーション（全身が振り回される・つなぎ目でポーズが跳ぶ）の代わり。
 * データは src/character/data/*.ts に置く。
 *
 * 単位: 角度は度、位置はメートル。チャンネルごとに独立したキー列を持ち（キーに書いたものだけが動く）、
 * 最初のキーが t>0 なら t=0 に idle の値を補う。'idle' と書けば idle のポーズの値になる。
 * 区間のイージングは「そのキーへ向かう区間」に掛かる。
 */

export type Vec3Tuple = [number, number, number];
export type Ease = 'lin' | 'in' | 'in3' | 'out' | 'out3' | 'io' | 'io3';

type Maybe<T> = Partial<T>;
interface Angles {
  yaw: number;
  pitch: number;
  roll: number;
}
interface FootKey extends FootTarget {
  /** この区間で足を弧状に持ち上げる高さ（m）。歩幅のある踏み出しに使う */
  arc: number;
}

export interface AuthoredKey {
  t: number;
  ease?: Ease;
  /** ルート（キャラの原点）の前進量の累計（m）。sim の移動もこれに従う */
  rootZ?: number;
  hips?: Maybe<Angles & { x: number; y: number; z: number }>;
  chest?: Maybe<Angles>;
  head?: Maybe<Angles>;
  /** [方位°, 仰角°, 距離 m]。右肩から柄まで、胸の座標系。方位は正面から右へ、仰角は水平から上へ */
  grip?: [number, number, number] | 'idle';
  /** 刃の向きと刃の面の法線のヒント（胸の座標系。右 = −X、上 = +Y、前 = +Z） */
  blade?: Vec3Tuple | 'idle';
  face?: Vec3Tuple | 'idle';
  /**
   * face を blade の軸まわりに回す角（度）。face にベクトルを書いたキーだけで有効。
   * 刃の向きと「面の法線」（斬りの面に垂直）を決めたまま、手首のねじれを調整するための値。
   * 面の法線から外すほど、刃が面に対して斜めに当たる（横腹で叩く）ので、±35° 程度までに収める
   */
  roll?: number;
  /** 右肘が向かう方向（胸の座標系） */
  pole?: Vec3Tuple | 'idle';
  /** 左手首: [方位°, 仰角°, 距離 m]（左肩から、胸の座標系） */
  left?: [number, number, number] | 'idle';
  leftPole?: Vec3Tuple | 'idle';
  footL?: Maybe<FootKey>;
  footR?: Maybe<FootKey>;
}

/**
 * 両手持ち（大剣。ADR-021）: 左手は右手の握り（grip = 柄の中心）から、柄の石突きの側へ offset（m）離れた位置を握る。
 * 左手首の目標を、右手の握りと剣の向き（blade）から毎フレーム導く（手付けの `left` は使わない。`leftPole` = 左肘の向きは使える）。
 * 両手が柄に付くので、剣は胸の前から大きく外せない（体のひねり = 腰・胸のヨーで振る）。届かない（腕が伸び切る）姿勢は左腕のクランプとして数に出る。
 */
export interface TwoHand {
  offset: number;
}

/** 両手持ちのとき、手付けが左肘の向きを書かなければ使う既定（肘は外・下へ） */
export const TWO_HAND_POLE: Vec3Tuple = [0.6, -0.8, 0.05];

export interface AuthoredAttack {
  name: string;
  /** 秒 */
  duration: number;
  keys: AuthoredKey[];
  /** 両手持ち。あれば左手が柄を握る（TwoHand）。クリップごとに決めるが、焼くときの指定（SamplerOptions.twoHanded）でも与えられる */
  twoHanded?: TwoHand;
  /**
   * 別の手付け攻撃の途中の姿勢から始める（コンボの連鎖用）。
   * t=0 のポーズ（体幹・剣・両手・足の位置・高さ）が attack の時刻 t のポーズにぴったり一致するので、前の技の受付時点からつなぎ目で姿勢が跳ばない。
   * チャンネルのキーが無いものは、idle ではなくこの姿勢のまま保たれる（'idle' と書けば本当の idle）。
   * 座標の原点はこの攻撃の開始時のルートに付け替わる: rootZ は 0 から、足の z は「前の技の足の位置 − 前の技のルートの前進量」から始まる
   * （＝世界での足の位置は変わらない）。rootZCurve は前の技に依存せず 0 から数える
   */
  continueFrom?: { attack: AuthoredAttack; t: number };
}

const EASE: Record<Ease, (u: number) => number> = {
  lin: (u) => u,
  in: (u) => u * u,
  in3: (u) => u * u * u,
  out: (u) => 1 - (1 - u) * (1 - u),
  out3: (u) => 1 - (1 - u) ** 3,
  io: (u) => u * u * (3 - 2 * u),
  io3: (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2),
};

const DEG = Math.PI / 180;

interface Seg {
  t: number;
  v: number;
  ease: Ease;
  arc: number;
}

/** チャンネル名 → キー列 */
type Timelines = Map<string, Seg[]>;

function add(tl: Timelines, ch: string, t: number, v: number, ease: Ease, arc = 0): void {
  let a = tl.get(ch);
  if (!a) tl.set(ch, (a = []));
  a.push({ t, v, ease, arc });
}

/** 'idle' を解決した、各チャンネルの idle 値 */
export function idleChannels(rig: Rig): Map<string, number> {
  const d = idleInput(rig);
  const m = new Map<string, number>();
  const put = (k: string, v: number) => m.set(k, v);
  put('rootZ', 0);
  for (const g of ['hips', 'chest', 'head'] as const) for (const a of ['yaw', 'pitch', 'roll'] as const) put(`${g}.${a}`, 0);
  put('hips.x', 0);
  put('hips.y', 0);
  put('hips.z', 0);
  // 角度はタイムライン内ではラジアンで持つ（キーに書く数値は度）
  put('grip.az', d.grip.az);
  put('grip.el', d.grip.el);
  put('grip.r', d.grip.r);
  put('left.az', d.left.az);
  put('left.el', d.left.el);
  put('left.r', d.left.r);
  for (const f of ['footL', 'footR'] as const) for (const a of ['x', 'z', 'lift', 'yaw', 'pitch', 'rel', 'lx', 'ly', 'lz', 'knee'] as const) put(`${f}.${a}`, 0);
  vec(m, 'pole', d.pole);
  vec(m, 'leftPole', d.leftPole);
  const q = swordRotation(d.blade, d.face, new THREE.Quaternion());
  m.set('sword.x', q.x);
  m.set('sword.y', q.y);
  m.set('sword.z', q.z);
  m.set('sword.w', q.w);
  return m;
}
function vec(m: Map<string, number>, k: string, v: THREE.Vector3): void {
  m.set(`${k}.x`, v.x);
  m.set(`${k}.y`, v.y);
  m.set(`${k}.z`, v.z);
}

/** idle の t=0 のポーズを、PoseInput（差分ゼロ + 剣・手の値）で表す */
export function idleInput(rig: Rig): PoseInput {
  const ix = (n: string) => rig.mustIndex(n);
  const S = rig.idleWorldP[ix(BONE.armR)]!;
  const handQ = rig.idleWorldQ[ix(BONE.handR)]!;
  const G = rig.data.grip.pos.clone().applyQuaternion(handQ).add(rig.idleWorldP[ix(BONE.handR)]!);
  const gp = vectorToPolar(G.clone().sub(S));
  const swordQ = handQ.clone().multiply(rig.data.grip.quat);
  const elbowPole = (arm: string, fore: string, hand: string, fallback: THREE.Vector3): THREE.Vector3 => {
    const s = rig.idleWorldP[ix(arm)]!;
    const e = rig.idleWorldP[ix(fore)]!;
    const w = rig.idleWorldP[ix(hand)]!;
    const d = w.clone().sub(s).normalize();
    const p = e.clone().sub(s);
    p.addScaledVector(d, -p.dot(d));
    return p.lengthSq() > 1e-6 ? p.normalize() : fallback.clone();
  };
  const SL = rig.idleWorldP[ix(BONE.armL)]!;
  const lp = vectorToPolar(rig.idleWorldP[ix(BONE.handL)]!.clone().sub(SL));
  const zero = (): Angles => ({ yaw: 0, pitch: 0, roll: 0 });
  const foot = (): FootTarget => ({ x: 0, z: 0, lift: 0, yaw: 0, pitch: 0, rel: 0, lx: 0, ly: 0, lz: 0, knee: 0 });
  return {
    rootZ: 0,
    hips: { ...zero(), x: 0, y: 0, z: 0 },
    chest: zero(),
    head: zero(),
    grip: gp,
    blade: new THREE.Vector3(0, 1, 0).applyQuaternion(swordQ),
    face: new THREE.Vector3(0, 0, 1).applyQuaternion(swordQ),
    pole: elbowPole(BONE.armR, BONE.foreR, BONE.handR, new THREE.Vector3(-1, -1, 0)),
    left: lp,
    leftPole: elbowPole(BONE.armL, BONE.foreL, BONE.handL, new THREE.Vector3(1, -1, 0)),
    footL: foot(),
    footR: foot(),
  };
}

/**
 * 左腕を固定して焼く指定（盾を持つ側。ADR-020）。盾を構えたまま攻撃・回避するので、手付けの左手・左肘のキーは使わず、
 * 全時刻でこの位置に保つ（値の意味は AuthoredKey.left / leftPole と同じ。角度は度）
 */
export interface LeftHold {
  left: [number, number, number];
  leftPole: Vec3Tuple;
}

export interface SamplerOptions {
  leftHold?: LeftHold;
  /** 両手持ちにして焼く（片手剣のクリップを大剣の両手持ちの版として焼き直す。例: ロール）。クリップ自身の twoHanded より優先 */
  twoHanded?: TwoHand;
}

/**
 * キー列をチャンネルごとのタイムラインに展開する。
 * idle は 'idle' と書かれた値の解決用、base は t=0 のパディングと「キーが無いチャンネル」の値（通常は idle、continueFrom なら前の技の姿勢）
 */
function expand(def: AuthoredAttack, idle: Map<string, number>, base: Map<string, number>, skip: { left: boolean; pole: boolean } = { left: false, pole: false }): Timelines {
  const tl: Timelines = new Map();
  const keys = [...def.keys].sort((a, b) => a.t - b.t);
  const swordPrev = { q: new THREE.Quaternion(base.get('sword.x'), base.get('sword.y'), base.get('sword.z'), base.get('sword.w')) };
  for (const k of keys) {
    const ease = k.ease ?? 'io';
    if (k.rootZ !== undefined) add(tl, 'rootZ', k.t, k.rootZ, ease);
    const grp = (g: 'hips' | 'chest' | 'head', o: Record<string, number | undefined> | undefined, deg: string[]): void => {
      if (!o) return;
      for (const [a, v] of Object.entries(o)) if (v !== undefined) add(tl, `${g}.${a}`, k.t, deg.includes(a) ? v * DEG : v, ease);
    };
    grp('hips', k.hips, ['yaw', 'pitch', 'roll']);
    grp('chest', k.chest, ['yaw', 'pitch', 'roll']);
    grp('head', k.head, ['yaw', 'pitch', 'roll']);
    const polar = (g: 'grip' | 'left', v: [number, number, number] | 'idle' | undefined): void => {
      if (v === undefined) return;
      const [az, el, r] =
        v === 'idle' ? [idle.get(`${g}.az`)!, idle.get(`${g}.el`)!, idle.get(`${g}.r`)!] : ([v[0] * DEG, v[1] * DEG, v[2]] as Vec3Tuple);
      add(tl, `${g}.az`, k.t, az, ease);
      add(tl, `${g}.el`, k.t, el, ease);
      add(tl, `${g}.r`, k.t, r, ease);
    };
    polar('grip', k.grip);
    if (!skip.left) polar('left', k.left);
    const vec3 = (ch: 'pole' | 'leftPole', v: Vec3Tuple | 'idle' | undefined): void => {
      if (v === undefined) return;
      const t3: Vec3Tuple = v === 'idle' ? [idle.get(`${ch}.x`)!, idle.get(`${ch}.y`)!, idle.get(`${ch}.z`)!] : v;
      add(tl, `${ch}.x`, k.t, t3[0], ease);
      add(tl, `${ch}.y`, k.t, t3[1], ease);
      add(tl, `${ch}.z`, k.t, t3[2], ease);
    };
    vec3('pole', k.pole);
    if (!skip.pole) vec3('leftPole', k.leftPole);
    if (k.blade !== undefined || k.face !== undefined) {
      const bl = k.blade === 'idle' || k.blade === undefined ? null : k.blade;
      const fc = k.face === 'idle' || k.face === undefined ? null : k.face;
      const idleQ = new THREE.Quaternion(idle.get('sword.x'), idle.get('sword.y'), idle.get('sword.z'), idle.get('sword.w'));
      // 'idle' を書いたら idle の値。blade だけ 'idle' と書いて face を省いたときも、剣ごと idle に戻す意味にする
      // （前のキーの面の向きを引きずると、握りが idle と違う角度になって手首の目標がずれる）
      const bladeIdle = k.blade === 'idle';
      const faceIdle = k.face === 'idle' || (bladeIdle && k.face === undefined);
      const bladeV = bl ? new THREE.Vector3(...bl) : new THREE.Vector3(0, 1, 0).applyQuaternion(bladeIdle ? idleQ : swordPrev.q);
      const faceV = fc ? new THREE.Vector3(...fc) : new THREE.Vector3(0, 0, 1).applyQuaternion(faceIdle ? idleQ : swordPrev.q);
      if (k.roll) {
        if (!fc) throw new Error(`authoring: roll は face にベクトルを書いたキーでだけ使えます (${def.name} t=${k.t})`);
        faceV.applyAxisAngle(bladeV.clone().normalize(), k.roll * DEG);
      }
      const q = swordRotation(bladeV, faceV, new THREE.Quaternion());
      // 前のキーとの符号を合わせて最短経路にする
      if (q.dot(swordPrev.q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      swordPrev.q.copy(q);
      add(tl, 'sword.x', k.t, q.x, ease);
      add(tl, 'sword.y', k.t, q.y, ease);
      add(tl, 'sword.z', k.t, q.z, ease);
      add(tl, 'sword.w', k.t, q.w, ease);
    }
    for (const f of ['footL', 'footR'] as const) {
      const o = k[f];
      if (!o) continue;
      for (const [a, v] of Object.entries(o)) {
        if (v === undefined || a === 'arc') continue;
        add(tl, `${f}.${a}`, k.t, a === 'yaw' || a === 'pitch' ? v * DEG : v, ease, a === 'z' ? (o.arc ?? 0) : 0);
      }
      // arc は x/z の移動区間に掛ける。z キーが無い（x だけ動く）足には lift 用に別チャンネルで持つ
      if (o.arc !== undefined && o.z === undefined) add(tl, `${f}.z`, k.t, Number.NaN, ease, o.arc);
    }
  }
  // t=0 に idle を補い、NaN（arc だけのキー）は前の値で埋める
  for (const [ch, segs] of tl) {
    segs.sort((a, b) => a.t - b.t);
    const b0 = base.get(ch) ?? 0;
    if (segs[0]!.t > 1e-9) segs.unshift({ t: 0, v: b0, ease: 'lin', arc: 0 });
    for (let i = 0; i < segs.length; i++) {
      if (Number.isNaN(segs[i]!.v)) segs[i]!.v = i > 0 ? segs[i - 1]!.v : b0;
    }
  }
  return tl;
}

export class AuthoredSampler {
  private readonly idle: Map<string, number>;
  /** t=0 の値（通常は idle、continueFrom なら前の技の姿勢）。キーが無いチャンネルはこの値のまま */
  private readonly start: Map<string, number>;
  private readonly tl: Timelines;
  private readonly idlePose: PoseInput;
  /** 両手持ち（左手が柄を握る）の指定。なければ左手は手付けのキー（または leftHold）に従う */
  private readonly twoHand: TwoHand | undefined;
  /** 右肩 − 左肩（胸の座標系。右手の握りの位置を左肩基準へ直すのに使う） */
  private readonly shoulderDelta = new THREE.Vector3();

  constructor(readonly rig: Rig, readonly def: AuthoredAttack, readonly opts: SamplerOptions = {}) {
    this.idle = idleChannels(rig);
    this.idlePose = idleInput(rig);
    this.twoHand = opts.twoHanded ?? def.twoHanded;
    this.shoulderDelta.copy(rig.idleWorldP[rig.mustIndex(BONE.armR)]!).sub(rig.idleWorldP[rig.mustIndex(BONE.armL)]!);
    const hold = opts.leftHold;
    let start: Map<string, number>;
    if (def.continueFrom) {
      // 前の技も同じ指定で作る（つなぎ目の姿勢が一致するように）。指定がなければ前の技自身の両手持ちを使う
      const prev = def.continueFrom.attack;
      const prevHand = opts.twoHanded ?? prev.twoHanded;
      const prevOpts: SamplerOptions = { ...opts, ...(prevHand ? { twoHanded: prevHand } : {}) };
      start = new AuthoredSampler(rig, prev, prevOpts).snapshot(def.continueFrom.t);
    } else {
      start = new Map(this.idle);
      if (hold) holdLeft(start, hold);
      if (this.twoHand) {
        start.set('leftPole.x', TWO_HAND_POLE[0]);
        start.set('leftPole.y', TWO_HAND_POLE[1]);
        start.set('leftPole.z', TWO_HAND_POLE[2]);
      }
    }
    this.start = start;
    // 左腕を固定するとき（leftHold）は左手・左肘のキーを、両手持ちのときは左手のキー（手首は導く）を使わない。
    // キーを作らないチャンネルは value() が start の値を返し続ける
    this.tl = expand(def, this.idle, this.start, { left: hold !== undefined || this.twoHand !== undefined, pole: hold !== undefined });
  }

  /**
   * 時刻 t の全チャンネルの値。continueFrom の起点に使う。
   * ルートの前進量は 0 に、足の z はその分を引いて渡す（次の技の原点 = この時刻のルート）。足の弧の持ち上げは lift に含める
   */
  private snapshot(t: number): Map<string, number> {
    const m = new Map<string, number>();
    for (const ch of this.idle.keys()) m.set(ch, ANGLE_CHANNEL.test(ch) ? wrapRad(this.value(ch, t)) : this.value(ch, t));
    this.swordQuat(t, _q);
    m.set('sword.x', _q.x);
    m.set('sword.y', _q.y);
    m.set('sword.z', _q.z);
    m.set('sword.w', _q.w);
    if (this.twoHand) {
      // 両手持ちの左手は導いた値（キーのチャンネルではない）。次の技が片手でも、この姿勢から続く
      const p = this.sample(t, this.newInput());
      m.set('left.az', p.left.az);
      m.set('left.el', p.left.el);
      m.set('left.r', p.left.r);
    }
    const r0 = this.value('rootZ', t);
    m.set('rootZ', 0);
    for (const f of ['footL', 'footR'] as const) {
      m.set(`${f}.z`, m.get(`${f}.z`)! - r0);
      m.set(`${f}.lift`, m.get(`${f}.lift`)! + this.arcLift(f, t));
    }
    return m;
  }

  /** チャンネル ch の時刻 t の値（キーが無ければ t=0 の値） */
  private value(ch: string, t: number): number {
    const segs = this.tl.get(ch);
    if (!segs) return this.start.get(ch) ?? 0;
    if (t <= segs[0]!.t) return segs[0]!.v;
    const last = segs[segs.length - 1]!;
    if (t >= last.t) return last.v;
    let i = 1;
    while (i < segs.length && segs[i]!.t < t) i++;
    const a = segs[i - 1]!;
    const b = segs[i]!;
    const u = (t - a.t) / (b.t - a.t);
    return a.v + (b.v - a.v) * EASE[b.ease](u);
  }

  /** 足の弧（x/z チャンネルの区間に付けた arc）の持ち上げ量 */
  private arcLift(foot: 'footL' | 'footR', t: number): number {
    let lift = 0;
    for (const a of ['x', 'z'] as const) {
      const segs = this.tl.get(`${foot}.${a}`);
      if (!segs) continue;
      for (let i = 1; i < segs.length; i++) {
        const s = segs[i]!;
        if (s.arc > 0 && t > segs[i - 1]!.t && t < s.t) {
          const u = (t - segs[i - 1]!.t) / (s.t - segs[i - 1]!.t);
          lift = Math.max(lift, s.arc * Math.sin(Math.PI * EASE[s.ease](u)));
        }
      }
    }
    return lift;
  }

  rootZ(t: number): number {
    return this.value('rootZ', t);
  }

  /** 剣の回転。キー間は slerp（成分ごとの線形補間だと角速度が不均一になる） */
  private swordQuat(t: number, out: THREE.Quaternion): THREE.Quaternion {
    const segs = this.tl.get('sword.x');
    if (!segs) return out.set(this.start.get('sword.x')!, this.start.get('sword.y')!, this.start.get('sword.z')!, this.start.get('sword.w')!);
    const comp = (i: number, c: 'x' | 'y' | 'z' | 'w'): number => this.tl.get(`sword.${c}`)![i]!.v;
    const at = (i: number, q: THREE.Quaternion): THREE.Quaternion => q.set(comp(i, 'x'), comp(i, 'y'), comp(i, 'z'), comp(i, 'w'));
    const last = segs.length - 1;
    if (t <= segs[0]!.t) return at(0, out);
    if (t >= segs[last]!.t) return at(last, out);
    let i = 1;
    while (i < segs.length && segs[i]!.t < t) i++;
    const a = segs[i - 1]!;
    const b = segs[i]!;
    const u = EASE[b.ease]((t - a.t) / (b.t - a.t));
    return at(i - 1, out).slerp(at(i, _qb), u);
  }

  /** 時刻 t の PoseInput を out に書く */
  sample(t: number, out: PoseInput): PoseInput {
    const v = (ch: string) => this.value(ch, t);
    out.rootZ = v('rootZ');
    for (const g of ['hips', 'chest', 'head'] as const) {
      out[g].yaw = v(`${g}.yaw`);
      out[g].pitch = v(`${g}.pitch`);
      out[g].roll = v(`${g}.roll`);
    }
    out.hips.x = v('hips.x');
    out.hips.y = v('hips.y');
    out.hips.z = v('hips.z');
    out.grip.az = v('grip.az');
    out.grip.el = v('grip.el');
    out.grip.r = v('grip.r');
    out.left.az = v('left.az');
    out.left.el = v('left.el');
    out.left.r = v('left.r');
    out.pole.set(v('pole.x'), v('pole.y'), v('pole.z'));
    out.leftPole.set(v('leftPole.x'), v('leftPole.y'), v('leftPole.z'));
    this.swordQuat(t, _q);
    out.blade.set(0, 1, 0).applyQuaternion(_q);
    out.face.set(0, 0, 1).applyQuaternion(_q);
    if (this.twoHand) {
      // 左手首 = 右手の握りの位置（右肩から → 左肩から）+ 石突き側（−刃の向き）へ offset。極座標（左肩基準）に直して渡す
      polarToVector(out.grip.az, out.grip.el, out.grip.r, _lv).add(this.shoulderDelta).addScaledVector(out.blade, -this.twoHand.offset);
      const lp = vectorToPolar(_lv);
      out.left.az = lp.az;
      out.left.el = lp.el;
      out.left.r = lp.r;
    }
    for (const f of ['footL', 'footR'] as const) {
      const o = out[f];
      o.x = v(`${f}.x`);
      o.z = v(`${f}.z`);
      o.lift = v(`${f}.lift`) + this.arcLift(f, t);
      o.yaw = v(`${f}.yaw`);
      o.pitch = v(`${f}.pitch`);
      o.rel = v(`${f}.rel`);
      o.lx = v(`${f}.lx`);
      o.ly = v(`${f}.ly`);
      o.lz = v(`${f}.lz`);
      o.knee = v(`${f}.knee`);
    }
    return out;
  }

  newInput(): PoseInput {
    const b = this.idlePose;
    return {
      rootZ: 0,
      hips: { ...b.hips },
      chest: { ...b.chest },
      head: { ...b.head },
      grip: { ...b.grip },
      blade: b.blade.clone(),
      face: b.face.clone(),
      pole: b.pole.clone(),
      left: { ...b.left },
      leftPole: b.leftPole.clone(),
      footL: { ...b.footL },
      footR: { ...b.footR },
    };
  }
}
const _q = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _lv = new THREE.Vector3();

/** チャンネル値の表 m の左手・左肘を、固定する位置に書き換える */
function holdLeft(m: Map<string, number>, h: LeftHold): void {
  m.set('left.az', h.left[0] * DEG);
  m.set('left.el', h.left[1] * DEG);
  m.set('left.r', h.left[2]);
  m.set('leftPole.x', h.leftPole[0]);
  m.set('leftPole.y', h.leftPole[1]);
  m.set('leftPole.z', h.leftPole[2]);
}

/**
 * 角度（ラジアン）のチャンネル。ロールのように 360° 回るクリップは終端が 372° などになるが、姿勢としては 12° と同じ。
 * continueFrom で次の技の起点にするとき、そのまま 372° を渡すと、次の技の 10° へ向かって逆に 1 回転してしまうので、±180° に折り返して渡す
 */
const ANGLE_CHANNEL = /^(hips|chest|head)\.(yaw|pitch|roll)$|^foot[LR]\.(yaw|pitch)$/;
function wrapRad(a: number): number {
  const t = Math.PI * 2;
  let r = a % t;
  if (r > Math.PI) r -= t;
  else if (r <= -Math.PI) r += t;
  return r;
}

/** 焼いたフレームごとの診断値（角度は度、長さは m） */
export interface FrameTrace {
  t: number;
  armElevation: number;
  elbowBend: number;
  wristBend: number;
  wristTwist: number;
  hipsDrop: number;
  gripError: number;
}

export interface BakeStats {
  frames: number;
  armRClampedFrames: number;
  armLClampedFrames: number;
  legClampedFrames: number;
  maxHipsDrop: number;
  maxGripError: number;
  /** 右上腕の最大挙上角（度）。130° 以下が目安 */
  maxArmElevationDeg: number;
  /** 右手首の最大の曲がり・ねじれ（度）と、右肘の最小の曲がり（度。0 に近いと伸び切り） */
  maxWristBendDeg: number;
  maxWristTwistDeg: number;
  minElbowBendDeg: number;
}

/** 手付けアニメを AnimationClip に焼く。トラックは全ボーンの quaternion と Hips の position（cm） */
export function bakeAttack(
  rig: Rig,
  def: AuthoredAttack,
  fps = 60,
  extras: readonly ExtraBone[] = [],
  opts: SamplerOptions & { /** クリップ名に付ける接尾辞（版を区別する。例: '@shield'） */ suffix?: string } = {},
): { clip: THREE.AnimationClip; stats: BakeStats; trace: FrameTrace[] } {
  const sampler = new AuthoredSampler(rig, def, opts);
  const solver = new PoseSolver(rig);
  const out = createPoseOutput(rig);
  const inp = sampler.newInput();
  const frames = Math.max(2, Math.round(def.duration * fps) + 1);
  const times = new Float32Array(frames);
  const qv = rig.names.map(() => new Float32Array(frames * 4));
  const hv = new Float32Array(frames * 3);
  const stats: BakeStats = { frames, armRClampedFrames: 0, armLClampedFrames: 0, legClampedFrames: 0, maxHipsDrop: 0, maxGripError: 0, maxArmElevationDeg: 0, maxWristBendDeg: 0, maxWristTwistDeg: 0, minElbowBendDeg: 180 };
  const prev = rig.names.map(() => new THREE.Quaternion());
  const trace: FrameTrace[] = [];
  for (let f = 0; f < frames; f++) {
    const t = Math.min(def.duration, f / fps);
    times[f] = t;
    sampler.sample(t, inp);
    solver.solve(inp, out);
    for (let i = 0; i < rig.names.length; i++) {
      const q = out.quats[i]!;
      // 前フレームと符号を揃える（補間が遠回りしない）
      if (f > 0 && q.dot(prev[i]!) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      prev[i]!.copy(q);
      qv[i]!.set([q.x, q.y, q.z, q.w], f * 4);
    }
    // Hips の position は資産の単位（GLB は cm。Armature が 0.01 倍のため）
    const inv = 1 / rig.unit;
    hv.set([out.hipsPos.x * inv, out.hipsPos.y * inv, out.hipsPos.z * inv], f * 3);
    if (out.info.armRClamped) stats.armRClampedFrames++;
    if (out.info.armLClamped) stats.armLClampedFrames++;
    if (out.info.legLClamped || out.info.legRClamped) stats.legClampedFrames++;
    stats.maxHipsDrop = Math.max(stats.maxHipsDrop, out.info.hipsDrop);
    stats.maxGripError = Math.max(stats.maxGripError, out.info.gripError);
    stats.maxArmElevationDeg = Math.max(stats.maxArmElevationDeg, out.info.armRElevation / DEG);
    stats.maxWristBendDeg = Math.max(stats.maxWristBendDeg, out.info.wristBend / DEG);
    stats.maxWristTwistDeg = Math.max(stats.maxWristTwistDeg, Math.abs(out.info.wristTwist) / DEG);
    stats.minElbowBendDeg = Math.min(stats.minElbowBendDeg, out.info.elbowBend / DEG);
    trace.push({
      t,
      armElevation: out.info.armRElevation / DEG,
      elbowBend: out.info.elbowBend / DEG,
      wristBend: out.info.wristBend / DEG,
      wristTwist: out.info.wristTwist / DEG,
      hipsDrop: out.info.hipsDrop,
      gripError: out.info.gripError,
    });
  }
  const tracks: THREE.KeyframeTrack[] = rig.names.map((n, i) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, qv[i]!));
  tracks.push(new THREE.VectorKeyframeTrack(`${BONE.hips}.position`, times, hv));
  // Rig 外の骨（head_end など）は idle の姿勢に固定。トラックが無いと、再生のたびに元の状態へ戻されて他のクリップと食い違う
  for (const e of extras) {
    const two = new Float32Array(8);
    for (let k = 0; k < 2; k++) two.set([e.quat.x, e.quat.y, e.quat.z, e.quat.w], k * 4);
    tracks.push(new THREE.QuaternionKeyframeTrack(`${e.name}.quaternion`, [0, def.duration], two));
  }
  return { clip: new THREE.AnimationClip(def.name + (opts.suffix ?? ''), def.duration, tracks), stats, trace };
}

/**
 * rootZ（ルートの前進量の累計 m）だけを取り出したカーブ。リグなしで評価できるので、sim（Player）が見た目と切り離して使う。
 * 最初のキーが t>0 なら 0 から始まる。キー以降は最後の値を保つ
 */
export function rootZCurve(def: AuthoredAttack): (t: number) => number {
  const ks = def.keys.filter((k) => k.rootZ !== undefined).sort((a, b) => a.t - b.t);
  const pts: Array<{ t: number; v: number; ease: Ease }> = ks.map((k) => ({ t: k.t, v: k.rootZ!, ease: k.ease ?? 'io' }));
  if (pts.length === 0 || pts[0]!.t > 1e-9) pts.unshift({ t: 0, v: 0, ease: 'lin' });
  return (t: number): number => {
    if (t <= pts[0]!.t) return pts[0]!.v;
    const last = pts[pts.length - 1]!;
    if (t >= last.t) return last.v;
    let i = 1;
    while (pts[i]!.t < t) i++;
    const a = pts[i - 1]!;
    const b = pts[i]!;
    return a.v + (b.v - a.v) * EASE[b.ease]((t - a.t) / (b.t - a.t));
  };
}
