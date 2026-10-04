import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { resolvePlayerAttack, type CombatTarget } from './combat';
import { Enemy } from '../ai/enemy';
import { ENEMIES, type EnemyDef } from '../ai/data/enemies';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import { ATTACKS, DODGES, MOVE, PLAYER_STATS, resolveAttack } from '../combat/data/attacks';
import { GUARDS } from '../combat/data/guard';
import { computeModifiers, baseStats, BASE_MODIFIERS } from '../combat/modifiers';
import { STAT_BASE, type StatId } from '../combat/data/stats';
import { Mystical } from '../combat/mystical';
import { MYSTICAL } from '../combat/data/mystical';
import { SkillBook } from '../combat/skills';
import type { HitEvent } from '../combat/hit';

/**
 * 成長（ステータス → Modifiers）が戦闘の数値に効くことの、本物の Player との結合テスト（ADR-033）。
 * 戦闘のコードは数値を Player.mods（Modifiers）だけから読む。初期のままなら従来と全く同じ。
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const DUMMY: EnemyDef = { ...ENEMIES.imp, hp: 999999, knockbackScale: 0 };
const mods = (id: StatId, points: number) => computeModifiers({ ...baseStats(), [id]: STAT_BASE + points });
const step = (p: Player, over: Partial<InputIntent> = {}, n = 1) => {
  for (let i = 0; i < n; i++) p.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
};
const hit = (over: Partial<HitEvent> = {}): HitEvent => ({ attackerId: 1, targetId: 0, damage: 20, knockback: 0.9, hitStop: 6, dirX: 0, dirZ: -1, x: 0, z: 0.4, ...over });

/** 的を (0, z) に置いて、最初の攻撃で当たるダメージ・ノックバックを測る */
function firstHit(m: Parameters<Player['setModifiers']>[0]): HitEvent {
  const p = new Player();
  p.setModifiers(m);
  const e = new Enemy(DUMMY, 1, 0, 1.4);
  e.place(0, 1.4, Math.PI);
  let ev: HitEvent | null = null;
  step(p, { attackPressed: true });
  for (let i = 0; i < 60 && !ev; i++) {
    step(p);
    e.step(DT, p.body.x, p.body.z, false);
    resolvePlayerAttack(p, [e] as CombatTarget[], (h) => (ev = h));
  }
  return ev!;
}

describe('STR: ダメージ・ノックバック', () => {
  it('初期のままなら、これまでと同じダメージ', () => {
    const base = firstHit(BASE_MODIFIERS);
    expect(base.damage).toBe(ATTACKS.combo1!.damage);
  });
  it('STR を振ると、当たるダメージとノックバックが増える', () => {
    const base = firstHit(BASE_MODIFIERS);
    const str = firstHit(mods('str', 30));
    expect(str.damage).toBe(Math.round(ATTACKS.combo1!.damage * 1.3));
    expect(str.damage).toBeGreaterThan(base.damage);
    expect(str.knockback).toBeCloseTo(base.knockback * 1.15, 9);
  });
});

describe('DEX: 攻撃の速さ・パリィの受付', () => {
  it('攻撃が速くなる（rate に倍率が掛かり、全体のフレームが短くなる）', () => {
    const slow = new Player();
    step(slow, { attackPressed: true });
    const fast = new Player();
    fast.setModifiers(mods('dex', 20));
    step(fast, { attackPressed: true });
    expect(slow.attack!.rate).toBe(1);
    expect(fast.attack!.rate).toBeCloseTo(1.1, 9);
    expect(fast.attackFrames!.total).toBeLessThan(slow.attackFrames!.total);
    expect(fast.attackFrames!.startup).toBeLessThan(slow.attackFrames!.startup);
    // 元の攻撃データは書き換えない
    expect(ATTACKS.combo1!.rate).toBe(1);
    expect(resolveAttack(ATTACKS.combo1!).total).toBe(slow.attackFrames!.total);
  });
  it('速くなった攻撃は、速くなった分だけ早く当たりを出す', () => {
    const base = new Player();
    const fast = new Player();
    fast.setModifiers(mods('dex', 30));
    step(base, { attackPressed: true });
    step(fast, { attackPressed: true });
    const firstActive = (p: Player) => {
      for (let f = 0; f < 80; f++) {
        step(p);
        if (p.attackActive) return f;
      }
      return -1;
    };
    expect(firstActive(fast)).toBeLessThan(firstActive(base));
  });
  it('パリィの受付が 10 点ごとに 1 フレーム伸びる（盾）', () => {
    const g = GUARDS.shield;
    const mk = (pts: number) => {
      const p = new Player();
      p.equip('sword-shield');
      p.setModifiers(mods('dex', pts));
      step(p, { guardPressed: true, guardHeld: true });
      return p;
    };
    const frames = (p: Player) => {
      let n = 0;
      for (let i = 0; i < 40; i++) {
        if (p.guardOutcome(hit()) === 'parry') n++;
        step(p, { guardHeld: true });
      }
      return n;
    };
    expect(frames(mk(0))).toBe(g.parryFrames);
    expect(frames(mk(20))).toBe(g.parryFrames + 2);
  });
});

