import type { AuthoredAttack, AuthoredKey } from '../authoring';
import { FROM_STANCE, GS_READY, GS_TWO_HAND } from './greatsword';
import { PASS as SMASH_PASS } from './gs-heavy';
import { LEAP_GATHER, LEAP_TOP, SLAM as LEAP_SLAM, SPIN_ARMS, SPIN_COIL } from './gs-moves';
import { RAISE } from './gs-smash';
import { findPasses } from './skill-sword';
import { LEAD, pose } from './stagger';

/**
 * 大剣の剣技（第 2 弾。ADR-038）の専用モーション。両手持ち（greatsword.ts）。座標の約束は combo1.ts と同じ（胸の座標系。右 = −X、上 = +Y、前 = +Z）。
 * 片手剣の第 2 弾（skill-sword-ex.ts）と同じく、仕様（Spec）から 1 本のクリップを作る生成関数にして、レベルで中身が伸びる（Lv1 / Lv4 / Lv7 の 3 本。ADR-034 と同じ約束）:
 *
 *  - 大渦（OUZU）: 腰を落として、全方位を薙ぐ大回転。回っているあいだずっとスーパーアーマー。2 周 → 3 周 → 4 周（竜巻の大剣版: 広く、遅く、重い）。
 *  - 剣山（KENZAN）: 剣を頭上から地面へ突き立て、突き立てたまま衝撃の輪が内から外へ広がる。輪は 3 回 → 4 回 → 5 回（突き立てているあいだアーマー）。
 *  - 飛竜落とし（HIRYU）: 高く跳び上がって回りながら降り、着地で叩きつける。降りるまで当たりはなく、着地の衝撃は輪になって広がる。
 */

type V3 = [number, number, number];

/** 構えへ戻る姿勢（回転で積み重なったヨーを引いた値で戻す。回転は整数周で元の向きに戻る） */
function ready(turns: number): Parameters<typeof pose>[2] {
  const rot = -360 * turns;
  return { ...GS_READY, hips: { ...GS_READY.hips, yaw: GS_READY.hips.yaw + rot }, chest: { ...GS_READY.chest, yaw: GS_READY.chest.yaw + rot }, head: { yaw: GS_READY.head.yaw + rot } };
}

// ================================================================= 大渦

export interface OuzuSpec {
  id: string;
  /** 回る周回の数（整数。2 周なら全方位を 4 回薙ぐ = 前・後ろ・前・後ろ） */
  turns: number;
}

export const OUZU2: OuzuSpec = { id: 'ouzu', turns: 2 };
export const OUZU3: OuzuSpec = { id: 'ouzu3', turns: 3 };
export const OUZU4: OuzuSpec = { id: 'ouzu4', turns: 4 };

/** 回転の区間（秒）と速さ（°/秒。竜巻の 963 より遅い = 重い）。剣は胸に対して右前へ水平に伸びる（SPIN_ARMS = plane(62, 0)） */
const O = { t0: 0.22, t1: 0.4, omega: 900, yaw0: 52, decelDeg: 150, decel: 0.3, bladeAz: 62 } as const;

export function ouzuTimes(spec: OuzuSpec): { t2: number; stopT: number; duration: number; yawT1: number; yawAtT2: number; yawStop: number; advance: number } {
  const t0p = O.t0 - LEAD.chest;
  const yawT1 = O.yaw0 - 0.5 * O.omega * (O.t1 - t0p);
  const yawStop = -360 * spec.turns;
  const yawAtT2 = yawStop + O.decelDeg;
  const t2 = O.t1 + (yawT1 - yawAtT2) / O.omega;
  const stopT = t2 + O.decel;
  return { t2, stopT, duration: stopT + 0.55, yawT1, yawAtT2, yawStop, advance: 1.2 + 0.35 * (spec.turns - 2) };
}

