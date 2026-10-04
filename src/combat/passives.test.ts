import { describe, expect, it } from 'vitest';
import { KILL_BUFF, PASSIVES, PASSIVE_CATEGORY_ORDER, PASSIVE_ORDER, PASSIVE_POINTS_TOTAL, brokenByLowering, describePassive, isPassiveId, unmetPrereqs, type PassiveId, type PassiveKey } from './data/passives';
import { passiveTotals } from './modifiers';
import { GROWTH } from './data/growth';

describe('パッシブのデータの整合', () => {
  it('id と並び順がそろっていて、重複しない。名前も重複しない', () => {
    expect(new Set(PASSIVE_ORDER).size).toBe(PASSIVE_ORDER.length);
    expect(Object.keys(PASSIVES).sort()).toEqual([...PASSIVE_ORDER].sort());
    expect(new Set(PASSIVE_ORDER.map((id) => PASSIVES[id].name)).size).toBe(PASSIVE_ORDER.length);
    for (const id of PASSIVE_ORDER) expect(PASSIVES[id].id).toBe(id);
  });

  it('どのパッシブにも効果・説明・最大レベルがあり、1 レベルあたりの効きは正（0 や負でない）。最大レベルは 1〜5', () => {
    for (const id of PASSIVE_ORDER) {
      const d = PASSIVES[id];
      expect(d.effects.length, id).toBeGreaterThan(0);
      expect(d.detail.length, id).toBeGreaterThan(5);
      expect(d.levelMax, id).toBeGreaterThanOrEqual(1);
      expect(d.levelMax, id).toBeLessThanOrEqual(5);
      for (const e of d.effects) expect(e.perLevel, `${id}.${e.key}`).toBeGreaterThan(0);
    }
  });

  it('カテゴリはどれかに属し、一覧のカテゴリの順にすべて使われている。系統つきは片手剣か大剣', () => {
    for (const id of PASSIVE_ORDER) expect(PASSIVE_CATEGORY_ORDER).toContain(PASSIVES[id].category);
    for (const c of PASSIVE_CATEGORY_ORDER) expect(PASSIVE_ORDER.some((id) => PASSIVES[id].category === c), c).toBe(true);
    for (const id of PASSIVE_ORDER) {
      const f = PASSIVES[id].family;
      if (f !== undefined) expect(['sword', 'greatsword']).toContain(f);
    }
  });

  it('前提は実在し、最大レベル以下で、自分自身を指さず、循環しない。前提は一覧で先に並ぶ（画面で上から習得できる）', () => {
    for (const id of PASSIVE_ORDER) {
      for (const p of PASSIVES[id].prereq ?? []) {
        expect(isPassiveId(p.id), `${id} → ${p.id}`).toBe(true);
        expect(p.id).not.toBe(id);
        expect(p.level).toBeGreaterThanOrEqual(1);
        expect(p.level).toBeLessThanOrEqual(PASSIVES[p.id].levelMax);
        expect(PASSIVE_ORDER.indexOf(p.id), `${id} の前提 ${p.id} は先に並ぶ`).toBeLessThan(PASSIVE_ORDER.indexOf(id));
      }
    }
  });

  it('全部取るには 52 ポイント。Lv30（29 ポイント）では、剣技と合わせても全部は取れない = 選ぶ楽しみ', () => {
    expect(PASSIVE_POINTS_TOTAL).toBe(52);
    expect(PASSIVE_POINTS_TOTAL).toBeGreaterThan(29 * GROWTH.skillPointsPerLevel);
  });

  it('isPassiveId は実在する id だけを通す', () => {
    expect(isPassiveId('agile')).toBe(true);
    expect(isPassiveId('nope')).toBe(false);
    expect(isPassiveId(3)).toBe(false);
    expect(isPassiveId(null)).toBe(false);
    expect(isPassiveId('toString')).toBe(false);
  });
});

describe('前提の判定', () => {
  it('unmetPrereqs: 満たしていない前提だけを返す（空 = 習得できる）', () => {
    expect(unmetPrereqs({}, 'agile')).toEqual([]);
    expect(unmetPrereqs({}, 'critPower')).toEqual([{ id: 'critChance', level: 2 }]);
    expect(unmetPrereqs({ critChance: 1 }, 'critPower')).toHaveLength(1);
    expect(unmetPrereqs({ critChance: 2 }, 'critPower')).toEqual([]);
    expect(unmetPrereqs({ critChance: 5 }, 'critPower')).toEqual([]);
  });
  it('brokenByLowering: 習得済みの依存先があるときだけ、前提を割る取り下げを教える', () => {
    // 会心の心得を Lv2 → Lv1 にすると、習得済みの急所突き（前提 Lv2）が割れる
    expect(brokenByLowering({ critChance: 2, critPower: 1 }, 'critChance', 1)).toEqual(['critPower']);
    // 急所突きが未習得なら、取り下げてよい
    expect(brokenByLowering({ critChance: 2 }, 'critChance', 1)).toEqual([]);
    // Lv3 → Lv2 は、前提（Lv2）を割らない
    expect(brokenByLowering({ critChance: 3, critPower: 2 }, 'critChance', 2)).toEqual([]);
    // 別のパッシブには影響しない
    expect(brokenByLowering({ critChance: 2, critPower: 1 }, 'agile', 0)).toEqual([]);
  });
});

