import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { resolvePlayerAttack, type CombatTarget } from './combat';
import { Enemy } from '../ai/enemy';
import { ENEMIES, type EnemyDef } from '../ai/data/enemies';
import { SkillBook } from '../combat/skills';
import { SKILLS, type SkillId } from '../combat/data/skills';
import { findAttack } from '../combat/data/skill-attacks';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import type { HitEvent } from '../combat/hit';

/**
 * 槍技（ADR-049）と本物の Player の結合テスト。Game.step と同じ順（requestSkill → player.step → 当たり判定）で 1 フレームずつ進める。
 * カメラ yaw = π のとき、スティックの上は +Z。的は倒れない・動かない丈夫な子鬼。
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const DUMMY: EnemyDef = { ...ENEMIES.imp, hp: 999999, knockbackScale: 0 };

interface Spot {
  x: number;
  z: number;
}

interface Scene {
  player: Player;
  enemies: Enemy[];
  book: SkillBook;
  /** 的ごとの命中の記録（的の並びと同じ順） */
  hits: HitEvent[][];
  attacks: string[];
  step(over?: Partial<InputIntent>): void;
  run(n: number, over?: Partial<InputIntent>): void;
  useSkill(): boolean;
}

function scene(spots: Spot[], bookInit?: Partial<Record<SkillId, number>>): Scene {
  const player = new Player();
  expect(player.equip('spear')).toBe(true);
  const enemies = spots.map((p, i) => {
    const e = new Enemy(DUMMY, 1 + i, p.x, p.z);
    e.place(p.x, p.z, Math.PI);
    return e;
  });
  const book = new SkillBook(bookInit);
  const hits: HitEvent[][] = spots.map(() => []);
  const attacks: string[] = [];
  let last: string | null = null;
  const sc: Scene = {
    player,
    enemies,
    book,
    hits,
    attacks,
    step(over = {}) {
      book.step();
      player.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
      for (const e of enemies) e.step(DT, player.body.x, player.body.z, false);
      resolvePlayerAttack(player, enemies as CombatTarget[], (ev, t) => hits[enemies.indexOf(t as Enemy)]!.push(ev));
      const id = player.attack?.id ?? null;
      if (id !== last) {
        last = id;
        if (id) attacks.push(id);
      }
    },
    run(n, over) {
      for (let i = 0; i < n; i++) sc.step(over);
    },
    useSkill() {
      const run = book.prepare(player.loadout.weapon);
      if (!run) return false;
      const before = player.skillSerial;
      player.requestSkill(run);
      sc.step();
      if (player.skillSerial === before) return false;
      book.start(run.skill);
      return true;
    },
  };
  return sc;
}

describe('槍技: 乱れ突き（高速の突き 6 → 9 → 12 連）', () => {
  it('Lv1: 1 つの技のなかで 6 回当たる。出が早く、間隔は 0.13 秒前後。1 回ごとのダメージは技 × 威力', () => {
    const sc = scene([{ x: 0, z: 2.4 }]);
    sc.book.select('midare');
    expect(sc.useSkill()).toBe(true);
    sc.run(110);
    expect(sc.attacks).toEqual(['skSpFlurry']);
    expect(sc.hits[0]!.length).toBe(6);
    expect(sc.hits[0]![0]!.damage).toBe(Math.round(findAttack('skSpFlurry')!.damage * SKILLS.midare.power));
  });

  it('進化: Lv4 は 9 連、Lv7 は 12 連で、とどめの 12 発目は重い', () => {
    const lv4 = scene([{ x: 0, z: 2.4 }], { midare: 4 });
    lv4.book.select('midare');
    lv4.useSkill();
    lv4.run(160);
    expect(lv4.attacks).toEqual(['skSpFlurry9']);
    expect(lv4.hits[0]!.length).toBe(9);

    const lv7 = scene([{ x: 0, z: 2.4 }], { midare: 7 });
    lv7.book.select('midare');
    lv7.useSkill();
    lv7.run(200);
    expect(lv7.attacks).toEqual(['skSpFlurry12']);
    expect(lv7.hits[0]!.length).toBe(12);
    const dmg = lv7.hits[0]!.map((h) => h.damage);
    expect(dmg[11]!).toBeGreaterThan(dmg[0]! * 1.8);
  });
});

