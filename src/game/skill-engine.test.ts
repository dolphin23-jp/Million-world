import { afterEach, describe, expect, it } from 'vitest';
import { Player } from './player';
import { resolvePlayerAttack, type CombatTarget } from './combat';
import { Enemy } from '../ai/enemy';
import { ENEMIES, type EnemyDef } from '../ai/data/enemies';
import { resolveAttack, type AttackDef } from '../combat/data/attacks';
import { SKILL_ATTACKS } from '../combat/data/skill-attacks';
import { hitboxHits, hitboxReach, type HitEvent } from '../combat/hit';
import type { SkillRun } from '../combat/skills';
import { createEmptyIntent, type InputIntent } from '../input/intent';

/**
 * 剣技の土台（ADR-031）: 多段ヒットの窓・窓の組・円形の当たり・スーパーアーマー・回避キャンセルの時刻。
 * 実在の剣技に頼らず、テスト用の攻撃定義を SKILL_ATTACKS に一時的に入れて、本物の Player で 1 フレームずつ確かめる。
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const DUMMY: EnemyDef = { ...ENEMIES.imp, hp: 999999, knockbackScale: 0 };

/** 窓の時刻は rate 1 の秒。60 を掛けたフレーム */
function def(over: Partial<AttackDef> & { id: string }): AttackDef {
  return {
    segment: 'combo1',
    segmentDuration: 1.2,
    activeStart: 0.2,
    activeEnd: 0.9,
    cancelAt: 1.2,
    trail: [0.1, 0.9],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'arc', range: 2, halfAngle: Math.PI / 2 },
    damage: 10,
    hitStop: 0,
    knockback: 0,
    ...over,
  };
}

const added: string[] = [];
function register(a: AttackDef): AttackDef {
  SKILL_ATTACKS[a.id] = a;
  added.push(a.id);
  return a;
}
afterEach(() => {
  for (const id of added.splice(0)) delete SKILL_ATTACKS[id];
});

interface Scene {
  player: Player;
  hits: { id: number; damage: number; t: number }[];
  step(over?: Partial<InputIntent>): void;
  run(n: number, over?: Partial<InputIntent>): void;
}

/** 的は id ごとに (x, z) へ置く（動かない）。攻撃者は原点で +Z を向く */
function scene(targets: { id: number; x: number; z: number }[]): Scene {
  const player = new Player();
  const enemies = targets.map((t) => {
    const e = new Enemy({ ...DUMMY }, t.id, t.x, t.z);
    e.place(t.x, t.z, Math.PI);
    return e;
  });
  const hits: Scene['hits'] = [];
  let frame = 0;
  const sc: Scene = {
    player,
    hits,
    step(over = {}) {
      player.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
      for (const e of enemies) e.step(DT, 9999, 9999, false); // プレイヤーに反応しない（的として置く）
      resolvePlayerAttack(player, enemies as unknown as CombatTarget[], (ev: HitEvent) => hits.push({ id: ev.targetId, damage: ev.damage, t: frame }));
      frame++;
    },
    run(n, over) {
      for (let i = 0; i < n; i++) sc.step(over);
    },
  };
  return sc;
}

function start(sc: Scene, id: string, power = 1): void {
  const run: SkillRun = { skill: 'yotsuba', steps: [{ attack: id, power }] };
  sc.player.requestSkill(run);
  sc.step();
}

