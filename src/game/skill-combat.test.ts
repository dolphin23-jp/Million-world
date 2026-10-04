import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { resolvePlayerAttack, type CombatTarget } from './combat';
import { Enemy } from '../ai/enemy';
import { ENEMIES, type EnemyDef } from '../ai/data/enemies';
import { SkillBook } from '../combat/skills';
import { SKILLS, type SkillId } from '../combat/data/skills';
import { findAttack } from '../combat/data/skill-attacks';
import { ATTACKS } from '../combat/data/attacks';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import type { HitEvent } from '../combat/hit';
import type { LoadoutId } from '../combat/data/loadouts';

/**
 * 剣技（ADR-031）と本物の Player の結合テスト。Game.step と同じ順（requestSkill → player.step → 当たり判定）で 1 フレームずつ進める。
 * カメラ yaw = π のとき、スティックの上は +Z。的は (0, z) に置く（倒れない・動かない丈夫な子鬼）。
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const DUMMY: EnemyDef = { ...ENEMIES.imp, hp: 999999, knockbackScale: 0 };

interface Scene {
  player: Player;
  enemy: Enemy;
  book: SkillBook;
  hits: HitEvent[];
  /** 当たりが出た sim フレーム（hits と同じ順） */
  hitFrames: number[];
  /** 攻撃 id の遷移（変わるたびに 1 つ。null = 攻撃していない）の記録 */
  attacks: string[];
  powers: number[];
  step(over?: Partial<InputIntent>): void;
  run(n: number, over?: Partial<InputIntent>): void;
  /** 選んでいるスキルを頼む（Game.useSkill と同じ。始まったら book.start して true） */
  useSkill(): boolean;
}