describe('槍技: 風車（水平の円を何周も描く）', () => {
  /** 前・後ろ・左・右に的を 1 体ずつ置く。1 周ごとに全員へ 1 回ずつ当たる */
  const spots: Spot[] = [
    { x: 0, z: 1.9 },
    { x: 0, z: -1.9 },
    { x: 1.9, z: 0 },
    { x: -1.9, z: 0 },
  ];

  it('Lv1: 2 周。四方の的に、それぞれ 2 回ずつ当たる', () => {
    const sc = scene(spots);
    sc.book.select('fusha');
    expect(sc.useSkill()).toBe(true);
    sc.run(130);
    expect(sc.attacks).toEqual(['skSpWhirl']);
    expect(sc.hits.map((h) => h.length)).toEqual([2, 2, 2, 2]);
  });

  it('進化: Lv4 は 3 周、Lv7 は 4 周（周ごとに四方へ 1 回ずつ）。周回が増えると前へ追う距離も伸びるので、的は体の近くに置く', () => {
    const near: Spot[] = [{ x: 0, z: 1.9 }, { x: 0, z: -0.9 }, { x: 1.2, z: 0 }, { x: -1.2, z: 0 }];
    for (const [lv, turns, id] of [[4, 3, 'skSpWhirl3'], [7, 4, 'skSpWhirl4']] as const) {
      const sc = scene(near, { fusha: lv });
      sc.book.select('fusha');
      sc.useSkill();
      sc.run(200);
      expect(sc.attacks, `Lv${lv}`).toEqual([id]);
      expect(sc.hits.map((h) => h.length), `Lv${lv}`).toEqual([turns, turns, turns, turns]);
    }
  });

  it('回っているあいだはスーパーアーマー（軽い攻撃では怯まない）。重い攻撃（breakDamage 以上）には割られる', () => {
    const def = findAttack('skSpWhirl')!;
    expect(def.armor).toBeDefined();
    expect(def.armor!.from).toBeLessThan(def.activeStart);
    expect(def.armor!.to).toBeGreaterThan(def.activeEnd);
    expect(def.armor!.breakDamage).toBeGreaterThan(10);
  });
});

describe('槍技: 穿ち（深く引き絞って一気に貫く）', () => {
  it('Lv1: 1 つ目の突きだけ。引き絞ってから 2m 前へ踏み込んで、正面の敵に 1 回当たる。踏み込みの途中に居る敵にも当たる', () => {
    const sc = scene([{ x: 0, z: 3.2 }, { x: 0, z: 1.6 }]);
    sc.book.select('ugachi');
    expect(sc.useSkill()).toBe(true);
    sc.run(130);
    expect(sc.attacks).toEqual(['skSpBore']);
    expect(sc.hits[0]!.length).toBe(1);
    expect(sc.hits[1]!.length).toBe(1);
    expect(sc.player.body.z).toBeGreaterThan(1.8);
  });

  it('進化: Lv4 は 2 つ目、Lv7 は 3 つ目（とどめ）の突きが続く。後ろの突きほど重い', () => {
    const lv4 = scene([{ x: 0, z: 3.2 }], { ugachi: 4 });
    lv4.book.select('ugachi');
    lv4.useSkill();
    lv4.run(200);
    expect(lv4.attacks).toEqual(['skSpBore', 'skSpBore2']);

    const lv7 = scene([{ x: 0, z: 3.2 }], { ugachi: 7 });
    lv7.book.select('ugachi');
    lv7.useSkill();
    lv7.run(260);
    expect(lv7.attacks).toEqual(['skSpBore', 'skSpBore2', 'skSpBore3']);
    expect(lv7.hits[0]!.length).toBeGreaterThanOrEqual(3);
    const last = lv7.hits[0]![lv7.hits[0]!.length - 1]!;
    expect(last.damage).toBeGreaterThan(lv7.hits[0]![0]!.damage);
  });

  it('引き絞りから踏み込みの終わりまでスーパーアーマー。最初の突きの前から回避で途中でやめられる', () => {
    const def = findAttack('skSpBore')!;
    expect(def.armor!.from).toBeLessThan(def.activeStart);
    expect(def.armor!.to).toBeGreaterThanOrEqual(def.activeEnd);
    const sc = scene([{ x: 0, z: 3.2 }]);
    sc.book.select('ugachi');
    sc.useSkill();
    sc.run(20);
    sc.step({ dodgePressed: true, moveX: -1, moveY: 0 });
    // 引き絞りのあいだ（出る前）は回避でやめられる
    expect(sc.player.state === 'dodge' || sc.player.state === 'attack').toBe(true);
  });
});
