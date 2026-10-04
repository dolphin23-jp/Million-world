import { describe, expect, it } from 'vitest';
import { buildGuide, GUIDE_SLOTS, type GuideContext } from './move-guide';
import { buildMoveTree, type MoveNode } from './move-tree';
import { MOVE_NAMES } from './data/move-names';
import { GREATSWORD_MOVESET, SWORD_MOVESET } from './data/moveset';
import { ATTACKS, CHARGES, resolveAttack } from './data/attacks';

const base = (o: Partial<GuideContext> = {}): GuideContext => ({
  state: 'idle',
  moveset: SWORD_MOVESET,
  chargeId: 'sword',
  attackId: null,
  trail: [],
  frame: 0,
  cancelFrame: 0,
  total: 0,
  queued: false,
  stick: 'none',
  locked: true,
  afterDodge: null,
  chargeLevel: 0,
  ...o,
});

/** 攻撃中の文脈（技の id・経過フレーム。受付・全体のフレームは resolveAttack から） */
const atk = (id: string, frame: number, o: Partial<GuideContext> = {}): GuideContext => {
  const fr = resolveAttack(ATTACKS[id]!);
  return base({ state: 'attack', attackId: id, trail: [id], frame, cancelFrame: fr.cancelFrame, total: fr.total, ...o });
};

const byName = (v: ReturnType<typeof buildGuide>) => Object.fromEntries(v.chips.map((c) => [c.slot, c.name]));
const selected = (v: ReturnType<typeof buildGuide>) => v.chips.filter((c) => c.selected).map((c) => c.slot);

