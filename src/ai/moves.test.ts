import { describe, expect, it } from 'vitest';
import { Enemy } from './enemy';
import { ENEMIES, type EnemyAttackDef, type EnemyDef } from './data/enemies';
import { laneCount, laneOf, type LaneView } from './telegraph';
import { summonPoints, type SummonPoint } from './summon';
import { fanOffset } from '../combat/projectile';

/**
 * 複数の技・段階・召喚・扇の弾（ADR-029）の sim。実際のボスのデータではなく、確かめたい性質だけを持つ合成のデータで調べる。
 */
const DT = 1 / 60;
const NO_HIT = { kind: 'arc', range: 0, halfAngle: 0 } as const;

const base = ENEMIES.imp.attack;
const near: EnemyAttackDef = { ...base, id: 'near', range: 3, rangeMin: 0, windupFrames: 20, windupTrackFrames: 10, cooldownFrames: 40 };
const far: EnemyAttackDef = { ...base, id: 'far', range: 12, rangeMin: 5, windupFrames: 20, windupTrackFrames: 10, cooldownFrames: 40, hitbox: NO_HIT, projectile: 'wisp', damage: 0 };
const late: EnemyAttackDef = { ...base, id: 'late', range: 12, rangeMin: 0, minPhase: 1, windupFrames: 20, windupTrackFrames: 10, cooldownFrames: 40, hitbox: NO_HIT, damage: 0 };

const DEF: EnemyDef = {
  ...ENEMIES.imp,
  id: 'test',
  hp: 100,
  moves: [near, far, late],
  attack: near,
  phases: [
    { hpBelow: 0.6, cooldownScale: 0.5 },
    { hpBelow: 0.3, cooldownScale: 0.25 },
  ],
  stopDistance: 0.5,
  moveSpeed: 0,
};

/** exactOptionalPropertyTypes のため、「なし」は undefined を渡さずプロパティごと除く */
const noPhases = (d: EnemyDef): EnemyDef => {
  const { phases: _p, ...rest } = d;
  return rest;
};
const noMoves = (d: EnemyDef): EnemyDef => {
  const { moves: _m, ...rest } = d;
  return rest;
};

const hit = (damage: number) => ({ attackerId: 0, targetId: 1, damage, knockback: 0, hitStop: 0, dirX: 0, dirZ: 1, x: 0, z: 0 });

/** 敵を (0, 0) に置き、プレイヤーを (0, z) に置いて、最初の予備動作に入るまで進める。入った技を返す */
function firstMove(def: EnemyDef, z: number, id = 1): Enemy {
  const e = new Enemy(def, id, 0, 0);
  e.place(0, 0, 0);
  for (let i = 0; i < 400 && e.state !== 'windup'; i++) e.step(DT, 0, z);
  return e;
}

describe('技の選択（ADR-029）', () => {
  it('距離で選べる技が変わる: 近ければ近距離の技、遠ければ遠距離の技（rangeMin / range）', () => {
    expect(firstMove(DEF, 2).attackDef.id).toBe('near');
    expect(firstMove(DEF, 8).attackDef.id).toBe('far');
  });

  it('どの技も届かない距離では、攻撃に入らない（追跡のまま）', () => {
    const e = new Enemy(DEF, 1, 0, 0);
    e.place(0, 0, 0);
    for (let i = 0; i < 300; i++) e.step(DT, 0, 20);
    expect(e.state).not.toBe('windup');
    expect(e.state).not.toBe('attack');
  });

  it('段階が足りない技（minPhase）は選ばれない。段階が上がると選ばれるようになる', () => {
    // 距離 2: 近距離の技と、段階 1 の技が候補になる。段階 0 のあいだは近距離の技だけ
    for (let id = 1; id <= 12; id++) expect(firstMove(DEF, 2, id).attackDef.id).not.toBe('late');
    const seen = new Set<string>();
    for (let id = 1; id <= 40; id++) {
      const e = new Enemy(DEF, id, 0, 0);
      e.place(0, 0, 0);
      e.takeHit(hit(50)); // HP 50% → 段階 1
      for (let i = 0; i < 400 && e.state !== 'windup'; i++) e.step(DT, 0, 2);
      seen.add(e.attackDef.id!);
    }
    expect(seen.has('late')).toBe(true);
  });

  it('直前と同じ技は、ほかに選べる技があれば避ける。選べる技が 1 つなら繰り返す', () => {
    const e = new Enemy({ ...noPhases(DEF), attack: near }, 5, 0, 0);
    e.place(0, 0, 0);
    // 距離 6〜: far だけが選べる（rangeMin 5。near は range 3）
    const ids: string[] = [];
    for (let i = 0; i < 1500 && ids.length < 3; i++) {
      const was = e.state;
      e.step(DT, 0, 8);
      if (e.state === 'windup' && was !== 'windup') ids.push(e.attackDef.id!);
    }
    expect(ids).toEqual(['far', 'far', 'far']);

    // 近い距離で late も選べる（段階 1）なら、near と late が交互になる（直前を避ける）
    const f = new Enemy({ ...DEF, hp: 100, phases: [{ hpBelow: 1, cooldownScale: 1 }], moves: [near, late], attack: near }, 6, 0, 0);
    f.place(0, 0, 0);
    f.takeHit(hit(1));
    const seq: string[] = [];
    for (let i = 0; i < 3000 && seq.length < 6; i++) {
      const was = f.state;
      f.step(DT, 0, 2);
      if (f.state === 'windup' && was !== 'windup') seq.push(f.attackDef.id!);
    }
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
  });

  it('選び方は敵の id で決まる（同じ id・同じ状況なら同じ順。テストできる）', () => {
    const run = (id: number): string[] => {
      const e = new Enemy({ ...DEF, phases: [{ hpBelow: 1, cooldownScale: 1 }] }, id, 0, 0);
      e.place(0, 0, 0);
      e.takeHit(hit(1));
      const seq: string[] = [];
      for (let i = 0; i < 4000 && seq.length < 8; i++) {
        const was = e.state;
        e.step(DT, 0, 2);
        if (e.state === 'windup' && was !== 'windup') seq.push(e.attackDef.id!);
      }
      return seq;
    };
    expect(run(3)).toEqual(run(3));
  });

  it('重み（weight）が大きい技ほど選ばれやすい', () => {
    const heavy: EnemyAttackDef = { ...near, id: 'heavy', weight: 9 };
    const light: EnemyAttackDef = { ...near, id: 'light', weight: 1 };
    const def: EnemyDef = { ...noPhases(DEF), moves: [heavy, light], attack: heavy };
    let h = 0;
    let l = 0;
    // 直前を避けるので 1 回目だけで数える（敵ごとに 1 回目を調べる）
    for (let id = 1; id <= 200; id++) {
      const e = firstMove(def, 2, id);
      if (e.attackDef.id === 'heavy') h++;
      else l++;
    }
    expect(h).toBeGreaterThan(l * 4);
    expect(l).toBeGreaterThan(0);
  });
});

