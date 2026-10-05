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

  describe('視線（M7-4b）', () => {
    const hid = (id: number, x: number, z: number, visible: boolean): LockCandidate => ({ id, x, z, visible });

    it('見えない敵はロックできない（最寄りでも飛ばして、見える敵を選ぶ）。見える敵がいなければ何も起きない', () => {
      const l = new LockOn();
      expect(l.update(upd({ pressed: true, cands: [hid(1, 0, 6, true), hid(2, 0, 3, false)] }))).toBe('lock');
      expect(l.targetId).toBe(1);
      const none = new LockOn();
      expect(none.update(upd({ pressed: true, cands: [hid(2, 0, 3, false)] }))).toBeNull();
      expect(none.locked).toBe(false);
    });

    it('切替も、見えない敵へは移らない', () => {
      const l = new LockOn();
      const cands = [hid(1, 0, 4, true), hid(2, -3, 4, false), hid(3, 3, 6, true)];
      l.update(upd({ pressed: true, cands }));
      expect(l.targetId).toBe(1);
      const ev = l.update(upd({ switchDir: 1, cands }));
      // 右（カメラ yaw π では +X 側が左）に見えない敵があっても、見える敵へだけ移る
      expect(ev === null || l.targetId === 3).toBe(true);
      expect(l.targetId).not.toBe(2);
    });

    it('ロック中の対象が一時的に隠れても、hiddenBreakFrames までは保つ。見えればカウントは戻る', () => {
      const l = new LockOn();
      l.update(upd({ pressed: true, cands: [hid(1, 0, 5, true)] }));
      for (let i = 0; i < LOCKON.hiddenBreakFrames; i++) l.update(upd({ cands: [hid(1, 0, 5, false)] }));
      expect(l.targetId).toBe(1);
      l.update(upd({ cands: [hid(1, 0, 5, true)] })); // 見えた: 数え直し
      for (let i = 0; i < LOCKON.hiddenBreakFrames; i++) l.update(upd({ cands: [hid(1, 0, 5, false)] }));
      expect(l.targetId).toBe(1);
    });

    it('隠れ続けたら、見える別の敵へ移る。いなければ解除する', () => {
      const l = new LockOn();
      const both = [hid(1, 0, 5, false), hid(2, 4, 6, true)];
      l.update(upd({ pressed: true, cands: [hid(1, 0, 5, true), hid(2, 4, 6, true)] }));
      expect(l.targetId).toBe(1);
      let last: string | null = null;
      for (let i = 0; i <= LOCKON.hiddenBreakFrames; i++) last = l.update(upd({ cands: both })) ?? last;
      expect(last).toBe('switch');
      expect(l.targetId).toBe(2);

      const solo = new LockOn();
      solo.update(upd({ pressed: true, cands: [hid(1, 0, 5, true)] }));
      let ev: string | null = null;
      for (let i = 0; i <= LOCKON.hiddenBreakFrames; i++) ev = solo.update(upd({ cands: [hid(1, 0, 5, false)] })) ?? ev;
      expect(ev).toBe('unlock');
      expect(solo.locked).toBe(false);
    });
  });
});
