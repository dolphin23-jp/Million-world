import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { resolvePlayerAttack, type CombatTarget } from './combat';
import { Enemy } from '../ai/enemy';
import { ENEMIES, type EnemyDef } from '../ai/data/enemies';
import { SkillBook } from '../combat/skills';
import { SKILLS, type SkillId } from '../combat/data/skills';
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
  /** 攻撃 id の遷移（変わるたびに 1 つ。null = 攻撃していない）の記録 */
  attacks: string[];
  powers: number[];
  step(over?: Partial<InputIntent>): void;
  run(n: number, over?: Partial<InputIntent>): void;
  /** 選んでいるスキルを頼む（Game.useSkill と同じ。始まったら book.start して true） */
  useSkill(): boolean;
}

function scene(loadout: LoadoutId = 'sword', z = 1.6, bookInit?: Partial<Record<SkillId, number>>): Scene {
  const player = new Player();
  player.equip(loadout);
  const enemy = new Enemy(DUMMY, 1, 0, z);
  enemy.place(0, z, Math.PI);
  const book = new SkillBook(bookInit);
  const hits: HitEvent[] = [];
  const attacks: string[] = [];
  const powers: number[] = [];
  let last: string | null = null;
  const sc: Scene = {
    player,
    enemy,
    book,
    hits,
    attacks,
    powers,
    step(over = {}) {
      book.step();
      player.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
      enemy.step(DT, player.body.x, player.body.z, !player.dead);
      resolvePlayerAttack(player, [enemy as CombatTarget], (ev) => hits.push(ev));
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

describe('剣技: 連なりが自動で続く', () => {
  it('頼むと、押さなくても連なりの順に技が出て、段ごとの威力が掛かる（片手剣の燕返し）', () => {
    const sc = scene('sword');
    expect(sc.useSkill()).toBe(true);
    sc.run(400);
    expect(sc.attacks).toEqual(['combo1', 'comboHop', 'hopThrust']);
    const run = sc.book.prepare('sword'); // クールダウン中 = null
    expect(run).toBeNull();
    const steps = [SKILLS.tsubame.power, SKILLS.tsubame.power, SKILLS.tsubame.power * 1.1];
    expect(sc.powers.map((p) => +p.toFixed(4))).toEqual(steps.map((p) => +p.toFixed(4)));
    expect(sc.player.state).not.toBe('attack');
  });

  it('当たったダメージ = 技のダメージ × 威力（段ごと）', () => {
    const sc = scene('sword');
    sc.useSkill();
    sc.run(400);
    expect(sc.hits.length).toBeGreaterThanOrEqual(1);
    const first = sc.hits[0]!;
    expect(first.damage).toBe(Math.round(ATTACKS.combo1!.damage * SKILLS.tsubame.power));
  });

  it('レベルで連なりが伸びる（五月雨 Lv5 は 5 段）', () => {
    const sc = scene('sword', 1.6, { samidare: 5 });
    sc.book.select('samidare');
    sc.useSkill();
    sc.run(600);
    expect(sc.attacks).toEqual(['combo1', 'combo2', 'combo3', 'comboUpper', 'comboSlam']);
  });

  it('大剣の剣技（崩山: 斬り → 斬り → 叩き割り）も順に出る', () => {
    const sc = scene('greatsword', 2.0);
    sc.book.select('houzan');
    expect(sc.useSkill()).toBe(true);
    sc.run(700);
    expect(sc.attacks).toEqual(['gs1', 'gs2', 'gsDrop']);
  });

  it('連なりの途中の受付は、押さなくても開くたびに次へ進む（攻撃の頼みは要らない）', () => {
    const sc = scene('sword', 1.6, { senpu: 1 });
    sc.book.select('senpu');
    sc.useSkill();
    sc.run(5);
    expect(sc.attacks).toEqual(['combo1']);
    sc.run(400);
    expect(sc.attacks).toEqual(['combo1', 'combo2', 'comboSpin']);
  });
});

describe('剣技: 始められる状態・途切れ・クールダウン', () => {
  it('始められたときだけクールダウンに入る。被弾中などで始められなければ入らない', () => {
    const sc = scene('sword');
    sc.player.takeHit({ attackerId: 1, targetId: 0, damage: 5, knockback: 0, hitStop: 0, dirX: 0, dirZ: -1, x: 0, z: 0 });
    expect(sc.player.state).toBe('hit');
    expect(sc.useSkill()).toBe(false);
    expect(sc.book.ready('tsubame')).toBe(true);
    // 立ち直ったあとは使える
    sc.run(40);
    expect(sc.player.state).not.toBe('hit');
    expect(sc.useSkill()).toBe(true);
    expect(sc.book.ready('tsubame')).toBe(false);
  });

  it('頼みは 1 ステップだけ有効（始められない状態で頼んでも、あとから勝手に始まらない）', () => {
    const sc = scene('sword');
    sc.player.takeHit({ attackerId: 1, targetId: 0, damage: 5, knockback: 0, hitStop: 0, dirX: 0, dirZ: -1, x: 0, z: 0 });
    const run = sc.book.prepare('sword')!;
    const before = sc.player.skillSerial;
    sc.player.requestSkill(run);
    sc.run(60);
    expect(sc.player.skillSerial).toBe(before);
    expect(sc.attacks).toEqual([]);
  });

  it('連なりの途中で被弾すると途切れる（以降の段は出ない）', () => {
    const sc = scene('sword');
    sc.useSkill();
    sc.run(10);
    expect(sc.attacks).toEqual(['combo1']);
    sc.player.takeHit({ attackerId: 1, targetId: 0, damage: 5, knockback: 0, hitStop: 0, dirX: 0, dirZ: -1, x: 0, z: 0 });
    sc.run(300);
    expect(sc.attacks).toEqual(['combo1']);
  });

  it('持続のあとの回避キャンセルで連なりを捨てられる（その後、次の段は出ない）', () => {
    const sc = scene('sword');
    sc.useSkill();
    sc.run(5);
    // 1 段目の持続が終わるまで進めて、回避を押す（受付が開く前に押せば回避が先に効く）
    let dodged = false;
    for (let i = 0; i < 80 && !dodged; i++) {
      sc.step({ dodgePressed: sc.player.stateFrame >= 22 });
      dodged = sc.player.state === 'dodge';
    }
    expect(dodged).toBe(true);
    sc.run(300);
    expect(sc.attacks).toEqual(['combo1']);
  });

  it('攻撃の次段の受付のあいだに頼むと、その剣技が始まる（ふつうのコンボから剣技へ）', () => {
    const sc = scene('sword');
    sc.step({ attackPressed: true }); // 1 段目
    expect(sc.attacks).toEqual(['combo1']);
    const cancelFrame = 30;
    sc.run(cancelFrame);
    expect(sc.useSkill()).toBe(true);
    sc.run(5);
    expect(sc.attacks[sc.attacks.length - 1]).toBe('combo1'); // 剣技の 1 段目（燕返し）
    expect(sc.player.lastSkill).toBe('tsubame');
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

  it('溜めの構え・ガードの最中は始められない', () => {
    const sc = scene('sword-shield');
    sc.step({ guardPressed: true, guardHeld: true });
    expect(sc.player.state).toBe('guard');
    const run = sc.book.prepare('sword')!;
    const before = sc.player.skillSerial;
    sc.player.requestSkill(run);
    sc.step({ guardHeld: true });
    expect(sc.player.skillSerial).toBe(before);
  });
});

describe('剣技: 盾付き・大剣でも使える', () => {
  it('盾付きの片手剣は剣の系統のスキルを使える（同じ連なり）', () => {
    const sc = scene('sword-shield');
    expect(sc.useSkill()).toBe(true);
    sc.run(400);
    expect(sc.attacks).toEqual(['combo1', 'comboHop', 'hopThrust']);
  });

  it('装備の系統で使えるスキルが替わる（大剣は大剣の最初のスキル）', () => {
    const sc = scene('greatsword', 2.0);
    expect(sc.book.prepare(sc.player.loadout.weapon)!.skill).toBe('dangan');
  });
});
