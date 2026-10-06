import { describe, expect, it } from 'vitest';
import { SPELLS, SPELL_TARGETING, BOLT_BURSTS, type BeamSpell, type ConeSpell, type RegenSpell, type RingSpell, type StrikeSpell } from './data/spells';
import { CRIT } from './data/crit';
import { SpellSystem, pickSpellTarget, type CastParams, type SpellCasterView, type SpellHandlers, type SpellHitInfo, type SpellTarget, type SpellTargetCand } from './spell-system';
import type { HitEvent, Hurtbox } from './hit';

/** 魔法（杖。ADR-048）の sim。落雷・爆発（予告 → 着弾・範囲・ターゲットに付いて動く）・吹雪（扇・刻み）・火炎放射（帯・向きの追従）・旋風（輪ごとに 1 回）・再生（回復）・ターゲット選び */

const THUNDER = SPELLS.thunder as StrikeSpell;
const EXPLOSION = SPELLS.explosion as StrikeSpell;
const BLIZZARD = SPELLS.blizzard as ConeSpell;
const FLAME = SPELLS.flame as BeamSpell;
const HURRICANE = SPELLS.hurricane as RingSpell;
const REGEN = SPELLS.regen as RegenSpell;

class Dummy implements SpellTarget {
  readonly body: Hurtbox;
  readonly hits: { ev: HitEvent; info: SpellHitInfo; frame: number }[] = [];
  hp = 100000;
  constructor(id: number, x: number, z: number, r = 0.5) {
    this.body = { id, x, z, r, invulnerable: false };
  }
  takeHit(ev: HitEvent) {
    this.hp -= ev.damage;
    return { dealt: ev.damage, killed: false };
  }
  get total(): number {
    return this.hits.reduce((n, h) => n + h.ev.damage, 0);
  }
}

interface Rig {
  sys: SpellSystem;
  caster: { body: { id: number; x: number; z: number; r: number; invulnerable: boolean }; yaw: number; liveCastSerial: number; channelingSerial: number; damageMul: number; critRate: number; critDamage: number };
  targets: Dummy[];
  frame: number;
  landed: { index: number; x: number; z: number; frame: number }[];
  rings: number[];
  heals: number[];
  hitInfos: SpellHitInfo[];
  step: (n?: number) => void;
}

function rig(opts: { rng?: () => number; world?: ConstructorParameters<typeof SpellSystem>[0]; critRate?: number } = {}): Rig {
  const sys = new SpellSystem(opts.world ?? null, 0, opts.rng ?? (() => 1));
  const r: Rig = {
    sys,
    caster: { body: { id: 0, x: 0, z: 0, r: 0.4, invulnerable: false }, yaw: 0, liveCastSerial: 1, channelingSerial: 1, damageMul: 1, critRate: opts.critRate ?? 0, critDamage: CRIT.baseDamage },
    targets: [],
    frame: 0,
    landed: [],
    rings: [],
    heals: [],
    hitInfos: [],
    step: (n = 1) => {
      for (let i = 0; i < n; i++) {
        const handlers: SpellHandlers<Dummy> = {
          onHit: (ev, t, _res, info) => {
            t.hits.push({ ev, info, frame: r.frame });
            r.hitInfos.push(info);
          },
          onLand: (_fx, p, index) => r.landed.push({ index, x: p.x, z: p.z, frame: r.frame }),
          onRing: (_fx, ring) => r.rings.push(ring),
          onHeal: (amount) => r.heals.push(amount),
        };
        sys.step(r.caster as SpellCasterView, r.targets, handlers);
        r.frame++;
      }
    },
  };
  return r;
}

const cast = (r: Rig, spell: (typeof SPELLS)[keyof typeof SPELLS], over: Partial<CastParams> = {}, target: SpellTargetCand | null = null) =>
  r.sys.cast(spell, { x: 0, z: 0, yaw: 0, power: 1, serial: 1, ...over }, target);

