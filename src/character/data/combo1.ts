import type { AuthoredAttack } from '../authoring';
import { plane } from './cutting-plane';

/** 予備動作の頂点のポーズ（右へひねって右肩の後ろへ振りかぶる）。頂点で一拍止めるので 2 つのキーで使う */
const WINDUP = {
  hips: { yaw: 14, pitch: -3, z: -0.03 },
  chest: { yaw: 34, pitch: -8 },
  head: { yaw: 8 },
  grip: [42, 60, 0.33] as [number, number, number],
  ...plane(115),
  roll: 20,
  pole: [-0.6, -0.8, -0.1] as [number, number, number],
  left: [-38, 12, 0.42] as [number, number, number],
  leftPole: [0.55, -0.7, 0.3] as [number, number, number],
};

/**
 * 振り抜きの終わりのポーズ。次段（2 段目）はこの姿勢（0.37s）から続けて始まる（combo2 の continueFrom）。
 * 受付はここから戻りの手前まで続くので、そのあいだは姿勢を保つ（遅めに押しても同じ姿勢からつながる）
 */
const FOLLOW = {
  hips: { yaw: -16, pitch: 6, z: 0.03, y: -0.07 },
  chest: { yaw: -30, pitch: 12 },
  head: { yaw: -10 },
  grip: [-48, -26, 0.43] as [number, number, number],
  ...plane(-68),
  roll: -15,
  pole: [-0.5, -0.8, 0] as [number, number, number],
  left: [-70, -25, 0.4] as [number, number, number],
  leftPole: [0.6, -0.8, 0] as [number, number, number],
};

/**
 * 1 段目: 右手の袈裟斬り（右上から左下へ）に左足を踏み込む。手付け（authoring.ts / ADR-012）。
 *
 * 座標は胸の座標系（右 = −X、上 = +Y、前 = +Z）。grip = [方位°（正面から右へ）, 仰角°, 右肩からの距離 m]。
 * blade = 刃の向き、face = 刃の面の法線（手の甲が向く側）。斬りの面は「前 (0,0,1)」と「右上がりの斜め」（水平から PLANE_TILT）が張る
 * 平面で、刃はこの面の中で θ = +115°（右上・後ろ）→ 0°（前）→ −68°（左下）へ回る（plane() 参照）。roll で面の法線まわりに少し回し、手首のねじれを抑える。
 *
 * 時間: 0 → 0.17 予備動作（右へひねって振りかぶる・左足が浮く。0.14〜0.17 は頂点で一拍） / 0.17 → 0.31 斬り（0.245 に体の前を通る最高速。
 * 当たりはその前後） / 0.31 → 0.37 振り抜き / 0.37 → 0.5 姿勢を保って次段を待つ / 0.5 → 0.66 戻り。足は世界に固定（足の z はワールドの idle 位置からの前進量）。
 * ルート（rootZ）は踏み込みで 0.3 m 進み、戻りで両足がルートの真下（idle の相対位置）に揃う。
 */
export const COMBO1: AuthoredAttack = {
  name: 'combo1',
  duration: 0.66,
  keys: [
    // ---- 予備動作（ゆっくり入って、頂点で一拍止める） ----
    { t: 0.14, ease: 'io', ...WINDUP },
    { t: 0.17, ease: 'lin', ...WINDUP },
    // ---- 下半身: 左足を上げて前へ運び（弧）、ルートが進む。右足はその場で踏ん張り、戻りで揃える ----
    { t: 0.08, ease: 'lin', footL: { z: 0 }, rootZ: 0 },
    { t: 0.3, ease: 'io', footL: { z: 0.3, arc: 0.12 }, rootZ: 0.3 },
    { t: 0.5, ease: 'lin', footR: { z: 0 } },
    { t: 0.66, ease: 'io', footR: { z: 0.3, arc: 0.07 } },
    // ---- 斬り ----
    {
      t: 0.245,
      ease: 'in',
      hips: { yaw: 0, pitch: 4, z: 0.02, y: -0.05 },
      chest: { yaw: 0, pitch: 8 },
      head: { yaw: 0 },
      grip: [8, 12, 0.46],
      ...plane(-20),
      roll: -20,
      pole: [-0.3, -0.9, -0.2],
      left: [-60, -10, 0.4],
      leftPole: [0.6, -0.8, 0.1],
    },
    {
      t: 0.31,
      ease: 'out',
      hips: { yaw: -14, pitch: 6, z: 0.04, y: -0.07 },
      chest: { yaw: -26, pitch: 12 },
      head: { yaw: -8 },
      grip: [-34, -18, 0.46],
      ...plane(-55),
      roll: -20,
      pole: [-0.5, -0.8, 0],
      left: [-75, -15, 0.42],
      leftPole: [0.6, -0.8, 0],
    },
    // ---- 振り抜き（0.37 から 0.5 まで姿勢を保って次段を待つ） ----
    { t: 0.37, ease: 'out', ...FOLLOW },
    { t: 0.5, ease: 'lin', ...FOLLOW },
    // ---- 戻り ----
    {
      t: 0.66,
      ease: 'io',
      hips: { yaw: 0, pitch: 0, z: 0, y: 0 },
      chest: { yaw: 0, pitch: 0 },
      head: { yaw: 0 },
      grip: 'idle',
      blade: 'idle',
      pole: 'idle',
      left: 'idle',
      leftPole: 'idle',
    },
  ],
};
