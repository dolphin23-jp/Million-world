import { describe, expect, it } from 'vitest';
import { LockOn, type LockUpdate } from './lockon-state';
import { LOCKON } from './data/lockon';
import type { LockCandidate } from './lockon';

const CAM = Math.PI;
const c = (id: number, x: number, z: number): LockCandidate => ({ id, x, z });
const upd = (over: Partial<LockUpdate> & { cands: readonly LockCandidate[] }): LockUpdate => ({ pressed: false, switchDir: 0, px: 0, pz: 0, camYaw: CAM, ...over });

describe('LockOn', () => {
  it('ロックボタンで最寄りの敵をロックし、もう一度で解除する', () => {
    const l = new LockOn();
    const cands = [c(1, 0, 6), c(2, 0, 3)];
    expect(l.update(upd({ pressed: true, cands }))).toBe('lock');
    expect(l.targetId).toBe(2);
    expect(l.locked).toBe(true);
    expect(l.update(upd({ pressed: true, cands }))).toBe('unlock');
    expect(l.targetId).toBeNull();
  });

  it('範囲内に敵がいなければ、ボタンを押しても何も起きない', () => {
    const l = new LockOn();
    expect(l.update(upd({ pressed: true, cands: [c(1, 0, LOCKON.maxRange + 3)] }))).toBeNull();
    expect(l.locked).toBe(false);
  });

  it('ロックしていないときの切替入力は無視する', () => {
    const l = new LockOn();
    expect(l.update(upd({ switchDir: 1, cands: [c(1, 0, 4), c(2, -3, 4)] }))).toBeNull();
    expect(l.locked).toBe(false);
  });

  it('ロック中は切替で隣の敵へ移り、切替の間隔を空ける', () => {
    const l = new LockOn();
    const cands = [c(1, 0, 6), c(2, -4, 5), c(3, -7, 3)];
    l.update(upd({ pressed: true, cands }));
    expect(l.targetId).toBe(1);
    expect(l.update(upd({ switchDir: 1, cands }))).toBe('switch');
    expect(l.targetId).toBe(2);
    // 間隔のあいだは続けて切り替わらない
    expect(l.update(upd({ switchDir: 1, cands }))).toBeNull();
    expect(l.targetId).toBe(2);
    for (let i = 0; i < LOCKON.switchCooldownFrames; i++) l.update(upd({ cands }));
    expect(l.update(upd({ switchDir: 1, cands }))).toBe('switch');
    expect(l.targetId).toBe(3);
  });

  it('対象が倒れたら（候補から消えたら）残りの敵へ自動で移る。いなければ解除', () => {
    const l = new LockOn();
    l.update(upd({ pressed: true, cands: [c(1, 0, 4), c(2, 3, 6)] }));
    expect(l.targetId).toBe(1);
    expect(l.update(upd({ cands: [c(2, 3, 6)] }))).toBe('switch');
    expect(l.targetId).toBe(2);
    expect(l.update(upd({ cands: [] }))).toBe('unlock');
    expect(l.locked).toBe(false);
  });

  it('breakRange を超えて離れたら解除する', () => {
    const l = new LockOn();
    l.update(upd({ pressed: true, cands: [c(1, 0, 10)] }));
    expect(l.update(upd({ cands: [c(1, 0, LOCKON.breakRange + 2)] }))).toBe('unlock');
    expect(l.locked).toBe(false);
  });

  it('release でいつでも解除できる（再戦など）', () => {
    const l = new LockOn();
    l.update(upd({ pressed: true, cands: [c(1, 0, 4)] }));
    l.release();
    expect(l.locked).toBe(false);
  });
});
