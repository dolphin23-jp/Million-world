import { describe, expect, it } from 'vitest';
import { ENEMIES, type EnemyAttackDef, type EnemyDef, type EnemyId } from './data/enemies';
import { enemyDef, makeVariant } from './data/enemy-variants';
import { MIN_WINDUP_FRAMES, TIERS, TIER_MAX, tierDef } from './data/tiers';
import { DEMO_ENCOUNTER } from './data/encounters';
import { Enemy } from './enemy';

const IDS = Object.keys(ENEMIES) as EnemyId[];
const movesOf = (d: EnemyDef): readonly EnemyAttackDef[] => d.moves ?? [d.attack];

describe('段階（TierDef）の表', () => {
  it('段は 1 から連番で、段 1 は何も変えない（等倍）', () => {
    expect(TIERS.map((t) => t.tier)).toEqual(Array.from({ length: TIERS.length }, (_, i) => i + 1));
    expect(TIER_MAX).toBe(TIERS.length);
    const t1 = TIERS[0]!;
    for (const k of ['hp', 'damage', 'speed', 'windup', 'cooldown', 'poise', 'armor', 'xp', 'drop', 'size', 'rankTime', 'rankDamage'] as const) expect(t1[k], k).toBe(1);
    expect(t1.color).toBe('');
  });
  it('段が上がるほど、敵は強く（HP・ダメージ・素早さ・硬さ）、予備動作と間隔は短く、経験値・ドロップは多く、大きく、評価は緩くなる', () => {
    for (let i = 1; i < TIERS.length; i++) {
      const a = TIERS[i - 1]!;
      const b = TIERS[i]!;
      for (const k of ['hp', 'damage', 'speed', 'poise', 'armor', 'xp', 'drop', 'size', 'rankTime', 'rankDamage', 'recommendedLevel'] as const) expect(b[k], `${b.tier}.${k}`).toBeGreaterThan(a[k]);
      expect(b.windup).toBeLessThan(a.windup);
      expect(b.cooldown).toBeLessThan(a.cooldown);
    }
  });
  it('色の名前・印・名前は段ごとに重ならない。tierDef は範囲に丸める', () => {
    expect(new Set(TIERS.map((t) => t.name)).size).toBe(TIERS.length);
    expect(new Set(TIERS.map((t) => t.mark)).size).toBe(TIERS.length);
    expect(tierDef(0).tier).toBe(1);
    expect(tierDef(99).tier).toBe(TIER_MAX);
    expect(tierDef(Number.NaN).tier).toBe(1);
    expect(tierDef(2.4).tier).toBe(2);
  });
});

