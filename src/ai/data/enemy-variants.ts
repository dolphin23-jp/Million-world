/**
 * 敵の色違い（段階。M6-4。ADR-036）: 元の敵のデータ（ENEMIES）に、段階（tiers.ts の TierDef）の倍率を掛けた強化版を作る純粋関数と、その表。
 * 元の敵のデータは書き換えない（段 1 = ENEMIES そのもの）。id は元の種類のまま（見た目・効果音・召喚の種類は id で決まる）で、tier と名前だけが変わる。
 * 倍率の意味は TierDef を参照。ここには「倍率では表せない、段階ごとの変化」（提灯の鬼火が扇になる・ボスの号令が増える・全周の円が広がる）も置く。
 */

import { ENEMIES, type EnemyAttackDef, type EnemyDef, type EnemyId } from './enemies';
import { MIN_WINDUP_FRAMES, TIER_MAX, tierDef, type TierDef } from './tiers';

/** 名前の付け方の例外。既定は「{色}の{元の名前}」（紅の子鬼）。ボスは固有の呼び名 */
const NAMES: Partial<Record<EnemyId, readonly string[]>> = {
  boss: ['夜行の大将', '紅蓮の大将', '蒼天の大将', '黒夜の大将'],
};

/** 全周の円（地ならしなど）の半径の倍率（段ごと）。当たりの届く距離・予告の円・地面の演出が一緒に広がる */
const CIRCLE_SCALE = [1, 1, 1.1, 1.2] as const;

/** 床を叩く演出の強さ（GroundFx.burst の power）は、輪の半径 = 1.2 + 1.5 × power で決まる。半径が変わったら合わせる */
const impactForRadius = (r: number): number => Math.round(((r - 1.2) / 1.5) * 100) / 100;

const isCircle = (a: EnemyAttackDef): boolean => a.telegraph?.kind === 'circle';

/** 技 1 つに段階の倍率を掛ける。予備動作は MIN_WINDUP_FRAMES を下回らない（元が短い技は元のまま）。硬直（recoverFrames）は変えない = 反撃の窓は読める長さのまま */
function scaleAttack(a: EnemyAttackDef, t: TierDef, circleScale: number): EnemyAttackDef {
  const windup = Math.max(Math.round(a.windupFrames * t.windup), Math.min(a.windupFrames, MIN_WINDUP_FRAMES));
  const k = a.windupFrames > 0 ? windup / a.windupFrames : 1;
  // 「アーマーなし」（armorFromFrame ≥ 900）・割り込めない重さ（9999）・割り込みなし（0）は倍率を掛けない
  const hasArmorFrame = a.armorFromFrame < 900;
  const breakable = a.armorBreakDamage > 0 && a.armorBreakDamage < 5000;
  const out: EnemyAttackDef = {
    ...a,
    damage: a.damage > 0 ? Math.max(1, Math.round(a.damage * t.damage)) : a.damage,
    windupFrames: windup,
    windupTrackFrames: Math.min(windup, Math.round(a.windupTrackFrames * k)),
    armorFromFrame: hasArmorFrame ? Math.min(windup, Math.round(a.armorFromFrame * k)) : a.armorFromFrame,
    armorBreakDamage: breakable ? Math.round(a.armorBreakDamage * t.armor) : a.armorBreakDamage,
    cooldownFrames: Math.round(a.cooldownFrames * t.cooldown),
  };
  if (a.projectile) {
    out.projectileDamageScale = (a.projectileDamageScale ?? 1) * t.damage;
    out.projectileReflectScale = (a.projectileReflectScale ?? 1) * t.hp;
  }
  if (isCircle(a) && circleScale !== 1 && a.hitbox.kind === 'arc') {
    const range = Math.round(a.hitbox.range * circleScale * 100) / 100;
    out.hitbox = { ...a.hitbox, range };
    out.range = Math.round(a.range * circleScale * 100) / 100;
    if (a.groundImpact !== undefined) out.groundImpact = impactForRadius(range);
  }
  return out;
}

