import { describe, expect, it } from 'vitest';
import { Growth } from './growth';
import { GROWTH, totalXpTo, xpToNext } from './data/growth';
import { SKILL_LEVEL_MAX, SKILL_ORDER } from './data/skills';
import { PASSIVES, PASSIVE_ORDER, unmetPrereqs } from './data/passives';
import { STAT_BASE, STAT_IDS } from './data/stats';
import { DEMO_ENCOUNTER } from '../ai/data/encounters';
import { ENEMIES, type EnemyDef } from '../ai/data/enemies';

/** 決まった種の乱数（テストの再現のため） */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const spentStat = (g: Growth) => STAT_IDS.reduce((a, id) => a + g.stat(id) - STAT_BASE, 0);
const spentSkill = (g: Growth) => SKILL_ORDER.reduce((a, id) => a + g.skillLevel(id) - 1, 0) + PASSIVE_ORDER.reduce((a, id) => a + g.passiveLevel(id), 0);

/** 不変条件: 未使用 + 振った = もらった */
function expectInvariant(g: Growth): void {
  expect(g.statPoints + spentStat(g)).toBe((g.level - 1) * GROWTH.statPointsPerLevel);
  expect(g.skillPoints + spentSkill(g)).toBe((g.level - 1) * GROWTH.skillPointsPerLevel);
}

