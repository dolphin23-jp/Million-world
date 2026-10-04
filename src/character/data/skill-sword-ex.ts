import type { AuthoredAttack, AuthoredKey } from '../authoring';
import { LAND as HEAVY_LAND, TOP as HEAVY_TOP } from './heavy';
import { plane, planeL } from './cutting-plane';
import { GATHER as DASH_GATHER, RISE as DASH_RISE } from './dash';
import { OFFHAND } from './offhand';
import { QUAD3_FOLLOW, QUAD5_CHAMBER, QUAD5_THRUST, RETURN } from './skill-sword';
import { pose } from './stagger';
import { BACK_COIL, BACK_FOLLOW, BACK_PASS } from './sword-chain';
import { FOLLOW as SWEEP_FOLLOW, WINDUP as SWEEP_WINDUP } from './sweep';

/**
 * 片手剣の剣技（第 2 弾。ADR-038）の専用モーション。座標の約束は combo1.ts と同じ（胸の座標系。右 = −X、上 = +Y、前 = +Z）。
 * どの剣技も、仕様（Spec）から 1 本のクリップを作る生成関数にして、レベルで中身が伸びる（Lv1 / Lv4 / Lv7 の 3 本。ADR-034 と同じ約束）:
 *
 *  - 居合（IAI）: 納刀の構えで溜め（スーパーアーマー）→ 一瞬のダッシュ → 左から右への抜き打ち → 返しの斬り上げ（Lv4: + 袈裟 / Lv7: + 突き）。
 *  - 十字斬り（CROSS）: 縦の斬り下ろし → 横の薙ぎ → 交点に爆ぜる突き立て（衝撃の円）。Lv1 で 1 回、Lv4 で 2 回、Lv7 で 3 回の十字。
 *  - 疾風連斬（GALE）: 前へ駆けながら、横薙ぎを左右交互に切り返して斬り抜ける。4 → 6 → 8 太刀。
 * 姿勢の多くは既存の技（combo / sweep / heavy / dash / lunge ほか）の構えを使い回す（つなぎ目の姿勢が自然になる）。
 */

type V3 = [number, number, number];

// ================================================================= 足運びの道具

/** 1 歩ごとの指定: 踏み込む（足が着く）時刻 t と、その歩が落ち着いたときのルートの位置。踏み込む足は右・左・右…の交互 */
interface Beat {
  t: number;
  /** その歩が落ち着いたときのルートの前進量（m） */
  root: number;
  /** この歩の着地で、踏み込む足を置くルートからの前の距離（m。省略 = 0.3） */
  reach?: number;
}

/**
 * 足を交互に踏み込ませるキー列（右・左・右…）。踏み込む足は、次の歩の直前まで世界に固定して、着地の 0.1 秒前から弧を描いて前へ着く。
 * もう片方は、着地の 0.1 秒あとに、ルートのすぐ後ろへ追いつく。最後は全体の終わり（tEnd）に、両足がルートの真下（endRoot）に揃う。
 * 足の z は世界の前進量（authoring.ts）。開始の足の位置は両足 0（待機）。
 */
function strideFeet(beats: readonly Beat[], tEnd: number, endRoot: number, opts: { z0L?: number; z0R?: number; first?: 'R' | 'L'; reach?: number } = {}): AuthoredKey[] {
  const keys: AuthoredKey[] = [];
  let zL = opts.z0L ?? 0;
  let zR = opts.z0R ?? 0;
  const first = opts.first ?? 'R';
  beats.forEach((b, k) => {
    const rightSteps = (k % 2 === 0) === (first === 'R');
    const reach = b.reach ?? opts.reach ?? 0.3;
    const landZ = b.root + reach;
    const catchZ = b.root - 0.08;
    const stepKey = rightSteps ? 'footR' : 'footL';
    const holdKey = rightSteps ? 'footL' : 'footR';
    const sz = rightSteps ? zR : zL;
    const hz = rightSteps ? zL : zR;
    keys.push({ t: b.t - 0.1, ease: 'lin', [stepKey]: { z: sz, arc: 0 } } as AuthoredKey);
    keys.push({ t: b.t, ease: 'io', [stepKey]: { z: landZ, arc: 0.12 } } as AuthoredKey);
    keys.push({ t: b.t, ease: 'lin', [holdKey]: { z: hz, arc: 0 } } as AuthoredKey);
    keys.push({ t: b.t + 0.1, ease: 'out', [holdKey]: { z: catchZ, arc: 0.05 } } as AuthoredKey);
    if (rightSteps) {
      zR = landZ;
      zL = catchZ;
    } else {
      zL = landZ;
      zR = catchZ;
    }
  });
  keys.push({ t: tEnd, ease: 'io', footL: { z: endRoot, arc: 0.1 }, footR: { z: endRoot, arc: 0.04 } });
  return keys;
}

