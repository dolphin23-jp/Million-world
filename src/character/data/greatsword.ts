import type { AuthoredAttack, TwoHand } from '../authoring';
import { DODGE_BACK, DODGE_CLIP } from './dodge';
import { pose } from './stagger';
import { twoHandDodge } from './two-hand';

/**
 * 大剣（両手持ち）の手付けクリップの共通部分（ADR-021）。座標の約束は combo1.ts と同じ（胸の座標系。右 = −X、上 = +Y、前 = +Z）。
 *
 * 両手で握るので、左手は手付けに書かない: AuthoredAttack.twoHanded があれば、左手首は右手の握りと剣の向きから導く
 * （右手の握りから石突き側へ GS_TWO_HAND.offset）。左肘の向きだけ leftPole で書ける（既定は TWO_HAND_POLE）。
 * 両手が柄に付くので、剣は胸の前から大きく外せない。大きな振りは体のひねり（腰・胸のヨー）で作り、握りは胸の中心の近くを回す
 * （右手を右肩の前に置くと、左手の側が届かない。右肩 − 左肩は 0.24m、腕の長さは 0.44m）。
 *
 * 剣のメッシュは src/game/greatsword.ts（原点は右手の握り、刃が +Y、柄は −Y へ 0.4m）。
 */

/** 左手は右手の下 0.24m（石突き寄り）を握る */
export const GS_TWO_HAND: TwoHand = { offset: 0.24 };

type V3 = [number, number, number];

/**
 * 構え（待機・走りの腕。すべての大剣の技がここから始まり、ここへ戻る）: 剣を体の右前、腹の高さに構え、切っ先は前上がりで敵へ向く。
 * 腰を少し落として、右肩をわずかに引く。両手は腰の右前に寄せる。
 */
export const GS_READY = {
  hips: { yaw: 6, pitch: 3, z: -0.02, y: -0.05 },
  chest: { yaw: 10, pitch: 3 },
  head: { yaw: -4 },
  grip: [-8, -26, 0.36] as V3,
  blade: [-0.18, 0.62, 0.76] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.5, -0.8, 0.1] as V3,
};

/** 構えに入る（静止。ほかの大剣の技の起点として continueFrom で使い、動きの検査にも使う）。0.2 秒で待機から構えの姿勢へ */
export const GS_STANCE: AuthoredAttack = {
  name: 'gsStance',
  duration: 0.2,
  twoHanded: GS_TWO_HAND,
  keys: [...pose(0.2, 'io', GS_READY)],
};

/**
 * 走りの腕（胴・脚は Meshy の走りのまま、腕だけこの姿勢で固定する。HeroVisual の overlayPose）: 剣を体の右前に、ほぼ立てて担ぐ。
 * 走りの胴は前へ傾いている（構えの前傾 3° に対して 15° 前後）ので、胸の座標では構えより刃を立てて、世界では斜め前上がりに見えるようにする。
 * 腰・胸・頭の値は使われない（腕のトラックだけを使う）。
 */
const CARRY = {
  ...GS_READY,
  grip: [-4, -10, 0.34] as V3,
  blade: [-0.08, 0.93, 0.36] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
};

export const GS_CARRY: AuthoredAttack = {
  name: 'gsCarry',
  duration: 0.2,
  twoHanded: GS_TWO_HAND,
  keys: [...pose(0.2, 'io', CARRY)],
};

/** 構えから続ける起点（技の continueFrom に使う） */
export const FROM_STANCE = { attack: GS_STANCE, t: GS_STANCE.duration } as const;

/**
 * 大剣を持つときの待機（名前は大剣版の待機として探される 'idle@greatsword'）。構えの姿勢のまま、息づかいだけで腰と胸がわずかに沈んで戻る
 * （周期 3 秒。始まりと終わりが同じ姿勢なので、つなぎ目なく繰り返せる）。Meshy の待機は腕を下ろすので、そのままでは大剣が体の横にぶら下がってしまう。
 */
export const GS_IDLE: AuthoredAttack = {
  name: 'idle@greatsword',
  duration: 3,
  twoHanded: GS_TWO_HAND,
  continueFrom: FROM_STANCE,
  keys: [
    { t: 1.5, ease: 'io', hips: { y: GS_READY.hips.y - 0.008 }, chest: { pitch: GS_READY.chest.pitch + 1.6 }, head: { pitch: -0.8 } },
    { t: 3, ease: 'io', hips: { y: GS_READY.hips.y }, chest: { pitch: GS_READY.chest.pitch }, head: { pitch: 0 } },
  ],
};

// ---------------------------------------------------------------- 回避（片手剣の回避を大剣用に作り直す）

/** 大剣を持つときのロールと後ろステップ（名前は大剣版として探される 'dodge@greatsword' / 'dodgeBack@greatsword'）。作り方は two-hand.ts */
export const GS_DODGE = twoHandDodge(DODGE_CLIP, 'dodge@greatsword', { twoHand: GS_TWO_HAND, ready: GS_READY, from: FROM_STANCE });
export const GS_DODGE_BACK = twoHandDodge(DODGE_BACK, 'dodgeBack@greatsword', { twoHand: GS_TWO_HAND, ready: GS_READY, from: FROM_STANCE });
