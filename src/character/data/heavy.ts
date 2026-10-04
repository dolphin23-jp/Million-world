import type { AuthoredAttack } from '../authoring';
import { COMBO1 } from './combo1';
import { plane } from './cutting-plane';
import { OFFHAND } from './offhand';
import { pose } from './stagger';

/** 縦の面（刃と面の法線が矢状面）。θ = 0 が前、+ が上〜後ろ、− が前下 */
const V = 90;

/** 予備動作の頂点: 腰を落として体を反らせ、剣を頭の上〜後ろへ大きく振りかぶる。頂点で一拍止めてから振り下ろす */
export const TOP = {
  hips: { yaw: 6, pitch: -6, z: -0.06, y: -0.12 },
  chest: { yaw: 10, pitch: -14 },
  head: { yaw: 2 },
  grip: [14, 64, 0.34] as [number, number, number],
  ...plane(128, V),
  roll: 0,
  pole: [-0.65, -0.75, -0.2] as [number, number, number],
  ...OFFHAND.guard,
};

/** 振り下ろしの終わり: 前へ大きく踏み込んで腰を深く沈め、体を倒し、剣先が前の低い所で止まる。この姿勢を保つ */
export const LAND = {
  hips: { yaw: 0, pitch: 14, z: 0.08, y: -0.2 },
  chest: { yaw: 0, pitch: 24 },
  head: { yaw: 0 },
  grip: [4, -26, 0.46] as [number, number, number],
  ...plane(-16, V),
  roll: 0,
  pole: [-0.4, -0.85, -0.1] as [number, number, number],
  ...OFFHAND.hip,
};

/** 溜めに入る時刻（1 段目の予備動作の途中。ここまでは 1 段目と同じ動き）。CHARGE_HOLD_FRAMES（9f = 0.15s）に合わせる */
export const CHARGE_ENTER_T = 0.15;

/**
 * 重撃の溜め: 攻撃を押し続けると、1 段目の予備動作の途中（CHARGE_ENTER_T）の姿勢から、剣を頭上へ振りかぶった構え（TOP）へ移り、そこで止まる。
 * 手付け（ADR-012）。座標の約束は combo1.ts と同じ（胸の座標系）。クリップは終端の姿勢で止まる（Player が離すまで保つ）。
 *
 * 1 段目は 0.1 から左足を前へ出し始める（0.15 では足が浮いて半分進んでいる）ので、溜めに入ったらその足をすぐ着地させる（0 → 0.06 で前に置く）。
 * 時間: 0 → 0.22 剣を頭上へ、腰を落として体を反らせる（0.22〜0.3 は頂点で一拍。以降は止めて保つ）
 */
export const HEAVY_CHARGE: AuthoredAttack = {
  name: 'heavyCharge',
  duration: 0.3,
  continueFrom: { attack: COMBO1, t: CHARGE_ENTER_T },
  keys: [
    ...pose(0.22, 'io', TOP),
    ...pose(0.3, 'lin', TOP),
    // 浮いていた左足を前へ置く（以降は動かさない）
    { t: 0.07, ease: 'out', footL: { z: 0.22, lift: 0, arc: 0 } },
  ],
};

/**
 * 重撃（溜めを放つ）: 頭上の構えから、右足を大きく踏み込んで真上から真下へ叩き斬る（縦斬り）。手付け（ADR-012）。
 * 溜めの終端（TOP）の姿勢から続けて始まる（continueFrom）。斬りの面は縦（plane の tilt = 90）。左手は構え手 → 引き手 → 脇（offhand.ts）。
 *
 * 時間: 0 → 0.1 腰を沈めて右足を踏み出し始める / 0.1 → 0.18 振り下ろし（0.18 に前を通る最高速。当たりはその前後。右足は 0.18 に着地）/
 * 0.18 → 0.25 叩きつけて止まる / 0.25 → 0.36 姿勢を保つ / 0.36 → 0.62 戻り（左足が追いつく）。
 *
 * 踏み込み: 右足が 0.0 に床を離れ、0.18 までに弧を描いて、腰の 0.4 m 前へ着地する（左足は腰の 0.34 m 後ろに残り、幅 0.74 m）。
 * ルートは 0.1 から加速して 0.18（着地）までに 0.4 m、そのあと減速して 0.36 までに 0.8 m。着地で腰が 0.2 m 沈み、体が 24° 前へ倒れる。
 */
export const HEAVY: AuthoredAttack = {
  name: 'heavy',
  duration: 0.62,
  continueFrom: { attack: HEAVY_CHARGE, t: 0.3 },
  keys: [
    // ---- 下半身: 右足が大きく踏み込む。左足は残って、着地のあと引きつけ、戻りで追いつく ----
    { t: 0.04, ease: 'lin', rootZ: 0 },
    { t: 0.1, ease: 'in', rootZ: 0.12 },
    { t: 0.18, ease: 'lin', rootZ: 0.48 },
    { t: 0.36, ease: 'out', rootZ: 0.81 },
    { t: 0.0, ease: 'lin', footR: { z: 0, lift: 0 } },
    { t: 0.18, ease: 'io', footR: { z: 0.97, arc: 0.18 } },
    { t: 0.36, ease: 'lin', footR: { z: 0.97 } },
    { t: 0.62, ease: 'io', footR: { z: 0.81, arc: 0.03 } },
    { t: 0.18, ease: 'lin', footL: { z: 0.22 } },
    { t: 0.27, ease: 'out', footL: { z: 0.35, arc: 0.06 } },
    { t: 0.36, ease: 'lin', footL: { z: 0.35 } },
    { t: 0.62, ease: 'io', footL: { z: 0.81, arc: 0.12 } },
    // ---- 振り下ろし（腰 → 胸 → 腕・剣の順に遅れて動く）。直前に腰を少し沈めて力を溜める ----
    ...pose(0.08, 'io', { ...TOP, hips: { yaw: 6, pitch: -4, z: -0.04, y: -0.16 } }),
    ...pose(0.18, 'in', {
      hips: { yaw: 0, pitch: 8, z: 0.06, y: -0.18 },
      chest: { yaw: 0, pitch: 12 },
      head: { yaw: 0 },
      grip: [6, 6, 0.46],
      ...plane(0, V),
      roll: 0,
      pole: [-0.45, -0.85, -0.15],
      ...OFFHAND.pull,
    }),
    ...pose(0.25, 'out', LAND),
    ...pose(0.36, 'lin', LAND),
    // ---- 戻り ----
    ...pose(0.62, 'io', {
      hips: { yaw: 0, pitch: 0, z: 0, y: 0 },
      chest: { yaw: 0, pitch: 0 },
      head: { yaw: 0 },
      grip: 'idle',
      blade: 'idle',
      pole: 'idle',
      left: 'idle',
      leftPole: 'idle',
    }),
  ],
};
