import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import { LOADOUTS } from '../combat/data/loadouts';
import { SPELL_ATTACKS } from '../combat/data/spell-attacks';
import { resolveAttack } from '../combat/data/attacks';
import { SPELLS } from '../combat/data/spells';
import { SkillBook } from '../combat/skills';
import type { HitEvent } from '../combat/hit';

/**
 * 杖（ADR-048）の Player 結合テスト: 詠唱 → 魔法を放つ合図（castSerial）・魔弾の 1 ルート連打・詠唱の中断・持続魔法（火炎放射）の旋回・ガードも溜めも無い。
 * カメラ yaw = π のとき、スティックの上は +Z、右は −X、左は +X。
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const step = (p: Player, over: Partial<InputIntent> = {}, n = 1) => {
  for (let i = 0; i < n; i++) p.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
};
const staff = () => {
  const p = new Player();
  expect(p.equip('staff')).toBe(true);
  return p;
};
const hit = (over: Partial<HitEvent> = {}): HitEvent => ({ attackerId: 1, targetId: 0, damage: 5, knockback: 0.5, hitStop: 0, dirX: 0, dirZ: 1, x: 0, z: 0, ...over });
/** 魔法を頼み、始まったあと魔法を放つ合図が出るまで進めたステップ数（頼んだステップ = 1） */
const framesToCast = (p: Player, limit = 400): number => {
  const before = p.castSerial;
  for (let i = 1; i <= limit; i++) {
    step(p);
    if (p.castSerial !== before) return i;
  }
  return -1;
};
const cast = (p: Player, id: Parameters<SkillBook['prepareById']>[0], book = new SkillBook()) => {
  const run = book.prepareById(id)!;
  expect(run).toBeTruthy();
  p.requestSkill(run);
  step(p);
};

describe('杖: 装備', () => {
  it('杖はガードも溜めも持たない。技のセットは魔弾の連打（1 ルート）で、盾は持たない', () => {
    const p = staff();
    expect(p.loadout).toBe(LOADOUTS.staff);
    expect(p.loadout.weapon).toBe('staff');
    expect(p.loadout.guard).toBeNull();
    expect(p.loadout.charge).toBeNull();
    expect(p.loadout.offhand).toBe('none');
    expect(p.guard).toBeNull();
    expect(Object.values(p.loadout.moveset).every((id) => id === 'stBolt1')).toBe(true);
  });

  it('ガードを押しても構えない。攻撃を押し続けても溜めに入らない（魔弾を撃つだけ）', () => {
    const p = staff();
    step(p, { guardPressed: true, guardHeld: true }, 10);
    expect(p.state).not.toBe('guard');
    expect(p.guarding).toBe(false);
    const q = staff();
    step(q, { attackPressed: true, attackHeld: true });
    for (let i = 0; i < 40; i++) step(q, { attackHeld: true });
    expect(q.state).not.toBe('charge');
    expect(q.chargeLevel).toBe(0);
  });
});