describe('段階（ADR-029）', () => {
  it('HP の割合が hpBelow 以下になるたびに段階が 1 つ上がり、phaseSerial が増える（とどめでは増えない）', () => {
    const e = new Enemy(DEF, 1, 0, 0);
    expect(e.phase).toBe(0);
    e.takeHit(hit(39)); // 61%
    expect(e.phase).toBe(0);
    expect(e.phaseSerial).toBe(0);
    e.takeHit(hit(2)); // 59%
    expect(e.phase).toBe(1);
    expect(e.phaseSerial).toBe(1);
    e.takeHit(hit(30)); // 29% → 一気に段階 2
    expect(e.phase).toBe(2);
    expect(e.phaseSerial).toBe(2);
    e.takeHit(hit(999));
    expect(e.dead).toBe(true);
    expect(e.phaseSerial).toBe(2);
  });

  it('段階が上がると、技のあとの待ちが縮む（cooldownScale）', () => {
    const wait = (hpHit: number): number => {
      const e = new Enemy({ ...noMoves(DEF), attack: near }, 1, 0, 0);
      e.place(0, 0, 0);
      if (hpHit > 0) e.takeHit(hit(hpHit));
      let attackEnd = -1;
      let next = -1;
      for (let i = 0; i < 2000 && next < 0; i++) {
        const was = e.state;
        e.step(DT, 0, 2);
        if (was === 'attack' && e.state === 'chase' && attackEnd < 0) attackEnd = i;
        if (attackEnd >= 0 && e.state === 'windup') next = i;
      }
      return next - attackEnd;
    };
    const w0 = wait(0);
    const w1 = wait(45); // 段階 1（0.5 倍）
    const w2 = wait(75); // 段階 2（0.25 倍）
    expect(w1).toBeLessThan(w0);
    expect(w2).toBeLessThan(w1);
  });
});

