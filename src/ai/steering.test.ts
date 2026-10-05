import { describe, expect, it } from 'vitest';
import { freeDistance, steerYaw, createSteerState } from './steering';
import { Enemy } from './enemy';
import { ENEMIES, type EnemyDef } from './data/enemies';
import { STEERING } from './data/steering';
import { wrapAngle } from '../core/math';
import { ARENA_WORLD } from '../world/data/arena-props';
import { FLYING_Y, World, type Obstacle } from '../world/world';

const circle = (x: number, z: number, r: number, top: number): Obstacle => ({ kind: 'circle', x, z, r, top });
const box = (x: number, z: number, hx: number, hz: number, top: number, yaw = 0): Obstacle => ({ kind: 'box', x, z, hx, hz, yaw, top });
const worldOf = (...obstacles: Obstacle[]): World => new World({ radius: 14, obstacles });
const R = 0.5;

describe('freeDistance: 体の幅で、先まで障害物に触れずに進めるか', () => {
  it('障害物が無ければ look まで進める。柱が正面にあれば、柱の手前（柱の半径 + 体の半径）まで', () => {
    expect(freeDistance(worldOf(), 0, 0, 0, 1, R, 0, 3)).toBe(3);
    const w = worldOf(circle(0, 3, 0.55, 4));
    expect(freeDistance(w, 0, 0, 0, 1, R, 0, 5)).toBeCloseTo(3 - 0.55 - R + STEERING.slack, 2);
  });

  it('柱の脇を通る線は、体の幅だけ離れていれば進める（離れていなければ塞がれる）', () => {
    const w = worldOf(circle(0, 3, 0.55, 4));
    expect(freeDistance(w, 1.2, 0, 0, 1, R, 0, 5)).toBe(5); // 中心線が 1.2 離れる: 0.55 + 0.5 = 1.05 < 1.2
    expect(freeDistance(w, 0.8, 0, 0, 1, R, 0, 5)).toBeLessThan(5);
  });

  it('足の高さ: 低い岩（0.85）は歩く敵を止め、飛ぶ敵（FLYING_Y）は上を通る。段差（0.3）は止めない', () => {
    const rock = worldOf(circle(0, 3, 0.9, 0.85));
    expect(freeDistance(rock, 0, 0, 0, 1, R, 0, 5)).toBeLessThan(2);
    expect(freeDistance(rock, 0, 0, 0, 1, R, FLYING_Y, 5)).toBe(5);
    expect(freeDistance(worldOf(circle(0, 3, 0.9, 0.3)), 0, 0, 0, 1, R, 0, 5)).toBe(5);
  });

  it('障害物に接して押し出された体（太らせた面の上）から、外向き・沿う向きには進める。めり込む向きは進めない', () => {
    const w = worldOf(circle(0, 3, 1, 4));
    // 体の中心が、柱の中心から 1 + R の距離（接している）
    const z = 3 - 1 - R;
    expect(freeDistance(w, 0, z, 0, 1, R, 0, 2)).toBeLessThan(0.3); // 向かう
    expect(freeDistance(w, 0, z, 0, -1, R, 0, 2)).toBe(2); // 離れる
    expect(freeDistance(w, 0, z, 1, 0, R, 0, 2)).toBeGreaterThan(1); // 沿う（横）
  });

  it('箱の角に接した体からも、離れる向きには進める（四角に太らせた角の内側でも詰まらない）', () => {
    const w = worldOf(box(0, 5, 1, 1, 2));
    // 角 (1, 4) の斜め外（角から R の距離）
    const k = R / Math.SQRT2;
    const x = 1 + k;
    const z = 4 - k;
    expect(freeDistance(w, x, z, Math.SQRT1_2, -Math.SQRT1_2, R, 0, 2)).toBe(2); // 外へ
    // 面に接した体（面から R の距離）は、面に沿って角まで横へ進める
    expect(freeDistance(w, 0, 4 - R, 1, 0, R, 0, 2)).toBe(2);
  });
});