describe('円形の当たり（HitboxDef circle）', () => {
  const origin = { x: 0, z: 0, yaw: 0 };
  it('攻撃者の正面 offset の点を中心に、半径 + 相手の半径で当たる', () => {
    const box = { kind: 'circle', offset: 2, radius: 1.5 } as const;
    expect(hitboxHits(origin, box, { x: 0, z: 2, r: 0.4 })).toBe(true);
    expect(hitboxHits(origin, box, { x: 1.8, z: 2, r: 0.4 })).toBe(true); // 中心から 1.8 ≤ 1.5 + 0.4
    expect(hitboxHits(origin, box, { x: 2.0, z: 2, r: 0.4 })).toBe(false);
    // 攻撃者の後ろ側の点は、中心から遠い
    expect(hitboxHits(origin, box, { x: 0, z: -1, r: 0.4 })).toBe(false);
  });
  it('向き（yaw）に従う', () => {
    const box = { kind: 'circle', offset: 2, radius: 1 } as const;
    expect(hitboxHits({ x: 0, z: 0, yaw: Math.PI / 2 }, box, { x: 2, z: 0, r: 0.4 })).toBe(true);
    expect(hitboxHits({ x: 0, z: 0, yaw: Math.PI / 2 }, box, { x: 0, z: 2, r: 0.4 })).toBe(false);
  });
  it('届く距離は offset + radius', () => {
    expect(hitboxReach({ kind: 'circle', offset: 2, radius: 1.5 })).toBe(3.5);
    expect(hitboxReach({ kind: 'arc', range: 2, halfAngle: 1 })).toBe(2);
    expect(hitboxReach({ kind: 'line', length: 3, radius: 0.3 })).toBe(3);
  });
});

describe('resolveAttack: 窓・アーマー・回避キャンセル', () => {
  it('窓は rate で割ってフレームにし、組を持つ（省略は窓の番号）', () => {
    const f = resolveAttack(
      def({
        id: 'w',
        rate: 2,
        windows: [
          { start: 0.2, end: 0.3 },
          { start: 0.5, end: 0.6, group: 7 },
        ],
        armor: { from: 0, to: 0.4, breakDamage: 30 },
        dodgeCancelAt: 0.4,
      }),
    );
    expect(f.windows.map((w) => [w.start, w.end, w.group])).toEqual([
      [6, 9, 0],
      [15, 18, 7],
    ]);
    expect(f.armor).toEqual({ from: 0, to: 12, breakDamage: 30 });
    expect(f.dodgeCancel).toBe(12);
  });
  it('窓・アーマー・回避キャンセルの指定が無ければ、従来どおり（窓なし・アーマーなし・持続の終わり）', () => {
    const f = resolveAttack(def({ id: 'plain' }));
    expect(f.windows).toEqual([]);
    expect(f.armor).toBeNull();
    expect(f.dodgeCancel).toBe(f.startup + f.active);
  });
});

describe('resolveAttack: 地面を叩く演出（impact と echoes）', () => {
  it('impact と echoes は rate で割ったフレームに直り、時刻の順に並ぶ。無ければ空', () => {
    const f = resolveAttack(
      def({
        id: 'imp',
        rate: 2,
        impact: { t: 0.4, dist: 2.0, power: 1.5 },
        echoes: [
          { t: 0.6, dist: 2.2, power: 1.7 },
          { t: 0.8, dist: 2.4, power: 1.9 },
        ],
      }),
    );
    expect(f.impacts).toEqual([
      { frame: 12, dist: 2.0, power: 1.5 },
      { frame: 18, dist: 2.2, power: 1.7 },
      { frame: 24, dist: 2.4, power: 1.9 },
    ]);
    expect(resolveAttack(def({ id: 'none' })).impacts).toEqual([]);
    // echoes だけでも出る（impact が無い攻撃）
    expect(resolveAttack(def({ id: 'e', echoes: [{ t: 0.3, dist: 1, power: 1 }] })).impacts).toEqual([{ frame: 18, dist: 1, power: 1 }]);
  });

  it('Player は impact と echoes の時刻ごとに 1 回ずつ impactSerial を進め、位置は体の前 dist・強さは attackPower 倍', () => {
    register(
      def({
        id: 'tImpact',
        impact: { t: 0.3, dist: 2.0, power: 1.5 },
        echoes: [{ t: 0.5, dist: 3.0, power: 2.0 }],
      }),
    );
    const sc = scene([]);
    const p = sc.player;
    start(sc, 'tImpact', 1.2);
    const seen: { z: number; power: number }[] = [];
    let last = p.impactSerial;
    for (let i = 0; i < 90; i++) {
      sc.step();
      if (p.impactSerial !== last) {
        last = p.impactSerial;
        seen.push({ z: p.lastImpact.z - p.body.z, power: p.lastImpact.power });
      }
    }
    expect(seen.length).toBe(2);
    expect(seen[0]!.power).toBeCloseTo(1.5 * 1.2, 9);
    expect(seen[1]!.power).toBeCloseTo(2.0 * 1.2, 9);
    expect(seen[0]!.z).toBeCloseTo(2.0, 1);
    expect(seen[1]!.z).toBeCloseTo(3.0, 1);
  });
});

