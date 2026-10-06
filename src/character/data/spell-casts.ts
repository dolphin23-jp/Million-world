import type { AuthoredAttack } from '../authoring';
import { STAFF_FROM_STANCE, STAFF_READY } from './staff';
import { pose, type Pose } from './stagger';

/**
 * 杖の詠唱のクリップ（ADR-048）。座標の約束は combo1.ts と同じ（胸の座標系）。右手が杖の握り、blade = 杖の頭（宝珠）の向き、左手は仕草（手付けの left / leftPole）。
 * どのクリップも構え（STAFF_READY）から始まり、構えへ戻って終わる（待機 'idle@staff' へつなぎ目なく戻れる）。
 * 詠唱 = 構える → 杖を掲げる / 引く（宝珠が光る）→ 魔法を放つ（AttackDef.cast.at）→ 保つ → 戻る。足は動かさない（その場で詠唱する。隙が大きい）。
 * 魔法を放つ時刻・持続・攻撃の数値は src/combat/data/spell-attacks.ts。
 *
 * 通常攻撃の魔弾（stBolt1 → stBolt2 → stBolt3）は 1 ルートの連打。前の詠唱の保持の姿勢（受付の時刻）から続けて始まる（continueFrom）。
 */

type V3 = [number, number, number];

/** 構えの姿勢に、指定した値を重ねる（腰・胸・頭・杖・左手の書き換えたいところだけ書く） */
const P = (over: Partial<Pose>): Pose => ({ ...STAFF_READY, ...over });

/** 左手の仕草: 手首の位置 [方位°, 仰角°, 距離 m]（左肩から）と、肘の向き */
const hand = (left: V3, leftPole: V3 = [0.5, -0.8, -0.1]): { left: V3; leftPole: V3 } => ({ left, leftPole });

// ================================================================= 通常攻撃: 魔弾 → 魔弾 → 大魔弾

const BOLT1_WIND = P({
  hips: { yaw: 8, pitch: -2, z: -0.02, y: -0.04 },
  chest: { yaw: 14, pitch: -3 },
  head: { yaw: 6 },
  grip: [-30, 4, 0.34],
  blade: [-0.2, 0.62, -0.75],
  face: [-1, 0, 0],
  ...hand([-6, 6, 0.4], [0.4, -0.7, -0.2]),
});

const BOLT1_THRUST = P({
  hips: { yaw: -4, pitch: 6, z: 0.05, y: -0.06 },
  chest: { yaw: -6, pitch: 8 },
  head: { yaw: -2 },
  grip: [-8, 6, 0.44],
  blade: [0, 0.18, 0.98],
  face: [-1, 0, 0],
  ...hand([-8, 4, 0.44], [0.4, -0.7, -0.2]),
});

/** 魔弾の受付の時刻（突き出して保つ姿勢。次の魔弾 stBolt2 がここから続く）。AttackDef.cancelAt と同じ */
export const BOLT1_HOLD_T = 0.42;

/** 魔弾 1（stBolt1）: 杖を引いて（宝珠が光る）、前へ突き出して魔力の弾を撃つ。0 → 0.14 引く / 0.14 → 0.3 突き出す（0.3 に放つ）/ 0.3 → 0.46 保つ / 0.46 → 0.66 戻り */
export const ST_BOLT1: AuthoredAttack = {
  name: 'stBolt1',
  duration: 0.66,
  noShield: true,
  continueFrom: STAFF_FROM_STANCE,
  keys: [...pose(0.14, 'io', BOLT1_WIND), ...pose(0.3, 'in', BOLT1_THRUST), ...pose(BOLT1_HOLD_T, 'out', BOLT1_THRUST), ...pose(0.66, 'io', STAFF_READY)],
};

const BOLT2_WIND = P({
  hips: { yaw: 10, pitch: 2, z: 0, y: -0.08 },
  chest: { yaw: 18, pitch: 2 },
  head: { yaw: 8 },
  grip: [-34, -26, 0.38],
  blade: [-0.55, -0.3, -0.5],
  face: [0.3, 0.7, -0.2],
  ...hand([-14, -10, 0.38], [0.5, -0.8, -0.1]),
});