describe('passiveTotals（効果の合計）', () => {
  it('レベル × 1 レベルあたりをキーごとに足す。未習得は数えない。最大レベルを超える値は最大に丸める', () => {
    const t = passiveTotals({ critChance: 3, agile: 2, apothecary: 0 });
    expect(t.critRate).toBeCloseTo(0.06, 9);
    expect(t.moveSpeed).toBeCloseTo(0.04, 9);
    expect(t.heal).toBeUndefined();
    expect(passiveTotals({ agile: 99 }).moveSpeed).toBeCloseTo(0.1, 9);
  });
  it('1 つのパッシブが複数の効果を持つ（受け流し = 受付 + 回復、薬師 = 回復 + ドロップ）', () => {
    const t = passiveTotals({ parryArt: 3, apothecary: 2 });
    expect(t.parryFrames).toBe(3);
    expect(t.parryHeal).toBe(6);
    expect(t.heal).toBeCloseTo(0.2, 9);
    expect(t.dropRate).toBeCloseTo(0.1, 9);
  });
  it('系統つきのパッシブは、その武器を装備しているときだけ数える（省略 = 系統つきは数えない）', () => {
    const lv = { swordMastery: 2, greatMastery: 3 };
    expect(passiveTotals(lv, 'sword').damage).toBeCloseTo(0.08, 9);
    expect(passiveTotals(lv, 'sword').knockback).toBeUndefined();
    expect(passiveTotals(lv, 'greatsword').damage).toBeCloseTo(0.12, 9);
    expect(passiveTotals(lv, 'greatsword').knockback).toBeCloseTo(0.09, 9);
    expect(passiveTotals(lv).damage).toBeUndefined();
  });
  it('同じキーを重ねるパッシブは足し算になる（剣術習熟 + 剛力習熟のダメージは、片方の系統しか効かないので重ならない）', () => {
    const keys = new Map<PassiveKey, PassiveId[]>();
    for (const id of PASSIVE_ORDER) for (const e of PASSIVES[id].effects) keys.set(e.key, [...(keys.get(e.key) ?? []), id]);
    // 重なるキーは、系統で分かれるもの（damage）だけ
    for (const [k, ids] of keys) if (ids.length > 1) expect(ids.every((id) => PASSIVES[id].family !== undefined), k).toBe(true);
  });
});

describe('describePassive（画面の文章）', () => {
  it('レベル 0 は未習得。レベルに応じた数値が入る', () => {
    expect(describePassive(PASSIVES.swordMastery, 0)).toBe('未習得');
    expect(describePassive(PASSIVES.swordMastery, 3)).toBe('ダメージ +12%');
    expect(describePassive(PASSIVES.greatMastery, 2)).toBe('ダメージ +8% / ふっ飛ばし +6%');
    expect(describePassive(PASSIVES.critPower, 2)).toBe('会心ダメージ +0.2');
    expect(describePassive(PASSIVES.parryArt, 4)).toBe('パリィ受付 +4f / パリィ成功で体力 +8');
    expect(describePassive(PASSIVES.evasion, 2)).toContain('回避の無敵 +2f');
    expect(describePassive(PASSIVES.evasion, 2)).toContain('ミスティカル +0.4秒');
    expect(describePassive(PASSIVES.ironwall, 5)).toBe('受けるダメージ −15%');
    expect(describePassive(PASSIVES.momentum, 3)).toContain(`+6%`);
    expect(describePassive(PASSIVES.momentum, 3)).toContain(`最大 ${KILL_BUFF.maxStacks} 回`);
  });
  it('どのパッシブも、最大レベルまで文章が出る（空でない）', () => {
    for (const id of PASSIVE_ORDER) for (let lv = 0; lv <= PASSIVES[id].levelMax; lv++) expect(describePassive(PASSIVES[id], lv).length, `${id} Lv${lv}`).toBeGreaterThan(0);
  });
});
