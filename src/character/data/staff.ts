import type { AuthoredAttack } from '../authoring';
import { OFFHAND } from './offhand';
import { pose } from './stagger';

/**
 * 杖（片手持ちの魔法の媒体。ADR-048）の手付けクリップの共通部分。座標の約束は combo1.ts と同じ（胸の座標系。右 = −X、上 = +Y、前 = +Z）。
 * 右手が杖の握り（柄の中ほど）、左手は自由（仕草をする。手付けの `left` / `leftPole`）。杖の頭（宝珠）は握りから +Y（剣の「刃」の向き = blade）へ 1.1m ほど。
 * 杖は円柱なので、刃の面の法線（face）はどの向きでもよい（roll は手首のねじれを減らすためだけに使う）。
 *
 * 構え（READY）: 杖を体の右前に、ほぼ立てて持つ（頭は少し前へ傾ける）。左手は力を抜いて脇へ。待機・走りの腕・詠唱の始まりと終わり。
 */

type V3 = [number, number, number];

/** 構え: 杖を右肩の前に立てて持つ。腰はわずかに右へ、背筋を伸ばす（魔法使いらしい、静かな立ち姿） */
export const STAFF_READY = {
  hips: { yaw: 4, pitch: 0, z: 0, y: -0.02 },
  chest: { yaw: 8, pitch: 0 },
  head: { yaw: -4 },
  grip: [-22, -18, 0.4] as V3,
  blade: [0.05, 0.98, 0.18] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.5, -0.85, 0.1] as V3,
  ...OFFHAND.hip,
};

/** 構えに入る（静止。詠唱の始点として continueFrom で使い、動きの検査にも使う）。0.2 秒で待機から構えの姿勢へ */
export const STAFF_STANCE: AuthoredAttack = {
  name: 'staffStance',
  duration: 0.2,
  noShield: true,
  keys: [...pose(0.2, 'io', STAFF_READY)],
};

/** 構えから続ける起点（詠唱クリップの continueFrom に使う） */
export const STAFF_FROM_STANCE = { attack: STAFF_STANCE, t: STAFF_STANCE.duration } as const;

/**
 * 走りの腕（胴・脚は Meshy の走りのまま、腕だけこの姿勢で固定する。HeroVisual の overlayPose）: 杖を体の右前に立てて持つ。
 * 走りの胴は前へ傾いている（構えの前傾 0° に対して 15° 前後）ので、胸の座標では構えより頭を起こして、世界では立った杖に見えるようにする。
 * 腰・胸・頭の値は使われない（腕のトラックだけを使う）。
 */
const CARRY = {
  ...STAFF_READY,
  grip: [-20, -14, 0.38] as V3,
  blade: [0.04, 0.9, 0.06] as V3,
};

export const STAFF_CARRY: AuthoredAttack = {
  name: 'staffCarry',
  duration: 0.2,
  noShield: true,
  keys: [...pose(0.2, 'io', CARRY)],
};

/**
 * 杖を持つときの待機（名前は杖版の待機として探される 'idle@staff'）。構えの姿勢のまま、息づかいだけで腰と胸がわずかに沈んで戻る
 * （周期 3.4 秒。始まりと終わりが同じ姿勢なので、つなぎ目なく繰り返せる）。宝珠がわずかに揺れるよう、杖の頭を息に合わせて少し傾ける
 */
export const STAFF_IDLE: AuthoredAttack = {
  name: 'idle@staff',
  duration: 3.4,
  noShield: true,
  continueFrom: STAFF_FROM_STANCE,
  keys: [
    { t: 1.7, ease: 'io', hips: { y: STAFF_READY.hips.y - 0.008 }, chest: { pitch: STAFF_READY.chest.pitch + 1.4 }, head: { pitch: -0.8 }, blade: [0.05, 0.98, 0.22] },
    { t: 3.4, ease: 'io', hips: { y: STAFF_READY.hips.y }, chest: { pitch: STAFF_READY.chest.pitch }, head: { pitch: 0 }, blade: STAFF_READY.blade },
  ],
};