describe('多段ヒット: 窓ごとに当たり直す', () => {
  it('窓のあいだだけ当たりが出て、窓ごとに同じ敵へもう一度当たる', () => {
    register(
      def({
        id: 'multi',
        windows: [
          { start: 0.2, end: 0.3 },
          { start: 0.5, end: 0.6 },
          { start: 0.8, end: 0.9 },
        ],
        activeStart: 0.2,
        activeEnd: 0.9,
      }),
    );
    const sc = scene([{ id: 1, x: 0, z: 1.2 }]);
    start(sc, 'multi');
    sc.run(80);
    expect(sc.hits.length).toBe(3);
    // 窓の外（0.3〜0.5 秒）は当たりが出ない
    for (const h of sc.hits) {
      const sec = (h.t + 1) / 60;
      const inWindow = (sec >= 0.2 && sec < 0.3 + 0.03) || (sec >= 0.5 && sec < 0.6 + 0.03) || (sec >= 0.8 && sec < 0.9 + 0.03);
      expect(inWindow, `t=${sec}`).toBe(true);
    }
  });

  it('窓ごとの当たりの形と向き: 前半分・後ろ半分（回転斬り）', () => {
    const half = { kind: 'arc', range: 2.2, halfAngle: Math.PI / 2 } as const;
    register(
      def({
        id: 'spin',
        windows: [
          { start: 0.2, end: 0.3, hitbox: half },
          { start: 0.4, end: 0.5, hitbox: half, yawOffset: Math.PI },
          { start: 0.6, end: 0.7, hitbox: half },
        ],
        activeStart: 0.2,
        activeEnd: 0.7,
      }),
    );
    const sc = scene([
      { id: 1, x: 0, z: 1.3 }, // 前
      { id: 2, x: 0, z: -1.3 }, // 後ろ
    ]);
    start(sc, 'spin');
    sc.run(60);
    const front = sc.hits.filter((h) => h.id === 1).length;
    const rear = sc.hits.filter((h) => h.id === 2).length;
    expect(front).toBe(2); // 前の窓 2 回
    expect(rear).toBe(1); // 後ろの窓 1 回
  });

  it('窓ごとのダメージの倍率が掛かる', () => {
    register(def({ id: 'scale', damage: 10, windows: [{ start: 0.2, end: 0.3 }, { start: 0.5, end: 0.6, damageScale: 2.5 }], activeStart: 0.2, activeEnd: 0.6 }));
    const sc = scene([{ id: 1, x: 0, z: 1.2 }]);
    start(sc, 'scale', 1.2);
    sc.run(60);
    expect(sc.hits.map((h) => h.damage)).toEqual([Math.round(10 * 1.2), Math.round(10 * 2.5 * 1.2)]);
  });

  it('同じ組（group）の窓は、同じ敵に重ねて当たらない（直撃と衝撃波）。別の敵には衝撃波が当たる', () => {
    register(
      def({
        id: 'quake',
        windows: [
          { start: 0.2, end: 0.3, group: 1, hitbox: { kind: 'arc', range: 2, halfAngle: 0.5 } },
          { start: 0.3, end: 0.5, group: 1, hitbox: { kind: 'circle', offset: 1.6, radius: 3 }, damageScale: 0.6 },
        ],
        activeStart: 0.2,
        activeEnd: 0.5,
      }),
    );
    const sc = scene([
      { id: 1, x: 0, z: 1.4 }, // 直撃（扇の中。衝撃波の円の中でもある）
      { id: 2, x: 2.2, z: 1.4 }, // 横（扇の外、衝撃波の中）
      { id: 3, x: 0, z: 8 }, // 遠い（どちらも外）
    ]);
    start(sc, 'quake');
    sc.run(40);
    expect(sc.hits.filter((h) => h.id === 1).length).toBe(1);
    expect(sc.hits.filter((h) => h.id === 2).length).toBe(1);
    expect(sc.hits.filter((h) => h.id === 3).length).toBe(0);
    // 直撃は等倍、衝撃波だけ当たった敵は 0.6 倍
    expect(sc.hits.find((h) => h.id === 1)!.damage).toBe(10);
    expect(sc.hits.find((h) => h.id === 2)!.damage).toBe(6);
  });

  it('2 つ目以降の窓の組が開くたびに swingSerial が増える（最初の窓と、同じ組の窓では増えない。Game が振りの音を鳴らす）', () => {
    register(
      def({
        id: 'swings',
        windows: [
          { start: 0.2, end: 0.3, group: 0 },
          { start: 0.3, end: 0.4, group: 0 },
          { start: 0.5, end: 0.6, group: 1 },
          { start: 0.8, end: 0.9, group: 2 },
        ],
        activeStart: 0.2,
        activeEnd: 0.9,
      }),
    );
    const sc = scene([]);
    start(sc, 'swings');
    const s0 = sc.player.swingSerial;
    sc.run(80);
    expect(sc.player.swingSerial - s0).toBe(2);
  });

  it('窓のある攻撃では、窓と窓のあいだは attackActive が false', () => {
    register(def({ id: 'gap', windows: [{ start: 0.2, end: 0.3 }, { start: 0.6, end: 0.7 }], activeStart: 0.2, activeEnd: 0.7 }));
    const sc = scene([]);
    start(sc, 'gap');
    const seen: boolean[] = [];
    for (let i = 0; i < 50; i++) {
      sc.step();
      seen.push(sc.player.attackActive);
    }
    // 0.2〜0.3 秒 = 12〜17 フレーム、0.6〜0.7 秒 = 36〜41 フレームが当たり
    expect(seen.filter(Boolean).length).toBe(6 + 6);
    expect(seen[25]).toBe(false);
  });
});

