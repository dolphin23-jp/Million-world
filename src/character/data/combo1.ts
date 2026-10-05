import type { AuthoredAttack } from '../authoring';
import { plane } from './cutting-plane';
import { OFFHAND } from './offhand';
import { pose } from './stagger';

/** 予備動作の頂点のポーズ（右へひねって右肩の後ろへ振りかぶる。腰を少し沈めて後ろ足に体重を乗せる）。頂点で一拍止めるので 2 つのキーで使う */
export const WINDUP = {
  hips: { yaw: 14, pitch: -3, z: -0.04, y: -0.05 },
  chest: { yaw: 34, pitch: -8 },
  head: { yaw: 8 },
  grip: [42, 60, 0.33] as [number, number, number],
  ...plane(115),
  roll: 20,
  pole: [-0.6, -0.8, -0.1] as [number, number, number],
  ...OFFHAND.guard,
};

/**
 * 振り抜きの終わりのポーズ（前足の上に腰が乗り、膝を曲げたまま前傾）。次段（2 段目）はこの姿勢（0.37s）から続けて始まる（combo2 の continueFrom）。
 * 受付はここから戻りの手前まで続くので、そのあいだは姿勢を保つ（遅めに押しても同じ姿勢からつながる）
 */
export const FOLLOW = {
  hips: { yaw: -16, pitch: 9, z: 0.05, y: -0.1 },
  chest: { yaw: -30, pitch: 14 },
  head: { yaw: -10 },
  grip: [-48, -26, 0.43] as [number, number, number],
  ...plane(-68),
  roll: -15,
  pole: [-0.5, -0.8, 0] as [number, number, number],
  ...OFFHAND.hip,
};

/**
 * 1 段目: 右手の袈裟斬り（右上から左下へ）に左足を大きく踏み込む。手付け（authoring.ts / ADR-012）。
 *
 * 座標は胸の座標系（右 = −X、上 = +Y、前 = +Z）。grip = [方位°（正面から右へ）, 仰角°, 右肩からの距離 m]。
 * blade = 刃の向き、face = 刃の面の法線（手の甲が向く側）。斬りの面は「前 (0,0,1)」と「右上がりの斜め」（水平から PLANE_TILT）が張る
 * 平面で、刃はこの面の中で θ = +115°（右上・後ろ）→ 0°（前）→ −68°（左下）へ回る（plane() 参照）。roll で面の法線まわりに少し回し、手首のねじれを抑える。
 *
 * 時間: 0 → 0.17 予備動作（右へひねって振りかぶる・腰を沈めて後ろ足に体重を乗せる。0.14〜0.17 は頂点で一拍） / 0.17 → 0.31 斬り
 * （0.245 に体の前を通る最高速。当たりはその前後。前足は 0.235 に着地） / 0.31 → 0.37 振り抜き / 0.37 → 0.5 姿勢を保って次段を待つ / 0.5 → 0.66 戻り。
 *
 * 踏み込み（docs/01 ADR-012 追記）:
 *  - 前足（左）を 0.1 に上げ、0.235 に腰の 0.36 m 前へ着地させる（以前は 0.12 m。足の z は 0.57 進む）。後ろ足（右）は 0.245 まで残し、腰との間は 0.44 m に開く（踏み込みの幅）。
 *  - ルートは 0.09 から加速して 0.235（着地）までに 0.30 m、そのあと減速して 0.37 までに 0.57 m（腰が前足の真上を通り過ぎる）。それ以降は止める
 *    （後で押しても pose と位置がずれない）。加速と減速の最高速は揃えてある（約 4.1 m/s）。
 *  - 着地のとき腰が 0.14 m 沈み、体が前へ倒れる。後ろ足は着地のあと床をすべらせずに小さく浮かせて引きつけ、戻りで前足に揃える。
 * 足は世界に固定（足の z はワールドの idle 位置からの前進量）。戻りで両足がルートの真下（idle の相対位置）に揃う。
 */
export const COMBO1: AuthoredAttack = {
  name: 'combo1',
  duration: 0.66,
  keys: [
    // ---- 予備動作（ゆっくり入って、頂点で一拍止める） ----
    ...pose(0.14, 'io', WINDUP),
    ...pose(0.17, 'lin', WINDUP),
    // ---- 下半身: ルートが爆ぜるように前へ（加速 → 着地で減速）。左足が弧を描いて大きく前へ着地する。右足は後ろに残り、着地のあと引きつける ----
    { t: 0.09, ease: 'lin', rootZ: 0 },
    { t: 0.235, ease: 'in', rootZ: 0.3 },
    { t: 0.37, ease: 'out', rootZ: 0.57 },
    { t: 0.1, ease: 'lin', footL: { z: 0 } },
    { t: 0.235, ease: 'io', footL: { z: 0.57, arc: 0.14 } },
    { t: 0.2, ease: 'lin', footR: { z: 0 } },
    { t: 0.33, ease: 'io', footR: { z: 0.45, arc: 0.07 } },
    { t: 0.5, ease: 'lin', footR: { z: 0.45 } },
    { t: 0.66, ease: 'io', footR: { z: 0.57, arc: 0.05 } },
    // ---- 斬り（腰 → 胸 → 腕・剣の順に遅れて動く） ----
    ...pose(0.245, 'in', {
      hips: { yaw: 0, pitch: 7, z: 0.05, y: -0.14 },
      chest: { yaw: 0, pitch: 11 },
      head: { yaw: 0 },
      grip: [8, 12, 0.46],
      ...plane(-20),
      roll: -20,
      pole: [-0.3, -0.9, -0.2],
      ...OFFHAND.pull,
    }),
    ...pose(0.31, 'out', {
      hips: { yaw: -14, pitch: 8, z: 0.05, y: -0.13 },
      chest: { yaw: -26, pitch: 13 },
      head: { yaw: -8 },
      grip: [-34, -18, 0.46],
      ...plane(-55),
      roll: -20,
      pole: [-0.5, -0.8, 0],
      ...OFFHAND.hip,
    }),
    // ---- 振り抜き（0.37 から 0.5 まで姿勢を保って次段を待つ） ----
    ...pose(0.37, 'out', FOLLOW),
    ...pose(0.5, 'lin', FOLLOW),
    // ---- 戻り ----
    ...pose(0.66, 'io', {
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