describe('makeVariant / enemyDef: 元の敵に段階の倍率を掛けた強化版', () => {
  it('段 1 は元のオブジェクトそのもの。同じ引数は同じオブジェクト（キャッシュ）。範囲外の段は丸める', () => {
    for (const id of IDS) {
      expect(enemyDef(id, 1)).toBe(ENEMIES[id]);
      expect(enemyDef(id, 2)).toBe(enemyDef(id, 2));
      expect(enemyDef(id, 0)).toBe(ENEMIES[id]);
      expect(enemyDef(id, 99)).toBe(enemyDef(id, TIER_MAX));
    }
  });

  it('元のデータを書き換えない（変換したあとも ENEMIES は同じ）', () => {
    const before = JSON.stringify(ENEMIES);
    for (const id of IDS) for (let t = 2; t <= TIER_MAX; t++) makeVariant(ENEMIES[id] as EnemyDef, t);
    expect(JSON.stringify(ENEMIES)).toBe(before);
  });

  it('id は元の種類のまま（見た目・効果音・召喚の種類は id で決まる）。tier が付き、名前が変わる', () => {
    for (const id of IDS) {
      for (let t = 2; t <= TIER_MAX; t++) {
        const d = enemyDef(id, t);
        expect(d.id).toBe(id);
        expect(d.tier).toBe(t);
        expect(d.name).not.toBe(ENEMIES[id].name);
      }
    }
    expect(enemyDef('imp', 2).name).toBe('紅の子鬼');
    expect(enemyDef('imp', 3).name).toBe('蒼の子鬼');
    expect(enemyDef('imp', 4).name).toBe('黒の子鬼');
    expect(enemyDef('boss', 2).name).toBe('紅蓮の大将');
    expect(enemyDef('imp', 1).tier).toBeUndefined();
  });

  it('HP・経験値・体勢・移動の速さ・大きさに倍率が掛かる。ドロップの確率は増えるが 1 を超えない', () => {
    for (const id of IDS) {
      const base = ENEMIES[id] as EnemyDef;
      for (let n = 2; n <= TIER_MAX; n++) {
        const t = tierDef(n);
        const d = enemyDef(id, n);
        expect(d.hp).toBe(Math.round(base.hp * t.hp));
        expect(d.xp).toBe(Math.round((base.xp ?? 0) * t.xp));
        expect(d.moveSpeed).toBeCloseTo(base.moveSpeed * t.speed, 2);
        expect(d.radius).toBeCloseTo(base.radius * t.size, 2);
        expect(d.height).toBeCloseTo(base.height * t.size, 2);
        if (base.poise) expect(d.poise!.max).toBe(Math.round(base.poise.max * t.poise));
        else expect(d.poise).toBeUndefined();
        for (let i = 0; i < (base.drops?.length ?? 0); i++) {
          expect(d.drops![i]!.chance).toBeGreaterThanOrEqual(base.drops![i]!.chance);
          expect(d.drops![i]!.chance).toBeLessThanOrEqual(1);
          expect(d.drops![i]!.item).toBe(base.drops![i]!.item);
        }
      }
    }
  });

  it('近接のダメージに倍率が掛かる。弾を撃つ技は弾のダメージの倍率（と、弾き返しの倍率 = HP の倍率）が付く', () => {
    const imp = enemyDef('imp', 3);
    expect(imp.attack.damage).toBe(Math.round(ENEMIES.imp.attack.damage * tierDef(3).damage));
    const lantern = enemyDef('lantern', 2);
    expect(lantern.attack.damage).toBe(ENEMIES.lantern.attack.damage); // 弾を撃つ技の近接ダメージは 0 のまま
    expect(lantern.attack.projectileDamageScale).toBeCloseTo(tierDef(2).damage, 9);
    expect(lantern.attack.projectileReflectScale).toBeCloseTo(tierDef(2).hp, 9);
    // 段 1 は何も付かない
    expect((enemyDef('lantern', 1).attack as EnemyAttackDef).projectileDamageScale).toBeUndefined();
  });

  it('どの敵・どの段階でも、見て避けられる読みやすさが保たれる（予備動作は下限以上・硬直は変えない・追う / アーマーの区間は予備動作の中）', () => {
    for (const id of IDS) {
      const base = ENEMIES[id] as EnemyDef;
      for (let n = 1; n <= TIER_MAX; n++) {
        const d = enemyDef(id, n);
        const bm = movesOf(base);
        const dm = movesOf(d);
        expect(dm.length).toBe(bm.length);
        dm.forEach((m, i) => {
          const b = bm[i]!;
          const where = `${id} 段${n} ${m.id ?? i}`;
          expect(m.windupFrames, where).toBeGreaterThanOrEqual(Math.min(b.windupFrames, MIN_WINDUP_FRAMES));
          expect(m.windupFrames, where).toBeLessThanOrEqual(b.windupFrames);
          expect(m.windupTrackFrames, where).toBeLessThanOrEqual(m.windupFrames);
          if (m.armorFromFrame < 900) expect(m.armorFromFrame, where).toBeLessThanOrEqual(m.windupFrames);
          expect(m.recoverFrames, where).toBe(b.recoverFrames);
          expect(m.startupFrames, where).toBe(b.startupFrames);
          expect(m.activeFrames, where).toBe(b.activeFrames);
          expect(m.cooldownFrames, where).toBeGreaterThanOrEqual(1);
          expect(m.damage, where).toBeGreaterThanOrEqual(b.damage);
          // 割り込めない（9999）・割り込みなし（0）の約束は変えない。割れる重さは段が上がるほど重くなる
          if (b.armorBreakDamage >= 5000 || b.armorBreakDamage === 0) expect(m.armorBreakDamage, where).toBe(b.armorBreakDamage);
          else expect(m.armorBreakDamage, where).toBeGreaterThanOrEqual(b.armorBreakDamage);
        });
      }
    }
  });

  it('複数の技を持つ敵は、attack と moves の先頭が同じ技のまま（変換後も）', () => {
    const base = ENEMIES.boss as EnemyDef;
    expect(base.attack).toBe(base.moves![0]);
    for (let n = 2; n <= TIER_MAX; n++) {
      const d = enemyDef('boss', n);
      expect(d.attack).toBe(d.moves![0]);
      expect(d.phases).toEqual(base.phases);
    }
  });

  it('全周の円（地ならし）は段が上がると広がり、当たりの届く距離・予告の円・地面の演出の輪の半径が揃っている', () => {
    for (const id of ['ogre', 'boss'] as const) {
      for (let n = 1; n <= TIER_MAX; n++) {
        for (const m of movesOf(enemyDef(id, n))) {
          if (m.telegraph?.kind !== 'circle' || m.hitbox.kind !== 'arc') continue;
          // 輪の半径 = 1.2 + 1.5 × power が、当たりの半径（hitbox.range）に合う
          expect(1.2 + 1.5 * (m.groundImpact ?? 0), `${id} 段${n}`).toBeCloseTo(m.hitbox.range, 1);
        }
      }
    }
    const r = (n: number): number => (enemyDef('ogre', n).attack.hitbox as { range: number }).range;
    expect(r(4)).toBeGreaterThan(r(1));
    expect(r(3)).toBeGreaterThan(r(2) - 1e-9);
  });

  it('提灯: 段 3 は 3 方向・段 4 は 5 方向の扇で撃つ（段 1・2 は 1 発）。1 発ずつは弱い（本数が増えたぶんを抑える）', () => {
    const count = (n: number): number => enemyDef('lantern', n).attack.projectileCount ?? 1;
    expect([1, 2, 3, 4].map(count)).toEqual([1, 1, 3, 5]);
    const per = (n: number): number => enemyDef('lantern', n).attack.projectileDamageScale ?? 1;
    expect(per(3)).toBeLessThan(tierDef(3).damage);
    expect(per(4)).toBeLessThan(tierDef(4).damage);
  });

  it('ボス: 段が上がると号令で呼ぶ小蝙蝠が増え、連弾・鬼火の輪の本数が増える', () => {
    const move = (n: number, id: string): EnemyAttackDef => enemyDef('boss', n).moves!.find((m) => m.id === id)!;
    expect([1, 2, 3, 4].map((n) => move(n, 'summon').summon!.count)).toEqual([3, 4, 5, 5]);
    expect([1, 2, 3, 4].map((n) => move(n, 'summon').summon!.max)).toEqual([6, 8, 10, 10]);
    expect(move(1, 'volley').projectileCount).toBe(5);
    expect(move(3, 'volley').projectileCount).toBe(7);
    expect(move(3, 'ring').projectileCount).toBe(8);
    expect(move(4, 'ring').projectileCount).toBe(12);
    // 召喚の種類は元のまま（id）。Game が呼ばれた手下をボスと同じ段階にする
    expect(move(4, 'summon').summon!.type).toBe('bat');
  });
});

describe('段階と戦闘の数値の釣り合い', () => {
  it('敵の sim が強化版の数値で動く（HP・ダメージ・予備動作）', () => {
    const d = enemyDef('imp', 3);
    const e = new Enemy(d, 1, 0, 3);
    expect(e.health.max).toBe(d.hp);
    expect(e.def.attack.windupFrames).toBeLessThan(ENEMIES.imp.attack.windupFrames);
    expect(e.def.tier).toBe(3);
  });

  it('デモ 1 周の経験値: 段 1 は 660。段が上がるほど増える', () => {
    const total = (tier: number): number => {
      let sum = 0;
      for (const wave of DEMO_ENCOUNTER.waves) for (const w of wave) sum += enemyDef(w.type as EnemyId, tier).xp ?? 0;
      return sum;
    };
    expect(total(1)).toBe(660);
    for (let n = 2; n <= TIER_MAX; n++) expect(total(n)).toBeGreaterThan(total(n - 1));
  });
});
