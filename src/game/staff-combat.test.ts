import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { Enemy } from '../ai/enemy';
import { ENEMIES } from '../ai/data/enemies';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import { SPELLS } from '../combat/data/spells';
import { SkillBook } from '../combat/skills';
import { SpellSystem, pickSpellTarget, type SpellHandlers } from '../combat/spell-system';

/**
 * 杖の結合テスト（Game の配線と同じ順で、Player・SpellSystem・Enemy だけで動かす）: 詠唱を放つ合図 → 魔法の効果 → 敵に当たる。
 * 吹雪は術者が回避でやめると止まり、火炎放射は放出のあいだの向きの変更で別の敵に当たり、落雷はロック対象に落ちる、をここで確かめる。
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;

function setup() {
  const player = new Player();
  expect(player.equip('staff')).toBe(true);
  const spells = new SpellSystem(null, 0, () => 1);
  const book = new SkillBook();
  const enemies: Enemy[] = [];
  const add = (x: number, z: number): Enemy => {
    const e = new Enemy(ENEMIES.imp, enemies.length + 1, x, z);
    e.place(x, z, Math.PI);
    e.health.hp = e.health.max = 100000;
    enemies.push(e);
    return e;
  };
  const dealt = new Map<number, number>();
  let healed = 0;
  const handlers: SpellHandlers<Enemy> = {
    onHit: (_ev, t, result) => dealt.set(t.id, (dealt.get(t.id) ?? 0) + result.dealt),
    onHeal: (amount) => (healed += player.heal(amount)),
  };
  let seenCast = 0;
  /** Game.step と同じ順: 入力 → Player → 魔法を放った合図（効果を作る。クールダウンに入る）→ SpellSystem → 敵（Enemy.step は呼ばない = 動かず、攻撃しない） */
  const step = (over: Partial<InputIntent> = {}, n = 1) => {
    for (let i = 0; i < n; i++) {
      book.step();
      player.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
      if (player.castSerial !== seenCast) {
        seenCast = player.castSerial;
        const c = player.lastCast;
        if (c.skill) book.start(c.skill);
        const spell = SPELLS[c.spell];
        if (spell.kind !== 'bolt') {
          const cands = enemies.filter((e) => !e.dead).map((e) => ({ id: e.id, x: e.body.x, z: e.body.z }));
          const target = pickSpellTarget(cands, c.x, c.z, c.yaw, lockedId);
          spells.cast(spell, { x: c.x, z: c.z, yaw: c.yaw, power: c.power, serial: player.castSerial }, target);
        }
      }
      spells.step(player, enemies, handlers);
    }
  };
  let lockedId: number | null = null;
  const lock = (id: number | null) => (lockedId = id);
  const useSpell = (id: Parameters<SkillBook['prepareById']>[0]) => {
    const run = book.prepareById(id);
    expect(run).toBeTruthy();
    player.requestSkill(run!);
  };
  return { player, spells, book, enemies, add, dealt, step, useSpell, lock, healed: () => healed };
}