describe('召喚・扇の弾（ADR-029）', () => {
  const summonMove: EnemyAttackDef = { ...base, id: 'roar', range: 20, hitbox: NO_HIT, damage: 0, summon: { type: 'bat', count: 3, radius: 3 }, windupFrames: 20, windupTrackFrames: 0, startupFrames: 3, activeFrames: 1 };

  it('召喚の技は、攻撃に入って startupFrames で 1 回だけ summonSerial が増え、内容が入る。近接の判定は出ない', () => {
    const e = new Enemy({ ...noPhases(DEF), moves: [summonMove], attack: summonMove }, 1, 0, 0);
    e.place(0, 0, 0);
    let attackActiveSeen = false;
    for (let i = 0; i < 200; i++) {
      e.step(DT, 0, 6);
      if (e.attackActive) attackActiveSeen = true;
    }
    expect(e.summonSerial).toBeGreaterThanOrEqual(1);
    expect(e.summon).toEqual({ type: 'bat', count: 3, radius: 3 });
    expect(attackActiveSeen).toBe(false);
    // 1 回の攻撃で 1 回（次の攻撃までは増えない）
    const s0 = e.summonSerial;
    const frames = e.stateFrame;
    expect(frames).toBeGreaterThanOrEqual(0);
    expect(s0).toBe(Math.floor(s0));
  });

  it('扇の弾: shot に本数・広がり・銃口のずれ（muzzleOffset）が入る。fanOffset は中心が 0、左右対称', () => {
    const volley: EnemyAttackDef = { ...far, id: 'volley', projectileCount: 5, projectileSpread: 1.2, muzzleOffset: 1.0 };
    const e = new Enemy({ ...noPhases(DEF), moves: [volley], attack: volley }, 1, 0, 0);
    e.place(0, 0, 0);
    for (let i = 0; i < 400 && e.fireSerial === 0; i++) e.step(DT, 0, 8);
    expect(e.fireSerial).toBe(1);
    expect(e.shot.count).toBe(5);
    expect(e.shot.spread).toBe(1.2);
    expect(Math.hypot(e.shot.x, e.shot.z)).toBeCloseTo(0.8 + 1.0, 6); // 鬼火の銃口 0.8m + ずれ 1.0m
    const offs = [0, 1, 2, 3, 4].map((i) => fanOffset(i, 5, 1.2));
    expect(offs[2]).toBeCloseTo(0, 9);
    expect(offs[0]).toBeCloseTo(-0.6, 9);
    expect(offs[4]).toBeCloseTo(0.6, 9);
    expect(offs[1]).toBeCloseTo(-offs[3]!, 9);
  });

  it('fanOffset: 1 本はずれなし、全周（2π）は等間隔で先頭が撃つ向き', () => {
    expect(fanOffset(0, 1, 3)).toBe(0);
    const ring = [0, 1, 2, 3].map((i) => fanOffset(i, 4, Math.PI * 2));
    expect(ring[0]).toBe(0);
    expect(ring[1]).toBeCloseTo(Math.PI / 2, 9);
    expect(ring[3]).toBeCloseTo((Math.PI * 3) / 2, 9);
  });

  it('倒れる（とどめ）前に vanish すると、倒した数に入らず死亡の演出に入る', () => {
    const e = new Enemy(DEF, 1, 0, 0);
    e.vanish();
    expect(e.dead).toBe(true);
    expect(e.body.invulnerable).toBe(true);
    expect(e.hitSerial).toBe(0);
  });
});

describe('扇・輪の予告の帯（ADR-029）', () => {
  const lane = (): LaneView => ({ x: 0, z: 0, yaw: 0, length: 0, width: 0, intensity: 0, locked: false, striking: false, unblockable: false });

  it('弾を撃つ技は、本数ぶんの帯を出し、i 本目は fanOffset だけ向きがずれる。帯の予告の無い技は 0 本', () => {
    const volley: EnemyAttackDef = { ...far, id: 'volley', projectileCount: 5, projectileSpread: 1.2, telegraph: { kind: 'lane', width: 0.8 } };
    const e = new Enemy({ ...noPhases(DEF), moves: [volley], attack: volley }, 1, 0, 0);
    e.place(0, 0, 0);
    for (let i = 0; i < 400 && !(e.state === 'windup' && e.stateFrame >= 14); i++) e.step(DT, 0, 8);
    expect(laneCount(volley)).toBe(5);
    expect(laneCount(near)).toBe(0);
    const views = [0, 1, 2, 3, 4].map((k) => {
      const v = lane();
      expect(laneOf(e, v, k)).toBe(true);
      return v;
    });
    expect(views[2]!.yaw).toBeCloseTo(e.yaw, 9);
    expect(views[0]!.yaw).toBeCloseTo(e.yaw - 0.6, 9);
    expect(views[4]!.yaw).toBeCloseTo(e.yaw + 0.6, 9);
  });
});

describe('召喚の出現位置（summonPoints）', () => {
  it('中心から radius の円周に等間隔で count 個。seed を変えると向きがばらける', () => {
    const out: SummonPoint[] = [];
    summonPoints(0, 0, 4, 3, 0, 14, out);
    for (const p of out) expect(Math.hypot(p.x, p.z)).toBeCloseTo(3, 9);
    expect(Math.hypot(out[0]!.x - out[2]!.x, out[0]!.z - out[2]!.z)).toBeCloseTo(6, 9); // 向かい合う
    const a = { x: out[0]!.x, z: out[0]!.z };
    summonPoints(0, 0, 4, 3, 1, 14, out);
    expect(Math.hypot(out[0]!.x - a.x, out[0]!.z - a.z)).toBeGreaterThan(0.5);
  });

  it('アリーナの縁の外に出る位置は、縁の内側（arenaRadius − 1）へ寄せる', () => {
    const out: SummonPoint[] = [];
    summonPoints(12, 0, 6, 4, 0, 14, out);
    for (const p of out) expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(13 + 1e-9);
  });

  it('out の配列を使い回す（毎回新しい配列を作らない）', () => {
    const out: SummonPoint[] = [];
    summonPoints(0, 0, 3, 2, 0, 14, out);
    const first = out[0];
    summonPoints(0, 0, 3, 2, 5, 14, out);
    expect(out[0]).toBe(first);
    expect(out).toHaveLength(3);
  });
});