describe('杖: 通常攻撃 = 魔弾の 1 ルート連打（詠唱 → 魔弾）', () => {
  it('攻撃で 1 段目の詠唱に入る。魔法を放つ合図（castSerial）は、定義の放つ時刻（0.3 秒）に出る。放つ前は詠唱中（casting）', () => {
    const p = staff();
    step(p, { attackPressed: true });
    expect(p.state).toBe('attack');
    expect(p.attack!.id).toBe('stBolt1');
    expect(p.casting).toBe(true);
    expect(p.castSerial).toBe(0);
    const n = 1 + framesToCast(p);
    expect(Math.abs(n - SPELL_ATTACKS.stBolt1!.activeStart * 60)).toBeLessThanOrEqual(2);
    expect(p.casting).toBe(false);
    expect(p.lastCast.spell).toBe('bolt1');
    expect(p.lastCast.skill).toBeNull();
    expect(p.lastCast.power).toBe(1);
  });

  it('連打すると 魔弾 → 魔弾 → 大魔弾 と続く。大魔弾が最後（4 発目は出ない）', () => {
    const p = staff();
    const seen: string[] = [];
    const spells: string[] = [];
    step(p, { attackPressed: true });
    seen.push(p.attack!.id);
    for (let i = 0; i < 160 && p.state === 'attack'; i++) {
      const before = p.castSerial;
      step(p, { attackPressed: true });
      if (p.attack && p.attack.id !== seen[seen.length - 1]) seen.push(p.attack.id);
      if (p.castSerial !== before) spells.push(p.lastCast.spell);
    }
    expect(seen).toEqual(['stBolt1', 'stBolt2', 'stBolt3']);
    expect(spells).toEqual(['bolt1', 'bolt2', 'bolt3']);
  });

  it('次の詠唱の受付（cancelAt）より前に押しても、先行入力で受付が開いた時点で続く。押さなければ戻って待機', () => {
    const p = staff();
    step(p, { attackPressed: true });
    step(p, { attackPressed: true }, 2); // 受付の前に押す
    const cancel = Math.round(SPELL_ATTACKS.stBolt1!.cancelAt * 60);
    step(p, {}, cancel + 2);
    expect(p.attack?.id).toBe('stBolt2');
    const q = staff();
    step(q, { attackPressed: true });
    step(q, {}, 90);
    expect(q.state).toBe('idle');
  });

  it('魔弾の詠唱は、放つ前に被弾すると中断され、魔法は放たれない（castSerial が増えない）', () => {
    const p = staff();
    step(p, { attackPressed: true });
    step(p, {}, 5);
    expect(p.casting).toBe(true);
    p.takeHit(hit());
    expect(p.state).toBe('hit');
    step(p, {}, 90);
    expect(p.castSerial).toBe(0);
  });
});

describe('杖: 魔法（スキル）の詠唱', () => {
  it('魔法を頼むと詠唱に入り、定義の時刻に放つ。放った魔法とスキルの id・威力が lastCast に残る', () => {
    const p = staff();
    const book = new SkillBook();
    book.setLevel('thunder', 5);
    const run = book.prepareById('thunder', 1.1)!;
    p.requestSkill(run);
    step(p);
    expect(p.state).toBe('attack');
    expect(p.attack!.id).toBe('spThunder');
    expect(p.lastSkill).toBe('thunder');
    expect(p.skillSerial).toBe(1);
    expect(p.castSerial).toBe(0);
    const n = 1 + framesToCast(p);
    expect(Math.abs(n - SPELL_ATTACKS.spThunder!.activeStart * 60)).toBeLessThanOrEqual(2);
    expect(p.lastCast.spell).toBe('thunder');
    expect(p.lastCast.skill).toBe('thunder');
    expect(p.lastCast.power).toBeCloseTo(run.steps[0]!.power, 9);
    expect(p.lastCast.power).toBeGreaterThan(1.1);
  });

  it('詠唱の位置・向きは、魔法を放った時点の術者のもの（lastCast）', () => {
    const p = staff();
    p.body.x = 2;
    p.body.z = -1;
    cast(p, 'explosion');
    framesToCast(p);
    expect(p.lastCast.x).toBeCloseTo(p.body.x, 9);
    expect(p.lastCast.z).toBeCloseTo(p.body.z, 9);
    expect(p.lastCast.yaw).toBeCloseTo(p.yaw, 9);
  });

  it('魔法を放つ前に被弾すると、放たれない（クールダウンも始まらない = Game は castSerial が増えたときだけクールダウンに入る）', () => {
    const p = staff();
    cast(p, 'explosion');
    step(p, {}, 20);
    p.takeHit(hit());
    step(p, {}, 120);
    expect(p.castSerial).toBe(0);
    expect(p.lastCast.skill).toBeNull();
  });

  it('魔法を放ったあとは、回避でやめられる（吹雪の liveCastSerial が 0 に戻る）。放つ前の回避は効かない（詠唱を続ける）', () => {
    const p = staff();
    cast(p, 'blizzard');
    step(p, { dodgePressed: true }, 1);
    expect(p.state).toBe('attack'); // 詠唱の途中は回避できない
    framesToCast(p);
    expect(p.liveCastSerial).toBe(p.castSerial);
    step(p, { dodgePressed: true, moveX: 1, moveY: 0 });
    for (let i = 0; i < 6 && p.state === 'attack'; i++) step(p, { dodgePressed: true, moveX: 1, moveY: 0 });
    expect(p.state).toBe('dodge');
    expect(p.liveCastSerial).toBe(0);
  });

  it('魔法の詠唱は足を止める（スティックを倒しても動かない。向きだけ変わる）', () => {
    const p = staff();
    cast(p, 'thunder');
    const x0 = p.body.x;
    const z0 = p.body.z;
    step(p, { moveX: -1, moveY: 0 }, 50);
    expect(Math.hypot(p.body.x - x0, p.body.z - z0)).toBeLessThan(0.05);
  });

  it('詠唱の前は、スティックの向きへ向き直れる（狙いを合わせられる）。放ったあとは向きを固定（火炎放射を除く）', () => {
    const p = staff();
    const yaw0 = p.yaw;
    cast(p, 'thunder');
    step(p, { moveX: 1, moveY: 0 }, 20); // 画面の右 = −X（yaw −π/2）
    const turned = Math.abs(p.yaw - yaw0);
    expect(turned).toBeGreaterThan(0.5);
    framesToCast(p);
    const yawAt = p.yaw;
    step(p, { moveX: -1, moveY: 0 }, 20);
    expect(p.yaw).toBeCloseTo(yawAt, 6);
  });
});