const BOLT2_FLICK = P({
  hips: { yaw: -6, pitch: 4, z: 0.04, y: -0.06 },
  chest: { yaw: -10, pitch: 6 },
  head: { yaw: -4 },
  grip: [-4, 10, 0.46],
  blade: [0.1, 0.35, 0.93],
  face: [-1, 0, 0],
  ...hand([-12, 10, 0.42], [0.4, -0.7, -0.2]),
});

/** 魔弾 2 の受付の時刻（払い上げて保つ姿勢。大魔弾 stBolt3 がここから続く）。AttackDef.cancelAt と同じ */
export const BOLT2_HOLD_T = 0.4;

/** 魔弾 2（stBolt2）: 杖を右下へ引き、下から払い上げて撃つ。0 → 0.12 右下へ引く / 0.12 → 0.28 払い上げる（0.28 に放つ）/ 0.28 → 0.44 保つ / 0.44 → 0.62 戻り */
export const ST_BOLT2: AuthoredAttack = {
  name: 'stBolt2',
  duration: 0.62,
  noShield: true,
  continueFrom: { attack: ST_BOLT1, t: BOLT1_HOLD_T },
  keys: [...pose(0.12, 'io', BOLT2_WIND), ...pose(0.28, 'in', BOLT2_FLICK), ...pose(BOLT2_HOLD_T, 'out', BOLT2_FLICK), ...pose(0.62, 'io', STAFF_READY)],
};

const BOLT3_RAISE = P({
  hips: { yaw: 0, pitch: -6, z: 0, y: -0.02 },
  chest: { yaw: 0, pitch: -10 },
  head: { yaw: 0, pitch: -6 },
  grip: [-14, 52, 0.36],
  blade: [0, 1, -0.05],
  face: [-1, 0, 0],
  ...hand([-8, 62, 0.38], [0.5, -0.5, -0.4]),
});

const BOLT3_SLAM = P({
  hips: { yaw: 0, pitch: 12, z: 0.08, y: -0.16 },
  chest: { yaw: 0, pitch: 18 },
  head: { yaw: 0, pitch: 6 },
  grip: [-6, 4, 0.46],
  blade: [0, 0.1, 1],
  face: [-1, 0, 0],
  ...hand([-6, -8, 0.44], [0.4, -0.7, -0.2]),
});

/** 大魔弾（stBolt3）: 杖を高く掲げて魔力を溜め（宝珠が強く光る）、前へ振り下ろして大きな弾を撃つ。0 → 0.34 掲げる / 0.34 → 0.5 振り下ろす（0.5 に放つ）/ 0.5 → 0.64 保つ / 0.64 → 0.94 戻り */
export const ST_BOLT3: AuthoredAttack = {
  name: 'stBolt3',
  duration: 0.94,
  noShield: true,
  continueFrom: { attack: ST_BOLT2, t: BOLT2_HOLD_T },
  keys: [...pose(0.34, 'io', BOLT3_RAISE), ...pose(0.38, 'lin', BOLT3_RAISE), ...pose(0.5, 'in', BOLT3_SLAM), ...pose(0.64, 'out', BOLT3_SLAM), ...pose(0.94, 'io', STAFF_READY)],
};

// ================================================================= 魔法（スキル）

// ---------------------------------------------------------------- 落雷（ターゲットとその周囲に落とす）

const THUNDER_RAISE = P({
  hips: { yaw: 0, pitch: -8, z: -0.02, y: 0 },
  chest: { yaw: 0, pitch: -14 },
  head: { yaw: 0, pitch: -8 },
  grip: [-14, 60, 0.34],
  blade: [0, 1, -0.1],
  face: [-1, 0, 0],
  ...hand([-8, 72, 0.4], [0.5, -0.4, -0.5]),
});

const THUNDER_POINT = P({
  hips: { yaw: 0, pitch: 12, z: 0.06, y: -0.1 },
  chest: { yaw: 0, pitch: 18 },
  head: { yaw: 0, pitch: 8 },
  grip: [-6, -4, 0.45],
  blade: [0, -0.25, 0.97],
  face: [-1, 0, 0],
  ...hand([-8, -10, 0.42], [0.4, -0.7, -0.2]),
});