describe('pickSpellTarget: ロック → 正面の最も近い敵', () => {
  const cands: SpellTargetCand[] = [
    { id: 1, x: 0, z: 6 },
    { id: 2, x: 0, z: 3 },
    { id: 3, x: 0, z: -2 },
    { id: 4, x: 20, z: 0 },
  ];

  it('ロックしている敵は、遠くても・背後でも選ぶ', () => {
    expect(pickSpellTarget(cands, 0, 0, 0, 1)!.id).toBe(1);
    expect(pickSpellTarget(cands, 0, 0, 0, 3)!.id).toBe(3);
    expect(pickSpellTarget(cands, 0, 0, 0, 4)!.id).toBe(4);
  });

  it('ロックなしは、正面の扇の中でいちばん近い敵（背後・扇の外・遠すぎる敵は選ばない）', () => {
    expect(pickSpellTarget(cands, 0, 0, 0, null)!.id).toBe(2);
    // 向きを変えると、背後だった敵が正面になる
    expect(pickSpellTarget(cands, 0, 0, Math.PI, null)!.id).toBe(3);
    // 正面に敵がいなければ null（魔法は前方の点に放つ）
    expect(pickSpellTarget([cands[2]!, cands[3]!], 0, 0, 0, null)).toBeNull();
    expect(pickSpellTarget([], 0, 0, 0, null)).toBeNull();
  });

  it('扇の端（±frontConeDeg）の内外、最大の距離（maxRange）の内外で切り替わる', () => {
    const a = (SPELL_TARGETING.frontConeDeg * Math.PI) / 180;
    const at = (deg: number, d = 4): SpellTargetCand => ({ id: 9, x: Math.sin((deg * Math.PI) / 180) * d, z: Math.cos((deg * Math.PI) / 180) * d });
    expect(pickSpellTarget([at(SPELL_TARGETING.frontConeDeg - 2)], 0, 0, 0, null)).not.toBeNull();
    expect(pickSpellTarget([at(SPELL_TARGETING.frontConeDeg + 2)], 0, 0, 0, null)).toBeNull();
    expect(pickSpellTarget([at(0, SPELL_TARGETING.maxRange - 0.1)], 0, 0, 0, null)).not.toBeNull();
    expect(pickSpellTarget([at(0, SPELL_TARGETING.maxRange + 0.5)], 0, 0, 0, null)).toBeNull();
    expect(a).toBeGreaterThan(0);
  });
});