/** 技のあとに、段階ごとの変化（倍率では表せないもの）を足す */
function flavorMove(id: EnemyId, m: EnemyAttackDef, tier: number): EnemyAttackDef {
  // 提灯: 段 3 から鬼火が 3 方向の扇、段 4 は 5 方向（1 発ずつはやや弱い = 本数が増えたぶんを抑える）。床の予告の帯も本数ぶん出る
  if (id === 'lantern' && m.projectile) {
    if (tier === 3) return { ...m, projectileCount: 3, projectileSpread: 0.6, projectileDamageScale: (m.projectileDamageScale ?? 1) * 0.85 };
    if (tier >= 4) return { ...m, projectileCount: 5, projectileSpread: 1.0, projectileDamageScale: (m.projectileDamageScale ?? 1) * 0.75 };
  }
  if (id === 'boss') {
    // 号令: 呼ぶ小蝙蝠が増える（呼ばれた小蝙蝠も同じ段階の強化版）
    if (m.summon) {
      if (tier === 2) return { ...m, summon: { ...m.summon, count: 4, max: 8 } };
      if (tier >= 3) return { ...m, summon: { ...m.summon, count: 5, max: 10 } };
    }
    // 連弾は 7 発、鬼火の輪は 12 発（段 4）
    if (m.id === 'volley' && tier >= 3) return { ...m, projectileCount: 7, projectileSpread: 1.6, projectileDamageScale: (m.projectileDamageScale ?? 1) * 0.85 };
    if (m.id === 'ring' && tier >= 4) return { ...m, projectileCount: 12, projectileDamageScale: (m.projectileDamageScale ?? 1) * 0.85 };
  }
  return m;
}

/** 元の敵に段階の倍率を掛けた強化版（純粋。段 1 は元のオブジェクトをそのまま返す） */
export function makeVariant(base: EnemyDef, tier: number): EnemyDef {
  const t = tierDef(tier);
  if (t.tier === 1) return base;
  const id = base.id as EnemyId;
  const circle = CIRCLE_SCALE[t.tier - 1] ?? 1;
  const cache = new Map<EnemyAttackDef, EnemyAttackDef>();
  const map = (a: EnemyAttackDef): EnemyAttackDef => {
    let v = cache.get(a);
    if (!v) {
      v = flavorMove(id, scaleAttack(a, t, circle), t.tier);
      cache.set(a, v);
    }
    return v;
  };
  const names = NAMES[id];
  const out: EnemyDef = {
    ...base,
    tier: t.tier,
    name: names?.[t.tier - 1] ?? `${t.color}の${base.name}`,
    hp: Math.round(base.hp * t.hp),
    radius: Math.round(base.radius * t.size * 1000) / 1000,
    height: Math.round(base.height * t.size * 1000) / 1000,
    moveSpeed: Math.round(base.moveSpeed * t.speed * 1000) / 1000,
    attack: map(base.attack),
  };
  if (base.xp !== undefined) out.xp = Math.round(base.xp * t.xp);
  if (base.moves) out.moves = base.moves.map(map);
  if (base.poise) out.poise = { ...base.poise, max: Math.round(base.poise.max * t.poise) };
  if (base.drops) out.drops = base.drops.map((d) => ({ ...d, chance: Math.min(1, Math.round(d.chance * t.drop * 1000) / 1000) }));
  return out;
}

const cache = new Map<string, EnemyDef>();

/** 種類と段階から敵のデータ（段階は範囲に丸める。同じ引数なら同じオブジェクト = 比較・キャッシュに使える） */
export function enemyDef(id: EnemyId, tier = 1): EnemyDef {
  const t = Math.min(TIER_MAX, Math.max(1, Math.round(Number.isFinite(tier) ? tier : 1)));
  const key = `${id}:${t}`;
  let d = cache.get(key);
  if (!d) {
    d = makeVariant(ENEMIES[id] as EnemyDef, t);
    cache.set(key, d);
  }
  return d;
}
