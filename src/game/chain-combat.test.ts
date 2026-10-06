import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { resolvePlayerAttack, type CombatTarget } from './combat';
import { Enemy } from '../ai/enemy';
import { ENEMIES, type EnemyDef } from '../ai/data/enemies';
import { ATTACKS } from '../combat/data/attacks';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import type { HitEvent } from '../combat/hit';
import type { LoadoutId } from '../combat/data/loadouts';

/**
 * 連携の続き 第 2 弾（ADR-047）の戦闘の結合テスト: 本物の Player で連携を最後まで出して、どの技も的に当たること（7 連・5 連の全部）と、
 * 燕返しの 2 つの当たりが別々に当たることを確かめる。的はいつも体の前（follow）に置き続ける（このテストの場には体の衝突が無いので、駆け抜けても前に居続ける）。
 * カメラ yaw = π のとき、スティックの上は +Z。
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const DUMMY: EnemyDef = { ...ENEMIES.imp, hp: 999999, knockbackScale: 0 };
const FORWARD = { moveX: 0, moveY: 1 };

interface Scene {
  player: Player;
  /** 技の id → その技のあいだに的へ出た当たり */
  hitsBy: Map<string, HitEvent[]>;
  step(over?: Partial<InputIntent>): void;
}

function scene(loadout: LoadoutId, gap: number): Scene {
  const player = new Player();
  player.equip(loadout);
  const enemy = new Enemy(DUMMY, 1, 0, gap);
  enemy.place(0, gap, Math.PI);
  const hitsBy = new Map<string, HitEvent[]>();
  return {
    player,
    hitsBy,
    step(over = {}) {
      player.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
      enemy.place(0, player.body.z + gap, Math.PI);
      enemy.step(DT, player.body.x, player.body.z, false);
      resolvePlayerAttack(player, [enemy] as CombatTarget[], (ev) => {
        const id = player.attack?.id ?? '?';
        hitsBy.set(id, [...(hitsBy.get(id) ?? []), ev]);
      });
    },
  };
}

/** 1 撃目を出して（スティックなし）、ids の順に、受付が開いたら stick を倒して押して続ける。全部の技を出し切って、最後の技が終わるまで進める */
function drive(sc: Scene, ids: readonly string[], stick: Partial<InputIntent>): string[] {
  const seen: string[] = [];
  sc.step({ attackPressed: true });
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    expect(sc.player.attack?.id, `${i + 1} 連目`).toBe(id);
    seen.push(id);
    if (i === ids.length - 1) break;
    while (sc.player.attack?.id === id && sc.player.stateFrame < sc.player.attackFrames!.cancelFrame) sc.step();
    sc.step({ attackPressed: true, ...stick });
    sc.step(stick);
  }
  for (let i = 0; i < 160 && sc.player.state === 'attack'; i++) sc.step();
  return seen;
}

describe('連携の続き 第 2 弾の戦闘（ADR-047）', () => {
  it('片手剣 7 連は、どの技も体の前の的に当たる。燕返しは 2 つの当たりが別々に当たり、2 つ目のほうが強い', () => {
    const sc = scene('sword', 1.3);
    const route = ['combo1', 'combo2', 'combo3', 'comboUpper', 'comboSlam', 'slamRip', 'swallow'];
    expect(drive(sc, route, FORWARD)).toEqual(route);
    for (const id of route) expect(sc.hitsBy.get(id)?.length ?? 0, `${id} が当たる`).toBeGreaterThanOrEqual(1);
    const sw = sc.hitsBy.get('swallow')!;
    expect(sw).toHaveLength(2);
    expect(sw[1]!.damage).toBeGreaterThan(sw[0]!.damage);
    expect(sw[0]!.damage).toBe(Math.round(ATTACKS.swallow!.damage * 0.9));
    expect(sw[1]!.damage).toBe(Math.round(ATTACKS.swallow!.damage * 1.6));
    // 7 連の合計の威力（連携の 3 段目以降の倍率は 1.0 のまま）
    const total = route.reduce((s, id) => s + (sc.hitsBy.get(id) ?? []).reduce((a, h) => a + h.damage, 0), 0);
    expect(total).toBeGreaterThan(110);
  });

  it('大剣 5 連は、どの技も体の前の的に当たる（跳ね上げ・大叩き割りも）', () => {
    const sc = scene('greatsword', 1.6);
    const route = ['gs1', 'gs2', 'gsDrop', 'gsBounce', 'gsCrush'];
    expect(drive(sc, route, FORWARD)).toEqual(route);
    for (const id of route) expect(sc.hitsBy.get(id)?.length ?? 0, `${id} が当たる`).toBeGreaterThanOrEqual(1);
    expect(sc.hitsBy.get('gsCrush')![0]!.damage).toBe(ATTACKS.gsCrush!.damage);
  });
});
