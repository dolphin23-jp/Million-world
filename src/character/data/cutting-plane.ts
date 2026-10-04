const DEG = Math.PI / 180;

/** 斬りの面の傾き（水平から。大きいほど縦斬りに近い）。手首のねじれが少なく済むよう、袈裟斬りでも浅めにしてある */
export const PLANE_TILT = 38;

/**
 * 斬りの面の中の刃の向き（胸の座標系。右 = −X、上 = +Y、前 = +Z）。
 * 面は「前 (0,0,1)」と「右上がりの斜め」（水平から tilt 度）が張る平面。θ = 0 が前、+ が右上（後ろへ回り込む）、− が左下。
 * face は面の法線（手の甲が向く側）。キーの roll で刃の軸まわりに少し回して、手首のねじれを調整する
 */
export function plane(theta: number, tilt = PLANE_TILT): { blade: [number, number, number]; face: [number, number, number] } {
  const t = tilt * DEG;
  const d: [number, number, number] = [-Math.cos(t), Math.sin(t), 0];
  const th = theta * DEG;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return {
    blade: [r(Math.sin(th) * d[0]), r(Math.sin(th) * d[1]), r(Math.cos(th))],
    face: [r(-d[1]), r(d[0]), 0],
  };
}

/**
 * 左上がりの斜めの面（plane の左右反転。左手側の斬りに使う。ADR-031）。θ = 0 が前、+ が左上（後ろへ回り込む）、− が右下。
 * 面は「前 (0,0,1)」と「左上がりの斜め」（水平から tilt 度）が張る平面。face は面の法線で、刃が進む向きに刃先が向く側（右手の plane と同じ向きの約束）
 */
export function planeL(theta: number, tilt = PLANE_TILT): { blade: [number, number, number]; face: [number, number, number] } {
  const t = tilt * DEG;
  const d: [number, number, number] = [Math.cos(t), Math.sin(t), 0];
  const th = theta * DEG;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return {
    blade: [r(Math.sin(th) * d[0]), r(Math.sin(th) * d[1]), r(Math.cos(th))],
    face: [r(-d[1]), r(d[0]), 0],
  };
}
