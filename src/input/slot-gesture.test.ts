import { describe, expect, it } from 'vitest';
import { DEFAULT_SLOT_GESTURE, SlotGesture } from './slot-gesture';

const CFG = DEFAULT_SLOT_GESTURE; // 真上を中心にした同心円、hold 260ms、openDrag 24px

function gesture(n = 3): SlotGesture {
  return new SlotGesture(CFG, () => n);
}

describe('SlotGesture: タップ', () => {
  it('短く押して離すと tap', () => {
    const g = gesture();
    g.down(0, 0, 1000);
    expect(g.tick(1100)).toBeNull();
    expect(g.up(1120)).toEqual({ type: 'tap' });
    expect(g.isDown).toBe(false);
  });

  it('少し動いても、しきい値より小さければタップのまま', () => {
    const g = gesture();
    g.down(0, 0, 0);
    expect(g.move(5, -10)).toBeNull();
    expect(g.up(100)).toEqual({ type: 'tap' });
  });

  it('何も押していないときの move / up / tick は何も起こさない', () => {
    const g = gesture();
    expect(g.move(10, 10)).toBeNull();
    expect(g.up(10)).toBeNull();
    expect(g.tick(10)).toBeNull();
  });
});

describe('SlotGesture: 開く', () => {
  it('長押しで開く（tick）', () => {
    const g = gesture();
    g.down(0, 0, 0);
    expect(g.tick(CFG.holdMs - 1)).toBeNull();
    expect(g.tick(CFG.holdMs)).toEqual({ type: 'open' });
    expect(g.isOpen).toBe(true);
  });

  it('しきい値を越えてすべらせると、待たずに開く', () => {
    const g = gesture();
    g.down(0, 0, 0);
    expect(g.move(0, -CFG.openDragPx)).toEqual({ type: 'open' });
    expect(g.isOpen).toBe(true);
  });

  it('タイマーより先に離しても、長押しの時間を越えていれば開いたものとして扱う（タップにならない）', () => {
    const g = gesture();
    g.down(0, 0, 0);
    expect(g.up(CFG.holdMs + 5)).toEqual({ type: 'cancel' });
  });
});

describe('SlotGesture: 選ぶ（同心円の上の選択肢を、指の向きと距離で選ぶ）', () => {
  function opened(n = 3): SlotGesture {
    const g = gesture(n);
    g.down(0, 0, 0);
    g.tick(CFG.holdMs);
    return g;
  }
  /** i 番目の選択肢の位置へ指を動かす */
  const to = (g: SlotGesture, i: number) => {
    const p = g.layout()[i]!;
    return g.move(p.x, p.y);
  };

  it('選択肢の位置へ動かすと、その番号が hover になり、離すと choose', () => {
    const g = opened(5);
    expect(to(g, 0)).toEqual({ type: 'hover', index: 0 });
    expect(to(g, 3)).toEqual({ type: 'hover', index: 3 });
    expect(to(g, 4)).toEqual({ type: 'hover', index: 4 });
    expect(g.up(500)).toEqual({ type: 'choose', index: 4 });
  });

  it('輪をなぞるように動かすと、番号が順に変わる', () => {
    const g = opened(5);
    const seen: number[] = [];
    for (let deg = -170; deg <= -10; deg += 4) {
      const ev = g.move(Math.cos((deg * Math.PI) / 180) * 120, Math.sin((deg * Math.PI) / 180) * 120);
      if (ev?.type === 'hover') seen.push(ev.index);
    }
    expect(seen).toEqual([0, 1, 2, 3, 4]);
  });

  it('輪より遠くへ払っても、その向きの選択肢（払う操作で選べる）', () => {
    const g = opened(3);
    const p = g.layout()[2]!;
    g.move(p.x * 2.2, p.y * 2.2);
    expect(g.hoverIndex).toBe(2);
    expect(g.up(500)).toEqual({ type: 'choose', index: 2 });
  });

  it('ボタンの近くは選ばない: 離すと cancel', () => {
    const g = opened();
    to(g, 1);
    expect(g.move(0, -CFG.layout.cancelRadius * 0.5)).toEqual({ type: 'hover', index: -1 });
    expect(g.up(500)).toEqual({ type: 'cancel' });
  });

  it('扇と逆（下）へすべらせても選ばない', () => {
    const g = opened();
    g.move(0, 150);
    expect(g.hoverIndex).toBe(-1);
    expect(g.up(500)).toEqual({ type: 'cancel' });
  });

  it('同じ選択肢の上では hover を繰り返さない', () => {
    const g = opened();
    const p = g.layout()[1]!;
    g.move(p.x, p.y);
    expect(g.move(p.x + 3, p.y - 3)).toBeNull();
  });

  it('開いた瞬間に、指がすでに選択肢の上なら hover はそれ（払って開いたとき）', () => {
    const g = gesture(3);
    g.down(0, 0, 0);
    const p = g.layout()[1]!;
    expect(g.move(p.x, p.y)).toEqual({ type: 'open' });
    expect(g.hoverIndex).toBe(1);
    expect(g.up(80)).toEqual({ type: 'choose', index: 1 });
  });

  it('選択肢が 0 個なら、どこにいても選ばない', () => {
    const g = opened(0);
    g.move(0, -150);
    expect(g.hoverIndex).toBe(-1);
    expect(g.layout()).toEqual([]);
  });

  it('個数が変わると配置も変わる（開く瞬間・動くたびに個数を読む）', () => {
    let n = 2;
    const g = new SlotGesture(CFG, () => n);
    expect(g.layout().length).toBe(2);
    n = 7;
    expect(g.layout().length).toBe(7);
  });

  it('cancel() は開いていれば cancel を返し、何も選ばないまま終わる', () => {
    const g = opened();
    to(g, 1);
    expect(g.cancel()).toEqual({ type: 'cancel' });
    expect(g.isDown).toBe(false);
    expect(g.up(10)).toBeNull();
  });

  it('扇の向きを左にすると、左側の向きで選ぶ', () => {
    const g = new SlotGesture({ ...CFG, layout: { ...CFG.layout, centerDeg: 180 } }, () => 3);
    g.down(0, 0, 0);
    g.tick(CFG.holdMs);
    const p = g.layout()[1]!;
    expect(p.x).toBeLessThan(-100);
    g.move(p.x, p.y);
    expect(g.hoverIndex).toBe(1);
    g.move(150, 0); // 右は扇の外
    expect(g.hoverIndex).toBe(-1);
  });
});