describe('buildGuide（操作ガイドの表示内容）', () => {
  it('立っているとき: 枠は始動の技（タップ・前・横・後ろ・長押し）。いつも同じ順', () => {
    const v = buildGuide(base());
    expect(v.mode).toBe('ready');
    expect(v.chips.map((c) => c.slot)).toEqual([...GUIDE_SLOTS]);
    expect(byName(v)).toEqual({ tap: '袈裟斬り', forward: '踏み込み突き', side: '横薙ぎ', back: '下がり払い', hold: '溜め斬り' });
    expect(selected(v)).toEqual(['tap']);
  });

  it('立っているとき: スティックの向きで光る枠が変わる。ロックなしでは横・後ろは「ロック」が要る', () => {
    expect(selected(buildGuide(base({ stick: 'forward' })))).toEqual(['forward']);
    expect(selected(buildGuide(base({ stick: 'side' })))).toEqual(['side']);
    expect(selected(buildGuide(base({ stick: 'back' })))).toEqual(['back']);
    const free = buildGuide(base({ locked: false }));
    expect(free.chips.find((c) => c.slot === 'side')!.needsLock).toBe(true);
    expect(free.chips.find((c) => c.slot === 'back')!.needsLock).toBe(true);
    expect(free.chips.find((c) => c.slot === 'forward')!.needsLock).toBe(false);
    expect(buildGuide(base({ locked: true })).chips.some((c) => c.needsLock)).toBe(false);
  });

  it('長押しの枠: 大剣は最大まで溜めたときの技を添える（片手剣は添えない）', () => {
    const gs = buildGuide(base({ moveset: GREATSWORD_MOVESET, chargeId: 'greatsword' }));
    expect(gs.chips.find((c) => c.slot === 'hold')).toMatchObject({ name: '唐竹割り', note: '最大 地割り' });
    expect(buildGuide(base()).chips.find((c) => c.slot === 'hold')!.note).toBeNull();
  });

  it('回避の直後は、ダッシュの技を一言で出す（向きの枠は光らない）', () => {
    const v = buildGuide(base({ afterDodge: 'roll' }));
    expect(v.title).toContain('ダッシュ斬り');
    expect(selected(v)).toEqual([]);
    expect(buildGuide(base({ state: 'dodge', afterDodge: 'back' })).title).toContain('踏み込み突き');
  });

  it('攻撃中: 枠は次に続けられる技。受付が開くまで ready ではなく、開いたら ready', () => {
    const wait = buildGuide(atk('combo1', 5));
    expect(wait.mode).toBe('attack');
    expect(wait.title).toBe('袈裟斬り');
    expect(byName(wait)).toMatchObject({ tap: '逆袈裟', back: '跳び退き斬り', forward: null, side: null });
    expect(wait.window.phase).toBe('wait');
    expect(wait.window.amount).toBeGreaterThan(0);
    expect(wait.window.amount).toBeLessThan(1);
    expect(wait.chips.every((c) => !c.ready)).toBe(true);
    const fr = resolveAttack(ATTACKS.combo1!);
    const open = buildGuide(atk('combo1', fr.cancelFrame));
    expect(open.window).toMatchObject({ phase: 'open', amount: 1 });
    expect(open.chips.find((c) => c.slot === 'tap')!.ready).toBe(true);
    expect(open.chips.find((c) => c.slot === 'back')!.ready).toBe(true);
    expect(open.chips.find((c) => c.slot === 'side')!.ready).toBe(false); // この技に横の続きは無い
    // 受付が閉じていく（連携が切れるまで）
    const late = buildGuide(atk('combo1', fr.total - 1));
    expect(late.window.phase).toBe('open');
    expect(late.window.amount).toBeLessThan(0.2);
  });

  it('攻撃中: いまのスティックで出る枠が金の縁（専用の技が無い向きは「連打」の枠）', () => {
    const f = resolveAttack(ATTACKS.combo1!).cancelFrame;
    expect(selected(buildGuide(atk('combo1', f)))).toEqual(['tap']);
    expect(selected(buildGuide(atk('combo1', f, { stick: 'back' })))).toEqual(['back']);
    expect(selected(buildGuide(atk('combo1', f, { stick: 'forward' })))).toEqual(['tap']); // 前へ倒したままの連打は普通の続き
    expect(selected(buildGuide(atk('combo1', f, { stick: 'side' })))).toEqual(['tap']);
  });

  it('攻撃中: 横・後ろの続きはロックしていないと出せない（ロックなしでは倒せば前）', () => {
    const f = resolveAttack(ATTACKS.combo1!).cancelFrame;
    expect(buildGuide(atk('combo1', f, { locked: false })).chips.find((c) => c.slot === 'back')!.needsLock).toBe(true);
    expect(buildGuide(atk('combo1', f, { locked: true })).chips.find((c) => c.slot === 'back')!.needsLock).toBe(false);
  });

  it('連携の最後の技（next なし）は、前へ倒したときだけ延長がある', () => {
    const f = resolveAttack(ATTACKS.combo3!).cancelFrame;
    const v = buildGuide(atk('combo3', f, { stick: 'forward' }));
    expect(byName(v)).toMatchObject({ tap: null, forward: '打ち上げ' });
    expect(selected(v)).toEqual(['forward']);
    expect(selected(buildGuide(atk('combo3', f)))).toEqual([]); // スティックなしでは何も出ない（連携の終わり）
  });

  it('続きの無い技は、受付なし・枠はすべて空', () => {
    const v = buildGuide(atk('lunge', 10));
    expect(v.window.phase).toBe('none');
    expect(v.chips.every((c) => c.name === null && !c.ready)).toBe(true);
  });

  it('連携の履歴（trail）は技名で、最後がいまの技', () => {
    const v = buildGuide(atk('combo2', 3, { trail: ['combo1', 'combo2'] }));
    expect(v.trail).toEqual(['袈裟斬り', '逆袈裟']);
    expect(v.title).toBe('逆袈裟');
  });

  it('先行入力（queued）が受付の表示に伝わる', () => {
    expect(buildGuide(atk('combo1', 4, { queued: true })).window.queued).toBe(true);
  });

  it('溜め中: 段階・次の段階までの進み・離したときの技（最大で変わる技）', () => {
    const c = CHARGES.greatsword!;
    const at = (frameAfterSetup: number, level: number) =>
      buildGuide(base({ state: 'charge', moveset: GREATSWORD_MOVESET, chargeId: 'greatsword', frame: c.frames + frameAfterSetup, chargeLevel: level }));
    const v0 = at(c.levels[0]! / 2, 0);
    expect(v0.mode).toBe('charge');
    expect(v0.charge).toMatchObject({ level: 0, levels: 2, release: '唐竹割り', max: '地割り' });
    expect(v0.charge!.progress).toBeCloseTo(0.5, 1);
    const v2 = at(c.levels[1]! + 5, 2);
    expect(v2.charge).toMatchObject({ level: 2, release: '地割り', progress: 1 });
    expect(v2.charge!.max).toBeNull(); // 最大の段階なら、離したときの技がそのまま最大
    expect(buildGuide(base({ state: 'charge', frame: 2 })).charge!.progress).toBe(0); // 構えが整う前
  });

  it('ガード・被弾・戦闘不能では出さない', () => {
    for (const state of ['guard', 'hit', 'dead'] as const) expect(buildGuide(base({ state })).mode).toBe('hidden');
  });

  it('すべての技の id に表示名がある（名前の付け忘れ）', () => {
    for (const id of Object.keys(ATTACKS)) expect(MOVE_NAMES[id], `表示名が無い: ${id}`).toBeTruthy();
  });
});