// ================================================================= 居合

export interface IaiSpec {
  id: string;
  /** Lv4〜: 斬り上げのあと、袈裟（左上から右下）をもう 1 太刀 */
  kesa: boolean;
  /** Lv7〜: さらに、右腰へ引き絞って突き込む 1 太刀 */
  thrust: boolean;
}

export const IAI1: IaiSpec = { id: 'iai', kesa: false, thrust: false };
export const IAI4: IaiSpec = { id: 'iai4', kesa: true, thrust: false };
export const IAI7: IaiSpec = { id: 'iai7', kesa: true, thrust: true };

/** ダッシュ（秒・距離 m）: 1 フレーム 0.53 m 以下（敵の体に押し戻されて止まる。向こう側へ抜けない。一閃と同じ約束） */
export const IAI_DASH = 3.2;
export const IAI_DASH_FROM = 0.4;
export const IAI_DASH_TO = 0.5;
/** 抜き打ちが体の前を通る最高速の時刻 */
export const IAI_DRAW_T = 0.53;

/** 納刀の構え: 体を左へひねって腰を落とし、右手を左腰へ（鞘の柄に手をかける）。剣は左後ろへ水平に寝る。左手は鞘を押さえるように左腰に置く */
const IAI_STANCE = {
  hips: { yaw: -24, pitch: 6, z: -0.05, y: -0.2 },
  chest: { yaw: -44, pitch: 8 },
  head: { yaw: -14 },
  grip: [-46, -32, 0.3] as V3,
  ...plane(-112, 0),
  roll: -30,
  pole: [-0.5, -0.8, 0.1] as V3,
  ...OFFHAND.hip,
};

/** 溜めの底: さらに沈んで前へ倒れかけ、力を溜める */
const IAI_CHARGE = { ...IAI_STANCE, hips: { yaw: -26, pitch: 10, z: -0.07, y: -0.3 }, chest: { yaw: -46, pitch: 13 } };

/** ダッシュ中: 前へ低く倒れ込む（剣は左腰に引いたまま） */
const IAI_DASH_POSE = {
  hips: { yaw: -22, pitch: 20, z: 0.04, y: -0.3 },
  chest: { yaw: -40, pitch: 24 },
  head: { yaw: -10 },
  grip: [-44, -28, 0.32] as V3,
  ...plane(-108, 0),
  roll: -30,
  pole: [-0.5, -0.8, 0.1] as V3,
  ...OFFHAND.hip,
};

/** 抜き打ちの途中（体の前を通る最高速）: 着地した前足に体重を乗せ、剣が左から体の前を水平に通る */
const IAI_DRAW_PASS = {
  hips: { yaw: 2, pitch: 14, z: 0.1, y: -0.28 },
  chest: { yaw: 4, pitch: 18 },
  head: { yaw: 2 },
  grip: [6, 4, 0.46] as V3,
  ...plane(0, 0),
  roll: -30,
  pole: [-0.4, -0.9, 0] as V3,
  ...OFFHAND.pull,
};

/** 斬り上げの準備の刃の回し（度）。抜き打ち（水平）の手首の向きから続けて、手首のねじれが 150° を超えないよう、dash.ts の準備（70°）から 180° 回した値（両刃の直剣なので見た目は変わらない） */
const IAI_GATHER_ROLL = -110;

