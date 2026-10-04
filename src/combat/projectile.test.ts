import { describe, expect, it } from 'vitest';
import { MAX_PROJECTILES, ProjectileSystem, end, reflect, segmentHitsCircle } from './projectile';
import { PROJECTILES } from './data/projectiles';

const DT = 1 / 60;
const WISP = PROJECTILES.wisp;
const ARENA = 14;

describe('飛び道具の sim（ADR-026）', () => {
  it('まっすぐ一定の速さで飛ぶ（毎フレーム speed / 60 m）', () => {
    const sys = new ProjectileSystem();
    const p = sys.spawn(WISP, 7, 0, 5, 0, -1);
    for (let i = 0; i < 30; i++) sys.step(DT, ARENA);
    expect(p.alive).toBe(true);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(5 - (WISP.speed * 30) / 60, 9);
    expect(p.prevZ - p.z).toBeCloseTo(WISP.speed / 60, 9);
    expect(p.age).toBe(30);
  });

  it('寿命が尽きると消える（理由 expire）', () => {
    const sys = new ProjectileSystem();
    const ends: string[] = [];
    // 縁に当たらない向き（アリーナの中心から外へ出ない短い距離）で、寿命だけ数える
    const p = sys.spawn({ ...WISP, speed: 0.01 }, 1, 0, 0, 0, 1);
    for (let i = 0; i < WISP.lifetimeFrames - 1; i++) sys.step(DT, ARENA, (_p, r) => ends.push(r));
    expect(p.alive).toBe(true);
    sys.step(DT, ARENA, (_p, r) => ends.push(r));
    expect(p.alive).toBe(false);
    expect(ends).toEqual(['expire']);
  });

  it('アリーナの縁の外へ出ると消える（理由 wall）', () => {
    const sys = new ProjectileSystem();
    const ends: string[] = [];
    const p = sys.spawn(WISP, 1, 0, 13, 0, 1);
    for (let i = 0; i < 20 && p.alive; i++) sys.step(DT, ARENA, (_p, r) => ends.push(r));
    expect(p.alive).toBe(false);
    expect(ends).toEqual(['wall']);
    expect(Math.hypot(p.x, p.z)).toBeGreaterThan(ARENA);
  });

  it('消した弾は動かない。プールが埋まったら一番古い弾を消して使う', () => {
    const sys = new ProjectileSystem(3);
    const a = sys.spawn(WISP, 1, 0, 0, 0, 1);
    sys.step(DT, ARENA);
    sys.step(DT, ARENA);
    const b = sys.spawn(WISP, 1, 1, 0, 0, 1);
    sys.step(DT, ARENA);
    const c = sys.spawn(WISP, 1, 2, 0, 0, 1);
    expect(sys.aliveCount).toBe(3);
    const d = sys.spawn(WISP, 1, 3, 0, 0, 1); // 満杯: 一番古い a を再利用
    expect(d).toBe(a);
    expect(sys.aliveCount).toBe(3);
    end(b, 'cut');
    expect(b.alive).toBe(false);
    expect(b.end).toBe('cut');
    const z = b.z;
    sys.step(DT, ARENA);
    expect(b.z).toBe(z);
    void c;
  });

  it('end は 1 度だけ通知する（すでに消えた弾には何もしない）', () => {
    const sys = new ProjectileSystem();
    const p = sys.spawn(WISP, 1, 0, 0, 0, 1);
    let n = 0;
    end(p, 'hit', () => n++);
    end(p, 'guard', () => n++);
    expect(n).toBe(1);
    expect(p.end).toBe('hit');
  });

  it('clear で全部消える', () => {
    const sys = new ProjectileSystem();
    for (let i = 0; i < 5; i++) sys.spawn(WISP, 1, i, 0, 0, 1);
    expect(sys.aliveCount).toBe(5);
    sys.clear();
    expect(sys.aliveCount).toBe(0);
  });

  it('弾き返し: player の陣営になり、向き・速さ・ダメージ・寿命が反撃用に替わる', () => {
    const sys = new ProjectileSystem();
    const p = sys.spawn(WISP, 1, 0, 3, 0, -1);
    for (let i = 0; i < 10; i++) sys.step(DT, ARENA);
    const age = p.age;
    expect(age).toBe(10);
    reflect(p, 0, 1);
    expect(p.team).toBe('player');
    expect(p.dirZ).toBe(1);
    expect(p.speed).toBeCloseTo(WISP.speed * WISP.reflect.speedScale, 9);
    expect(p.damage).toBe(WISP.reflect.damage);
    expect(p.knockback).toBe(WISP.reflect.knockback);
    expect(p.hitStop).toBe(WISP.reflect.hitStop);
    expect(p.age).toBe(0);
    expect(p.lifetime).toBe(WISP.reflect.lifetimeFrames);
    expect(p.reflectSerial).toBe(1);
    // 補間が逆戻りしない（前の位置が今の位置）
    expect(p.prevX).toBe(p.x);
    expect(p.prevZ).toBe(p.z);
    const z = p.z;
    sys.step(DT, ARENA);
    expect(p.z - z).toBeCloseTo((WISP.speed * WISP.reflect.speedScale) / 60, 9);
  });

  it('プールの大きさ MAX_PROJECTILES が確保される', () => {
    expect(new ProjectileSystem().pool).toHaveLength(MAX_PROJECTILES);
  });
});

describe('線分と円の判定', () => {
  const c = { x: 0, z: 0, r: 0.4 };
  it('線分が円を横切れば当たる。速くてもすり抜けない（始点・終点が円の外でも）', () => {
    expect(segmentHitsCircle(0, 2, 0, -2, c, 0.3)).toBe(true);
    // 1 ステップで 4m 動いて円の反対側へ抜けた弾
    expect(segmentHitsCircle(0.1, 3, 0.1, -1, c, 0.3)).toBe(true);
  });
  it('届かなければ当たらない（半径 + margin の外）', () => {
    expect(segmentHitsCircle(1.0, 2, 1.0, -2, c, 0.3)).toBe(false);
    expect(segmentHitsCircle(0, 2, 0, 1, c, 0.3)).toBe(false); // 線分が円の手前で終わる
  });
  it('縁すれすれ: 半径 + margin ちょうどは当たる', () => {
    expect(segmentHitsCircle(0.7, 2, 0.7, -2, c, 0.3)).toBe(true);
    expect(segmentHitsCircle(0.701, 2, 0.701, -2, c, 0.3)).toBe(false);
  });
  it('命中位置（線分上で円の中心に最も近い点）を out に書く', () => {
    const out = { x: 9, z: 9 };
    expect(segmentHitsCircle(0.2, 2, 0.2, -2, c, 0.3, out)).toBe(true);
    expect(out.x).toBeCloseTo(0.2, 9);
    expect(out.z).toBeCloseTo(0, 9);
  });
  it('長さ 0 の線分（撃った瞬間）は点として調べる', () => {
    expect(segmentHitsCircle(0.5, 0, 0.5, 0, c, 0.3)).toBe(true);
    expect(segmentHitsCircle(0.8, 0, 0.8, 0, c, 0.3)).toBe(false);
  });
});