describe('杖: 火炎放射（放つあいだ向きを変えられる）', () => {
  it('放ったあと channel の seconds のあいだは channeling で、そのあいだ向きが変わる。終わったら変わらない', () => {
    const p = staff();
    cast(p, 'flame');
    framesToCast(p);
    expect(p.channeling).toBe(true);
    expect(p.channelingSerial).toBe(p.castSerial);
    expect(p.liveCastSerial).toBe(p.castSerial);
    const turn = SPELL_ATTACKS.spFlame!.cast!.channel!.turnRate;
    const y0 = p.yaw;
    step(p, { moveX: 1, moveY: 0 }, 15); // 右（−X）へ。0.25 秒ぶんの旋回
    const d = Math.abs(p.yaw - y0);
    expect(d).toBeGreaterThan(turn * 0.25 * 0.8);
    expect(d).toBeLessThan(turn * 0.25 * 1.2);
    // 放出が終わるまで進める → 向きは変わらず、channeling は false
    const secs = SPELL_ATTACKS.spFlame!.cast!.channel!.seconds;
    step(p, {}, Math.round(secs * 60));
    expect(p.channeling).toBe(false);
    expect(p.channelingSerial).toBe(0);
    const yEnd = p.yaw;
    step(p, { moveX: -1, moveY: 0 }, 10);
    if (p.state === 'attack') expect(p.yaw).toBeCloseTo(yEnd, 6);
  });

  it('放出のあいだは足を止める。詠唱が終わったら（あとで）動ける', () => {
    const p = staff();
    cast(p, 'flame');
    framesToCast(p);
    const x0 = p.body.x;
    const z0 = p.body.z;
    step(p, { moveX: 0, moveY: 1 }, 60);
    expect(Math.hypot(p.body.x - x0, p.body.z - z0)).toBeLessThan(0.05);
    step(p, { moveX: 0, moveY: 1 }, 200);
    expect(p.state).toBe('run');
  });
});

describe('杖: 詠唱の定義', () => {
  it('どの詠唱も、魔法を放つ時刻がクリップの中にあり、放ったあとでなければ回避でやめられない。持続魔法の放出はクリップの終わりまでに収まる', () => {
    for (const a of Object.values(SPELL_ATTACKS)) {
      const fr = resolveAttack(a);
      expect(a.cast, a.id).toBeDefined();
      expect(SPELLS[a.cast!.spell], a.id).toBeDefined();
      expect(fr.startup, a.id).toBeGreaterThan(0);
      expect(fr.dodgeCancel, a.id).toBeGreaterThanOrEqual(fr.startup);
      expect(fr.total, a.id).toBeGreaterThan(fr.startup);
      if (a.cast!.channel) expect(a.cast!.at + a.cast!.channel.seconds, a.id).toBeLessThanOrEqual(a.segmentDuration);
    }
  });
});
