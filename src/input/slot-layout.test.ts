import { describe, expect, it } from 'vitest';
import { DEFAULT_SLOT_LAYOUT, layoutSlots, pickSlot, ringArcs } from './slot-layout';

const CFG = DEFAULT_SLOT_LAYOUT;
const DEG = Math.PI / 180;
const at = (r: number, deg: number) => ({ x: Math.cos(deg * DEG) * r, y: Math.sin(deg * DEG) * r });

describe('layoutSlots: 同心円の配置', () => {
  it('0 個なら空、1 個なら扇の中心（真上）の内側の輪', () => {
    expect(layoutSlots(0)).toEqual([]);
    const [p] = layoutSlots(1);
    expect(p!.ring).toBe(0);
    expect(p!.x).toBeCloseTo(0, 6);
    expect(p!.y).toBeCloseTo(-CFG.rings[0]!.radius, 6);
  });

  it('内側の輪から詰め、輪の最大数を超えたら次の輪へ', () => {
    expect(layoutSlots(5).every((p) => p.ring === 0)).toBe(true);
    const six = layoutSlots(6);
    expect(six.filter((p) => p.ring === 0).length).toBe(5);
    expect(six.filter((p) => p.ring === 1).length).toBe(1);
    const all = layoutSlots(13);
    expect(all.filter((p) => p.ring === 0).length).toBe(5);
    expect(all.filter((p) => p.ring === 1).length).toBe(8);
  });

  it('輪の半径は設定どおりで、ボタンを中心にした同心円の上にある', () => {
    for (const p of layoutSlots(13)) expect(Math.hypot(p.x, p.y)).toBeCloseTo(CFG.rings[p.ring]!.radius, 6);
  });

  it('置ききれない分は、最後の輪にそのまま詰める（個数が多くても落ちない）', () => {
    const many = layoutSlots(20);
    expect(many.length).toBe(20);
    expect(many.filter((p) => p.ring === 1).length).toBe(15);
  });

  it('番号は時計回り（同じ輪で、番号が増えると左から右へ）。扇の中心は真上で、左右に対称', () => {
    const pts = layoutSlots(5);
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.x).toBeGreaterThan(pts[i - 1]!.x);
    expect(pts[2]!.x).toBeCloseTo(0, 6);
    expect(pts[0]!.x).toBeCloseTo(-pts[4]!.x, 6);
    expect(pts[0]!.y).toBeCloseTo(pts[4]!.y, 6);
  });

  it('隣どうしの中心の距離はほぼ spacingPx で、選択肢の円（64px）が重ならない', () => {
    for (const n of [2, 3, 5, 8, 13]) {
      const pts = layoutSlots(n);
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const d = Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y);
          expect(d, `n=${n} ${i}-${j}`).toBeGreaterThanOrEqual(64);
        }
      }
    }
    const three = layoutSlots(3);
    const d = Math.hypot(three[0]!.x - three[1]!.x, three[0]!.y - three[1]!.y);
    expect(d).toBeGreaterThan(CFG.spacingPx * 0.97);
    expect(d).toBeLessThanOrEqual(CFG.spacingPx + 1e-9);
  });

  it('選択肢が少ないあいだは扇の中心に寄る（指の動きが小さい）', () => {
    const two = layoutSlots(2);
    expect(Math.abs(two[0]!.x)).toBeLessThan(60);
    // 5 個のときの端の位置より中心に近い
    expect(Math.abs(two[0]!.x)).toBeLessThan(Math.abs(layoutSlots(5)[0]!.x));
  });

  it('向き（centerDeg）を変えると扇ごと回る', () => {
    const left = layoutSlots(1, { ...CFG, centerDeg: 180 });
    expect(left[0]!.x).toBeCloseTo(-CFG.rings[0]!.radius, 6);
    expect(left[0]!.y).toBeCloseTo(0, 6);
  });
});