describe('buildMoveTree（技表）', () => {
  const flat = (nodes: MoveNode[], depth = 0): string[] => nodes.flatMap((n) => [`${'  '.repeat(depth)}${n.input}: ${n.name}`, ...flat(n.children, depth + 1)]);

  it('片手剣: 始動の技と、袈裟 → 逆袈裟 → 突き の連携・分岐が木になる', () => {
    const lines = flat(buildMoveTree(SWORD_MOVESET, 'sword'));
    expect(lines).toContain('攻撃: 袈裟斬り');
    expect(lines).toContain('  連打: 逆袈裟');
    expect(lines).toContain('    連打: 突き');
    expect(lines).toContain('      前 + 攻撃: 打ち上げ');
    expect(lines).toContain('  後ろ + 攻撃: 跳び退き斬り');
    expect(lines).toContain('    横 + 攻撃: 回転斬り');
    expect(lines).toContain('攻撃を長押し → 離す: 溜め斬り');
  });

  it('大剣: 最大まで溜めて離す = 地割り が別の行で出る', () => {
    const lines = flat(buildMoveTree(GREATSWORD_MOVESET, 'greatsword'));
    expect(lines).toContain('攻撃を長押し → 離す: 唐竹割り');
    expect(lines).toContain('最大まで溜めて離す: 地割り');
    expect(lines).toContain('  連打: 逆袈裟');
    expect(lines).toContain('    前 + 攻撃: 叩き落とし');
  });

  it('横・後ろの入力はロックが要ると印が付く', () => {
    const nodes = buildMoveTree(SWORD_MOVESET, 'sword');
    expect(nodes.find((n) => n.input === '横 + 攻撃')!.needsLock).toBe(true);
    expect(nodes.find((n) => n.input === '前 + 攻撃')!.needsLock).toBe(false);
  });

  it('循環があっても止まる（A → B → A）', () => {
    const data = {
      attacks: { a: { next: 'b' }, b: { next: 'a' } },
      charges: {},
      name: (id: string) => id,
    };
    const nodes = buildMoveTree({ light: 'a', lunge: 'a', retreat: 'a', sweep: 'a', dashRoll: 'a', dashBack: 'a' }, 'none', data);
    expect(flat(nodes).length).toBeLessThan(40);
    expect(flat(nodes)[0]).toBe('攻撃: a');
    expect(flat(nodes)[1]).toBe('  連打: b');
  });
});