describe('落雷・爆発（strike）: 予告 → 着弾', () => {
  it('ターゲットの位置と、その周囲 around.count 個の点（ターゲットから ringMin〜ringMax の距離）に、時間差で落ちる', () => {
    const r = rig();
    const fx = cast(r, THUNDER, {}, { id: 5, x: 1, z: 5 }) as { points: { x: number; z: number; delay: number; radius: number; damage: number }[] };
    const ar = THUNDER.around!;
    expect(fx.points.length).toBe(1 + ar.count);
    expect(fx.points[0]).toMatchObject({ x: 1, z: 5, delay: THUNDER.warnFrames, radius: THUNDER.center.radius, damage: THUNDER.center.damage });
    fx.points.slice(1).forEach((p, i) => {
      const d = Math.hypot(p.x - 1, p.z - 5);
      expect(d).toBeGreaterThanOrEqual(ar.ringMin - 1e-9);
      expect(d).toBeLessThanOrEqual(ar.ringMax + 1e-9);
      expect(p.delay).toBe(THUNDER.warnFrames + (i + 1) * THUNDER.staggerFrames);
      expect(p.radius).toBe(ar.radius);
    });
  });

  it('ターゲットがいなければ、術者の前方 fallbackDistance の点に落ちる（向きは術者の向き）', () => {
    const r = rig();
    const fx = cast(r, THUNDER, { yaw: Math.PI / 2 }) as { points: { x: number; z: number }[] };
    expect(fx.points[0]!.x).toBeCloseTo(THUNDER.fallbackDistance, 9);
    expect(fx.points[0]!.z).toBeCloseTo(0, 9);
  });

  it('予告のあいだは当たらず、warnFrames 目のステップで着弾する（中心 = 一様のダメージ）。1 つの点は 1 回だけ', () => {
    const r = rig();
    const t = new Dummy(1, 0, 5);
    r.targets.push(t);
    cast(r, EXPLOSION, {}, { id: 1, x: 0, z: 5 });
    r.step(EXPLOSION.warnFrames);
    expect(t.hits.length).toBe(0);
    r.step();
    expect(t.hits.length).toBe(1);
    expect(t.hits[0]!.frame).toBe(EXPLOSION.warnFrames);
    expect(t.hits[0]!.ev.damage).toBe(EXPLOSION.center.damage);
    expect(t.hits[0]!.info.kind).toBe('strike');
    expect(t.hits[0]!.ev.chip).toBeUndefined();
    r.step(120);
    expect(t.hits.length).toBe(1);
    expect(r.sys.strikes.length).toBe(0); // 余韻のあと外れる
  });

  it('範囲の縁へ向けてダメージが edgeFalloff まで落ちる。範囲の外には当たらない（相手の体の半径は足して数える）', () => {
    const r = rig();
    const R = EXPLOSION.center.radius;
    const near = new Dummy(1, 0, 0, 0.5);
    const edge = new Dummy(2, R, 0, 0.5); // 中心までの距離 = R（体の半径 0.5 は縁にかかる）
    const out = new Dummy(3, R + 0.5 + 0.2, 0, 0.5); // 体の縁が範囲の外
    r.targets.push(near, edge, out);
    cast(r, EXPLOSION, { yaw: 0 }, { id: 99, x: 0, z: 0 });
    r.step(EXPLOSION.warnFrames + 1);
    expect(near.total).toBe(EXPLOSION.center.damage);
    expect(edge.total).toBe(Math.round(EXPLOSION.center.damage * EXPLOSION.edgeFalloff));
    expect(out.hits.length).toBe(0);
  });

  it('落ちる輪の点（周囲）は、ずれて遅れて落ち、そのどれにも 1 回ずつ当たる（周囲の点の上にいる敵にも当たる）', () => {
    const r = rig();
    const fx = cast(r, THUNDER, {}, { id: 1, x: 0, z: 6 }) as { points: { x: number; z: number; delay: number }[] };
    const on = fx.points[3]!;
    const t = new Dummy(2, on.x, on.z);
    r.targets.push(t);
    r.step(on.delay);
    expect(t.hits.length).toBe(0);
    r.step();
    expect(t.hits.length).toBeGreaterThanOrEqual(1);
    expect(t.hits[0]!.frame).toBe(on.delay);
    expect(r.landed.map((l) => l.index)).toEqual(Array.from({ length: r.landed.length }, (_, i) => i)); // 0, 1, 2, ... の順
  });

  it('予告の位置はターゲットに付いて動き、着弾の lockFrames 前に止まる。その後は走って逃げれば外れる', () => {
    const r = rig();
    const t = new Dummy(7, 0, 5);
    r.targets.push(t);
    const fx = cast(r, THUNDER, {}, { id: 7, x: 0, z: 5 }) as { points: { x: number; z: number }[] };
    const lockAt = THUNDER.warnFrames - THUNDER.lockFrames;
    r.step(5);
    t.body.x = 3;
    r.step();
    expect(fx.points[0]!.x).toBeCloseTo(3, 9);
    // 止まったあとは動いても追わない
    r.step(lockAt + 2 - r.frame);
    t.body.x = 9;
    r.step();
    expect(fx.points[0]!.x).toBeCloseTo(3, 9);
    // 着弾: 点は (3, 5)、敵は (9, 5) へ逃げているので当たらない
    r.step(THUNDER.warnFrames + 2 - r.frame);
    expect(t.hits.length).toBe(0);
  });

  it('倒れている・死んでいる相手（invulnerable）には当たらない。爆ぜる魔弾（addBurst）は直撃した相手（excludeId）に当てない', () => {
    const r = rig();
    const down = new Dummy(1, 0, 0);
    down.body.invulnerable = true;
    const direct = new Dummy(2, 0.5, 0);
    const other = new Dummy(3, 1.2, 0);
    r.targets.push(down, direct, other);
    const burst = BOLT_BURSTS.bolt3!;
    r.sys.addBurst(burst, 0, 0, 1, 1, direct.body.id);
    r.step();
    expect(down.hits.length).toBe(0);
    expect(direct.hits.length).toBe(0);
    expect(other.hits.length).toBe(1);
    expect(other.hits[0]!.info.kind).toBe('burst');
    expect(other.hits[0]!.frame).toBe(0); // 予告なし = すぐ
  });

  it('ダメージには、威力（スキルのレベル・INT）・STR の倍率・会心が掛かり、ヒットストップ・ノックバックは中心から外へ向かう', () => {
    const r = rig({ rng: () => 0, critRate: 1 });
    r.caster.damageMul = 1.2;
    const t = new Dummy(1, 0, 0);
    r.targets.push(t);
    cast(r, EXPLOSION, { power: 1.5 }, { id: 1, x: -0.0, z: 0 });
    r.step(EXPLOSION.warnFrames + 1);
    const ev = t.hits[0]!.ev;
    expect(ev.crit).toBe(true);
    expect(ev.damage).toBe(Math.round(EXPLOSION.center.damage * 1.5 * 1.2 * CRIT.baseDamage));
    expect(ev.hitStop).toBeGreaterThan(EXPLOSION.hitStop);
    expect(ev.knockback).toBeGreaterThan(EXPLOSION.knockback);
    // 中心から離れた敵は外向きに飛ぶ
    const r2 = rig();
    const t2 = new Dummy(2, 2, 0);
    r2.targets.push(t2);
    cast(r2, EXPLOSION, {}, { id: 1, x: 0, z: 0 });
    r2.step(EXPLOSION.warnFrames + 1);
    expect(t2.hits[0]!.ev.dirX).toBeCloseTo(1, 9);
    expect(t2.hits[0]!.ev.dirZ).toBeCloseTo(0, 9);
  });
});