/** 斬り上げが体の前を通る最高速（dash.ts の斬り上げと同じ面・手首） */
const IAI_UP_PASS = {
  hips: { yaw: -6, pitch: 6, z: 0.06, y: -0.22 },
  chest: { yaw: -8, pitch: 8 },
  head: { yaw: -4 },
  grip: [10, 2, 0.46] as V3,
  ...plane(-8, -35),
  roll: 70,
  pole: [-0.4, -0.85, -0.1] as V3,
  ...OFFHAND.pull,
};

/** 袈裟（左上から右下）が体の前を通る最高速（skill-sword.ts の左袈裟と同じ） */
const IAI_KESA_PASS = {
  hips: { yaw: 0, pitch: 7, z: 0.05, y: -0.14 },
  chest: { yaw: 0, pitch: 11 },
  head: { yaw: 0 },
  grip: [-8, 12, 0.46] as V3,
  ...planeL(-20),
  roll: 20,
  pole: [-0.3, -0.9, -0.2] as V3,
  ...OFFHAND.pull,
};

const IAI_THRUST_END = { ...QUAD5_THRUST, hips: { yaw: -10, pitch: 6, z: 0.08, y: -0.16 } };

export interface IaiTimes {
  /** 斬り上げ（返し）の、準備・体の前を通る時刻・振り上げ切り */
  upGather: number;
  upPass: number;
  upEnd: number;
  /** 袈裟（Lv4〜）の通過・振り抜き */
  kesaPass: number;
  kesaEnd: number;
  /** 突き（Lv7〜）の引き絞り・突き */
  thrustChamber: number;
  thrustPass: number;
  /** 最後の技の終わり（姿勢を保ち終わる）と、全体の長さ */
  holdEnd: number;
  duration: number;
}

export function iaiTimes(spec: IaiSpec): IaiTimes {
  const upGather = 0.7;
  const upPass = 0.8;
  const upEnd = 0.9;
  const kesaPass = upEnd + 0.12;
  const kesaEnd = kesaPass + 0.09;
  const thrustChamber = (spec.kesa ? kesaEnd : upEnd) + 0.12;
  const thrustPass = thrustChamber + 0.09;
  const lastEnd = spec.thrust ? thrustPass + 0.1 : spec.kesa ? kesaEnd : upEnd;
  const holdEnd = lastEnd + 0.1;
  return { upGather, upPass, upEnd, kesaPass, kesaEnd, thrustChamber, thrustPass, holdEnd, duration: holdEnd + 0.3 };
}

