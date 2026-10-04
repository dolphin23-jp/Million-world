/**
 * スロットボタンの選択肢の配置と選択（ADR-033）。縦に並べると選びづらいので、**ボタンを中心にした同心円（扇）の上**に選択肢を並べ、
 * 指のいる**向き（角度）と距離（輪）**で選ぶ。DOM にも時間にも依存しない純粋関数（座標はボタンの中心からの差 px。画面座標: x 右が正、y 下が正）。
 *
 *  - 選択肢は内側の輪から順に詰める（輪 0 が max 個になったら輪 1）。輪の中では、扇の中心（centerDeg）のまわりに等間隔（隣どうしの中心の距離が spacingPx）。
 *    番号が増える向きは時計回り（左から右へ読める）。選択肢が少ないときは、扇の中心のまわりに寄る（指の移動が小さい）。
 *  - 指がボタンの近く（cancelRadius 未満）なら選ばない。それ以外は、**輪（半径がいちばん近い輪）と角度（いちばん近い選択肢）**で決める。
 *    輪より遠くまで払っても、その向きの選択肢が選ばれる（払う操作に強い）。扇の向きから外れた方（maxOffDeg 以上）へ動いたら選ばない = 取り消し。
 */

export interface SlotRing {
  /** 輪の半径（px。ボタンの中心から選択肢の中心まで） */
  radius: number;
  /** この輪に置ける選択肢の最大数 */
  max: number;
}

export interface SlotLayoutConfig {
  /** 扇の中心の向き（度。0 = 右、−90 = 上。画面座標） */
  centerDeg: number;
  /** 隣り合う選択肢の中心の距離（px。選択肢の円の直径 + すきま） */
  spacingPx: number;
  /** 内側の輪から（輪ごとの半径と最大数） */
  rings: readonly SlotRing[];
  /** 指がこの距離（px）より近いときは選ばない（ボタンの上 = 取り消し） */
  cancelRadius: number;
  /** 扇の端の選択肢から、この角度（度）より外れた向きは選ばない（取り消し） */
  maxOffDeg: number;
}

export const DEFAULT_SLOT_LAYOUT: SlotLayoutConfig = {
  centerDeg: -90,
  spacingPx: 76,
  rings: [
    { radius: 116, max: 5 },
    { radius: 200, max: 8 },
  ],
  cancelRadius: 54,
  maxOffDeg: 38,
};

export interface SlotPoint {
  /** ボタンの中心からの位置（px） */
  x: number;
  y: number;
  /** 何番目の輪か・その輪での向き（ラジアン）・半径 */
  ring: number;
  angle: number;
  radius: number;
}

const DEG = Math.PI / 180;

/** n 個の選択肢の配置（番号順）。置ききれない分は最後の輪にそのまま詰める */
export function layoutSlots(count: number, cfg: SlotLayoutConfig = DEFAULT_SLOT_LAYOUT): SlotPoint[] {
  const out: SlotPoint[] = [];
  let left = Math.max(0, Math.floor(count));
  for (let ri = 0; left > 0; ri++) {
    const isLast = ri >= cfg.rings.length - 1;
    const ring = cfg.rings[Math.min(ri, cfg.rings.length - 1)]!;
    const n = isLast ? left : Math.min(left, ring.max);
    const pitch = cfg.spacingPx / ring.radius; // 隣どうしの角度（ラジアン）
    for (let k = 0; k < n; k++) {
      const a = cfg.centerDeg * DEG + (k - (n - 1) / 2) * pitch;
      out.push({ x: Math.cos(a) * ring.radius, y: Math.sin(a) * ring.radius, ring: Math.min(ri, cfg.rings.length - 1), angle: a, radius: ring.radius });
    }
    left -= n;
    if (isLast) break;
  }
  return out;
}

/** 角度の差（−π〜π） */
function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * 指の位置 (x, y)（ボタンの中心から）にある選択肢の番号。選ばないときは -1。
 * layout は layoutSlots の結果（番号順）
 */
export function pickSlot(layout: readonly SlotPoint[], x: number, y: number, cfg: SlotLayoutConfig = DEFAULT_SLOT_LAYOUT): number {
  if (layout.length === 0) return -1;
  const r = Math.hypot(x, y);
  if (r < cfg.cancelRadius) return -1;
  const theta = Math.atan2(y, x);
  // 半径がいちばん近い輪（選択肢のある輪だけ）
  let ring = layout[0]!.ring;
  let best = Infinity;
  for (const p of layout) {
    const d = Math.abs(r - p.radius);
    if (d < best) {
      best = d;
      ring = p.ring;
    }
  }
  // その輪の中で、角度がいちばん近い選択肢
  let idx = -1;
  let bestAng = Infinity;
  for (let i = 0; i < layout.length; i++) {
    const p = layout[i]!;
    if (p.ring !== ring) continue;
    const d = Math.abs(angleDiff(theta, p.angle));
    if (d < bestAng) {
      bestAng = d;
      idx = i;
    }
  }
  if (idx < 0) return -1;
  // 扇の端より外れた向きは選ばない（端の選択肢の半分の幅 + maxOffDeg まで）
  const half = (cfg.spacingPx / layout[idx]!.radius) / 2;
  if (bestAng > half + cfg.maxOffDeg * DEG) return -1;
  return idx;
}

/** 輪ごとの扇の範囲（描画の目安の弧用）。使っている輪だけ、半径と、最初・最後の選択肢の向き（ラジアン）+ 半ピッチ */
export function ringArcs(layout: readonly SlotPoint[], cfg: SlotLayoutConfig = DEFAULT_SLOT_LAYOUT): { radius: number; from: number; to: number }[] {
  const arcs: { radius: number; from: number; to: number }[] = [];
  for (let ring = 0; ring < cfg.rings.length; ring++) {
    const pts = layout.filter((p) => p.ring === ring);
    if (pts.length === 0) continue;
    const half = cfg.spacingPx / pts[0]!.radius / 2;
    arcs.push({ radius: pts[0]!.radius, from: pts[0]!.angle - half, to: pts[pts.length - 1]!.angle + half });
  }
  return arcs;
}