describe('経験値の曲線', () => {
  it('次のレベルまでに要る経験値は単調に増え、上限のレベルでは 0', () => {
    for (let l = 1; l < GROWTH.levelMax - 1; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
    expect(xpToNext(GROWTH.levelMax)).toBe(0);
    expect(xpToNext(1)).toBe(27);
  });
  it('デモ 1 周ぶんの経験値で Lv7 前後、5 周で Lv15 前後（docs/07 §3.1 の目安）', () => {
    const one = demoXp();
    expect(one).toBe(660);
    const lv = (xp: number) => {
      const g = new Growth();
      g.addXp(xp);
      return g.level;
    };
    expect(lv(one)).toBeGreaterThanOrEqual(7);
    expect(lv(one)).toBeLessThanOrEqual(8);
    expect(lv(one * 5)).toBeGreaterThanOrEqual(14);
    expect(lv(one * 5)).toBeLessThanOrEqual(16);
  });
  it('totalXpTo は xpToNext の合計', () => {
    expect(totalXpTo(1)).toBe(0);
    expect(totalXpTo(3)).toBe(xpToNext(1) + xpToNext(2));
  });
});

/** デモの戦闘で倒す敵の経験値の合計（ボスの呼ぶ手下は含まない。EnemyDef.xp は出現表の敵だけが数える） */
function demoXp(): number {
  let sum = 0;
  for (const wave of DEMO_ENCOUNTER.waves) for (const w of wave) sum += (ENEMIES[w.type] as EnemyDef).xp ?? 0;
  return sum;
}

describe('経験値とレベルアップ', () => {
  it('溜まっただけでは上がらず、必要な量に届くとレベルが上がり、余りは持ち越す', () => {
    const g = new Growth();
    expect(g.addXp(26)).toBe(0);
    expect(g.level).toBe(1);
    expect(g.addXp(1)).toBe(1);
    expect(g.level).toBe(2);
    expect(g.xp).toBe(0);
    g.addXp(xpToNext(2) + 5);
    expect(g.level).toBe(3);
    expect(g.xp).toBe(5);
  });
  it('1 レベルごとに、ステータスポイント +3・スキルポイント +1', () => {
    const g = new Growth();
    expect(g.addXp(totalXpTo(5))).toBe(4);
    expect(g.level).toBe(5);
    expect(g.statPoints).toBe(12);
    expect(g.skillPoints).toBe(4);
    expectInvariant(g);
  });
  it('一度に何レベルも上がる', () => {
    const g = new Growth();
    expect(g.addXp(100000)).toBe(GROWTH.levelMax - 1);
    expect(g.level).toBe(GROWTH.levelMax);
    expect(g.xp).toBe(0);
    expectInvariant(g);
  });
  it('上限のレベルでは経験値は増えず、レベルアップもしない', () => {
    const g = new Growth({ level: GROWTH.levelMax });
    expect(g.maxed).toBe(true);
    expect(g.addXp(1000)).toBe(0);
    expect(g.xp).toBe(0);
    expect(g.xpNeed).toBe(0);
  });
  it('0 以下・非数の経験値は無視する', () => {
    const g = new Growth();
    expect(g.addXp(0)).toBe(0);
    expect(g.addXp(-5)).toBe(0);
    expect(g.addXp(Number.NaN)).toBe(0);
    expect(g.xp).toBe(0);
  });
  it('serial は変化があったときだけ増える', () => {
    const g = new Growth();
    const s0 = g.serial;
    g.addXp(0);
    expect(g.serial).toBe(s0);
    g.addXp(5);
    expect(g.serial).toBeGreaterThan(s0);
  });
});

describe('ステータスの振り分け', () => {
  const lv = (n: number) => {
    const g = new Growth();
    g.addXp(totalXpTo(n));
    return g;
  };

  it('ポイントがあれば振れて、1 つ使う。ポイントが無ければ振れない', () => {
    const g = lv(2);
    expect(g.statPoints).toBe(3);
    expect(g.addStat('str')).toBe(true);
    expect(g.stat('str')).toBe(STAT_BASE + 1);
    expect(g.statPoints).toBe(2);
    g.addStat('dex');
    g.addStat('dex');
    expect(g.statPoints).toBe(0);
    expect(g.addStat('vit')).toBe(false);
    expect(g.stat('vit')).toBe(STAT_BASE);
    expectInvariant(g);
  });
  it('戻せるのは、編集を始めてから振った分だけ（始める前に振った分は戻せない）', () => {
    const g = lv(3);
    g.addStat('str'); // 編集の前に振った
    g.beginEdit();
    expect(g.canRemoveStat('str')).toBe(false);
    g.addStat('str');
    g.addStat('agi');
    expect(g.canRemoveStat('str')).toBe(true);
    expect(g.removeStat('str')).toBe(true);
    expect(g.removeStat('str')).toBe(false); // 編集の前の分は戻せない
    expect(g.stat('str')).toBe(STAT_BASE + 1);
    expect(g.removeStat('agi')).toBe(true);
    expectInvariant(g);
  });
  it('編集を終えると、振った分は戻せなくなる', () => {
    const g = lv(2);
    g.beginEdit();
    g.addStat('int');
    g.endEdit();
    expect(g.canRemoveStat('int')).toBe(false);
  });
  it('全部振り直す（無料）と、振った点がすべてポイントに戻る', () => {
    const g = lv(6);
    for (let i = 0; i < 9; i++) g.addStat(STAT_IDS[i % 5]!);
    g.resetStats();
    for (const id of STAT_IDS) expect(g.stat(id)).toBe(STAT_BASE);
    expect(g.statPoints).toBe(15);
    expectInvariant(g);
  });
  it('振り直したあとの編集は、振り直した状態が起点（さらに戻せない）', () => {
    const g = lv(3);
    g.beginEdit();
    g.addStat('str');
    g.resetStats();
    expect(g.canRemoveStat('str')).toBe(false);
  });
  it('Modifiers は振ると変わる（変化があったときだけ作り直す）', () => {
    const g = lv(4);
    const m0 = g.modifiers;
    expect(g.modifiers).toBe(m0);
    g.addStat('str');
    expect(g.modifiers).not.toBe(m0);
    expect(g.modifiers.damage).toBeGreaterThan(m0.damage);
  });
});

describe('スキルポイント', () => {
  const lv = (n: number) => {
    const g = new Growth();
    g.addXp(totalXpTo(n));
    return g;
  };
  it('全スキルが Lv1 から始まり、スキルポイント 1 でレベルが 1 上がる（上限 Lv10）', () => {
    const g = lv(4);
    for (const id of SKILL_ORDER) expect(g.skillLevel(id)).toBe(1);
    expect(g.skillPoints).toBe(3);
    expect(g.addSkill('yotsuba')).toBe(true);
    expect(g.skillLevel('yotsuba')).toBe(2);
    expect(g.skillPoints).toBe(2);
    expectInvariant(g);
  });
  it('上限（Lv10）を超えては上げられない。ポイントが無くても上げられない', () => {
    // Lv30 = スキルポイント 29。1 本を Lv10 まで上げるのに 9 ポイント
    const g = new Growth({ level: GROWTH.levelMax });
    expect(g.skillPoints).toBe(29);
    for (let i = 0; i < 20; i++) g.addSkill('issen');
    expect(g.skillLevel('issen')).toBe(SKILL_LEVEL_MAX);
    expect(g.skillPoints).toBe(29 - (SKILL_LEVEL_MAX - 1));
    expect(g.addSkill('issen')).toBe(false);
    // 残りを使い切ると、ほかのスキルも上げられない
    for (let i = 0; i < 40; i++) for (const id of SKILL_ORDER) g.addSkill(id);
    expect(g.skillPoints).toBe(0);
    for (const id of SKILL_ORDER) expect(g.addSkill(id)).toBe(false);
    expectInvariant(g);
  });
  it('戻せるのは編集を始めてから上げた分だけ。Lv1 より下にはならない', () => {
    const g = lv(5);
    g.addSkill('samidare');
    g.beginEdit();
    g.addSkill('samidare');
    expect(g.removeSkill('samidare')).toBe(true);
    expect(g.removeSkill('samidare')).toBe(false);
    expect(g.skillLevel('samidare')).toBe(2);
    expect(g.removeSkill('yotsuba')).toBe(false);
    expectInvariant(g);
  });
  it('全部振り直す（無料）と Lv1 に戻り、ポイントが返る', () => {
    const g = lv(8);
    g.addSkill('yotsuba');
    g.addSkill('yotsuba');
    g.addSkill('issen');
    g.resetSkills();
    for (const id of SKILL_ORDER) expect(g.skillLevel(id)).toBe(1);
    expect(g.skillPoints).toBe(7);
    expectInvariant(g);
  });
});

describe('どんな操作の順でも不変条件が崩れない', () => {
  it('ランダムな操作（経験値・振る・戻す・振り直し・編集の開始 / 終了）を長く', () => {
    for (const seed of [1, 2, 3, 4]) {
      const r = rng(seed * 101);
      const g = new Growth();
      for (let i = 0; i < 4000; i++) {
        const k = r();
        const stat = STAT_IDS[Math.floor(r() * 5)]!;
        const skill = SKILL_ORDER[Math.floor(r() * SKILL_ORDER.length)]!;
        const passive = PASSIVE_ORDER[Math.floor(r() * PASSIVE_ORDER.length)]!;
        if (k < 0.08) g.addXp(Math.floor(r() * 200));
        else if (k < 0.22) g.addStat(stat);
        else if (k < 0.3) g.removeStat(stat);
        else if (k < 0.4) g.addSkill(skill);
        else if (k < 0.46) g.removeSkill(skill);
        else if (k < 0.6) g.addPassive(passive);
        else if (k < 0.68) g.removePassive(passive);
        else if (k < 0.72) g.resetStats();
        else if (k < 0.76) g.resetSkills();
        else if (k < 0.86) g.beginEdit();
        else if (k < 0.95) g.endEdit();
        expectInvariant(g);
        // パッシブは、どの操作のあとでも、範囲の中で前提を満たしている
        for (const id of PASSIVE_ORDER) {
          expect(g.passiveLevel(id)).toBeGreaterThanOrEqual(0);
          expect(g.passiveLevel(id)).toBeLessThanOrEqual(PASSIVES[id].levelMax);
          if (g.passiveLevel(id) > 0) expect(unmetPrereqs(g.passiveLevels, id)).toEqual([]);
        }
        for (const id of STAT_IDS) expect(g.stat(id)).toBeGreaterThanOrEqual(STAT_BASE);
        for (const id of SKILL_ORDER) {
          expect(g.skillLevel(id)).toBeGreaterThanOrEqual(1);
          expect(g.skillLevel(id)).toBeLessThanOrEqual(SKILL_LEVEL_MAX);
        }
      }
    }
  });
});

describe('保存したものから戻す（壊れていても動く）', () => {
  it('スナップショットから同じ状態に戻る', () => {
    const a = new Growth();
    a.addXp(totalXpTo(6) + 10);
    a.addStat('str');
    a.addStat('vit');
    a.addSkill('houzan');
    const b = new Growth(a.toSnapshot());
    expect(b.toSnapshot()).toEqual(a.toSnapshot());
    expect(b.modifiers).toEqual(a.modifiers);
  });
  it('範囲外・小数・非数は丸める', () => {
    const g = new Growth({ level: 999, xp: -5, statPoints: 1.6, skillPoints: Number.NaN });
    expect(g.level).toBe(GROWTH.levelMax);
    expect(g.xp).toBe(0);
    expectInvariant(g);
    const h = new Growth({ level: 0.2, xp: 1e9 });
    expect(h.level).toBe(1);
    expect(h.xp).toBe(xpToNext(1) - 1);
  });
  it('ポイントの合計が合わない（壊れている・書き換えた）セーブは、振り分けを初期に戻してポイントを返す', () => {
    const g = new Growth({ level: 5, statPoints: 0, skillPoints: 0, stats: { str: 50, dex: 5, agi: 5, int: 5, vit: 5 } });
    for (const id of STAT_IDS) expect(g.stat(id)).toBe(STAT_BASE);
    expect(g.statPoints).toBe(12);
    expectInvariant(g);
    const h = new Growth({ level: 3, skillPoints: 0, skills: { yotsuba: 10 } as never });
    expect(h.skillLevel('yotsuba')).toBe(1);
    expect(h.skillPoints).toBe(2);
  });
  it('正しく振り分けたセーブは、そのまま戻る', () => {
    const g = new Growth({ level: 5, statPoints: 7, skillPoints: 2, stats: { str: 10, dex: 5, agi: 5, int: 5, vit: 5 }, skills: { yotsuba: 3 } as never });
    expect(g.stat('str')).toBe(10);
    expect(g.statPoints).toBe(7);
    expect(g.skillLevel('yotsuba')).toBe(3);
    expect(g.skillLevel('issen')).toBe(1);
    expectInvariant(g);
  });
});

describe('最初から（reset）', () => {
  it('レベル・経験値・ポイント・ステータス・スキルのレベルが初期に戻る', () => {
    const g = new Growth();
    g.addXp(totalXpTo(9) + 5);
    g.addStat('str');
    g.addSkill('issen');
    g.beginEdit();
    g.addStat('dex');
    g.reset();
    expect(g.toSnapshot()).toEqual(new Growth().toSnapshot());
    expectInvariant(g);
    // 編集の途中でも、戻せる起点は初期の状態になる（さらに戻せない）
    expect(g.canRemoveStat('dex')).toBe(false);
  });
});

describe('パッシブ（習得・前提・取り下げ。ADR-037）', () => {
  /** スキルポイントを n 持ったプレイヤー（レベル n + 1） */
  const withSp = (n: number): Growth => {
    const g = new Growth();
    g.addXp(totalXpTo(n + 1));
    expect(g.skillPoints).toBe(n);
    return g;
  };

  it('パッシブは Lv0（未習得）から始まる。1 ポイントで習得し、以降 1 ポイントで 1 レベル。最大で止まる', () => {
    const g = withSp(10);
    for (const id of PASSIVE_ORDER) expect(g.passiveLevel(id)).toBe(0);
    expect(g.addPassive('agile')).toBe(true);
    expect(g.passiveLevel('agile')).toBe(1);
    expect(g.skillPoints).toBe(9);
    for (let i = 0; i < 4; i++) expect(g.addPassive('agile')).toBe(true);
    expect(g.passiveLevel('agile')).toBe(PASSIVES.agile.levelMax);
    expect(g.canAddPassive('agile')).toBe(false);
    expect(g.addPassive('agile')).toBe(false);
    expect(g.skillPoints).toBe(5);
    expectInvariant(g);
  });

  it('ポイントが無ければ習得できない', () => {
    const g = new Growth();
    expect(g.canAddPassive('agile')).toBe(false);
    expect(g.addPassive('agile')).toBe(false);
  });

  it('前提のあるパッシブは、前提を満たすまで習得できない（急所突きは会心の心得 Lv2 から）', () => {
    const g = withSp(10);
    expect(g.canAddPassive('critPower')).toBe(false);
    g.addPassive('critChance');
    expect(g.canAddPassive('critPower')).toBe(false); // Lv1 では足りない
    g.addPassive('critChance');
    expect(g.canAddPassive('critPower')).toBe(true);
    expect(g.addPassive('critPower')).toBe(true);
    expect(g.passiveLevel('critPower')).toBe(1);
  });

  it('前提は 2 段になる（追い打ち ← 受け流し ← 見切り）', () => {
    const g = withSp(10);
    expect(g.canAddPassive('followUp')).toBe(false);
    expect(g.canAddPassive('parryArt')).toBe(false);
    g.addPassive('evasion');
    expect(g.canAddPassive('parryArt')).toBe(true);
    expect(g.canAddPassive('followUp')).toBe(false);
    g.addPassive('parryArt');
    expect(g.canAddPassive('followUp')).toBe(true);
  });

  it('戻せるのは、メニューを開いてから上げた分だけ。開く前に上げた分は戻せない', () => {
    const g = withSp(5);
    g.addPassive('agile');
    g.beginEdit();
    expect(g.canRemovePassive('agile')).toBe(false);
    g.addPassive('agile');
    expect(g.canRemovePassive('agile')).toBe(true);
    expect(g.removePassive('agile')).toBe(true);
    expect(g.passiveLevel('agile')).toBe(1);
    expect(g.canRemovePassive('agile')).toBe(false);
    g.endEdit();
    expect(g.canRemovePassive('agile')).toBe(false); // 編集の外では戻せない
  });

  it('前提を割る取り下げはできない（急所突きを習得したまま、会心の心得を Lv2 から Lv1 には戻せない）。依存が先なら戻せる', () => {
    const g = withSp(6);
    g.beginEdit();
    g.addPassive('critChance');
    g.addPassive('critChance');
    g.addPassive('critPower');
    expect(g.canRemovePassive('critChance')).toBe(false);
    expect(g.removePassive('critChance')).toBe(false);
    expect(g.removePassive('critPower')).toBe(true);
    expect(g.canRemovePassive('critChance')).toBe(true);
    expect(g.removePassive('critChance')).toBe(true);
    expectInvariant(g);
  });

  it('全部振り直す（無料）と、剣技のレベルもパッシブも初期に戻り、ポイントが返る', () => {
    const g = withSp(8);
    g.addSkill('yotsuba');
    g.addPassive('critChance');
    g.addPassive('critChance');
    g.addPassive('critPower');
    g.addPassive('agile');
    g.beginEdit();
    g.addPassive('agile');
    g.resetSkills();
    expect(g.skillPoints).toBe(8);
    expect(g.skillLevel('yotsuba')).toBe(1);
    for (const id of PASSIVE_ORDER) expect(g.passiveLevel(id)).toBe(0);
    // 振り直したあとの編集は、振り直した状態が起点（さらに戻せない）
    expect(g.canRemovePassive('agile')).toBe(false);
    expectInvariant(g);
  });

  it('modifiersFor は、パッシブ込み・系統ごと。stats だけの modifiers は変わらない。変化があったときだけ作り直す', () => {
    const g = withSp(6);
    const base = g.modifiersFor('sword');
    expect(g.modifiersFor('sword')).toBe(base); // キャッシュ
    g.addPassive('swordMastery');
    g.addPassive('swordMastery');
    const sword = g.modifiersFor('sword');
    const great = g.modifiersFor('greatsword');
    expect(sword).not.toBe(base);
    expect(sword.damage).toBeCloseTo(1.08, 9);
    expect(great.damage).toBeCloseTo(1, 9); // 大剣では効かない
    expect(g.modifiers.damage).toBe(1); // stats だけ
    expect(g.modifiersFor('sword')).toBe(sword);
  });

  it('保存から戻す: パッシブが往復する。範囲外は丸める。前提を割った・ポイントの合わないセーブは、スキルもパッシブも初期に戻してポイントを返す', () => {
    const a = withSp(8);
    a.addPassive('critChance');
    a.addPassive('critChance');
    a.addPassive('critPower');
    a.addSkill('houzan');
    const b = new Growth(a.toSnapshot());
    expect(b.toSnapshot()).toEqual(a.toSnapshot());
    expect(b.modifiersFor('sword')).toEqual(a.modifiersFor('sword'));
    // 前提を割ったセーブ（急所突きだけ習得しているのに、会心の心得が 0）
    const base = withSp(4).toSnapshot();
    const broken = new Growth({ ...base, skillPoints: 3, passives: { ...base.passives, critPower: 1 } });
    for (const id of PASSIVE_ORDER) expect(broken.passiveLevel(id)).toBe(0);
    expect(broken.skillPoints).toBe(4);
    // ポイントの合わないセーブ
    const cheat = new Growth({ ...base, passives: { ...base.passives, agile: 5 } });
    expect(cheat.passiveLevel('agile')).toBe(0);
    expect(cheat.skillPoints).toBe(4);
    // 範囲外・小数は丸める（合計が合うように与える）
    const clamp = new Growth({ ...base, skillPoints: 4 - 5, passives: { ...base.passives, agile: 99 } });
    expectInvariant(clamp);
    expect(clamp.passiveLevel('agile')).toBeLessThanOrEqual(PASSIVES.agile.levelMax);
  });

  it('passives の無い古いスナップショットでも、未習得として読める', () => {
    const snap = withSp(3).toSnapshot();
    const { passives: _p, ...old } = snap;
    void _p;
    const g = new Growth(old);
    for (const id of PASSIVE_ORDER) expect(g.passiveLevel(id)).toBe(0);
    expect(g.skillPoints).toBe(3);
  });
});