describe('pickSlot: 向きと距離で選ぶ', () => {
  it('選択肢の位置そのものにいれば、その選択肢（どの個数でも）', () => {
    for (const n of [1, 2, 3, 5, 6, 9, 13]) {
      const pts = layoutSlots(n);
      pts.forEach((p, i) => expect(pickSlot(pts, p.x, p.y), `n=${n} i=${i}`).toBe(i));
    }
  });

  it('輪より遠くまで払っても、その向きの選択肢が選ばれる（いちばん外の輪）', () => {
    const pts = layoutSlots(5); // 輪 0 だけ
    pts.forEach((p, i) => {
      expect(pickSlot(pts, p.x * 1.8, p.y * 1.8)).toBe(i);
      expect(pickSlot(pts, p.x * 0.6, p.y * 0.6)).toBe(i); // 近め（取り消しの円の外）
    });
  });

  it('輪が 2 つあるときは、半径がいちばん近い輪の中で、向きがいちばん近い選択肢', () => {
    const pts = layoutSlots(13);
    const r0 = at(120, -90);
    expect(pts[pickSlot(pts, r0.x, r0.y)]!.ring).toBe(0);
    const r1 = at(195, -90);
    expect(pts[pickSlot(pts, r1.x, r1.y)]!.ring).toBe(1);
    // 真上は、輪 0 では中央の 3 番目、輪 1 では 4 番目か 5 番目（偶数個なので中央をはさむ）
    expect(pickSlot(pts, r0.x, r0.y)).toBe(2);
    expect([5 + 3, 5 + 4]).toContain(pickSlot(pts, r1.x, r1.y));
  });

  it('輪を左から右へなぞると、番号が増えていく', () => {
    const pts = layoutSlots(5);
    let prev = -1;
    for (let deg = -170; deg <= -10; deg += 2) {
      const q = at(116, deg);
      const i = pickSlot(pts, q.x, q.y);
      if (i < 0) continue;
      expect(i).toBeGreaterThanOrEqual(prev);
      prev = i;
    }
    expect(prev).toBe(4);
  });

  it('ボタンの近く（cancelRadius 未満）は選ばない', () => {
    const pts = layoutSlots(3);
    expect(pickSlot(pts, 0, 0)).toBe(-1);
    const q = at(CFG.cancelRadius - 2, -90);
    expect(pickSlot(pts, q.x, q.y)).toBe(-1);
    const r = at(CFG.cancelRadius + 4, -90);
    expect(pickSlot(pts, r.x, r.y)).toBeGreaterThanOrEqual(0);
  });

  it('扇の向きと逆（下）へ動いたら選ばない = 取り消し。端より少し外れたくらいなら端の選択肢', () => {
    const pts = layoutSlots(3); // 中心 −90°、ピッチ約 37.5° → 端は −127.5° と −52.5°
    const down = at(150, 90);
    expect(pickSlot(pts, down.x, down.y)).toBe(-1);
    const nearEdge = at(150, -52.5 + 20);
    expect(pickSlot(pts, nearEdge.x, nearEdge.y)).toBe(2);
    const farOut = at(150, -52.5 + 18 + 38 + 10);
    expect(pickSlot(pts, farOut.x, farOut.y)).toBe(-1);
  });

  it('選択肢が 0 個なら、どこでも選ばない', () => {
    expect(pickSlot([], 0, -150)).toBe(-1);
  });
});

describe('ringArcs: 輪の目安の弧', () => {
  it('使っている輪だけ、扇の端の選択肢の半ピッチ外まで', () => {
    expect(ringArcs(layoutSlots(0))).toEqual([]);
    const one = ringArcs(layoutSlots(3));
    expect(one.length).toBe(1);
    expect(one[0]!.radius).toBe(CFG.rings[0]!.radius);
    expect(one[0]!.from).toBeLessThan(one[0]!.to);
    const two = ringArcs(layoutSlots(7));
    expect(two.map((a) => a.radius)).toEqual([CFG.rings[0]!.radius, CFG.rings[1]!.radius]);
  });
});