export function buildIai(spec: IaiSpec): AuthoredAttack {
  const T = iaiTimes(spec);
  const D = IAI_DASH;
  // 太刀ごとに進む量（m）: 斬り上げ・袈裟・突き
  const upAdv = 0.5;
  const kesaAdv = 0.3;
  const thrustAdv = 0.7;
  const r1 = D + upAdv;
  const r2 = r1 + (spec.kesa ? kesaAdv : 0);
  const r3 = r2 + (spec.thrust ? thrustAdv : 0);
  const keys: AuthoredKey[] = [
    // ---- ルート: 溜めのあいだは動かない → 一瞬で踏み込む → 斬り上げ・袈裟・突きでそれぞれ少し進む ----
    { t: IAI_DASH_FROM, ease: 'lin', rootZ: 0 },
    { t: IAI_DASH_FROM + 0.02, ease: 'in', rootZ: 0.15 },
    { t: IAI_DASH_TO, ease: 'lin', rootZ: D },
    { t: T.upGather + 0.02, ease: 'lin', rootZ: D },
    { t: T.upPass, ease: 'in', rootZ: D + upAdv * 0.55 },
    { t: T.upEnd + 0.06, ease: 'out', rootZ: r1 },
  ];
  if (spec.kesa) {
    keys.push({ t: T.kesaPass, ease: 'in', rootZ: r1 + kesaAdv * 0.55 });
    keys.push({ t: T.kesaEnd + 0.06, ease: 'out', rootZ: r2 });
  }
  if (spec.thrust) {
    keys.push({ t: T.thrustPass, ease: 'in', rootZ: r2 + thrustAdv * 0.7 });
    keys.push({ t: T.thrustPass + 0.1, ease: 'out', rootZ: r3 });
  }
  // ---- 足: 構え（左前・右後ろ）→ 蹴る → 腰にぶら下がる → 着地（左が前）。以降は太刀ごとに右・左・右と踏み込む ----
  keys.push(
    { t: 0.04, ease: 'lin', footL: { z: 0 }, footR: { z: 0 } },
    { t: 0.2, ease: 'io', footL: { z: 0.22, arc: 0.05 }, footR: { z: -0.2, arc: 0.03 } },
    { t: IAI_DASH_FROM, ease: 'lin', footL: { rel: 0, z: 0.22, lift: 0 }, footR: { rel: 0, z: -0.2, lift: 0 } },
    { t: IAI_DASH_FROM + 0.04, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.6, lz: -0.3, knee: 0.8 }, footR: { rel: 1, lx: -0.11, ly: -0.62, lz: -0.5, knee: 0.8 } },
    { t: IAI_DASH_FROM + 0.08, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.72, lz: -0.1, knee: 0.2 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: -0.3, knee: 0.2 } },
    { t: IAI_DASH_TO + 0.02, ease: 'io', footL: { rel: 0, z: D + 0.38, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: D - 0.3, x: 0, lift: 0, pitch: 0 } },
  );
  const beats: Beat[] = [{ t: T.upPass, root: r1, reach: 0.25 }];
  if (spec.kesa) beats.push({ t: T.kesaPass, root: r2, reach: 0.2 });
  if (spec.thrust) beats.push({ t: T.thrustPass, root: r3, reach: 0.35 });
  // 着地の足は D − 0.3（右）と D + 0.38（左）。次に踏み込むのは右足
  keys.push(...strideFeet(beats, T.duration, r3, { z0L: D + 0.38, z0R: D - 0.3, first: 'R' }));
  // ---- 上半身: 巻く → 溜める（わずかに震える）→ 倒れ込む → 抜き打ち → 斬り上げ → (袈裟 → 突き) → 戻る ----
  keys.push(
    ...pose(0.2, 'io', IAI_STANCE),
    ...pose(0.28, 'io', { chest: { yaw: -45, pitch: 11 } }),
    ...pose(0.34, 'io', { chest: { yaw: -47, pitch: 12 } }),
    ...pose(0.38, 'io', { chest: { yaw: -45, pitch: 13 } }),
    ...pose(IAI_DASH_FROM, 'io', IAI_CHARGE),
    ...pose(IAI_DASH_FROM + 0.05, 'io', IAI_DASH_POSE),
    ...pose(IAI_DRAW_T, 'in', IAI_DRAW_PASS),
    ...pose(IAI_DRAW_T + 0.08, 'out', BACK_FOLLOW),
    ...pose(T.upGather - 0.02, 'lin', BACK_FOLLOW),
    ...pose(T.upGather + 0.04, 'io', { ...DASH_GATHER, roll: IAI_GATHER_ROLL }),
    ...pose(T.upPass, 'in', IAI_UP_PASS),
    ...pose(T.upEnd, 'out', DASH_RISE),
  );
  let last: Parameters<typeof pose>[2] = DASH_RISE;
  if (spec.kesa) {
    keys.push(...pose(T.upEnd + 0.03, 'lin', DASH_RISE), ...pose(T.kesaPass, 'in', IAI_KESA_PASS), ...pose(T.kesaEnd, 'out', QUAD3_FOLLOW));
    last = QUAD3_FOLLOW;
  }
  if (spec.thrust) {
    keys.push(
      ...pose(T.thrustChamber - 0.02, 'lin', last),
      ...pose(T.thrustChamber, 'io', QUAD5_CHAMBER),
      ...pose(T.thrustPass, 'in', QUAD5_THRUST),
      ...pose(T.thrustPass + 0.1, 'out', IAI_THRUST_END),
    );
    last = IAI_THRUST_END;
  }
  keys.push(...pose(T.holdEnd, 'lin', last), ...pose(T.duration, 'io', RETURN));
  return { name: spec.id, duration: T.duration, keys };
}