describe('steerYaw: 目標へ向かう向き', () => {
  it('塞がれていなければ目標の向きそのまま。側の記憶は捨てる', () => {
    const w = worldOf(circle(5, 0, 0.55, 4));
    const st = createSteerState();
    st.side = 1;
    const yaw = steerYaw(w, 0, 0, R, 0, 0, 6, st); // +Z へ。柱は横
    expect(yaw).toBeCloseTo(0);
    expect(st.side).toBe(0);
  });

  it('柱が正面を塞いでいれば、通れる向きのうち回す角度の小さいものへ。柱に近づくほど大きく回る', () => {
    const w = worldOf(circle(0, 4, 0.55, 4));
    const st = createSteerState();
    const far = Math.abs(wrapAngle(steerYaw(w, 0, 1.6, R, 0, 0, 10, st)));
    expect(far).toBeGreaterThan(0); // 先 2.4m に柱が入ったので避け始める
    expect(far).toBeLessThanOrEqual((STEERING.offsetsDeg[STEERING.offsetsDeg.length - 1]! * Math.PI) / 180);
    st.side = 0;
    const near = Math.abs(wrapAngle(steerYaw(w, 0, 2.6, R, 0, 0, 10, st)));
    expect(near).toBeGreaterThanOrEqual(far);
  });

  it('同じ角度で左右とも通れるときは、前に選んだ側を続ける。決めていなければ prefer の側', () => {
    const w = worldOf(circle(0, 4, 0.55, 4));
    const a = createSteerState();
    const right = steerYaw(w, 0, 2.6, R, 0, 0, 10, a, -1);
    expect(Math.sign(wrapAngle(right))).toBe(-1);
    const b = createSteerState();
    const left = steerYaw(w, 0, 2.6, R, 0, 0, 10, b, 1);
    expect(Math.sign(wrapAngle(left))).toBe(1);
    // 記憶している側を、prefer が逆でも続ける
    b.side = 1;
    expect(Math.sign(wrapAngle(steerYaw(w, 0, 2.6, R, 0, 0, 10, b, -1)))).toBe(1);
  });

  it('飛ぶ敵は低い岩をまっすぐ越える。柱は避ける', () => {
    const rock = worldOf(circle(0, 4, 0.9, 0.85));
    expect(steerYaw(rock, 0, 2, 0.3, FLYING_Y, 0, 10, createSteerState())).toBeCloseTo(0);
    expect(steerYaw(rock, 0, 2, 0.3, 0, 0, 10, createSteerState())).not.toBeCloseTo(0);
    const pillar = worldOf(circle(0, 4, 0.55, 4.5));
    expect(steerYaw(pillar, 0, 2.4, 0.3, FLYING_Y, 0, 10, createSteerState())).not.toBeCloseTo(0);
  });

  it('目標が近い（minDistance 未満）・目標までが先の距離より短ければ、そこまでを調べる', () => {
    const w = worldOf(circle(0, 4, 0.55, 4));
    expect(steerYaw(w, 0, 0, R, 0, 0, 0.2, createSteerState())).toBeCloseTo(0);
    // 目標は柱の手前 1m（先 2.4m より近い）: 柱は目標の先なので避けない
    expect(steerYaw(w, 0, 0, R, 0, 0, 2, createSteerState())).toBeCloseTo(0);
  });
});

/** 追うだけの敵（どこにいても追い始める）。EnemyDef はそのまま、気づく範囲と出現直後の待ちだけ変える */
const chaser = (type: keyof typeof ENEMIES): EnemyDef => ({ ...ENEMIES[type], aggroRange: 99, spawnIdleFrames: 0 });

/** 敵を 1 体、障害物ありの世界で目標へ向かわせる。目標のそばに着くまでのステップ数（着かなければ -1） */
function chase(type: keyof typeof ENEMIES, world: World, from: [number, number], to: [number, number], maxSteps = 60 * 25): { steps: number; enemy: Enemy; stuck: number } {
  const e = new Enemy(chaser(type), 1, from[0], from[1]);
  e.world = world;
  e.place(from[0], from[1], Math.atan2(to[0] - from[0], to[1] - from[1]));
  const y = e.def.flying ? FLYING_Y : 0;
  let stuck = 0;
  for (let i = 0; i < maxSteps; i++) {
    const px = e.body.x;
    const pz = e.body.z;
    e.step(1 / 60, to[0], to[1], true, false); // 攻撃しない（追うだけ）
    world.moveCircle(e.body, y);
    const dist = Math.hypot(to[0] - e.body.x, to[1] - e.body.z);
    if (Math.hypot(e.body.x - px, e.body.z - pz) < 0.2 * e.def.moveSpeed * (1 / 60)) stuck++;
    if (dist <= e.def.stopDistance + 0.25) return { steps: i, enemy: e, stuck };
  }
  return { steps: -1, enemy: e, stuck };
}