/** 秒 t の胸のヨー（度）。回転の 3 区間のイージングを authoring.ts と同じ式で再現する（当たりの時刻を求めるため） */
function ouzuChestYaw(spec: OuzuSpec, t: number): number {
  const w = ouzuTimes(spec);
  const t0p = O.t0 - LEAD.chest;
  if (t <= t0p) return O.yaw0;
  if (t <= O.t1) {
    const u = (t - t0p) / (O.t1 - t0p);
    return O.yaw0 + (w.yawT1 - O.yaw0) * u * u; // in
  }
  if (t <= w.t2) return w.yawT1 + (w.yawAtT2 - w.yawT1) * ((t - O.t1) / (w.t2 - O.t1)); // lin
  const u = Math.min(1, (t - w.t2) / (w.stopT - w.t2));
  return w.yawAtT2 + (w.yawStop - w.yawAtT2) * (1 - (1 - u) * (1 - u)); // out
}

/** 剣が体の前・後ろを通る時刻（秒）。前・後・前・後…（turns × 2 回） */
export function ouzuPasses(spec: OuzuSpec): { t: number; rear: boolean }[] {
  const w = ouzuTimes(spec);
  return findPasses((t) => ouzuChestYaw(spec, t) + O.bladeAz, w.stopT, spec.turns * 2);
}

export function buildOuzu(spec: OuzuSpec): AuthoredAttack {
  const w = ouzuTimes(spec);
  const A = w.advance;
  const arms = { ...SPIN_ARMS };
  const low = { ...SPIN_COIL, hips: { yaw: 26, pitch: 8, z: 0, y: -0.3 } };
  const keys: AuthoredKey[] = [
    // ---- ルート: 回りながら敵を追って前へ ----
    { t: O.t0, ease: 'lin', rootZ: 0 },
    { t: O.t1, ease: 'in', rootZ: 0.3 },
    { t: w.t2 - 0.1, ease: 'lin', rootZ: A * 0.8 },
    { t: w.stopT - 0.1, ease: 'out', rootZ: A },
    // ---- 足: 回り始めるまで世界に固定 → 腰に付いて回る（膝を曲げてぶら下がる）→ 止まって世界に固定 ----
    { t: O.t0, ease: 'lin', footL: { rel: 0, z: 0, lift: 0 }, footR: { rel: 0, z: 0, lift: 0 } },
    { t: O.t0 + 0.06, ease: 'io', footL: { rel: 1, lx: 0.12, ly: -0.62, lz: 0.08, knee: 1 }, footR: { rel: 1, lx: -0.12, ly: -0.64, lz: -0.04, knee: 1 } },
    { t: w.t2 + 0.06, ease: 'lin', footL: { rel: 1, lx: 0.12, ly: -0.66, lz: 0.06, knee: 0.5 }, footR: { rel: 1, lx: -0.12, ly: -0.66, lz: -0.04, knee: 0.5 } },
    { t: w.stopT - 0.08, ease: 'io', footL: { rel: 0, z: A + 0.1, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: A - 0.1, x: 0, lift: 0, pitch: 0 } },
    { t: w.duration, ease: 'io', footL: { z: A }, footR: { z: A } },
    // ---- 腰: 深く沈む → 低く回る → 止まって沈む → 立つ ----
    { t: O.t1, ease: 'out', hips: { y: -0.2 } },
    { t: w.t2 - 0.02, ease: 'lin', hips: { y: -0.2 } },
    { t: w.stopT - 0.06, ease: 'in', hips: { y: -0.3 } },
    { t: w.stopT + 0.1, ease: 'lin', hips: { y: -0.3 } },
    // ---- 体の回転（ヨー）と腕 ----
    ...pose(O.t0, 'io', low),
    { t: O.t1, ease: 'in', ...arms, hips: { yaw: w.yawT1 - 24 }, chest: { yaw: w.yawT1 }, head: { yaw: w.yawT1 - 36 } },
    { t: w.t2, ease: 'lin', ...arms, hips: { yaw: w.yawAtT2 - 24 }, chest: { yaw: w.yawAtT2 }, head: { yaw: w.yawAtT2 - 36 } },
    { t: w.stopT, ease: 'out', hips: { yaw: w.yawStop - 24, pitch: 12 }, chest: { yaw: w.yawStop, pitch: 14 }, head: { yaw: w.yawStop - 36 } },
    { t: w.stopT + 0.1, ease: 'lin', hips: { yaw: w.yawStop - 24, pitch: 12 }, chest: { yaw: w.yawStop, pitch: 14 }, head: { yaw: w.yawStop - 36 } },
    ...pose(w.duration, 'io', ready(spec.turns)),
  ];
  return { name: spec.id, duration: w.duration, twoHanded: GS_TWO_HAND, continueFrom: FROM_STANCE, keys };
}

