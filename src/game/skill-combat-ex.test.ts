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
import type { LoadoutId } from '../combat/data/loadouts';

/**
 * 剣技の第 2 弾（ADR-038）と本物の Player の結合テスト。skill-combat.test.ts と同じ作り（Game.step と同じ順で 1 フレームずつ進める。
 * カメラ yaw = π のとき、スティックの上は +Z。的は (0, z) に置く）。
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const DUMMY: EnemyDef = { ...ENEMIES.imp, hp: 999999, knockbackScale: 0 };
const HIT = (damage: number) => ({ attackerId: 9, targetId: 0, damage, knockback: 3, hitStop: 0, dirX: 0, dirZ: -1, x: 0, z: 0 });

interface Scene {
  player: Player;
  enemy: Enemy;
  book: SkillBook;
  hits: HitEvent[];
  hitFrames: number[];
  attacks: string[];
  /** 撃った地面の演出（Player.impactSerial）が増えたフレーム */
  impactFrames: number[];
  /** プレイヤーの z（フレームごと） */
  zs: number[];
  step(over?: Partial<InputIntent>): void;
  run(n: number, over?: Partial<InputIntent>): void;
  useSkill(): boolean;
}

function scene(loadout: LoadoutId, z: number, level: Partial<Record<SkillId, number>> = {}, extra: { x: number; z: number }[] = [], follow?: number): Scene {
  const player = new Player();
  player.equip(loadout);
  const enemy = new Enemy(DUMMY, 1, 0, z);
  enemy.place(0, z, Math.PI);
  const others = extra.map((p, i) => {
    const e = new Enemy(DUMMY, 10 + i, p.x, p.z);
    e.place(p.x, p.z, Math.PI);
    return e;
  });
  const book = new SkillBook(level);
  const hits: HitEvent[] = [];
  const hitFrames: number[] = [];
  const impactFrames: number[] = [];
  const zs: number[] = [];
  let frame = 0;
  const attacks: string[] = [];
  let last: string | null = null;
  let lastImpact = player.impactSerial;
  const sc: Scene = {
    player,
    enemy,
    book,
    hits,
    hitFrames,
    attacks,
    impactFrames,
    zs,
    step(over = {}) {
      book.step();
      player.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
      // 本物のゲームでは体がぶつかって、駆け抜けても敵は前に居続ける（follow = その間隔）。このテストの場には体の衝突が無いので、敵を前に置き続けて代わりにする
      if (follow !== undefined) enemy.place(0, player.body.z + follow, Math.PI);
      enemy.step(DT, player.body.x, player.body.z, false);
      for (const o of others) o.step(DT, player.body.x, player.body.z, false);
      resolvePlayerAttack(player, [enemy, ...others] as CombatTarget[], (ev) => {
        hits.push(ev);
        hitFrames.push(frame);
      });
      if (player.impactSerial !== lastImpact) {
        lastImpact = player.impactSerial;
        impactFrames.push(frame);
      }
      zs.push(player.body.z);
      frame++;
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

const of = (sc: Scene, id: number): number => sc.hits.filter((h) => h.targetId === id).length;

describe('剣技: 居合（片手剣。溜め → 一瞬のダッシュ → 抜き打ち → 返しの斬り上げ）', () => {
  it('溜めのあいだは動かず、一瞬で前へ踏み込み（1 フレーム 0.53m 以下）、前の遠い敵を抜き打ちで斬る', () => {
    const sc = scene('sword', 4.6);
    sc.book.select('iai');
    sc.useSkill();
    sc.run(22);
    expect(sc.player.body.z).toBeLessThan(0.05);
    sc.run(30);
    expect(sc.player.body.z).toBeGreaterThan(2.8);
    let maxStep = 0;
    for (let i = 1; i < sc.zs.length; i++) maxStep = Math.max(maxStep, sc.zs[i]! - sc.zs[i - 1]!);
    // 平均は 0.32m / フレーム（3.2m を 0.1 秒）。加速のぶん 1 フレームの最大は 0.7m 未満（一閃と同じ）
    expect(maxStep).toBeLessThan(0.7);
    sc.run(80);
    expect(sc.attacks).toEqual(['skIai']);
    // 抜き打ち 1 回 + 返しの斬り上げ 1 回（どちらも前の敵に当たる）
    expect(sc.hits.length).toBe(2);
    expect(sc.hits[0]!.damage).toBe(Math.round(findAttack('skIai')!.damage * SKILLS.iai.power));
    // 抜き打ちのほうが重い（斬り上げは 0.6 倍）
    expect(sc.hits[1]!.damage).toBeLessThan(sc.hits[0]!.damage);
  });

  it('抜き打ちは広い扇（斜め前の敵にも 1 回）。後ろ・遠すぎる敵には当たらない', () => {
    const sc = scene('sword', 4.6, {}, [
      { x: 2.4, z: 4.0 },
      { x: 0, z: -2 },
      { x: 0, z: 9.5 },
    ]);
    sc.book.select('iai');
    sc.useSkill();
    sc.run(120);
    expect(of(sc, 10)).toBeGreaterThanOrEqual(1);
    expect(of(sc, 11)).toBe(0);
    expect(of(sc, 12)).toBe(0);
  });

  it('溜めのあいだはスーパーアーマー（軽い攻撃では怯まない）。重い攻撃には割られる', () => {
    const light = scene('sword', 4.6);
    light.book.select('iai');
    light.useSkill();
    light.run(20);
    light.player.takeHit(HIT(12));
    expect(light.player.state).toBe('attack');
    expect(light.player.armorSerial).toBe(1);
    light.run(110);
    expect(light.hits.length).toBe(2);

    const heavy = scene('sword', 4.6);
    heavy.book.select('iai');
    heavy.useSkill();
    heavy.run(20);
    heavy.player.takeHit(HIT(30));
    expect(heavy.player.state).toBe('hit');
  });

  it('溜めのあいだでも回避で途中でやめられる。ただし溜め始めてすぐは効かない', () => {
    const early = scene('sword', 4.6);
    early.book.select('iai');
    early.useSkill();
    early.run(6, { dodgePressed: true });
    expect(early.player.state).toBe('attack');
    const late = scene('sword', 4.6);
    late.book.select('iai');
    late.useSkill();
    late.run(20);
    late.step({ dodgePressed: true });
    expect(late.player.state).toBe('dodge');
    late.run(100);
    expect(late.hits.length).toBe(0);
  });

  it('盾付きの片手剣でも同じ技が出る', () => {
    const sc = scene('sword-shield', 4.6);
    sc.book.select('iai');
    expect(sc.useSkill()).toBe(true);
    sc.run(110);
    expect(sc.attacks).toEqual(['skIai']);
    expect(sc.hits.length).toBe(2);
  });

  it('進化: Lv4 は袈裟（3 回）、Lv7 は突きまで（4 回）当たる。後ろの技ほど前へ進む', () => {
    const counts: number[] = [];
    const ends: number[] = [];
    for (const [lv, attack] of [
      [1, 'skIai'],
      [4, 'skIai4'],
      [7, 'skIai7'],
    ] as const) {
      const sc = scene('sword', 4.6, { iai: lv });
      sc.book.select('iai');
      sc.useSkill();
      sc.run(170);
      expect(sc.attacks).toEqual([attack]);
      counts.push(sc.hits.length);
      ends.push(sc.player.body.z);
    }
    expect(counts).toEqual([2, 3, 4]);
    // 敵（z = 4.6）にぶつかって止まるので、前へ進む量は同じか大きい（めり込まない）
    expect(ends[2]!).toBeGreaterThanOrEqual(ends[0]! - 0.05);
  });

  it('突き（Lv7）は細く長い線: 正面の 3.4m 先まで届き、真横には当たらない', () => {
    const sc = scene('sword', 4.6, { iai: 7 }, [{ x: 1.8, z: 4.6 }]);
    sc.book.select('iai');
    sc.useSkill();
    sc.run(170);
    // 正面の敵は 4 回、真横寄り（x = 1.8）の敵は突きには当たらない（抜き打ちや袈裟の扇では当たりうる）
    expect(of(sc, 1)).toBe(4);
    expect(of(sc, 10)).toBeLessThan(4);
  });
});

describe('剣技: 十字斬り（片手剣。縦 → 横 → 交点に突き立て）', () => {
  it('Lv1: 縦・横・突き立ての 3 回が 1 体に当たる。突き立ては最も重く、地面の演出が 1 回', () => {
    const sc = scene('sword', 1.7);
    sc.book.select('juji');
    sc.useSkill();
    sc.run(100);
    expect(sc.attacks).toEqual(['skCross']);
    expect(sc.hits.length).toBe(3);
    const dmg = sc.hits.map((h) => h.damage);
    expect(dmg[2]!).toBeGreaterThan(dmg[0]!);
    expect(dmg[2]!).toBeGreaterThan(dmg[1]!);
    expect(sc.impactFrames.length).toBe(1);
  });

  it('突き立ては円の範囲: 少し離れた敵・体の脇の敵にも爆ぜるが、遠すぎる敵には届かない。縦の斬りは正面だけ', () => {
    const sc = scene('sword', 1.6, {}, [
      { x: 2.0, z: 2.6 },
      { x: 0, z: 6.5 },
      { x: 1.9, z: 0.4 },
    ]);
    sc.book.select('juji');
    sc.useSkill();
    sc.run(100);
    // 斜め前の敵（2.0, 2.6）は横の薙ぎか爆ぜのどちらかに当たる。遠い敵（6.5）には何も当たらない
    expect(of(sc, 10)).toBeGreaterThanOrEqual(1);
    expect(of(sc, 11)).toBe(0);
  });

  it('進化: Lv4 は十字 2 回（6 ヒット・演出 2 回）、Lv7 は 3 回（9 ヒット・演出 3 回）', () => {
    const got: { hits: number; impacts: number }[] = [];
    for (const lv of [1, 4, 7]) {
      const sc = scene('sword', 1.7, { juji: lv });
      sc.book.select('juji');
      sc.useSkill();
      sc.run(190);
      got.push({ hits: sc.hits.length, impacts: sc.impactFrames.length });
    }
    expect(got).toEqual([
      { hits: 3, impacts: 1 },
      { hits: 6, impacts: 2 },
      { hits: 9, impacts: 3 },
    ]);
  });

  it('最初の縦斬りのあとから、回避で途中でやめられる（それより前は効かない）', () => {
    const early = scene('sword', 1.7);
    early.book.select('juji');
    early.useSkill();
    early.run(8, { dodgePressed: true });
    expect(early.player.state).toBe('attack');
    const late = scene('sword', 1.7);
    late.book.select('juji');
    late.useSkill();
    late.run(30);
    late.step({ dodgePressed: true });
    expect(late.player.state).toBe('dodge');
    expect(late.hits.length).toBeLessThan(3);
  });

  it('アーマーなし: 被弾すると途切れる', () => {
    const sc = scene('sword', 1.7);
    sc.book.select('juji');
    sc.useSkill();
    sc.run(30);
    sc.player.takeHit(HIT(12));
    expect(sc.player.state).toBe('hit');
  });
});

describe('剣技: 疾風連斬（片手剣。駆けながら左右に切り返す）', () => {
  it('Lv1: 4 太刀が 1 体に 4 回当たり、最後の 1 太刀は重い。1 太刀ごとに前へ進む', () => {
    // 敵が前に居続ける（体がぶつかって止まる）ものとして、1 太刀ごとに 1 回ずつ当たる
    const sc = scene('sword', 1.8, {}, [], 1.5);
    sc.book.select('hayate');
    sc.useSkill();
    sc.run(90);
    expect(sc.attacks).toEqual(['skGale']);
    expect(sc.hits.length).toBe(4);
    expect(sc.hits[3]!.damage).toBeGreaterThan(sc.hits[0]!.damage);
    expect(sc.hits[0]!.damage).toBe(Math.round(findAttack('skGale')!.damage * SKILLS.hayate.power));
    // 太刀の間隔は 0.2 秒（12 フレーム）
    for (let i = 1; i < 4; i++) expect(sc.hitFrames[i]! - sc.hitFrames[i - 1]!).toBe(12);
    // 4 太刀で 2.8m ほど駆け抜ける（1 太刀 0.7m）
    expect(sc.player.body.z).toBeGreaterThan(2.7);
  });

  it('進化: Lv4 は 6 太刀、Lv7 は 8 太刀。駆ける距離も伸びる', () => {
    const got: { hits: number; z: number }[] = [];
    for (const lv of [1, 4, 7]) {
      const sc = scene('sword', 1.8, { hayate: lv }, [], 1.5);
      sc.book.select('hayate');
      sc.useSkill();
      sc.run(150);
      got.push({ hits: sc.hits.length, z: Math.round(sc.player.body.z * 10) / 10 });
    }
    expect(got.map((g) => g.hits)).toEqual([4, 6, 8]);
    expect(got[1]!.z).toBeGreaterThan(got[0]!.z + 1);
    expect(got[2]!.z).toBeGreaterThan(got[1]!.z + 1);
    // 最後の 1 太刀は、飛ばす力が強い（ノックバックが 3 倍）
    const last = scene('sword', 1.8, { hayate: 7 }, [], 1.5);
    last.book.select('hayate');
    last.useSkill();
    last.run(150);
    expect(last.hits[7]!.knockback).toBeGreaterThan(last.hits[0]!.knockback * 2);
  });

  it('駆け抜ける途中に居る敵（前に並んだ敵）にも、それぞれ当たる。後ろの敵には当たらない', () => {
    const sc = scene('sword', 2.0, {}, [
      { x: 0, z: 3.4 },
      { x: 0, z: -1.5 },
    ]);
    sc.book.select('hayate');
    sc.useSkill();
    sc.run(90);
    expect(of(sc, 1)).toBeGreaterThanOrEqual(2);
    expect(of(sc, 10)).toBeGreaterThanOrEqual(2);
    expect(of(sc, 11)).toBe(0);
  });

  it('扇で斬るので、体の少し横の敵にも当たる', () => {
    const sc = scene('sword', 1.8, {}, [{ x: 1.6, z: 1.6 }]);
    sc.book.select('hayate');
    sc.useSkill();
    sc.run(90);
    expect(of(sc, 10)).toBeGreaterThanOrEqual(1);
  });

  it('アーマーなし: 被弾すると途切れる。最初の太刀のあとから回避で途中でやめられる', () => {
    const sc = scene('sword', 14);
    sc.book.select('hayate');
    sc.useSkill();
    sc.run(20);
    sc.player.takeHit(HIT(12));
    expect(sc.player.state).toBe('hit');
    const early = scene('sword', 14);
    early.book.select('hayate');
    early.useSkill();
    early.run(6, { dodgePressed: true });
    expect(early.player.state).toBe('attack');
    const late = scene('sword', 14);
    late.book.select('hayate');
    late.useSkill();
    late.run(18);
    late.step({ dodgePressed: true });
    expect(late.player.state).toBe('dodge');
  });
});

describe('剣技: 大渦（大剣。腰を落として全方位を薙ぐ大回転）', () => {
  it('Lv1: 2 周で 4 回薙ぐ。前の敵に 2 回、後ろの敵に 2 回当たる（前・後・前・後）', () => {
    // 前の敵は体がぶつかって前に居続ける（follow）。後ろの敵は少し置いていかれる
    const sc = scene('greatsword', 1.4, {}, [{ x: 0, z: -0.8 }], 1.4);
    sc.book.select('ouzu');
    sc.useSkill();
    sc.run(170);
    expect(sc.attacks).toEqual(['skOuzu']);
    expect(of(sc, 1)).toBe(2);
    expect(of(sc, 10)).toBe(2);
    // 最後の 1 回（後ろの半円）は強く飛ばす
    const rear = sc.hits.filter((h) => h.targetId === 10);
    expect(rear[1]!.knockback).toBeGreaterThan(rear[0]!.knockback * 1.5);
    expect(rear[1]!.damage).toBeGreaterThan(rear[0]!.damage);
  });

  it('進化: Lv4 は 3 周（6 回）、Lv7 は 4 周（8 回）。前後の敵が同じ数だけ当たる', () => {
    const got: number[][] = [];
    for (const lv of [1, 4, 7]) {
      const sc = scene('greatsword', 1.4, { ouzu: lv }, [{ x: 0, z: -0.8 }], 1.4);
      sc.book.select('ouzu');
      sc.useSkill();
      sc.run(260);
      got.push([of(sc, 1), of(sc, 10)]);
    }
    expect(got).toEqual([
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
  });

  it('回っているあいだはずっとスーパーアーマー（軽い攻撃では怯まない）。重い攻撃（breakDamage 34 以上）には割られる', () => {
    const light = scene('greatsword', 1.4);
    light.book.select('ouzu');
    light.useSkill();
    light.run(50);
    light.player.takeHit(HIT(30));
    expect(light.player.state).toBe('attack');
    expect(light.player.armorSerial).toBe(1);
    light.run(130);
    expect(light.attacks).toEqual(['skOuzu']);
    const heavy = scene('greatsword', 1.4);
    heavy.book.select('ouzu');
    heavy.useSkill();
    heavy.run(50);
    heavy.player.takeHit(HIT(36));
    expect(heavy.player.state).toBe('hit');
  });

  it('前へ追って回る（1.2m 以上）。最初の薙ぎのあとから回避で途中でやめられる', () => {
    const sc = scene('greatsword', 6);
    sc.book.select('ouzu');
    sc.useSkill();
    sc.run(150);
    expect(sc.player.body.z).toBeGreaterThan(1.1);
    const early = scene('greatsword', 6);
    early.book.select('ouzu');
    early.useSkill();
    early.run(8, { dodgePressed: true });
    expect(early.player.state).toBe('attack');
    const late = scene('greatsword', 6);
    late.book.select('ouzu');
    late.useSkill();
    late.run(36);
    late.step({ dodgePressed: true });
    expect(late.player.state).toBe('dodge');
  });
});

describe('剣技: 剣山（大剣。突き立てて衝撃の輪が内から外へ）', () => {
  it('Lv1: 直接の斬り + 輪 3 回 = 4 回当たる。地面の演出は輪の数（3 回）', () => {
    const sc = scene('greatsword', 1.4);
    sc.book.select('kenzan');
    sc.useSkill();
    sc.run(130);
    expect(sc.attacks).toEqual(['skKenzan']);
    expect(sc.hits.length).toBe(4);
    expect(sc.impactFrames.length).toBe(3);
    // 輪は 0.3 秒（18 フレーム）おき
    const gaps = sc.hitFrames.slice(2).map((t, i) => t - sc.hitFrames[i + 1]!);
    for (const g of gaps) expect(g).toBe(18);
  });

  it('輪は内から外へ広がる: 遠い敵ほど、あとの輪にしか当たらない。いちばん遠い敵（Lv1 の輪の外）には届かない', () => {
    const sc = scene('greatsword', 1.4, {}, [
      { x: 0, z: 5.2 },
      { x: 0, z: 9.2 },
    ]);
    sc.book.select('kenzan');
    sc.useSkill();
    sc.run(140);
    // 近い敵は直接の斬り + 3 つの輪すべて、中ほどの敵は外の輪だけ、いちばん遠い敵は Lv1 の輪では届かない
    expect(of(sc, 1)).toBe(4);
    expect(of(sc, 10)).toBeGreaterThanOrEqual(1);
    expect(of(sc, 10)).toBeLessThan(of(sc, 1));
    expect(of(sc, 11)).toBe(0);
  });

  it('進化: Lv4 は輪 4 回（5 ヒット）、Lv7 は輪 5 回（6 ヒット）。Lv7 の外の輪は、Lv1 では届かない遠い敵にも当たる', () => {
    const counts: number[] = [];
    for (const lv of [1, 4, 7]) {
      const sc = scene('greatsword', 1.4, { kenzan: lv });
      sc.book.select('kenzan');
      sc.useSkill();
      sc.run(190);
      counts.push(sc.hits.length);
    }
    expect(counts).toEqual([4, 5, 6]);
    const farLv = (lv: number): number => {
      const far = scene('greatsword', 1.4, { kenzan: lv }, [{ x: 0, z: 8.4 }]);
      far.book.select('kenzan');
      far.useSkill();
      far.run(190);
      return of(far, 10);
    };
    expect(farLv(1)).toBe(0);
    expect(farLv(7)).toBeGreaterThanOrEqual(1);
  });

  it('突き立てているあいだはスーパーアーマー: 軽い攻撃では怯まず、重い攻撃（28 以上）には割られる', () => {
    const light = scene('greatsword', 1.4);
    light.book.select('kenzan');
    light.useSkill();
    light.run(50);
    light.player.takeHit(HIT(20));
    expect(light.player.state).toBe('attack');
    expect(light.player.armorSerial).toBe(1);
    light.run(90);
    expect(light.hits.length).toBe(4);
    const heavy = scene('greatsword', 1.4);
    heavy.book.select('kenzan');
    heavy.useSkill();
    heavy.run(50);
    heavy.player.takeHit(HIT(30));
    expect(heavy.player.state).toBe('hit');
  });

  it('振りかぶりの途中は回避でやめられない。突き立てたあとなら効く', () => {
    const early = scene('greatsword', 1.4);
    early.book.select('kenzan');
    early.useSkill();
    early.run(10, { dodgePressed: true });
    expect(early.player.state).toBe('attack');
    const late = scene('greatsword', 1.4);
    late.book.select('kenzan');
    late.useSkill();
    late.run(40);
    late.step({ dodgePressed: true });
    expect(late.player.state).toBe('dodge');
  });
});

describe('剣技: 飛竜落とし（大剣。高く跳び、回りながら降りて叩きつける）', () => {
  it('降りるまで当たりはなく、着地で直接の斬り + 衝撃の輪が当たる（Lv1 は 2 回）。地面の演出が 1 回', () => {
    const sc = scene('greatsword', 2.8);
    sc.book.select('hiryu');
    sc.useSkill();
    sc.run(120);
    expect(sc.attacks).toEqual(['skHiryu']);
    expect(sc.hits.length).toBe(2);
    // 跳び立ち（0.24 秒）から着地（0.66 秒）まで、当たりなし。最初の当たりは着地の直前
    expect(sc.hitFrames[0]!).toBeGreaterThan(32);
    expect(sc.impactFrames.length).toBe(1);
    // 跳ぶあいだに前へ 1.4m ほど動く
    expect(sc.player.body.z).toBeGreaterThan(1.3);
  });

  it('進化: Lv4 は 2 重の輪（3 ヒット・演出 2 回）、Lv7 は 3 重の輪（4 ヒット・演出 3 回）。滞空は長くなる', () => {
    const got: { hits: number; impacts: number; first: number }[] = [];
    for (const lv of [1, 4, 7]) {
      const sc = scene('greatsword', 3.0, { hiryu: lv });
      sc.book.select('hiryu');
      sc.useSkill();
      sc.run(170);
      got.push({ hits: sc.hits.length, impacts: sc.impactFrames.length, first: sc.hitFrames[0]! });
    }
    expect(got.map((g) => g.hits)).toEqual([2, 3, 4]);
    expect(got.map((g) => g.impacts)).toEqual([1, 2, 3]);
    expect(got[1]!.first).toBeGreaterThan(got[0]!.first);
    expect(got[2]!.first).toBeGreaterThan(got[1]!.first);
  });

  it('輪は円の範囲: 着地点から離れた敵・脇の敵にも爆ぜるが、遠すぎる敵には届かない', () => {
    const sc = scene('greatsword', 2.8, {}, [
      { x: 3.2, z: 2.0 },
      { x: 0, z: 10 },
    ]);
    sc.book.select('hiryu');
    sc.useSkill();
    sc.run(120);
    expect(of(sc, 10)).toBeGreaterThanOrEqual(1);
    expect(of(sc, 11)).toBe(0);
  });

  it('降りてくるあいだはスーパーアーマー: 軽い攻撃では怯まず、重い攻撃（32 以上）には割られる', () => {
    const light = scene('greatsword', 2.8);
    light.book.select('hiryu');
    light.useSkill();
    light.run(26);
    light.player.takeHit(HIT(20));
    expect(light.player.state).toBe('attack');
    expect(light.player.armorSerial).toBe(1);
    light.run(100);
    expect(light.hits.length).toBe(2);
    const heavy = scene('greatsword', 2.8);
    heavy.book.select('hiryu');
    heavy.useSkill();
    heavy.run(26);
    heavy.player.takeHit(HIT(34));
    expect(heavy.player.state).toBe('hit');
  });

  it('跳び立つ前は軽い攻撃で怯む（アーマーは跳び立ってから）。着地のあとなら回避でやめられる', () => {
    const early = scene('greatsword', 2.8);
    early.book.select('hiryu');
    early.useSkill();
    early.run(6);
    early.player.takeHit(HIT(12));
    expect(early.player.state).toBe('hit');
    const late = scene('greatsword', 2.8);
    late.book.select('hiryu');
    late.useSkill();
    late.run(54);
    late.step({ dodgePressed: true });
    expect(late.player.state).toBe('dodge');
  });
});