export const IAI: AuthoredAttack = buildIai(IAI1);
export const IAI_4: AuthoredAttack = buildIai(IAI4);
export const IAI_7: AuthoredAttack = buildIai(IAI7);

// ================================================================= 十字斬り

export interface CrossSpec {
  id: string;
  /** 十字（縦 → 横 → 突き立て）を繰り返す回数 */
  crosses: number;
}

export const CROSS1: CrossSpec = { id: 'cross', crosses: 1 };
export const CROSS2: CrossSpec = { id: 'cross2', crosses: 2 };
export const CROSS3: CrossSpec = { id: 'cross3', crosses: 3 };

/** 十字 1 回ぶんの時刻（その十字の基準 b からの秒）。縦の斬り下ろし → 横の薙ぎ → 振りかぶって突き立て */
export const CROSS_BEAT = {
  /** 頭上の構えに着く */
  top: 0,
  /** 縦の斬り下ろしが体の前を通る・斬り切って保つ */
  chop: 0.09,
  land: 0.14,
  landHold: 0.17,
  /** 横の薙ぎ: 右へ巻く・体の前を通る・左へ払い切る */
  sweepWind: 0.26,
  sweep: 0.33,
  sweepEnd: 0.4,
  /** 頭上へ振りかぶる・突き立て（地面を叩く）・保つ */
  raise: 0.5,
  plunge: 0.56,
  plungeHold: 0.64,
  /** 次の十字の頭上の構えに着くまでの間隔 */
  next: 0.72,
} as const;

/** 最初の十字の基準時刻（待機から頭上の構えへ） */
export const CROSS_START = 0.2;

/** 縦の斬り下ろしが体の前を通る最高速（heavy.ts と同じ） */
const CROSS_CHOP_PASS = {
  hips: { yaw: 0, pitch: 8, z: 0.06, y: -0.18 },
  chest: { yaw: 0, pitch: 12 },
  head: { yaw: 0 },
  grip: [6, 6, 0.46] as V3,
  ...plane(0, 90),
  roll: 0,
  pole: [-0.45, -0.85, -0.15] as V3,
  ...OFFHAND.pull,
};

/** 突き立てから頭上へ振りかぶり直す途中: 剣を胸の前へ引き寄せて（肘を曲げて）刃を立てる */
const CROSS_REGATHER = {
  hips: { yaw: 2, pitch: 6, z: 0.02, y: -0.18 },
  chest: { yaw: 4, pitch: 6 },
  head: { yaw: 0 },
  grip: [10, 34, 0.34] as V3,
  ...plane(92, 90),
  roll: 0,
  pole: [-0.55, -0.8, -0.15] as V3,
  ...OFFHAND.guard,
};

/** 横の薙ぎが体の前を通る最高速（sweep.ts と同じ） */
const CROSS_SWEEP_PASS = {
  hips: { yaw: 0, pitch: 6, z: 0.05, y: -0.16 },
  chest: { yaw: 0, pitch: 9 },
  head: { yaw: 0 },
  grip: [6, 8, 0.46] as V3,
  ...plane(0, 0),
  roll: -30,
  pole: [-0.4, -0.85, 0] as V3,
  ...OFFHAND.pull,
};

/** 突き立て: 剣を頭上から真下へ。前へ大きく踏み込んで体を倒し、剣先が前の床へ刺さる（縦斬りの着地より深い） */
const CROSS_PLUNGE = {
  hips: { yaw: 0, pitch: 20, z: 0.1, y: -0.26 },
  chest: { yaw: 0, pitch: 30 },
  head: { yaw: 0 },
  grip: [4, -34, 0.44] as V3,
  ...plane(-62, 90),
  roll: 0,
  pole: [-0.4, -0.85, -0.1] as V3,
  ...OFFHAND.hip,
};

