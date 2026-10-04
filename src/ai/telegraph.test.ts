import { describe, expect, it } from 'vitest';
import { Enemy } from './enemy';
import { ENEMIES } from './data/enemies';
import { PROJECTILES } from '../combat/data/projectiles';
import { laneLength, laneOf, type LaneView } from './telegraph';

const DT = 1 / 60;
const lane = (): LaneView => ({ x: 0, z: 0, yaw: 0, length: 0, width: 0, intensity: 0, locked: false, striking: false });
const ATK = ENEMIES.boar.attack;

/** 暴れ猪を (0, 0) に置き、プレイヤーを (0, z) に置いて n フレーム進める */
function boarAt(z: number, frames: number): Enemy {
  const e = new Enemy(ENEMIES.boar, 1, 0, 0);
  e.place(0, 0, 0);
  for (let i = 0; i < frames; i++) e.step(DT, 0, z);
  return e;
}
const inWindup = (e: Enemy, frame: number): void => {
  while (e.state !== 'windup' || e.stateFrame < frame) e.step(DT, 0, 6);
};

describe('予告の帯（telegraph。ADR-025）', () => {
  it('帯の長さは踏み込み + 当たりの届く距離、幅は敵のデータ', () => {
    expect(laneLength(ATK)).toBeCloseTo(ATK.lunge + ATK.hitbox.range, 9);
    const e = new Enemy(ENEMIES.boar, 1, 0, 0);
    inWindup(e, 1);
    const l = lane();
    expect(laneOf(e, l)).toBe(true);
    expect(l.length).toBeCloseTo(7.6, 6);
    expect(l.width).toBe(2.1);
  });

  it('予告の無い敵（子鬼）は、予備動作でも出さない', () => {
    const imp = new Enemy(ENEMIES.imp, 1, 0, 0);
    imp.place(0, 0, 0);
    for (let i = 0; i < 120 && imp.state !== 'windup'; i++) imp.step(DT, 0, 1.5);
    expect(imp.state).toBe('windup');
    expect(laneOf(imp, lane())).toBe(false);
  });

  it('予備動作の前半は薄く（向きを追う）、向きが固定されたら濃くなる', () => {
    const e = new Enemy(ENEMIES.boar, 1, 0, 0);
    e.place(0, 0, 0);
    inWindup(e, 6);
    const early = lane();
    laneOf(e, early);
    expect(early.locked).toBe(false);
    inWindup(e, ATK.windupTrackFrames + 4);
    const late = lane();
    laneOf(e, late);
    expect(late.locked).toBe(true);
    expect(late.intensity).toBeGreaterThan(early.intensity + 0.2);
  });

  it('向きが固定されたあとは帯の向きが動かない（プレイヤーが回り込んでも）', () => {
    const e = new Enemy(ENEMIES.boar, 1, 0, 0);
    e.place(0, 0, 0);
    inWindup(e, ATK.windupTrackFrames + 1);
    const a = lane();
    laneOf(e, a);
    for (let i = 0; i < 10; i++) e.step(DT, 6, 0); // プレイヤーが真横へ回り込む
    const b = lane();
    laneOf(e, b);
    expect(b.yaw).toBeCloseTo(a.yaw, 9);
  });

  it('突進が始まったら、帯は出発点に固定され、強く光ってから薄れ、突進の終わりで消える', () => {
    const e = new Enemy(ENEMIES.boar, 1, 0, 0);
    e.place(0, 0, 0);
    while (e.state !== 'attack') e.step(DT, 0, 6);
    const l0 = lane();
    expect(laneOf(e, l0)).toBe(true);
    expect(l0.striking).toBe(true);
    expect(l0.intensity).toBeGreaterThan(0.9);
    const startZ = e.body.z;
    for (let i = 0; i < 20; i++) e.step(DT, 0, 6);
    const l1 = lane();
    laneOf(e, l1);
    expect(e.body.z).toBeGreaterThan(startZ + 2); // 敵は前へ進んでいる
    expect(l1.z).toBeCloseTo(l0.z, 9); // 帯の始点は出発点のまま
    expect(l1.intensity).toBeLessThan(l0.intensity);
    for (let i = 0; i < ATK.startupFrames + ATK.activeFrames; i++) e.step(DT, 0, 6);
    expect(laneOf(e, lane())).toBe(false); // 硬直のあいだは出さない
  });

  it('追跡・硬直・ひるみでは出さない', () => {
    expect(laneOf(boarAt(30, 100), lane())).toBe(false); // 遠くて追跡中
  });
});

describe('飛び道具の予告（提灯。ADR-026）', () => {
  const LANTERN = ENEMIES.lantern.attack;
  const WISP = PROJECTILES.wisp;

  it('帯の長さは弾の飛ぶ距離（速さ × 寿命）、幅は敵のデータ。弾の当たり幅（弾 + プレイヤーの半径）より広い', () => {
    expect(laneLength(LANTERN)).toBeCloseTo((WISP.speed * WISP.lifetimeFrames) / 60, 9);
    const e = new Enemy(ENEMIES.lantern, 1, 0, 6.5);
    e.place(0, 6.5, Math.PI);
    for (let i = 0; i < 300 && !(e.state === 'windup' && e.stateFrame >= 1); i++) e.step(DT, 0, 0);
    const l = lane();
    expect(laneOf(e, l)).toBe(true);
    expect(l.length).toBeCloseTo(12.6, 6);
    expect(l.width).toBe(0.8);
    // 帯の外へ体が出れば（中心が半幅 + プレイヤーの半径 0.38 より外）弾の当たり（弾の半径 + プレイヤーの半径）にも入らない
    expect(l.width / 2 + 0.38).toBeGreaterThan(WISP.radius + 0.38);
  });

  it('予備動作の後半は向きが固定され、帯が濃くなる。撃ったあとは出発点に固定されて薄れ、すぐ消える', () => {
    const e = new Enemy(ENEMIES.lantern, 1, 0, 6.5);
    e.place(0, 6.5, Math.PI);
    for (let i = 0; i < 300 && !(e.state === 'windup' && e.stateFrame >= LANTERN.windupTrackFrames + 2); i++) e.step(DT, 0, 0);
    const locked = lane();
    laneOf(e, locked);
    expect(locked.locked).toBe(true);
    expect(locked.striking).toBe(false);
    const yaw = locked.yaw;
    for (let i = 0; i < 4; i++) e.step(DT, 6, 0); // プレイヤーが横へ回り込んでも向きは動かない（撃つ向きもこのまま）
    laneOf(e, locked);
    expect(locked.yaw).toBeCloseTo(yaw, 9);
    while (e.state === 'windup') e.step(DT, 6, 0);
    expect(e.state).toBe('attack');
    const strike = lane();
    expect(laneOf(e, strike)).toBe(true);
    expect(strike.striking).toBe(true);
    expect(strike.x).toBeCloseTo(0, 9); // 提灯は撃つ前に動かない（出発点 = 立っていた位置）
    expect(strike.z).toBeCloseTo(6.5, 1);
    for (let i = 0; i < LANTERN.startupFrames + LANTERN.activeFrames + 2; i++) e.step(DT, 6, 0);
    expect(laneOf(e, lane())).toBe(false); // 撃ったあとの硬直では出さない
  });
});
