import type { AuthoredAttack, TwoHand } from '../authoring';
import { DODGE_BACK, DODGE_CLIP } from './dodge';
import { pose } from './stagger';
import { twoHandDodge } from './two-hand';

/**
 * 槍（両手持ち）の手付けクリップの共通部分（ADR-049）。座標の約束は combo1.ts と同じ（胸の座標系。右 = −X、上 = +Y、前 = +Z）。
 *
 * 大剣（greatsword.ts）と同じ両手持ちの仕組み（AuthoredAttack.twoHanded）。ただし**右手が前、左手が後ろ**（右手は穂先寄りの握り、左手は石突き寄りの 0.38m 後ろ）。
 * 左手首の目標は、右手の握り（grip）と槍の向き（blade）から毎フレーム導かれる。左手は体の近く（腹・腰の前）に収まるので、右腕は体の前へ大きく伸ばせる
 * （右肩から握りまで 0.44m ほど。大剣のように右手が体の中心から離れても左手が届く）。槍は長いので（石突きから穂先まで 2.43m）、突きは腕を伸ばす・踏み込む・体を前へ倒すで間合いを稼ぐ。
 * 構えは右半身が前（腰・胸が左へひねれて右肩が前に出る。右足が前）。体のひねりは胸の座標の blade を回して補う（槍は敵へ向ける）。
 *
 * 槍のメッシュは src/game/spear.ts（原点は右手の握り、穂先が +Y、石突きは −Y へ 0.58m）。
 */

/** 左手は右手の 0.38m 後ろ（石突き寄り）を握る */
export const SP_TWO_HAND: TwoHand = { offset: 0.38 };

type V3 = [number, number, number];

/**
 * 構え（待機・走りの腕。すべての槍の技がここから始まり、ここへ戻る）: 右半身を前に出し、槍を腰の高さで水平に近く構えて穂先を敵へ向ける（わずかに前上がり）。
 * 腰を少し落とし、右足を前に置く。右手は体の前へ伸ばし、左手は後ろ（腹の前）で支える。
 */
export const SP_READY = {
  hips: { yaw: -14, pitch: 3, z: -0.02, y: -0.07 },
  chest: { yaw: -24, pitch: 3 },
  head: { yaw: 14 },
  grip: [-6, -24, 0.4] as V3,
  blade: [-0.4, 0.26, 0.88] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.5, -0.8, 0.1] as V3,
};

/** 構えの足の前後（m。右足が前・左足が後ろ）。回避の終わりもここへ戻る */
export const SP_FEET_Z = { L: -0.1, R: 0.2 } as const;

/** 構えに入る（静止。ほかの槍の技の起点として continueFrom で使い、動きの検査にも使う）。0.2 秒で待機から構えの姿勢へ */
export const SP_STANCE: AuthoredAttack = {
  name: 'spStance',
  duration: 0.2,
  twoHanded: SP_TWO_HAND,
  keys: [{ t: 0.2, ease: 'io', footR: { z: SP_FEET_Z.R }, footL: { z: SP_FEET_Z.L } }, ...pose(0.2, 'io', SP_READY)],
};

/**
 * 走りの腕（胴・脚は Meshy の走りのまま、腕だけこの姿勢で固定する。HeroVisual の overlayPose）: 槍を体の右前に、穂先を前上がりに担ぐ。
 * 走りの胴は前へ傾いている（構えの前傾 3° に対して 15° 前後）ので、胸の座標では構えより穂先を立てて、世界では斜め前上がりに見えるようにする。
 * 腰・胸・頭・足の値は使われない（腕のトラックだけを使う）。
 */
const CARRY = {
  ...SP_READY,
  grip: [-8, -18, 0.4] as V3,
  blade: [-0.16, 0.7, 0.69] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
};

export const SP_CARRY: AuthoredAttack = {
  name: 'spCarry',
  duration: 0.2,
  twoHanded: SP_TWO_HAND,
  keys: [...pose(0.2, 'io', CARRY)],
};

/** 構えから続ける起点（技の continueFrom に使う） */
export const FROM_STANCE = { attack: SP_STANCE, t: SP_STANCE.duration } as const;

/**
 * 槍を持つときの待機（名前は槍版の待機として探される 'idle@spear'）。構えの姿勢のまま、息づかいだけで腰と胸がわずかに沈んで戻る
 * （周期 3 秒。始まりと終わりが同じ姿勢なので、つなぎ目なく繰り返せる）。足は構えの位置（右が前）のまま。
 */
export const SP_IDLE: AuthoredAttack = {
  name: 'idle@spear',
  duration: 3,
  twoHanded: SP_TWO_HAND,
  continueFrom: FROM_STANCE,
  keys: [
    { t: 1.5, ease: 'io', hips: { y: SP_READY.hips.y - 0.008 }, chest: { pitch: SP_READY.chest.pitch + 1.6 }, head: { pitch: -0.8 } },
    { t: 3, ease: 'io', hips: { y: SP_READY.hips.y }, chest: { pitch: SP_READY.chest.pitch }, head: { pitch: 0 } },
  ],
};

// ---------------------------------------------------------------- 回避（片手剣の回避を槍用に作り直す）

const KIT = { twoHand: SP_TWO_HAND, ready: SP_READY, from: FROM_STANCE, feetZ: SP_FEET_Z } as const;

/** 槍を持つときのロールと後ろステップ（名前は槍版として探される 'dodge@spear' / 'dodgeBack@spear'）。作り方は two-hand.ts */
export const SP_DODGE = twoHandDodge(DODGE_CLIP, 'dodge@spear', KIT);
export const SP_DODGE_BACK = twoHandDodge(DODGE_BACK, 'dodgeBack@spear', KIT);