describe('吹雪（cone）: 前方の扇に一定間隔で当たる', () => {
  it('扇の中（range・halfAngle の内）にだけ tickFrames ごとに当たる。当たりは継続の刻み（chip）で、ひるませない', () => {
    const r = rig();
    const front = new Dummy(1, 0, 3);
    const behind = new Dummy(2, 0, -3);
    const far = new Dummy(3, 0, BLIZZARD.range + 2);
    const side = new Dummy(4, 4, 0.5); // 横（扇の外）
    r.targets.push(front, behind, far, side);
    cast(r, BLIZZARD);
    r.step(BLIZZARD.frames);
    const ticks = Math.ceil(BLIZZARD.frames / BLIZZARD.tickFrames);
    expect(front.hits.length).toBe(ticks);
    expect(behind.hits.length).toBe(0);
    expect(far.hits.length).toBe(0);
    expect(side.hits.length).toBe(0);
    expect(front.hits.every((h) => h.ev.chip === true && h.info.kind === 'tick')).toBe(true);
    expect(front.hits.map((h) => h.frame)).toEqual(Array.from({ length: ticks }, (_, i) => i * BLIZZARD.tickFrames));
    expect(front.total).toBe(ticks * BLIZZARD.damage);
  });

  it('術者に付いて動く: 向きを変えると、扇が回る', () => {
    const r = rig();
    const t = new Dummy(1, 3, 0); // +X 側
    r.targets.push(t);
    cast(r, BLIZZARD);
    r.step(2);
    expect(t.hits.length).toBe(0);
    r.caster.yaw = Math.PI / 2; // +X を向く
    r.step(BLIZZARD.tickFrames);
    expect(t.hits.length).toBeGreaterThan(0);
  });

  it('術者が詠唱をやめたら（回避・被弾。liveCastSerial が変わる）止まる。ほかの詠唱の番号になっても止まる', () => {
    const r = rig();
    const t = new Dummy(1, 0, 3);
    r.targets.push(t);
    cast(r, BLIZZARD);
    r.step(BLIZZARD.tickFrames * 2 + 1);
    const before = t.hits.length;
    expect(before).toBe(3);
    r.caster.liveCastSerial = 0;
    r.step(BLIZZARD.frames);
    expect(t.hits.length).toBe(before);
    expect(r.sys.cones.length).toBe(0); // 余韻のあと外れる
    // 別の詠唱の番号でも止まる
    const r2 = rig();
    const t2 = new Dummy(1, 0, 3);
    r2.targets.push(t2);
    cast(r2, BLIZZARD, { serial: 1 });
    r2.caster.liveCastSerial = 2;
    r2.step(BLIZZARD.frames);
    expect(t2.hits.length).toBe(0);
  });
});