describe('回避・ガードのキャンセル時刻（dodgeCancelAt）', () => {
  it('指定した時刻より前の回避は効かず、その時刻から効く（多段の技を途中でやめられる）', () => {
    register(def({ id: 'cancel', windows: [{ start: 0.2, end: 0.3 }, { start: 0.7, end: 0.8 }], activeStart: 0.2, activeEnd: 0.8, dodgeCancelAt: 0.35 }));
    const early = scene([]);
    start(early, 'cancel');
    early.run(10, { dodgePressed: true }); // 0.17 秒まで: まだ
    expect(early.player.state).toBe('attack');
    const late = scene([]);
    start(late, 'cancel');
    late.run(23); // 0.38 秒
    late.step({ dodgePressed: true });
    expect(late.player.state).toBe('dodge');
  });
  it('溜めのある技は、持続（activeStart）より前の時刻にも置ける（溜めの途中でやめられる）', () => {
    register(def({ id: 'chargeCancel', activeStart: 0.6, activeEnd: 0.7, cancelAt: 0.9, dodgeCancelAt: 0.25 }));
    expect(resolveAttack(def({ id: 'chargeCancel2', activeStart: 0.6, activeEnd: 0.7, dodgeCancelAt: 0.25 })).dodgeCancel).toBe(15);
    const early = scene([]);
    start(early, 'chargeCancel');
    early.run(8, { dodgePressed: true });
    expect(early.player.state).toBe('attack');
    const late = scene([]);
    start(late, 'chargeCancel');
    late.run(16);
    late.step({ dodgePressed: true });
    expect(late.player.state).toBe('dodge');
  });
  it('dodgeCancelAt が無ければ従来どおり持続の終わりから', () => {
    register(def({ id: 'plain2', activeStart: 0.2, activeEnd: 0.5, cancelAt: 0.9 }));
    const sc = scene([]);
    start(sc, 'plain2');
    sc.run(20, { dodgePressed: true }); // 0.33 秒: 持続中
    expect(sc.player.state).toBe('attack');
    sc.run(15, { dodgePressed: true });
    expect(sc.player.state).toBe('dodge');
  });
});