export const OUZU: AuthoredAttack = buildOuzu(OUZU2);
export const OUZU_3: AuthoredAttack = buildOuzu(OUZU3);
export const OUZU_4: AuthoredAttack = buildOuzu(OUZU4);

// ================================================================= 剣山

export interface KenzanSpec {
  id: string;
  /** 突き立てたあと、衝撃の輪が広がる回数 */
  rings: number;
}

export const KENZAN3: KenzanSpec = { id: 'kenzan', rings: 3 };
export const KENZAN4: KenzanSpec = { id: 'kenzan4', rings: 4 };
export const KENZAN5: KenzanSpec = { id: 'kenzan5', rings: 5 };

/** 時刻（秒）: 振りかぶり終わり・体の前を通る・突き立て（地面を貫く）と、輪の間隔 */
export const KENZAN_T = { raise: 0.28, raiseHold: 0.34, pass: 0.4, stake: 0.46, ringGap: 0.3 } as const;

/** 突き立て: 前へ深く沈んで、両手で剣を前の床へ斜めに突き刺す（切っ先が床を貫く）。体は前へ倒れ、剣は床に立ったまま */
const KENZAN_STAKE = {
  hips: { yaw: 0, pitch: 22, z: 0.12, y: -0.38 },
  chest: { yaw: 0, pitch: 32 },
  head: { yaw: 0 },
  grip: [-2, -14, 0.42] as V3,
  blade: [0, -0.1, 0.995] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.4, -0.9, -0.1] as V3,
};

/** 輪が広がるたびの脈動: 突き立てたまま体重をかけ直す（わずかに沈む） */
const KENZAN_PULSE = { ...KENZAN_STAKE, hips: { yaw: 0, pitch: 24, z: 0.12, y: -0.41 }, chest: { yaw: 0, pitch: 34 } };

export function kenzanTimes(spec: KenzanSpec): { rings: number[]; ringsEnd: number; duration: number } {
  const first = KENZAN_T.stake + 0.03;
  const rings = Array.from({ length: spec.rings }, (_, k) => first + k * KENZAN_T.ringGap);
  const ringsEnd = rings[rings.length - 1]! + 0.12;
  return { rings, ringsEnd, duration: ringsEnd + 0.8 };
}