describe('DEX: 会心率・会心ダメージ（ADR-035）', () => {
  /** 的を (0, 1.4) に置いて最初の攻撃を当てる。rng で会心を決める */
  function firstHitWith(m: Parameters<Player['setModifiers']>[0], rng: () => number): HitEvent {
    const p = new Player();
    p.setModifiers(m);
    const e = new Enemy(DUMMY, 1, 0, 1.4);
    e.place(0, 1.4, Math.PI);
    let ev: HitEvent | null = null;
    step(p, { attackPressed: true });
    for (let i = 0; i < 60 && !ev; i++) {
      step(p);
      e.step(DT, p.body.x, p.body.z, false);
      resolvePlayerAttack(p, [e] as CombatTarget[], (h) => (ev = h), rng);
    }
    return ev!;
  }

  it('Player の会心率・会心ダメージは Modifiers から読む。初期は 5% / ×1.5、DEX を振ると伸びる', () => {
    const p = new Player();
    expect(p.critRate).toBeCloseTo(0.05, 9);
    expect(p.critDamage).toBeCloseTo(1.5, 9);
    p.setModifiers(mods('dex', 20));
    expect(p.critRate).toBeCloseTo(0.15, 9);
    expect(p.critDamage).toBeCloseTo(1.8, 9);
  });

  it('DEX を振ると、会心したときのダメージが大きくなる（会心しないときは変わらない）', () => {
    const base = ATTACKS.combo1!.damage;
    const plain = firstHitWith(mods('dex', 20), () => 0.99);
    expect(plain.damage).toBe(base);
    expect(plain.crit).toBeUndefined();
    const lo = firstHitWith(BASE_MODIFIERS, () => 0);
    const hi = firstHitWith(mods('dex', 20), () => 0);
    expect(lo.crit).toBe(true);
    expect(lo.damage).toBe(Math.round(base * 1.5));
    expect(hi.damage).toBe(Math.round(base * 1.8));
  });

  it('DEX を振ると、会心の出やすさが上がる（同じ乱数 0.1 で、初期は通常・DEX 20 は会心）', () => {
    expect(firstHitWith(BASE_MODIFIERS, () => 0.1).crit).toBeUndefined();
    expect(firstHitWith(mods('dex', 20), () => 0.1).crit).toBe(true);
  });
});

describe('AGI: 移動・回避の無敵・ミスティカル', () => {
  it('走る速さが伸びる', () => {
    const run = (m: Parameters<Player['setModifiers']>[0]) => {
      const p = new Player();
      p.setModifiers(m);
      step(p, { moveX: 0, moveY: 1 }, 90);
      return p.body.z;
    };
    const base = run(BASE_MODIFIERS);
    const agi = run(mods('agi', 30));
    expect(agi).toBeGreaterThan(base * 1.1);
    expect(agi).toBeLessThan(base * 1.25);
  });
  it('回避の無敵が 8 点ごとに 1 フレーム伸びる', () => {
    const d = DODGES.roll;
    const dur = (pts: number) => {
      const p = new Player();
      p.setModifiers(mods('agi', pts));
      step(p, { dodgePressed: true, moveX: 0, moveY: 1 }); // 前へ = ロール
      expect(p.dodgeKind).toBe('roll');
      let n = 0;
      for (let i = 0; i < 60; i++) {
        if (p.state === 'dodge' && p.invulnerable) n++;
        step(p, { moveX: 0, moveY: 1 });
      }
      return n;
    };
    const base = dur(0);
    expect(base).toBeGreaterThanOrEqual(d.invulnEnd - d.invulnStart);
    expect(dur(16)).toBe(base + 2);
  });
  it('ミスティカルドッジの続く長さが伸びる（残りの割合は 1 から減る）', () => {
    const m = new Mystical();
    expect(m.trigger(0)).toBe(true);
    expect(m.remaining).toBe(MYSTICAL.durationFrames);
    const n = new Mystical();
    expect(n.trigger(45)).toBe(true);
    expect(n.remaining).toBe(MYSTICAL.durationFrames + 45);
    expect(n.ratio).toBeCloseTo(1, 9);
    n.remaining -= 45;
    expect(n.ratio).toBeLessThan(1);
    expect(n.ratio).toBeGreaterThan(0.7);
  });
});

