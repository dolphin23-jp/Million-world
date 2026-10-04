import { describe, expect, it } from 'vitest';
import { DEFAULT_SLOT_GESTURE, SlotGesture } from './slot-gesture';

const CFG = DEFAULT_SLOT_GESTURE; // 上へ伸びる、pitch 72、hold 260ms、openDrag 24px

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

describe('SlotGesture: 選ぶ', () => {
  function opened(n = 3): SlotGesture {
    const g = gesture(n);
    g.down(0, 0, 0);
    g.tick(CFG.holdMs);
    return g;
  }

  it('上へすべらせた距離で選択肢が決まる（i 番目は (i+1) × pitch）', () => {
    const g = opened();
    expect(g.move(0, -CFG.pitchPx)).toEqual({ type: 'hover', index: 0 });
    expect(g.move(0, -CFG.pitchPx * 2)).toEqual({ type: 'hover', index: 1 });
    expect(g.move(0, -CFG.pitchPx * 3)).toEqual({ type: 'hover', index: 2 });
    expect(g.up(500)).toEqual({ type: 'choose', index: 2 });
  });

  it('いちばん遠い選択肢より先へ行っても最後の選択肢のまま', () => {
    const g = opened(2);
    g.move(0, -CFG.pitchPx * 9);
    expect(g.hoverIndex).toBe(1);
    expect(g.up(500)).toEqual({ type: 'choose', index: 1 });
  });

  it('ボタンの近く（1 つ目の半分より手前）は選ばない: 離すと cancel', () => {
    const g = opened();
    g.move(0, -CFG.pitchPx);
    expect(g.move(0, -CFG.pitchPx * 0.4)).toEqual({ type: 'hover', index: -1 });
    expect(g.up(500)).toEqual({ type: 'cancel' });
  });

  it('下（一覧と逆）へすべらせても選ばない', () => {
    const g = opened();
    g.move(0, CFG.pitchPx * 2);
    expect(g.hoverIndex).toBe(-1);
    expect(g.up(500)).toEqual({ type: 'cancel' });
  });

  it('同じ選択肢の上では hover を繰り返さない', () => {
    const g = opened();
    g.move(0, -CFG.pitchPx);
    expect(g.move(2, -CFG.pitchPx - 4)).toBeNull();
  });

  it('開いた瞬間に、指がすでに選択肢の上なら hover はそれ（上へ払って開いたとき）', () => {
    const g = gesture();
    g.down(0, 0, 0);
    // 一気に 1 つ目の位置まですべらせる
    expect(g.move(0, -CFG.pitchPx)).toEqual({ type: 'open' });
    expect(g.hoverIndex).toBe(0);
    expect(g.up(80)).toEqual({ type: 'choose', index: 0 });
  });

  it('選択肢が 0 個なら、どこにいても選ばない', () => {
    const g = opened(0);
    g.move(0, -CFG.pitchPx * 2);
    expect(g.hoverIndex).toBe(-1);
  });

  it('cancel() は開いていれば cancel を返し、何も選ばないまま終わる', () => {
    const g = opened();
    g.move(0, -CFG.pitchPx);
    expect(g.cancel()).toEqual({ type: 'cancel' });
    expect(g.isDown).toBe(false);
    expect(g.up(10)).toBeNull();
  });

  it('向きを左にすると、左へすべらせて選ぶ', () => {
    const g = new SlotGesture({ ...CFG, dirX: -1, dirY: 0 }, () => 3);
    g.down(0, 0, 0);
    g.tick(CFG.holdMs);
    g.move(-CFG.pitchPx * 2, 0);
    expect(g.hoverIndex).toBe(1);
    g.move(0, -CFG.pitchPx * 2); // 上へは伸びない
    expect(g.hoverIndex).toBe(-1);
  });
});