export function buildKenzan(spec: KenzanSpec): AuthoredAttack {
  const T = kenzanTimes(spec);
  const K = KENZAN_T;
  const keys: AuthoredKey[] = [
    // ---- ルート: 振り下ろしで 1.0 m 踏み込む（突き立てたあとは動かない） ----
    { t: 0.12, ease: 'lin', rootZ: 0 },
    { t: K.stake - 0.03, ease: 'in', rootZ: 0.7 },
    { t: K.stake + 0.1, ease: 'out', rootZ: 1.0 },
    // ---- 足: 右足を大きく前へ（突き立てる踏み込み）。左足は引き寄せる ----
    { t: 0.1, ease: 'lin', footR: { z: 0, arc: 0 } },
    { t: K.stake, ease: 'io', footR: { z: 1.35, arc: 0.16 } },
    { t: T.ringsEnd + 0.1, ease: 'lin', footR: { z: 1.35 } },
    { t: T.duration, ease: 'io', footR: { z: 1.2, arc: 0.03 } },
    { t: K.pass, ease: 'lin', footL: { z: 0, arc: 0 } },
    { t: K.stake + 0.18, ease: 'out', footL: { z: 0.6, arc: 0.06 } },
    { t: T.ringsEnd + 0.1, ease: 'lin', footL: { z: 0.6 } },
    { t: T.duration, ease: 'io', footL: { z: 1.2, arc: 0.1 } },
    // ---- 振りかぶる → 振り下ろす → 突き立てる → 輪のたびに体重をかけ直す → 引き抜いて戻る ----
    ...pose(K.raise, 'io', RAISE),
    ...pose(K.raiseHold, 'lin', RAISE),
    ...pose(K.pass, 'in', SMASH_PASS),
    ...pose(K.stake, 'in', KENZAN_STAKE),
    ...T.rings.flatMap((t) => [...pose(t, 'out', KENZAN_PULSE), ...pose(t + 0.1, 'io', KENZAN_STAKE)]),
    ...pose(T.ringsEnd + 0.1, 'lin', KENZAN_STAKE),
    ...pose(T.duration, 'io', GS_READY),
  ];
  return { name: spec.id, duration: T.duration, twoHanded: GS_TWO_HAND, continueFrom: FROM_STANCE, keys };
}

export const KENZAN: AuthoredAttack = buildKenzan(KENZAN3);
export const KENZAN_4: AuthoredAttack = buildKenzan(KENZAN4);
export const KENZAN_5: AuthoredAttack = buildKenzan(KENZAN5);

// ================================================================= 飛竜落とし

export interface HiryuSpec {
  id: string;
  /** 空中で回る周回の数（整数） */
  turns: number;
  /** 滞空の長さ（秒）。高く跳ぶほど長い */
  air: number;
  /** 跳ぶ高さ（m） */
  height: number;
  /** 着地の衝撃の輪の数 */
  rings: number;
}

export const HIRYU1: HiryuSpec = { id: 'hiryu', turns: 1, air: 0.42, height: 0.7, rings: 1 };
export const HIRYU4: HiryuSpec = { id: 'hiryu4', turns: 1, air: 0.48, height: 0.9, rings: 2 };
export const HIRYU7: HiryuSpec = { id: 'hiryu7', turns: 2, air: 0.6, height: 1.2, rings: 3 };

/** 時刻（秒）: 沈んで引き上げる終わり・跳び立つ時刻 */
export const HIRYU_GATHER_T = 0.2;
export const HIRYU_JUMP_T = 0.24;
/** 着地後の輪の間隔（秒） */
export const HIRYU_RING_GAP = 0.18;

export function hiryuTimes(spec: HiryuSpec): { land: number; rings: number[]; ringsEnd: number; hold: number; duration: number } {
  const land = HIRYU_JUMP_T + spec.air;
  const rings = Array.from({ length: spec.rings }, (_, k) => land + 0.03 + k * HIRYU_RING_GAP);
  const ringsEnd = rings[rings.length - 1]! + 0.12;
  const hold = ringsEnd + 0.1;
  return { land, rings, ringsEnd, hold, duration: hold + 0.75 };
}

type Pose = Parameters<typeof pose>[2];

/** ヨーを除いた姿勢（空中の回転は別のキーで積む） */
function noYaw(p: Pose): Pose {
  const { yaw: _hy, ...hips } = p.hips ?? {};
  const { yaw: _cy, ...chest } = p.chest ?? {};
  const { head: _head, hips: _hips, chest: _chest, ...rest } = p;
  return { ...rest, hips, chest };
}

