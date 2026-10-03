import type { AuthoredAttack } from '../authoring';

const DEG = Math.PI / 180;
/** 斬りの面の傾き（水平から。大きいほど縦斬りに近い）。手首のねじれが少なく済むよう、袈裟斬りでも浅めにしてある */
const PLANE_TILT = 38;
/**
 * 斬りの面の中の刃の向き（胸の座標系）。θ = 0 が前、+ が右上（後ろへ回り込む）、− が左下。
 * face は面の法線（手の甲が向く側）。roll で軸まわりに少し回して手首のねじれを調整する
 */
function plane(theta: number): { blade: [number, number, number]; face: [number, number, number] } {
  const t = PLANE_TILT * DEG;
  const d: [number, number, number] = [-Math.cos(t), Math.sin(t), 0];
  const th = theta * DEG;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return {
    blade: [r(Math.sin(th) * d[0]), r(Math.sin(th) * d[1]), r(Math.cos(th))],
    face: [r(-d[1]), r(d[0]), 0],
  };
}

/** 予備動作の頂点のポーズ（右へひねって右肩の後ろへ振りかぶる）。頂点で一拍止めるので 2 つのキーで使う */
const WINDUP = {
  hips: { yaw: 14, pitch: -3, z: -0.03 },
  chest: { yaw: 34, pitch: -8 },
  head: { yaw: 8 },
  grip: [42, 60, 0.33] as [number, number, number],
  ...plane(115),
  roll: 20,
  pole: [-0.6, -0.8, -0.1] as [number, number, number],
  left: [-30, -25, 0.38] as [number, number, number],
  leftPole: [0.5, -0.85, 0.1] as [number, number, number],
};

/**
 * 1 段目: 右手の袈裟斬り（右上から左下へ）に左足を踏み込む。手付け（authoring.ts / ADR-012）。
 *
 * 座標は胸の座標系（右 = −X、上 = +Y、前 = +Z）。grip = [方位°（正面から右へ）, 仰角°, 右肩からの距離 m]。
 * blade = 刃の向き、face = 刃の面の法線（手の甲が向く側）。斬りの面は「前 (0,0,1)」と「右上がりの斜め」（水平から PLANE_TILT）が張る
 * 平面で、刃はこの面の中で θ = +115°（右上・後ろ）→ 0°（前）→ −68°（左下）へ回る（plane() 参照）。roll で面の法線まわりに少し回し、手首のねじれを抑える。
 *
 * 時間: 0 → 0.18 予備動作（右へひねって振りかぶる・左足が浮く。0.15〜0.18 は頂点で一拍） / 0.18 → 0.30 斬り（0.235 に体の前を通る最高速。
 * 当たりはその前後） / 0.30 → 0.37 振り抜き / 0.37 → 0.6 戻り。足は世界に固定（足の z はワールドの idle 位置からの前進量）。
 * ルート（rootZ）は踏み込みで 0.3 m 進み、戻りで両足がルートの真下（idle の相対位置）に揃う。
 */
export const COMBO1: AuthoredAttack = {
  name: 'combo1',
  duration: 0.6,
  keys: [
    // ---- 予備動作（ゆっくり入って、頂点で一拍止める） ----
    { t: 0.15, ease: 'io', ...WINDUP },
    { t: 0.18, ease: 'lin', ...WINDUP },
    // ---- 下半身: 左足を上げて前へ運び（弧）、ルートが進む。右足はその場で踏ん張り、戻りで揃える ----
    { t: 0.08, ease: 'lin', footL: { z: 0 }, rootZ: 0 },
    { t: 0.3, ease: 'io', footL: { z: 0.3, arc: 0.12 }, rootZ: 0.3 },
    { t: 0.37, ease: 'lin', footR: { z: 0 } },
    { t: 0.6, ease: 'io', footR: { z: 0.3, arc: 0.07 } },
    // ---- 斬り ----
    {
      t: 0.235,
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
      t: 0.3,
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
    // ---- 振り抜き ----
    {
      t: 0.37,
      ease: 'out',
      hips: { yaw: -16, pitch: 6, z: 0.03, y: -0.07 },
      chest: { yaw: -30, pitch: 12 },
      head: { yaw: -10 },
      grip: [-48, -26, 0.43],
      ...plane(-68),
      roll: -15,
      pole: [-0.5, -0.8, 0],
      left: [-70, -25, 0.4],
    },
    // ---- 戻り ----
    {
      t: 0.6,
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