/**
 * 落雷（thunder）: 杖と左手を天へ高く掲げて雷雲を呼び（宝珠が強く光る）、杖をターゲットへ振り下ろす（0.95 に放つ。そのあと雷が落ちる）。
 * 0 → 0.5 掲げる / 0.5 → 0.9 保って溜める（かすかに震える）/ 0.9 → 0.95 振り下ろす / 0.95 → 1.4 保つ / 1.4 → 1.9 戻り。詠唱が長く隙が大きい。
 */
export const SP_THUNDER: AuthoredAttack = {
  name: 'spThunder',
  duration: 1.9,
  noShield: true,
  continueFrom: STAFF_FROM_STANCE,
  keys: [
    ...pose(0.5, 'io', THUNDER_RAISE),
    ...pose(0.7, 'lin', { ...THUNDER_RAISE, grip: [-14, 62, 0.34] }),
    ...pose(0.9, 'lin', THUNDER_RAISE),
    ...pose(0.95, 'in', THUNDER_POINT),
    ...pose(1.4, 'out', THUNDER_POINT),
    ...pose(1.9, 'io', STAFF_READY),
  ],
};

// ---------------------------------------------------------------- 吹雪（前方の扇）

const BLIZZARD_WIND = P({
  hips: { yaw: -10, pitch: 2, z: 0, y: -0.05 },
  chest: { yaw: -22, pitch: 2 },
  head: { yaw: -8 },
  grip: [-48, 4, 0.36],
  blade: [0.7, 0.4, 0.55],
  face: [0, 1, -0.3],
  ...hand([-30, 4, 0.34], [0.5, -0.7, -0.2]),
});

const BLIZZARD_SWEEP = P({
  hips: { yaw: 8, pitch: 4, z: 0.03, y: -0.08 },
  chest: { yaw: 14, pitch: 6 },
  head: { yaw: 4 },
  grip: [10, 6, 0.44],
  blade: [-0.45, 0.2, 0.87],
  face: [0.2, 0.9, -0.1],
  ...hand([-8, 6, 0.46], [0.4, -0.7, -0.2]),
});

/**
 * 吹雪（blizzard）: 杖を左胸へ引き寄せて冷気を溜め、右前へ大きく払い出して吹雪を放つ（0.6 に放つ）。放っているあいだ（1.2 秒）は、杖を前へ向けたままゆっくり左右へ振って吹き続ける。
 * 0 → 0.4 引き寄せる / 0.4 → 0.6 払い出す / 0.6 → 1.8 吹き続ける（杖がゆっくり左右へ）/ 1.8 → 2.2 戻り。向きは変えない（扇は放った向きに固定）。
 */
export const SP_BLIZZARD: AuthoredAttack = {
  name: 'spBlizzard',
  duration: 2.2,
  noShield: true,
  continueFrom: STAFF_FROM_STANCE,
  keys: [
    ...pose(0.4, 'io', BLIZZARD_WIND),
    ...pose(0.6, 'out', BLIZZARD_SWEEP),
    ...pose(1.0, 'io', { ...BLIZZARD_SWEEP, grip: [2, 6, 0.44], blade: [0.2, 0.2, 0.96] }),
    ...pose(1.4, 'io', { ...BLIZZARD_SWEEP, grip: [14, 6, 0.44], blade: [-0.6, 0.2, 0.78] }),
    ...pose(1.8, 'io', { ...BLIZZARD_SWEEP, grip: [4, 6, 0.44], blade: [0.1, 0.2, 0.97] }),
    ...pose(2.2, 'io', STAFF_READY),
  ],
};

// ---------------------------------------------------------------- 火炎放射（前方の直線。放つあいだ向きを変えられる）

const FLAME_WIND = P({
  hips: { yaw: 0, pitch: 2, z: 0, y: -0.04 },
  chest: { yaw: 2, pitch: 2 },
  head: { yaw: 0 },
  grip: [-26, -8, 0.38],
  blade: [0, 0.5, 0.85],
  face: [-1, 0, 0],
  ...hand([-10, 0, 0.4], [0.4, -0.7, -0.2]),
});