export function crossTimes(spec: CrossSpec): { base: number[]; duration: number; holdEnd: number } {
  const base = Array.from({ length: spec.crosses }, (_, n) => CROSS_START + n * CROSS_BEAT.next);
  const holdEnd = base[base.length - 1]! + CROSS_BEAT.plungeHold;
  return { base, duration: holdEnd + 0.3, holdEnd };
}

export function buildCross(spec: CrossSpec): AuthoredAttack {
  const { base, duration, holdEnd } = crossTimes(spec);
  const B = CROSS_BEAT;
  // 1 回の十字で進む量（m）: 縦・横・突き立て
  const adv = { chop: 0.28, sweep: 0.2, plunge: 0.26 };
  const per = adv.chop + adv.sweep + adv.plunge;
  const keys: AuthoredKey[] = [];
  const beats: Beat[] = [];
  base.forEach((b, n) => {
    const r0 = n * per;
    beats.push({ t: b + B.chop, root: r0 + adv.chop, reach: 0.35 });
    beats.push({ t: b + B.sweep, root: r0 + adv.chop + adv.sweep, reach: 0.25 });
    beats.push({ t: b + B.plunge, root: r0 + per, reach: 0.4 });
    // ルート: 斬り下ろし・薙ぎ・突き立てのそれぞれの踏み込みで前へ
    keys.push({ t: b + B.chop - 0.08, ease: 'lin', rootZ: r0 });
    keys.push({ t: b + B.chop, ease: 'in', rootZ: r0 + adv.chop * 0.6 });
    keys.push({ t: b + B.land + 0.03, ease: 'out', rootZ: r0 + adv.chop });
    keys.push({ t: b + B.sweep, ease: 'in', rootZ: r0 + adv.chop + adv.sweep * 0.6 });
    keys.push({ t: b + B.sweepEnd + 0.03, ease: 'out', rootZ: r0 + adv.chop + adv.sweep });
    keys.push({ t: b + B.plunge, ease: 'in', rootZ: r0 + adv.chop + adv.sweep + adv.plunge * 0.7 });
    keys.push({ t: b + B.plungeHold, ease: 'out', rootZ: r0 + per });
  });
  keys.push(...strideFeet(beats, duration, spec.crosses * per, { first: 'R' }));
  // ---- 上半身 ----
  base.forEach((b, n) => {
    if (n === 0) {
      keys.push(...pose(b - 0.02, 'io', { ...HEAVY_TOP, hips: { yaw: 6, pitch: -4, z: -0.04, y: -0.16 } }), ...pose(b + 0.03, 'lin', HEAVY_TOP));
    } else {
      // 前の突き立てから頭上へ振りかぶり直す。途中は肘を曲げた「引き上げ」を通す（腕を伸ばしたまま持ち上げると伸び切る）
      keys.push(...pose(b - 0.04, 'io', CROSS_REGATHER), ...pose(b, 'io', HEAVY_TOP), ...pose(b + 0.03, 'lin', HEAVY_TOP));
    }
    keys.push(
      ...pose(b + B.chop, 'in', CROSS_CHOP_PASS),
      ...pose(b + B.land, 'out', HEAVY_LAND),
      ...pose(b + B.landHold, 'lin', HEAVY_LAND),
      ...pose(b + B.sweepWind, 'io', SWEEP_WINDUP),
      ...pose(b + B.sweep, 'in', CROSS_SWEEP_PASS),
      ...pose(b + B.sweepEnd, 'out', SWEEP_FOLLOW),
      ...pose(b + B.raise, 'io', HEAVY_TOP),
      // 突き立ての途中は、縦の斬り下ろしと同じ道（体の前を通る）を通す（まっすぐ下へ引くと腕が伸び切る）
      ...pose(b + B.plunge - 0.035, 'in', CROSS_CHOP_PASS),
      ...pose(b + B.plunge, 'out', CROSS_PLUNGE),
      ...pose(b + B.plungeHold, 'lin', CROSS_PLUNGE),
    );
  });
  keys.push(...pose(holdEnd, 'lin', CROSS_PLUNGE), ...pose(duration, 'io', RETURN));
  return { name: spec.id, duration, keys };
}