describe('火炎放射（beam）: 前方の帯。放出のあいだ向きを変えられる', () => {
  it('杖の先から前へ length・width の帯に当たる（帯の幅は半分 + 相手の体の半径）。tickFrames ごと', () => {
    const r = rig();
    const inBeam = new Dummy(1, 0, 4);
    const edge = new Dummy(2, FLAME.width / 2 + 0.5 - 0.05, 4);
    const outSide = new Dummy(3, FLAME.width / 2 + 0.5 + 0.1, 4);
    const tooFar = new Dummy(4, 0, SPELL_TARGETING.muzzle + FLAME.length + 2); // 帯の端から体の半径 + 太さの半分より遠い
    const behind = new Dummy(5, 0, -3);
    r.targets.push(inBeam, edge, outSide, tooFar, behind);
    cast(r, FLAME);
    r.step(FLAME.frames);
    const ticks = Math.ceil(FLAME.frames / FLAME.tickFrames);
    expect(inBeam.hits.length).toBe(ticks);
    expect(edge.hits.length).toBe(ticks);
    expect(outSide.hits.length).toBe(0);
    expect(tooFar.hits.length).toBe(0);
    expect(behind.hits.length).toBe(0);
    expect(inBeam.hits.every((h) => h.ev.chip === true)).toBe(true);
  });

  it('放出のあいだ術者の向きに付いていく（向きを変えると、帯も回る）', () => {
    const r = rig();
    const t = new Dummy(1, 4, 0);
    r.targets.push(t);
    cast(r, FLAME);
    r.step(FLAME.tickFrames * 2);
    expect(t.hits.length).toBe(0);
    r.caster.yaw = Math.PI / 2;
    r.step(FLAME.tickFrames);
    expect(t.hits.length).toBeGreaterThan(0);
  });

  it('放出が終わったら（channelingSerial が自分の番号でなくなる）止まる', () => {
    const r = rig();
    const t = new Dummy(1, 0, 4);
    r.targets.push(t);
    cast(r, FLAME);
    r.step(FLAME.tickFrames * 3 + 1);
    expect(t.hits.length).toBe(4);
    r.caster.channelingSerial = 0;
    r.step(FLAME.frames);
    expect(t.hits.length).toBe(4);
    expect(r.sys.beams.length).toBe(0);
  });

  it('障害物に遮られたら、そこまでしか届かない（世界の raycast に従う）', () => {
    const world = {
      raycast: (_ax: number, _az: number, _bx: number, _bz: number, _y: number, out: { x: number; z: number }): boolean => {
        out.x = 0;
        out.z = 3;
        return true;
      },
    };
    const r = rig({ world: world as never });
    const near = new Dummy(1, 0, 2.5);
    const behindWall = new Dummy(2, 0, 5);
    r.targets.push(near, behindWall);
    const fx = cast(r, FLAME) as { len: number };
    r.step(FLAME.tickFrames + 1);
    expect(fx.len).toBeCloseTo(3 - SPELL_TARGETING.muzzle, 9);
    expect(near.hits.length).toBeGreaterThan(0);
    expect(behindWall.hits.length).toBe(0);
  });
});