function scene(loadout: LoadoutId = 'sword', z = 1.6, bookInit?: Partial<Record<SkillId, number>>, extra: { x: number; z: number }[] = []): Scene {
  const player = new Player();
  player.equip(loadout);
  const enemy = new Enemy(DUMMY, 1, 0, z);
  enemy.place(0, z, Math.PI);
  const others = extra.map((p, i) => {
    const e = new Enemy(DUMMY, 10 + i, p.x, p.z);
    e.place(p.x, p.z, Math.PI);
    return e;
  });
  const book = new SkillBook(bookInit);
  const hits: HitEvent[] = [];
  const hitFrames: number[] = [];
  let frame = 0;
  const attacks: string[] = [];
  const powers: number[] = [];
  let last: string | null = null;
  const sc: Scene = {
    player,
    enemy,
    book,
    hits,
    hitFrames,
    attacks,
    powers,
    step(over = {}) {
      book.step();
      player.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
      enemy.step(DT, player.body.x, player.body.z, false);
      for (const o of others) o.step(DT, player.body.x, player.body.z, false);
      resolvePlayerAttack(player, [enemy, ...others] as CombatTarget[], (ev) => {
        hits.push(ev);
        hitFrames.push(frame);
      });
      frame++;
      const id = player.attack?.id ?? null;
      if (id !== last) {
        last = id;
        if (id) {
          attacks.push(id);
          powers.push(player.attackPower);
        }
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

describe('剣技: 四ツ葉（四連斬り）', () => {
  it('頼むと、押さなくても 4 つの斬りが順に出て、段ごとの威力が掛かる', () => {
    const sc = scene('sword');
    sc.book.select('yotsuba');
    expect(sc.useSkill()).toBe(true);
    sc.run(300);
    expect(sc.attacks).toEqual(['skQuad1', 'skQuad2', 'skQuad3', 'skQuad4']);
    const p = SKILLS.yotsuba.power;
    expect(sc.powers.map((x) => +x.toFixed(4))).toEqual([p, p, p, p * 1.1].map((x) => +x.toFixed(4)));
    expect(sc.player.state).not.toBe('attack');
    expect(sc.book.prepare('sword')?.skill).not.toBe('yotsuba'); // クールダウン中
  });

  it('当たったダメージ = 技のダメージ × 威力（1 つ目は右袈裟 combo1）', () => {
    const sc = scene('sword');
    sc.book.select('yotsuba');
    sc.useSkill();
    sc.run(300);
    expect(sc.hits.length).toBeGreaterThanOrEqual(2);
    expect(sc.hits[0]!.damage).toBe(Math.round(findAttack('skQuad1')!.damage * SKILLS.yotsuba.power));
  });

  it('盾付きの片手剣でも同じ連なり', () => {
    const sc = scene('sword-shield');
    sc.book.select('yotsuba');
    expect(sc.useSkill()).toBe(true);
    sc.run(300);
    expect(sc.attacks).toEqual(['skQuad1', 'skQuad2', 'skQuad3', 'skQuad4']);
  });

  it('途中（3 つ目）で被弾すると途切れる。以降の段は出ない', () => {
    const sc = scene('sword');
    sc.book.select('yotsuba');
    sc.useSkill();
    for (let i = 0; i < 200 && sc.attacks.length < 3; i++) sc.step();
    expect(sc.attacks).toEqual(['skQuad1', 'skQuad2', 'skQuad3']);
    sc.player.takeHit({ attackerId: 1, targetId: 0, damage: 5, knockback: 0, hitStop: 0, dirX: 0, dirZ: -1, x: 0, z: 0 });
    sc.run(300);
    expect(sc.attacks).toEqual(['skQuad1', 'skQuad2', 'skQuad3']);
  });

  it('途中で回避に切り替えられる（段のあいだの受付）', () => {
    const sc = scene('sword');
    sc.book.select('yotsuba');
    sc.useSkill();
    let dodged = false;
    for (let i = 0; i < 200 && !dodged; i++) {
      sc.step({ dodgePressed: sc.attacks.length >= 2 && sc.player.stateFrame >= 12 });
      dodged = sc.player.state === 'dodge';
    }
    expect(dodged).toBe(true);
    sc.run(300);
    expect(sc.attacks.length).toBeLessThanOrEqual(3);
    expect(sc.attacks).not.toContain('skQuad4');
  });
});

describe('剣技: 五月雨突き（高速突き 5 連）', () => {
  it('細く長い線の当たりで、1 つの技のなかで 5 回当たる（出が早い）', () => {
    const sc = scene('sword', 2.6);
    sc.book.select('samidare');
    sc.useSkill();
    sc.run(80);
    expect(sc.attacks).toEqual(['skFlurry']);
    expect(sc.hits.length).toBe(5);
    // 最初の突きは出が早い（0.3 秒以内）。間隔は 0.11 秒前後
    expect(sc.hitFrames[0]!).toBeLessThan(18);
    const gaps = sc.hitFrames.slice(1).map((t, i) => t - sc.hitFrames[i]!);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(5);
    for (const g of gaps) expect(g).toBeLessThanOrEqual(9);
    // 1 回ごとのダメージ（突きの威力）
    expect(sc.hits[0]!.damage).toBe(Math.round(findAttack('skFlurry')!.damage * SKILLS.samidare.power));
  });

  it('前へ長く届くが、真横・後ろには当たらない（線）', () => {
    const sc = scene('sword', 2.6, undefined, [
      { x: 2.0, z: 1.0 }, // 真横寄り
      { x: 0, z: -1.5 }, // 後ろ
    ]);
    sc.book.select('samidare');
    sc.useSkill();
    sc.run(80);
    expect(sc.hits.filter((h) => h.targetId === 1).length).toBe(5);
    expect(sc.hits.filter((h) => h.targetId === 10).length).toBe(0);
    expect(sc.hits.filter((h) => h.targetId === 11).length).toBe(0);
  });

  it('最初の突きのあとから、回避で途中でやめられる（それより前は効かない）', () => {
    const early = scene('sword', 2.6);
    early.book.select('samidare');
    early.useSkill();
    early.run(8, { dodgePressed: true });
    expect(early.player.state).toBe('attack');
    const late = scene('sword', 2.6);
    late.book.select('samidare');
    late.useSkill();
    late.run(20);
    late.step({ dodgePressed: true });
    expect(late.player.state).toBe('dodge');
    expect(late.hits.length).toBeLessThan(5);
  });
});

describe('剣技: 竜巻（回転斬り 2 周半）', () => {
  it('前の半円に 3 回、後ろの半円に 2 回当たる', () => {
    const sc = scene('sword', 1.3, undefined, [{ x: 0, z: -1.0 }]);
    sc.book.select('tatsumaki');
    sc.useSkill();
    sc.run(130);
    expect(sc.attacks).toEqual(['skWhirl']);
    expect(sc.hits.filter((h) => h.targetId === 1).length).toBe(3);
    expect(sc.hits.filter((h) => h.targetId === 10).length).toBe(2);
  });

  it('回っているあいだはスーパーアーマー: 軽い攻撃では怯まず、重い攻撃（breakDamage 以上）には割られる', () => {
    const HIT = (damage: number) => ({ attackerId: 9, targetId: 0, damage, knockback: 3, hitStop: 0, dirX: 0, dirZ: -1, x: 0, z: 0 });
    const light = scene('sword', 1.3);
    light.book.select('tatsumaki');
    light.useSkill();
    light.run(30);
    light.player.takeHit(HIT(14));
    expect(light.player.state).toBe('attack');
    expect(light.player.armorSerial).toBe(1);
    light.run(130);
    expect(light.attacks).toEqual(['skWhirl']);
    const heavy = scene('sword', 1.3);
    heavy.book.select('tatsumaki');
    heavy.useSkill();
    heavy.run(30);
    heavy.player.takeHit(HIT(32));
    expect(heavy.player.state).toBe('hit');
  });

  it('最初の窓のあとから、回避で途中でやめられる', () => {
    const sc = scene('sword', 1.3);
    sc.book.select('tatsumaki');
    sc.useSkill();
    sc.run(35);
    sc.step({ dodgePressed: true });
    expect(sc.player.state).toBe('dodge');
  });
});

describe('剣技: 崩山（大剣。右払い → 左払い → 叩きつけ + 衝撃波）', () => {
  const HIT = (damage: number) => ({ attackerId: 9, targetId: 0, damage, knockback: 3, hitStop: 0, dirX: 0, dirZ: -1, x: 0, z: 0 });

  it('頼むと 3 つの技が順に出て、段ごとの威力が掛かる', () => {
    const sc = scene('greatsword', 1.8);
    sc.book.select('houzan');
    expect(sc.useSkill()).toBe(true);
    sc.run(240);
    expect(sc.attacks).toEqual(['skGsSweep1', 'skGsSweep2', 'skGsSlam']);
    const p = SKILLS.houzan.power;
    expect(sc.powers.map((x) => +x.toFixed(4))).toEqual([p, p, p].map((x) => +x.toFixed(4)));
    expect(sc.player.state).not.toBe('attack');
  });

  it('叩きつけは、直接の斬りと衝撃波が合わせて 1 体に 1 回だけ当たる。衝撃波は斜め前・体の後ろまで届き、遠くには届かない', () => {
    // 連なりのあいだに体は 2.3m ほど前へ進む（叩きつけの時点で z ≒ 1.9〜2.3、地面を叩く点はその 1.8m 前）。
    // 正面 5.0m（直接の斬りだけが届く）・横へ広がった所（扇の外・衝撃波の中）・体の少し後ろ（衝撃波の中）・遠い 9.5m（どちらも届かない）
    const sc = scene('greatsword', 5.0, undefined, [
      { x: 3.4, z: 4.2 },
      { x: 0, z: 0.9 },
      { x: 0, z: 9.5 },
    ]);
    sc.book.select('houzan');
    sc.useSkill();
    sc.run(240);
    const slam = findAttack('skGsSlam')!;
    const power = SKILLS.houzan.power;
    const strike = Math.round(slam.damage * power);
    const shock = Math.round(slam.damage * power * 0.6);
    const of = (id: number) => sc.hits.filter((h) => h.targetId === id);
    // 前の敵: 直接の斬り 1 回だけ（続く衝撃波では重ねて当たらない）
    expect(of(1).map((h) => h.damage)).toEqual([strike]);
    // 横の敵: 衝撃波だけ（威力 0.6 倍）。1 回だけ
    expect(of(10).map((h) => h.damage)).toEqual([shock]);
    // 体の後ろ: 払いと衝撃波が当たるが、衝撃波は 1 回だけ
    expect(of(11).filter((h) => h.damage === shock).length).toBe(1);
    // 遠い敵には当たらない
    expect(of(12).length).toBe(0);
  });

  it('叩きつけは、地面を叩く瞬間に 1 回、衝撃の合図（impactSerial）を出す', () => {
    const sc = scene('greatsword', 1.8);
    sc.book.select('houzan');
    sc.useSkill();
    const before = sc.player.impactSerial;
    sc.run(240);
    expect(sc.player.impactSerial).toBe(before + 1);
    expect(sc.player.lastImpact.power).toBeCloseTo(findAttack('skGsSlam')!.impact!.power * SKILLS.houzan.power, 9);
  });

  it('払いの途中で被弾すると途切れる（スーパーアーマーなし）。叩きつけの振りかぶりは軽い攻撃では怯まず、重い攻撃には割られる', () => {
    const cut = scene('greatsword', 1.8);
    cut.book.select('houzan');
    cut.useSkill();
    cut.run(12);
    cut.player.takeHit(HIT(5));
    expect(cut.player.state).toBe('hit');
    cut.run(240);
    expect(cut.attacks).toEqual(['skGsSweep1']);

    const armored = scene('greatsword', 1.8);
    armored.book.select('houzan');
    armored.useSkill();
    for (let i = 0; i < 200 && armored.attacks.length < 3; i++) armored.step();
    armored.run(10);
    armored.player.takeHit(HIT(14));
    expect(armored.player.state).toBe('attack');
    expect(armored.player.armorSerial).toBe(1);

    const broken = scene('greatsword', 1.8);
    broken.book.select('houzan');
    broken.useSkill();
    for (let i = 0; i < 200 && broken.attacks.length < 3; i++) broken.step();
    broken.run(10);
    broken.player.takeHit(HIT(36));
    expect(broken.player.state).toBe('hit');
  });

  it('払いのあいだは回避で途中でやめられる', () => {
    const sc = scene('greatsword', 1.8);
    sc.book.select('houzan');
    sc.useSkill();
    sc.run(21); // 右からの払いの持続が終わって、次段へ移る（0.4 秒 = 24 フレーム）前
    expect(sc.attacks).toEqual(['skGsSweep1']);
    sc.step({ dodgePressed: true });
    expect(sc.player.state).toBe('dodge');
    sc.run(200);
    expect(sc.attacks).not.toContain('skGsSlam');
  });
});

describe('剣技: 一閃（大剣。溜め → 一瞬のダッシュ → 踏み込み斬り）', () => {
  const HIT = (damage: number) => ({ attackerId: 9, targetId: 0, damage, knockback: 3, hitStop: 0, dirX: 0, dirZ: -1, x: 0, z: 0 });

  it('溜めたあと、ほぼ一瞬で前へ踏み込み、前の敵（遠く）を 1 回だけ斬る', () => {
    const sc = scene('greatsword', 5.4);
    sc.book.select('issen');
    sc.useSkill();
    // 溜めのあいだは動かない
    sc.run(25);
    expect(sc.player.body.z).toBeLessThan(0.05);
    const zs: number[] = [];
    for (let i = 0; i < 20; i++) {
      sc.step();
      zs.push(sc.player.body.z);
    }
    // ダッシュは 0.1 秒（6 フレーム）ほどで 3.2m 動く。1 フレームの移動は 0.7m 以下
    expect(sc.player.body.z).toBeGreaterThan(3.0);
    let maxStep = 0;
    for (let i = 1; i < zs.length; i++) maxStep = Math.max(maxStep, zs[i]! - zs[i - 1]!);
    expect(maxStep).toBeLessThan(0.7);
    sc.run(80);
    expect(sc.attacks).toEqual(['skGsIssen']);
    expect(sc.hits.length).toBe(1);
    expect(sc.hits[0]!.damage).toBe(Math.round(findAttack('skGsIssen')!.damage * SKILLS.issen.power));
  });

  it('広い扇で斬る（斜め前の敵も 1 回当たる）。後ろと、遠すぎる敵には当たらない', () => {
    const sc = scene('greatsword', 5.4, undefined, [
      { x: 2.2, z: 4.6 },
      { x: 0, z: -2 },
      { x: 0, z: 9.5 },
    ]);
    sc.book.select('issen');
    sc.useSkill();
    sc.run(110);
    const of = (id: number) => sc.hits.filter((h) => h.targetId === id).length;
    expect(of(1)).toBe(1);
    expect(of(10)).toBe(1);
    expect(of(11)).toBe(0);
    expect(of(12)).toBe(0);
  });

  it('溜めのあいだはスーパーアーマー（軽い攻撃では怯まない）。重い攻撃には割られる', () => {
    const light = scene('greatsword', 5.4);
    light.book.select('issen');
    light.useSkill();
    light.run(20);
    light.player.takeHit(HIT(12));
    expect(light.player.state).toBe('attack');
    expect(light.player.armorSerial).toBe(1);
    light.run(100);
    expect(light.hits.length).toBe(1);

    const heavy = scene('greatsword', 5.4);
    heavy.book.select('issen');
    heavy.useSkill();
    heavy.run(20);
    heavy.player.takeHit(HIT(30));
    expect(heavy.player.state).toBe('hit');
  });

  it('溜めのあいだでも回避で途中でやめられる。ただし溜め始めてすぐは効かない', () => {
    const early = scene('greatsword', 5.4);
    early.book.select('issen');
    early.useSkill();
    early.run(6, { dodgePressed: true });
    expect(early.player.state).toBe('attack');
    const late = scene('greatsword', 5.4);
    late.book.select('issen');
    late.useSkill();
    late.run(24);
    late.step({ dodgePressed: true });
    expect(late.player.state).toBe('dodge');
    late.run(100);
    expect(late.hits.length).toBe(0);
  });
});

describe('剣技: 始められる状態・途切れ・クールダウン', () => {
  const HURT = { attackerId: 1, targetId: 0, damage: 5, knockback: 0, hitStop: 0, dirX: 0, dirZ: -1, x: 0, z: 0 };

  it('始められたときだけクールダウンに入る。被弾中などで始められなければ入らない', () => {
    const sc = scene('sword');
    sc.book.select('yotsuba');
    sc.player.takeHit(HURT);
    expect(sc.player.state).toBe('hit');
    expect(sc.useSkill()).toBe(false);
    expect(sc.book.ready('yotsuba')).toBe(true);
    sc.run(40);
    expect(sc.player.state).not.toBe('hit');
    expect(sc.useSkill()).toBe(true);
    expect(sc.book.ready('yotsuba')).toBe(false);
  });

  it('頼みは 1 ステップだけ有効（始められない状態で頼んでも、あとから勝手に始まらない）', () => {
    const sc = scene('sword');
    sc.player.takeHit(HURT);
    const run = sc.book.prepare('sword')!;
    const before = sc.player.skillSerial;
    sc.player.requestSkill(run);
    sc.run(60);
    expect(sc.player.skillSerial).toBe(before);
    expect(sc.attacks).toEqual([]);
  });

  it('攻撃の次段の受付のあいだに頼むと、その剣技が始まる（ふつうのコンボから剣技へ）', () => {
    const sc = scene('sword');
    sc.book.select('samidare');
    sc.step({ attackPressed: true });
    expect(sc.attacks).toEqual(['combo1']);
    sc.run(30);
    expect(sc.useSkill()).toBe(true);
    sc.run(5);
    expect(sc.attacks[sc.attacks.length - 1]).toBe('skFlurry');
    expect(sc.player.lastSkill).toBe('samidare');
  });

  it('回避の受付（cancelFrame）からも剣技を始められる', () => {
    const sc = scene('sword', 4);
    sc.step({ dodgePressed: true, moveX: 0, moveY: 1 });
    expect(sc.player.state).toBe('dodge');
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) {
      const run = sc.book.prepare('sword')!;
      const before = sc.player.skillSerial;
      sc.player.requestSkill(run);
      sc.step();
      ok = sc.player.skillSerial !== before;
    }
    expect(ok).toBe(true);
    expect(sc.player.state).toBe('attack');
  });

  it('ガード中は始められない', () => {
    const sc = scene('sword-shield');
    sc.step({ guardPressed: true, guardHeld: true });
    expect(sc.player.state).toBe('guard');
    const run = sc.book.prepare('sword')!;
    const before = sc.player.skillSerial;
    sc.player.requestSkill(run);
    sc.step({ guardHeld: true });
    expect(sc.player.skillSerial).toBe(before);
  });

  it('装備の系統で使えるスキルが替わる（大剣は大剣の最初のスキル）', () => {
    const sc = scene('greatsword', 2.0);
    expect(sc.book.prepare(sc.player.loadout.weapon)!.skill).toBe('houzan');
  });
});