describe('杖: 詠唱 → 魔法 → 敵（Player・SpellSystem・Enemy の結合）', () => {
  it('落雷: クールダウンは魔法を放った瞬間から。ロックした敵（正面でなくても）にいちばん強く当たる', () => {
    const s = setup();
    const front = s.add(0, 5);
    const locked = s.add(6, -3); // 背後寄りでもロックすれば選ばれる
    s.lock(locked.id);
    s.useSpell('thunder');
    s.step({}, 5);
    expect(s.book.cooldownRatio('thunder')).toBe(0); // 詠唱の途中: まだクールダウンに入らない
    s.step({}, 140);
    expect(s.book.cooldownRatio('thunder')).toBeGreaterThan(0.7);
    expect(s.dealt.get(locked.id) ?? 0).toBeGreaterThanOrEqual(64 * 0.99);
    expect(s.dealt.get(front.id) ?? 0).toBeLessThan(s.dealt.get(locked.id) ?? 0);
  });

  it('落雷: ロックしないとき、正面の近い敵を狙う。背後の敵には周囲の落雷が届かない遠さなら当たらない', () => {
    const s = setup();
    const front = s.add(0, 4);
    const behind = s.add(0, -9);
    s.lock(null);
    s.useSpell('thunder');
    s.step({}, 150);
    expect(s.dealt.get(front.id) ?? 0).toBeGreaterThanOrEqual(64 * 0.99);
    expect(s.dealt.get(behind.id) ?? 0).toBe(0);
  });

  it('詠唱を放つ前に被弾すると、魔法は放たれず、クールダウンにも入らず、敵に当たらない', () => {
    const s = setup();
    const e = s.add(0, 4);
    s.useSpell('explosion');
    s.step({}, 20);
    s.player.takeHit({ attackerId: 1, targetId: 0, damage: 3, knockback: 0.5, hitStop: 0, dirX: 0, dirZ: 1, x: 0, z: 0 });
    s.step({}, 200);
    expect(s.book.cooldownRatio('explosion')).toBe(0);
    expect(s.dealt.get(e.id) ?? 0).toBe(0);
    expect(s.spells.active).toBe(false);
  });

  it('吹雪: 前方の敵に刻みで当たり続け、術者が回避でやめると止まる（その後は当たらない）。敵はひるまない', () => {
    const s = setup();
    const e = s.add(0, 3);
    s.useSpell('blizzard');
    s.step({}, 60); // 詠唱 → 放つ（0.6 秒）
    s.step({}, 20);
    const before = s.dealt.get(e.id) ?? 0;
    expect(before).toBeGreaterThan(0);
    expect(e.state).not.toBe('hit');
    s.step({ dodgePressed: true, moveX: 1, moveY: 0 }, 8); // 放ったあとなら回避でやめられる
    expect(s.player.state).toBe('dodge');
    const at = s.dealt.get(e.id) ?? 0;
    s.step({}, 120);
    expect(s.dealt.get(e.id) ?? 0).toBe(at);
  });

  it('火炎放射: 放出のあいだにスティックで向きを変えると、帯が回って別の敵に当たる', () => {
    const s = setup();
    const front = s.add(0, 4);
    const side = s.add(-4, 0.5); // 画面の右 = −X 側
    s.useSpell('flame');
    s.step({}, 45); // 放つ（0.6 秒）直後
    const sideBefore = s.dealt.get(side.id) ?? 0;
    expect(s.dealt.get(front.id) ?? 0).toBeGreaterThan(0);
    s.step({ moveX: 1, moveY: 0 }, 70); // 右（−X）へ向きを変える（旋回 2.4 rad/s で 1.2 秒 ≈ 82°）
    expect(s.dealt.get(side.id) ?? 0).toBeGreaterThan(sideBefore);
    expect(s.player.channeling).toBe(true);
  });

  it('旋風: 囲んだ敵に（距離に応じて）輪ごとに当たり、同じ輪では 1 回だけ。近い敵は遠い敵より多く当たる', () => {
    const s = setup();
    const near = s.add(0.9, 0);
    const far = s.add(0, 5);
    s.useSpell('hurricane');
    s.step({}, 200);
    const n = s.dealt.get(near.id) ?? 0;
    const f = s.dealt.get(far.id) ?? 0;
    expect(n).toBe(22 * 3); // 3 つの輪すべてに 1 回ずつ
    expect(f).toBe(22); // 外側の輪だけ
  });

  it('再生: 体力が少しずつ回復する（10 秒で 40 前後）。満タンを超えては増えない', () => {
    const s = setup();
    s.player.health.hp = 40;
    s.useSpell('regen');
    s.step({}, 700);
    expect(s.healed()).toBeGreaterThanOrEqual(36);
    expect(s.healed()).toBeLessThanOrEqual(44);
    expect(s.player.health.hp).toBe(40 + s.healed());
    const full = setup();
    full.useSpell('regen');
    full.step({}, 700);
    expect(full.healed()).toBe(0);
    expect(full.player.health.hp).toBe(full.player.health.max);
  });
});