describe('旋風（ring）: 同心円が内から外へ。輪ごとに 1 回ずつ当たる', () => {
  it('輪の外半径は 0 から radii[i] まで広がり、輪は staggerFrames ずつ遅れて出る（onRing の合図）', () => {
    expect(SpellSystem.ringOuter(HURRICANE, 0, 0)).toBe(0);
    expect(SpellSystem.ringOuter(HURRICANE, 0, HURRICANE.expandFrames)).toBeCloseTo(HURRICANE.radii[0]!, 9);
    expect(SpellSystem.ringOuter(HURRICANE, 1, HURRICANE.staggerFrames)).toBe(0);
    expect(SpellSystem.ringOuter(HURRICANE, 1, 99999)).toBeCloseTo(HURRICANE.radii[1]!, 9);
    const r = rig();
    cast(r, HURRICANE);
    r.step(HURRICANE.staggerFrames * 3);
    expect(r.rings).toEqual([0, 1, 2]);
  });

  it('近くの敵は 3 つの輪すべてに 1 回ずつ（計 3 回）、外側の敵は届く輪だけ、輪の外の敵は 0 回', () => {
    const r = rig();
    const inner = new Dummy(1, 0.8, 0);
    const outer = new Dummy(2, 5, 0); // 体の縁が 4.5: 3 つ目の輪（半径 5.6）だけ
    const away = new Dummy(3, HURRICANE.radii[2]! + 2, 0);
    r.targets.push(inner, outer, away);
    cast(r, HURRICANE);
    r.step(120);
    expect(inner.hits.length).toBe(HURRICANE.radii.length);
    expect(outer.hits.length).toBe(1);
    expect(away.hits.length).toBe(0);
    expect(inner.hits.every((h) => h.info.kind === 'ring' && h.ev.chip === undefined)).toBe(true);
    // 輪はノックバック（内から外へ）を持つ
    expect(inner.hits[0]!.ev.dirX).toBeGreaterThan(0.9);
    expect(r.sys.rings.length).toBe(0);
  });

  it('中心は詠唱した位置で動かない（術者が動いても輪はその場から広がる）', () => {
    const r = rig();
    const t = new Dummy(1, 0.8, 0);
    r.targets.push(t);
    cast(r, HURRICANE);
    r.caster.body.x = 50;
    r.step(120);
    expect(t.hits.length).toBe(HURRICANE.radii.length);
  });
});

describe('再生（regen）: 少しずつ回復', () => {
  it('tickFrames ごとに hpPerSecond × 刻みの秒数 × 威力を回復し、frames で終わる', () => {
    const r = rig();
    cast(r, REGEN, { power: 1.5 });
    r.step(REGEN.frames + 10);
    const ticks = Math.floor(REGEN.frames / REGEN.tickFrames);
    expect(r.heals.length).toBe(ticks);
    expect(r.heals[0]).toBeCloseTo(REGEN.hpPerSecond * (REGEN.tickFrames / 60) * 1.5, 9);
    expect(r.sys.regen).toBeNull();
  });

  it('重ねがけは残りを数え直すだけ（回復は 2 倍にならない）', () => {
    const r = rig();
    cast(r, REGEN);
    r.step(REGEN.tickFrames * 2);
    cast(r, REGEN);
    r.step(REGEN.tickFrames);
    expect(r.sys.regen!.age).toBe(REGEN.tickFrames);
    expect(r.heals.length).toBe(3); // 2 + 1（同時に 2 つ分は回復しない）
  });

  it('clear で効果がすべて消える', () => {
    const r = rig();
    cast(r, REGEN);
    cast(r, BLIZZARD);
    cast(r, HURRICANE);
    cast(r, THUNDER);
    expect(r.sys.active).toBe(true);
    r.sys.clear();
    expect(r.sys.active).toBe(false);
  });
});