export function buildHiryu(spec: HiryuSpec): AuthoredAttack {
  const T = hiryuTimes(spec);
  const rot = -360 * spec.turns;
  const D = 1.4 + 0.5 * (spec.turns - 1);
  const peak = HIRYU_JUMP_T + spec.air * 0.5;
  const keys: AuthoredKey[] = [
    // ---- ルート: 跳び立って前へ（落下で追う） ----
    { t: HIRYU_GATHER_T, ease: 'lin', rootZ: 0 },
    { t: peak, ease: 'io', rootZ: D * 0.55 },
    { t: T.land, ease: 'out', rootZ: D },
    // ---- 足: 蹴るまで世界に固定 → 腰にぶら下がる → 両足で着地 ----
    { t: HIRYU_GATHER_T, ease: 'lin', footL: { rel: 0, z: 0, lift: 0 }, footR: { rel: 0, z: 0, lift: 0 } },
    { t: HIRYU_JUMP_T + 0.04, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.62, lz: 0.06, knee: 0.8 }, footR: { rel: 1, lx: -0.11, ly: -0.64, lz: -0.04, knee: 0.8 } },
    { t: T.land - 0.1, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.72, lz: 0.1, knee: 0.1 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: 0, knee: 0.1 } },
    { t: T.land, ease: 'io', footL: { rel: 0, z: D + 0.25, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: D - 0.1, x: 0, lift: 0, pitch: 0 } },
    { t: T.duration, ease: 'io', footL: { z: D + 0.1 }, footR: { z: D + 0.1 } },
    // ---- 腰の高さ: 沈む → 跳ぶ（height）→ 着地で深く沈む ----
    { t: HIRYU_GATHER_T, ease: 'lin', hips: { y: -0.26 } },
    { t: peak, ease: 'out', hips: { y: spec.height - 0.1 } },
    { t: T.land - 0.03, ease: 'in', hips: { y: 0.06 } },
    { t: T.land, ease: 'in', hips: { y: LEAP_SLAM.hips.y } },
    // ---- 体の回転: 跳び立ってから着地まで一定の速さで（整数周で元の向きに戻る） ----
    { t: HIRYU_GATHER_T, ease: 'lin', hips: { yaw: LEAP_GATHER.hips.yaw }, chest: { yaw: LEAP_GATHER.chest.yaw }, head: { yaw: LEAP_GATHER.head.yaw } },
    { t: HIRYU_JUMP_T, ease: 'lin', hips: { yaw: LEAP_GATHER.hips.yaw }, chest: { yaw: LEAP_GATHER.chest.yaw }, head: { yaw: LEAP_GATHER.head.yaw } },
    { t: T.land, ease: 'lin', hips: { yaw: rot + LEAP_SLAM.hips.yaw }, chest: { yaw: rot + LEAP_SLAM.chest.yaw }, head: { yaw: rot + LEAP_SLAM.head.yaw } },
    // ---- 腕: 引き上げる → 頭上へ掲げる → 叩きつける → 保つ → 戻る ----
    ...pose(0.12, 'io', noYaw(LEAP_GATHER)),
    ...pose(HIRYU_GATHER_T, 'io', noYaw(LEAP_GATHER)),
    ...pose(peak, 'out', noYaw(LEAP_TOP)),
    ...pose(T.land - 0.06, 'lin', noYaw(LEAP_TOP)),
    ...pose(T.land, 'in', noYaw(LEAP_SLAM)),
    ...pose(T.hold, 'lin', noYaw(LEAP_SLAM)),
    { t: T.duration, ease: 'io', hips: { yaw: rot + GS_READY.hips.yaw }, chest: { yaw: rot + GS_READY.chest.yaw }, head: { yaw: rot + GS_READY.head.yaw } },
    ...pose(T.duration, 'io', noYaw(GS_READY)),
  ];
  return { name: spec.id, duration: T.duration, twoHanded: GS_TWO_HAND, continueFrom: FROM_STANCE, keys };
}

export const HIRYU: AuthoredAttack = buildHiryu(HIRYU1);
export const HIRYU_4: AuthoredAttack = buildHiryu(HIRYU4);
export const HIRYU_7: AuthoredAttack = buildHiryu(HIRYU7);