describe('VIT: 最大体力・受けるダメージ', () => {
  it('最大体力が増え、増えた分だけ体力も増える。減らしても最大を超えない', () => {
    const p = new Player();
    expect(p.health.max).toBe(PLAYER_STATS.maxHp);
    p.setModifiers(mods('vit', 10));
    expect(p.health.max).toBe(PLAYER_STATS.maxHp + 20);
    expect(p.health.hp).toBe(PLAYER_STATS.maxHp + 20);
    p.takeHit(hit({ damage: 30 }));
    const hp = p.health.hp;
    p.setModifiers(mods('vit', 20));
    expect(p.health.max).toBe(PLAYER_STATS.maxHp + 40);
    expect(p.health.hp).toBe(hp + 20);
    p.setModifiers(BASE_MODIFIERS);
    expect(p.health.max).toBe(PLAYER_STATS.maxHp);
    expect(p.health.hp).toBeLessThanOrEqual(PLAYER_STATS.maxHp);
    expect(p.health.hp).toBeGreaterThan(0);
  });
  it('受けるダメージが軽くなる（最低 1）。初期のままなら従来どおり', () => {
    const a = new Player();
    a.takeHit(hit({ damage: 20 }));
    expect(a.health.max - a.health.hp).toBe(20);
    const b = new Player();
    b.setModifiers(mods('vit', 30));
    const before = b.health.hp;
    b.takeHit(hit({ damage: 20 }));
    expect(before - b.health.hp).toBe(Math.round(20 * 0.91));
    const c = new Player();
    c.setModifiers(mods('vit', 90));
    const hp0 = c.health.hp;
    c.takeHit(hit({ damage: 1 }));
    expect(hp0 - c.health.hp).toBe(1);
  });
  it('ガードで受けた削りにも掛かる', () => {
    const mk = (pts: number) => {
      const p = new Player();
      p.equip('sword-shield');
      p.setModifiers(mods('vit', pts));
      step(p, { guardPressed: true, guardHeld: true });
      step(p, { guardHeld: true }, 20);
      const before = p.health.hp;
      p.guardBlock(hit({ damage: 40 }));
      return before - p.health.hp;
    };
    expect(mk(30)).toBeLessThan(mk(0));
  });
  it('死んだときは体力を増やさない（復活しない）', () => {
    const p = new Player();
    p.takeHit(hit({ damage: 999 }));
    expect(p.dead).toBe(true);
    p.setModifiers(mods('vit', 50));
    expect(p.health.hp).toBe(0);
    expect(p.dead).toBe(true);
  });
  it('再戦（reset）で、増えた最大体力まで満タンになる', () => {
    const p = new Player();
    p.setModifiers(mods('vit', 10));
    p.takeHit(hit({ damage: 50 }));
    p.reset();
    expect(p.health.hp).toBe(PLAYER_STATS.maxHp + 20);
  });
});

describe('INT: スキルの威力', () => {
  it('SkillBook.prepare の威力に倍率が掛かる', () => {
    const book = new SkillBook();
    book.select('yotsuba');
    const a = book.prepare('sword')!;
    const b = book.prepare('sword', 1.2)!;
    for (let i = 0; i < a.steps.length; i++) expect(b.steps[i]!.power).toBeCloseTo(a.steps[i]!.power * 1.2, 9);
  });
  it('クールダウンは start の倍率で縮む', () => {
    const a = new SkillBook();
    a.start('yotsuba', 1);
    const b = new SkillBook();
    b.start('yotsuba', 0.6);
    expect(b.cooldownRatio('yotsuba')).toBe(1);
    let na = 0;
    while (!a.ready('yotsuba')) {
      a.step();
      na++;
    }
    let nb = 0;
    while (!b.ready('yotsuba')) {
      b.step();
      nb++;
    }
    expect(nb).toBeLessThan(na * 0.7);
  });
});

describe('移動の速さの基準', () => {
  it('初期のままの走る速さは従来どおり（Modifiers が足されても変わらない）', () => {
    const p = new Player();
    step(p, { moveX: 0, moveY: 1 }, 120);
    expect(p.speed).toBeCloseTo(MOVE.runSpeed, 1);
  });
});