describe('Enemy: 障害物を回り込んで追う', () => {
  it('柱の真後ろにいるプレイヤーへ、柱を回って届く（迂回しない敵は柱にぶつかったまま届かない）', () => {
    const w = worldOf(circle(0, 5, 0.75, 3.2));
    const r = chase('imp', w, [0, 1], [0, 9]);
    expect(r.steps).toBeGreaterThan(0);
    const blind = new Enemy(chaser('imp'), 2, 0, 1);
    blind.place(0, 1, 0);
    for (let i = 0; i < 60 * 25; i++) {
      blind.step(1 / 60, 0, 9, true, false);
      w.moveCircle(blind.body, 0);
    }
    expect(Math.hypot(blind.body.x, blind.body.z - 9)).toBeGreaterThan(ENEMIES.imp.stopDistance + 1); // 真正面は止まる（従来）
  });

  it('長い低い壁（4.4m）・箱・壇の向こうのプレイヤーへ届く（壁の端を回る）', () => {
    for (const o of [box(0, 5, 2.2, 0.3, 0.9), box(0, 5, 1, 1, 1.5), box(0, 5, 1.5, 1, 2.2)]) {
      const r = chase('boar', worldOf(o), [0, 0.5], [0, 10]);
      expect(r.steps).toBeGreaterThan(0);
    }
  });

  it('飛ぶ敵（小蝙蝠）は低い壁の上をまっすぐ越える（回り込まない）。壁が柱（高い）なら避ける', () => {
    // 壁を越えるあいだは、まだプレイヤーから遠い（周回に入る stopDistance + 1.8 = 4.8m より先）
    const fly = (o: Obstacle): { maxX: number; z: number } => {
      const w = worldOf(o);
      const e = new Enemy(chaser('bat'), 1, 0, 0);
      e.world = w;
      e.place(0, 0, 0);
      let maxX = 0;
      for (let i = 0; i < 84; i++) {
        e.step(1 / 60, 0, 12, true, false);
        w.moveCircle(e.body, FLYING_Y);
        maxX = Math.max(maxX, Math.abs(e.body.x));
      }
      return { maxX, z: e.body.z };
    };
    const over = fly(box(0, 3, 2.2, 0.3, 0.9));
    expect(over.maxX).toBeLessThan(0.3);
    expect(over.z).toBeGreaterThan(4.5); // 壁（z = 3）の向こうまで進んだ
    const around = fly(circle(0, 3, 0.55, 4.5));
    expect(around.maxX).toBeGreaterThan(0.5); // 柱は避ける
    expect(around.z).toBeGreaterThan(4.5);
  });

  it('世界を渡さなければ従来どおり（まっすぐ追う）', () => {
    const w = worldOf(circle(0, 5, 0.75, 3.2));
    const e = new Enemy(chaser('imp'), 1, 0, 1);
    e.place(0, 1, 0);
    for (let i = 0; i < 60 * 6; i++) {
      e.step(1 / 60, 0, 9, true, false);
      w.moveCircle(e.body, 0);
    }
    expect(Math.abs(e.body.x)).toBeLessThan(0.3); // 柱に押し付けられたまま（横へ回らない）
  });
});

describe('Enemy: 闘技場のどこからでもプレイヤーに届く（全点の回帰）', () => {
  const arena = new World(ARENA_WORLD);
  // 闘技場の内側（障害物の外）の格子。プレイヤー・敵が立てる点だけ使う
  const points: [number, number][] = [];
  for (let a = 0; a < 360; a += 30) {
    for (const rad of [3, 6, 9]) {
      const p: [number, number] = [Math.cos((a * Math.PI) / 180) * rad, Math.sin((a * Math.PI) / 180) * rad];
      if (!arena.overlapsObstacle({ x: p[0], z: p[1], r: 1.3 }, 0)) points.push(p);
    }
  }

  it('点の数（障害物の外）が十分ある', () => {
    expect(points.length).toBeGreaterThan(20);
  });

  for (const type of ['imp', 'boar', 'lantern', 'ogre', 'boss', 'bat'] as const) {
    it(`${type}: どの点から、どの点のプレイヤーへも、25 秒以内に届く。詰まって動かない時間が長く続かない`, () => {
      let failures = 0;
      let pairs = 0;
      let worstStuck = 0;
      const failed: string[] = [];
      // 組み合わせを間引く（全組み合わせは遅い）: 始点ごとに、決まった間隔の目標
      for (let i = 0; i < points.length; i++) {
        for (let j = (i * 7) % 5; j < points.length; j += 5) {
          if (i === j) continue;
          const r = chase(type, arena, points[i]!, points[j]!);
          pairs++;
          worstStuck = Math.max(worstStuck, r.stuck);
          if (r.steps < 0) {
            failures++;
            failed.push(`${points[i]!.map((v) => v.toFixed(1)).join(',')} → ${points[j]!.map((v) => v.toFixed(1)).join(',')}`);
          }
        }
      }
      expect(pairs).toBeGreaterThan(100);
      expect(failed.slice(0, 5)).toEqual([]);
      expect(failures).toBe(0);
      expect(worstStuck).toBeLessThan(60 * 3); // 詰まった（ほぼ動いていない）フレームの合計が 3 秒を超えない
    });
  }
});