export const CROSS: AuthoredAttack = buildCross(CROSS1);
export const CROSS_2: AuthoredAttack = buildCross(CROSS2);
export const CROSS_3: AuthoredAttack = buildCross(CROSS3);

// ================================================================= 疾風連斬

export interface GaleSpec {
  id: string;
  /** 斬り抜ける回数（右から左 → 左から右 → …の交互） */
  strikes: number;
}

export const GALE4: GaleSpec = { id: 'gale', strikes: 4 };
export const GALE6: GaleSpec = { id: 'gale6', strikes: 6 };
export const GALE8: GaleSpec = { id: 'gale8', strikes: 8 };

/** 1 太刀ごとの間隔（秒）・進む距離（m）・最初の太刀の時刻 */
export const GALE_GAP = 0.2;
export const GALE_STEP = 0.7;
export const GALE_FIRST = 0.2;

/** 太刀が体の前を通る時刻（秒）の列 */
export function galeTimes(spec: GaleSpec): number[] {
  return Array.from({ length: spec.strikes }, (_, n) => GALE_FIRST + GALE_GAP * n);
}

/** 駆けながらの薙ぎの途中（体の前を通る最高速）: 前へ低く倒れ込み、剣が体の前を水平に通る */
const GALE_PASS_A = { ...CROSS_SWEEP_PASS, hips: { yaw: 0, pitch: 14, z: 0.08, y: -0.2 }, chest: { yaw: 0, pitch: 16 } };
const GALE_PASS_B = { ...BACK_PASS, hips: { yaw: 0, pitch: 14, z: 0.08, y: -0.2 }, chest: { yaw: 0, pitch: 16 } };

export function buildGale(spec: GaleSpec): AuthoredAttack {
  const times = galeTimes(spec);
  const last = times[times.length - 1]!;
  const end = last + 0.1;
  const holdEnd = end + 0.08;
  const duration = holdEnd + 0.28;
  const keys: AuthoredKey[] = [];
  // ---- ルート: 一定の速さで駆け抜ける（構えの 0.1 秒で動き出す）。最後の太刀のあと減速して止まる ----
  keys.push({ t: GALE_FIRST - 0.12, ease: 'lin', rootZ: 0 });
  times.forEach((t, n) => keys.push({ t, ease: 'lin', rootZ: GALE_STEP * (n + 1) }));
  const rootEnd = GALE_STEP * spec.strikes + 0.3;
  keys.push({ t: holdEnd, ease: 'out', rootZ: rootEnd });
  // ---- 足: 右・左・右…と駆ける（太刀ごとに 1 歩） ----
  const beats: Beat[] = times.map((t, n) => ({ t, root: GALE_STEP * (n + 1), reach: 0.3 }));
  keys.push(...strideFeet(beats, duration, rootEnd, { first: 'R' }));
  // ---- 上半身: 右へ構える → (薙ぐ → 反対へ引き込む)×回数 → 振り抜く → 戻る。奇数の太刀は左から右へ（返し薙ぎ） ----
  keys.push(...pose(GALE_FIRST - 0.06, 'io', { ...SWEEP_WINDUP, hips: { yaw: 22, pitch: 8, z: -0.03, y: -0.18 } }));
  times.forEach((t, n) => {
    const forehand = n % 2 === 0;
    keys.push(...pose(t, 'in', forehand ? GALE_PASS_A : GALE_PASS_B));
    if (n < times.length - 1) keys.push(...pose(t + GALE_GAP * 0.55, 'out', forehand ? BACK_COIL : SWEEP_WINDUP));
  });
  const finalForehand = (spec.strikes - 1) % 2 === 0;
  keys.push(...pose(end, 'out', finalForehand ? SWEEP_FOLLOW : BACK_FOLLOW), ...pose(holdEnd, 'lin', finalForehand ? SWEEP_FOLLOW : BACK_FOLLOW), ...pose(duration, 'io', RETURN));
  return { name: spec.id, duration, keys };
}

export const GALE: AuthoredAttack = buildGale(GALE4);
export const GALE_6: AuthoredAttack = buildGale(GALE6);
export const GALE_8: AuthoredAttack = buildGale(GALE8);