const FLAME_FIRE = P({
  hips: { yaw: -2, pitch: 8, z: 0.04, y: -0.1 },
  chest: { yaw: -2, pitch: 10 },
  head: { yaw: 0 },
  grip: [-10, 2, 0.45],
  blade: [0, 0.06, 1],
  face: [-1, 0, 0],
  ...hand([-8, 4, 0.42], [0.4, -0.7, -0.2]),
});

/**
 * 火炎放射（flame）: 杖を前へ水平に突き出し、腰を落として炎を吹き出す（0.6 に放つ）。放出は 2.4 秒続き、そのあいだは足を止めたまま（向きだけ変えられる）、
 * 反動で杖がかすかに震える。0 → 0.35 構える / 0.35 → 0.6 突き出す / 0.6 → 3.0 放出を保つ（震える）/ 3.0 → 3.5 戻り。
 */
export const SP_FLAME: AuthoredAttack = {
  name: 'spFlame',
  duration: 3.5,
  noShield: true,
  continueFrom: STAFF_FROM_STANCE,
  keys: [
    ...pose(0.35, 'io', FLAME_WIND),
    ...pose(0.6, 'in', FLAME_FIRE),
    ...pose(0.9, 'lin', { ...FLAME_FIRE, grip: [-10, 4, 0.45], hips: { yaw: -2, pitch: 9, z: 0.04, y: -0.1 } }),
    ...pose(1.2, 'lin', FLAME_FIRE),
    ...pose(1.5, 'lin', { ...FLAME_FIRE, grip: [-10, 4, 0.45], hips: { yaw: -2, pitch: 9, z: 0.04, y: -0.1 } }),
    ...pose(1.8, 'lin', FLAME_FIRE),
    ...pose(2.1, 'lin', { ...FLAME_FIRE, grip: [-10, 4, 0.45], hips: { yaw: -2, pitch: 9, z: 0.04, y: -0.1 } }),
    ...pose(2.4, 'lin', FLAME_FIRE),
    ...pose(2.7, 'lin', { ...FLAME_FIRE, grip: [-10, 4, 0.45], hips: { yaw: -2, pitch: 9, z: 0.04, y: -0.1 } }),
    ...pose(3.0, 'lin', FLAME_FIRE),
    ...pose(3.5, 'io', STAFF_READY),
  ],
};

// ---------------------------------------------------------------- 爆発（ターゲットとその周囲の広い範囲）

const EXPLOSION_PUSH = P({
  hips: { yaw: 0, pitch: 14, z: 0.08, y: -0.14 },
  chest: { yaw: 0, pitch: 20 },
  head: { yaw: 0, pitch: 8 },
  grip: [-8, -6, 0.46],
  blade: [0, -0.4, 0.9],
  face: [-1, 0, 0],
  ...hand([-8, -12, 0.44], [0.4, -0.7, -0.2]),
});

/**
 * 爆発（explosion）: 杖と左手を頭上に掲げて魔力を一点へ集め（宝珠が脈打つように強く光る）、両手を突き出すように杖をターゲットへ叩きつけて爆破する（1.05 に放つ）。
 * 0 → 0.6 掲げる / 0.6 → 1.0 溜める（震える）/ 1.0 → 1.05 叩きつける / 1.05 → 1.5 保つ / 1.5 → 2.0 戻り。落雷より少し長い。
 */
export const SP_EXPLOSION: AuthoredAttack = {
  name: 'spExplosion',
  duration: 2.0,
  noShield: true,
  continueFrom: STAFF_FROM_STANCE,
  keys: [
    ...pose(0.6, 'io', THUNDER_RAISE),
    ...pose(0.8, 'lin', { ...THUNDER_RAISE, hips: { yaw: 0, pitch: -10, z: -0.02, y: -0.04 }, grip: [-14, 64, 0.34] }),
    ...pose(1.0, 'lin', THUNDER_RAISE),
    ...pose(1.05, 'in', EXPLOSION_PUSH),
    ...pose(1.5, 'out', EXPLOSION_PUSH),
    ...pose(2.0, 'io', STAFF_READY),
  ],
};

