import { describe, expect, it } from 'vitest';
import { Inventory } from './inventory';
import { ITEMS, ITEM_RULES, type DropDef } from './data/items';
import { ENEMIES, type EnemyDef } from '../ai/data/enemies';

/** 決まった値を順に返す乱数 */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe('Inventory: 数と使用', () => {
  it('最初は何も持っていない。add で増え、持てる数を超える分は拾えない', () => {
    const inv = new Inventory();
    expect(inv.total).toBe(0);
    expect(inv.add('potionS', 3)).toBe(3);
    expect(inv.add('potionS', 9)).toBe(ITEMS.potionS.max - 3);
    expect(inv.count('potionS')).toBe(ITEMS.potionS.max);
    expect(inv.add('potionS')).toBe(0);
  });

  it('use: 持っていなければ none、満タンなら full（減らない）、使えたら 1 つ減って待ちに入る', () => {
    const inv = new Inventory();
    expect(inv.use(50)).toEqual({ ok: false, reason: 'none' });
    inv.add('potionS', 2);
    expect(inv.use(0)).toEqual({ ok: false, reason: 'full' });
    expect(inv.count('potionS')).toBe(2);
    expect(inv.use(30)).toEqual({ ok: true, item: 'potionS' });
    expect(inv.count('potionS')).toBe(1);
    // 待ち中は使えない（減らない）
    expect(inv.use(30)).toEqual({ ok: false, reason: 'wait' });
    expect(inv.count('potionS')).toBe(1);
    for (let i = 0; i < ITEMS.potionS.cooldownFrames; i++) inv.step();
    expect(inv.use(30)).toEqual({ ok: true, item: 'potionS' });
    expect(inv.count('potionS')).toBe(0);
  });

  it('選んでいるアイテムが使われる。select・cycle で替わる（持っていなくても選べる）', () => {
    const inv = new Inventory();
    inv.add('potionS');
    inv.add('potionM');
    expect(inv.selected).toBe('potionS');
    inv.select('potionM');
    expect(inv.use(30)).toEqual({ ok: true, item: 'potionM' });
    expect(inv.count('potionS')).toBe(1);
    expect(inv.cycle(1)).toBe('potionS');
    expect(inv.cycle(1)).toBe('potionM');
    expect(inv.cycle(-1)).toBe('potionS');
    inv.select('potionM');
    expect(inv.selected).toBe('potionM');
  });

  it('serial は数・選択が変わったときだけ増える', () => {
    const inv = new Inventory();
    const s0 = inv.serial;
    inv.select('potionS'); // すでにこれ
    expect(inv.serial).toBe(s0);
    inv.add('potionS');
    expect(inv.serial).toBeGreaterThan(s0);
    const s1 = inv.serial;
    inv.add('potionS', 0);
    inv.use(0); // 満タンで使えない
    expect(inv.serial).toBe(s1);
  });

  it('reset で最初に戻る（選択は残す）', () => {
    const inv = new Inventory();
    inv.add('potionM', 2);
    inv.select('potionM');
    inv.use(10);
    inv.reset();
    expect(inv.total).toBe(0);
    expect(inv.cooldown).toBe(0);
    expect(inv.selected).toBe('potionM');
  });
});

describe('Inventory: ドロップの抽選', () => {
  const drops: DropDef[] = [{ item: 'potionS', chance: 0.2 }];

  it('確率より小さい乱数なら落ち、そうでなければ落ちない', () => {
    const inv = new Inventory();
    expect(inv.rollDrops(drops, seq(0.19))).toEqual(['potionS']);
    expect(inv.rollDrops(drops, seq(0.2))).toEqual([]);
    expect(inv.rollDrops(undefined, seq(0))).toEqual([]);
  });

  it('ドロップ率の倍率（パッシブの薬師。ADR-037）: 確率に掛かる。1 を超えない。省略は等倍', () => {
    const inv = new Inventory();
    // 0.2 × 1.25 = 0.25: 0.24 は落ち、0.25 は落ちない（等倍なら 0.24 は落ちない）
    expect(inv.rollDrops(drops, seq(0.24), 1.25)).toEqual(['potionS']);
    expect(inv.rollDrops(drops, seq(0.25), 1.25)).toEqual([]);
    expect(inv.rollDrops(drops, seq(0.24))).toEqual([]);
    // 確率の上限（1 を超えても、乱数 < 1 なら必ず落ちる = 確率 100% 止まり）
    expect(inv.rollDrops(drops, seq(0.999), 100)).toEqual(['potionS']);
    expect(inv.rollDrops(drops, seq(0.5), 0)).toEqual([]);
  });

  it('種類ごとに別々に抽選する（両方落ちることもある）', () => {
    const inv = new Inventory();
    const both: DropDef[] = [
      { item: 'potionS', chance: 0.5 },
      { item: 'potionM', chance: 0.5 },
    ];
    expect(inv.rollDrops(both, seq(0.1, 0.1))).toEqual(['potionS', 'potionM']);
    expect(inv.rollDrops(both, seq(0.9, 0.1))).toEqual(['potionM']);
  });

  it('持てる数がいっぱいなら落とさない', () => {
    const inv = new Inventory();
    inv.add('potionS', ITEMS.potionS.max);
    expect(inv.rollDrops(drops, seq(0))).toEqual([]);
  });

  it('救済: 何も落ちない撃破が pityKills 続くと、次は必ず薬瓶（小）が落ちる', () => {
    const inv = new Inventory();
    for (let i = 0; i < ITEM_RULES.pityKills - 1; i++) expect(inv.rollDrops(drops, seq(0.99))).toEqual([]);
    expect(inv.rollDrops(drops, seq(0.99))).toEqual([ITEM_RULES.pityItem]);
    // 落ちたら数え直す
    expect(inv.rollDrops(drops, seq(0.99))).toEqual([]);
  });

  it('普通に落ちたときも数え直す（救済までの回数が伸びる）', () => {
    const inv = new Inventory();
    for (let i = 0; i < ITEM_RULES.pityKills - 1; i++) inv.rollDrops(drops, seq(0.99));
    expect(inv.rollDrops(drops, seq(0.01))).toEqual(['potionS']);
    for (let i = 0; i < ITEM_RULES.pityKills - 1; i++) expect(inv.rollDrops(drops, seq(0.99))).toEqual([]);
  });

  it('救済でも、持てる数がいっぱいなら出さない', () => {
    const inv = new Inventory();
    inv.add('potionS', ITEMS.potionS.max);
    for (let i = 0; i < ITEM_RULES.pityKills + 3; i++) expect(inv.rollDrops(drops, seq(0.99))).toEqual([]);
  });
});

describe('敵のドロップ表（データ）', () => {
  it('ドロップの確率は 0..1 で、ボスは落とさない', () => {
    for (const def of Object.values(ENEMIES) as EnemyDef[]) {
      for (const d of def.drops ?? []) {
        expect(d.chance).toBeGreaterThan(0);
        expect(d.chance).toBeLessThanOrEqual(1);
        expect(ITEMS[d.item]).toBeTruthy();
      }
    }
    expect((ENEMIES.boss as EnemyDef).drops ?? []).toEqual([]);
  });
});