describe('スーパーアーマー（AttackDef.armor）', () => {
  const HIT = (damage: number): HitEvent => ({ attackerId: 9, targetId: 0, damage, knockback: 3, hitStop: 0, dirX: 0, dirZ: -1, x: 0, z: 0 });

  it('アーマーの区間は、割れない重さの攻撃を受けてもひるまず、ダメージだけ受けて攻撃を続ける', () => {
    register(def({ id: 'armored', armor: { from: 0, to: 0.6, breakDamage: 30 }, activeStart: 0.4, activeEnd: 0.9 }));
    const sc = scene([]);
    start(sc, 'armored');
    sc.run(10);
    const hp0 = sc.player.health.hp;
    sc.player.takeHit(HIT(12));
    expect(sc.player.state).toBe('attack');
    expect(sc.player.health.hp).toBe(hp0 - 12);
    expect(sc.player.armorSerial).toBe(1);
    expect(sc.player.armored).toBe(true);
    // 短い無敵がつく（続けて当たらない）
    expect(sc.player.body.invulnerable).toBe(true);
    // 攻撃は続く（攻撃の最後まで進む）
    sc.run(80);
    expect(sc.player.state).not.toBe('hit');
  });

  it('割れる重さ（breakDamage 以上）の攻撃には、ふつうにひるむ', () => {
    register(def({ id: 'armored2', armor: { from: 0, to: 0.6, breakDamage: 30 }, activeStart: 0.4, activeEnd: 0.9 }));
    const sc = scene([]);
    start(sc, 'armored2');
    sc.run(10);
    sc.player.takeHit(HIT(30));
    expect(sc.player.state).toBe('hit');
    expect(sc.player.armorSerial).toBe(0);
  });

  it('アーマーの区間の外（あと）はひるむ', () => {
    register(def({ id: 'armored3', armor: { from: 0, to: 0.3, breakDamage: 30 }, activeStart: 0.4, activeEnd: 0.9 }));
    const sc = scene([]);
    start(sc, 'armored3');
    sc.run(30); // 0.5 秒: アーマーは切れている
    expect(sc.player.armored).toBe(false);
    sc.player.takeHit(HIT(8));
    expect(sc.player.state).toBe('hit');
  });

  it('アーマーが無い攻撃は、これまでどおりひるむ', () => {
    register(def({ id: 'plain3' }));
    const sc = scene([]);
    start(sc, 'plain3');
    sc.run(10);
    sc.player.takeHit(HIT(3));
    expect(sc.player.state).toBe('hit');
  });

  it('アーマーでも、体力が尽きれば倒れる', () => {
    register(def({ id: 'armored4', armor: { from: 0, to: 0.6, breakDamage: 99 }, activeStart: 0.4, activeEnd: 0.9 }));
    const sc = scene([]);
    start(sc, 'armored4');
    sc.run(5);
    sc.player.health.hp = 5;
    sc.player.takeHit(HIT(12));
    expect(sc.player.dead).toBe(true);
  });

  it('剣技の連なりは、アーマーで耐えたあとも次の段へ続く', () => {
    register(def({ id: 'ch1', armor: { from: 0, to: 0.5, breakDamage: 30 }, activeStart: 0.2, activeEnd: 0.4, cancelAt: 0.6, segmentDuration: 0.9 }));
    register(def({ id: 'ch2', activeStart: 0.2, activeEnd: 0.4, segmentDuration: 0.9 }));
    const sc = scene([]);
    sc.player.requestSkill({ skill: 'yotsuba', steps: [{ attack: 'ch1', power: 1 }, { attack: 'ch2', power: 1 }] });
    sc.step();
    sc.run(5);
    sc.player.takeHit(HIT(10));
    expect(sc.player.state).toBe('attack');
    const seen = new Set<string>();
    for (let i = 0; i < 120; i++) {
      sc.step();
      if (sc.player.attack) seen.add(sc.player.attack.id);
    }
    expect(seen.has('ch2')).toBe(true);
  });
});