// ---------------------------------------------------------------- 再生（自分への持続回復）

const REGEN_HOLD = P({
  hips: { yaw: 0, pitch: 3, z: 0, y: -0.04 },
  chest: { yaw: 0, pitch: 4 },
  head: { yaw: 0, pitch: 8 },
  grip: [-10, -4, 0.38],
  blade: [0, 1, 0.1],
  face: [-1, 0, 0],
  ...hand([-32, -8, 0.3], [0.5, -0.8, 0]),
});

/**
 * 再生（regen）: 杖を胸の前にまっすぐ立て、左手を胸に当てて目を閉じるように俯き、癒しの魔力を呼ぶ（0.6 に放つ）。杖の宝珠が柔らかく光る。
 * 0 → 0.4 杖を立てる / 0.4 → 0.6 俯く / 0.6 → 1.1 保つ / 1.1 → 1.5 戻り。短めの詠唱（自分を癒す魔法）
 */
export const SP_REGEN: AuthoredAttack = {
  name: 'spRegen',
  duration: 1.5,
  noShield: true,
  continueFrom: STAFF_FROM_STANCE,
  keys: [...pose(0.4, 'io', REGEN_HOLD), ...pose(1.1, 'lin', { ...REGEN_HOLD, head: { yaw: 0, pitch: 10 } }), ...pose(1.5, 'io', STAFF_READY)],
};

// ---------------------------------------------------------------- 旋風（自分の周囲の同心円）

/** 杖を水平に頭上へ掲げ、体ごとローターのように回る。回転は 360° で元の向きに戻る（腰・胸・頭のヨーの値は 360° 引いた座標で戻す） */
const HURRICANE_ARMS = P({
  hips: { yaw: 0, pitch: 0, z: 0, y: -0.1 },
  chest: { yaw: 0, pitch: -4 },
  head: { yaw: 0 },
  grip: [-10, 40, 0.38],
  blade: [-0.95, 0.2, 0.2],
  face: [0, 1, -0.2],
  ...hand([-8, 50, 0.38], [0.5, -0.5, -0.4]),
});

const HURRICANE_PLANT = P({
  hips: { yaw: -360, pitch: 12, z: 0.06, y: -0.16 },
  chest: { yaw: -360, pitch: 18 },
  head: { yaw: -360, pitch: 6 },
  grip: [-8, -20, 0.42],
  blade: [0, -0.8, 0.6],
  face: [-1, 0, 0],
  ...hand([-8, -14, 0.42], [0.4, -0.7, -0.2]),
});

/**
 * 旋風（hurricane）: 腰を落として杖を頭上へ水平に掲げ、体ごと 1 回転しながら風を巻き起こし（0.35〜0.8）、回り切って杖を足元へ突き立てる（0.85 に放つ。風が同心円に広がる）。
 * 0 → 0.35 掲げる / 0.35 → 0.8 回る / 0.8 → 0.85 突き立てる / 0.85 → 1.3 保つ / 1.3 → 2.0 戻り。回転は体の向き（hips / chest / head の yaw）を −360° まで回し、戻りも −360° の座標で書く
 */
export const SP_HURRICANE: AuthoredAttack = {
  name: 'spHurricane',
  duration: 2.0,
  noShield: true,
  continueFrom: STAFF_FROM_STANCE,
  keys: [
    ...pose(0.35, 'io', HURRICANE_ARMS),
    { t: 0.8, ease: 'lin', hips: { yaw: -360 }, chest: { yaw: -360 }, head: { yaw: -360 } },
    ...pose(0.85, 'out', HURRICANE_PLANT),
    ...pose(1.3, 'lin', HURRICANE_PLANT),
    ...pose(2.0, 'io', { ...STAFF_READY, hips: { ...STAFF_READY.hips, yaw: STAFF_READY.hips.yaw - 360 }, chest: { ...STAFF_READY.chest, yaw: STAFF_READY.chest.yaw - 360 }, head: { yaw: STAFF_READY.head.yaw - 360 } }),
  ],
};
