import { describe, expect, it } from 'vitest';
import { cameraClearDistance } from './camera-collision';
import { ARENA_WORLD } from '../world/data/arena-props';
import { World, type Obstacle } from '../world/world';

const circle = (x: number, z: number, r: number, top: number): Obstacle => ({ kind: 'circle', x, z, r, top });
const box = (x: number, z: number, hx: number, hz: number, top: number): Obstacle => ({ kind: 'box', x, z, hx, hz, yaw: 0, top });
const worldOf = (...obstacles: Obstacle[]): World => new World({ radius: 14, obstacles });
const RAD = 0.3;
/** ピッチ p・向き（注視点からカメラへ。+Z 側へ引く）の単位ベクトル */
const back = (pitch: number): [number, number, number] => [0, Math.sin(pitch), Math.cos(pitch)];

describe('cameraClearDistance: カメラが障害物にめり込まない距離', () => {
  it('遮るものが無ければ maxDist そのまま', () => {
    const [dx, dy, dz] = back(0.38);
    expect(cameraClearDistance(worldOf(), 0, 1, 0, dx, dy, dz, 4.9, RAD)).toBe(4.9);
  });

  it('背後に高い柱があれば、柱の手前（柱の半径 + カメラの半径）で止まる。距離は線に沿って測る', () => {
    const w = worldOf(circle(0, 3, 0.55, 4.5));
    const [dx, dy, dz] = back(0.38);
    const d = cameraClearDistance(w, 0, 1, 0, dx, dy, dz, 4.9, RAD);
    // 水平に 3 − 0.55 − 0.3 = 2.15 進んだところ → 線に沿って 2.15 / cos(0.38)
    expect(d).toBeCloseTo(2.15 / Math.cos(0.38), 2);
  });

  it('横にある柱・遠すぎる柱は遮らない（線がカメラの半径より離れて通る）', () => {
    const [dx, dy, dz] = back(0.38);
    expect(cameraClearDistance(worldOf(circle(1.5, 2, 0.55, 4.5)), 0, 1, 0, dx, dy, dz, 4.9, RAD)).toBe(4.9);
    expect(cameraClearDistance(worldOf(circle(0, 6, 0.55, 4.5)), 0, 1, 0, dx, dy, dz, 4.9, RAD)).toBe(4.9);
  });

  it('低い障害物（岩 0.85）の上を線が通るなら遮らない。線が上面より低ければ遮る（ピッチが低いとき）', () => {
    const w = worldOf(circle(0, 3, 0.9, 0.85));
    // 注視点 1.05・ピッチ 0.38: 岩の手前の面（水平 1.8）で線の高さ ≈ 1.05 + 1.8·tan(0.38) = 1.7 > 0.85 → 通り越す
    const [dx, dy, dz] = back(0.38);
    expect(cameraClearDistance(w, 0, 1.05, 0, dx, dy, dz, 4.9, RAD)).toBe(4.9);
    // 注視点が低く・ピッチが 0 なら、岩の上面（0.85）より線（0.5）が低い → 遮る
    const [fx, fy, fz] = back(0);
    expect(cameraClearDistance(w, 0, 0.5, 0, fx, fy, fz, 4.9, RAD)).toBeLessThan(2.1);
  });

  it('高い箱（1.5）の陰: 注視点が低ければ遮り、プレイヤーが箱の上（注視点が高い）なら遮らない', () => {
    const w = worldOf(box(0, 3.5, 1, 1, 1.5));
    const [dx, dy, dz] = back(0.2);
    expect(cameraClearDistance(w, 0, 1.05, 0, dx, dy, dz, 4.9, RAD)).toBeLessThan(2.5); // 線の高さ 1.05 + 0.4 = 1.45 < 1.5
    expect(cameraClearDistance(w, 0, 2.6, 0, dx, dy, dz, 4.9, RAD)).toBe(4.9); // 箱の上（足 1.5 + 1.05）
  });

  it('線が低い岩を通り越したあとの、背後の柱は遮る（先を探し直す）', () => {
    const w = worldOf(circle(0, 2, 0.6, 0.85), circle(0, 4.2, 0.55, 4.5));
    const [dx, dy, dz] = back(0.38);
    const d = cameraClearDistance(w, 0, 1.05, 0, dx, dy, dz, 5.5, RAD);
    expect(d).toBeCloseTo((4.2 - 0.55 - RAD) / Math.cos(0.38), 1);
  });

  it('箱の角に接した体の注視点から、外へ引くときは遮られない（太らせた角の内側でも）', () => {
    const w = worldOf(box(0, 5, 1, 1, 3));
    // 角 (1, 4) の斜め外に立つ体（角から 0.38）。注視点から、角から離れる向き（+x, −z）へ引く
    const k = 0.38 / Math.SQRT2;
    const dir = [Math.SQRT1_2, 0.3, -Math.SQRT1_2];
    const len = Math.hypot(dir[0]!, dir[1]!, dir[2]!);
    const d = cameraClearDistance(w, 1 + k, 1.05, 4 - k, dir[0]! / len, dir[1]! / len, dir[2]! / len, 4, RAD);
    expect(d).toBe(4);
  });

  it('闘技場: 縁の柱に背を向けて立ってもカメラは柱の中へ入らない（全方向で、カメラの位置が障害物の外）', () => {
    const arena = new World(ARENA_WORLD);
    let inside = 0;
    for (let a = 0; a < 360; a += 15) {
      for (const rad of [4, 8, 11]) {
        const px = Math.cos((a * Math.PI) / 180) * rad;
        const pz = Math.sin((a * Math.PI) / 180) * rad;
        if (arena.overlapsObstacle({ x: px, z: pz, r: 0.38 }, 0)) continue;
        for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 6) {
          const cp = Math.cos(0.38);
          const dx = Math.sin(yaw) * cp;
          const dy = Math.sin(0.38);
          const dz = Math.cos(yaw) * cp;
          const d = cameraClearDistance(arena, px, 1.05, pz, dx, dy, dz, 4.9, RAD);
          const cx = px + dx * d;
          const cz = pz + dz * d;
          const cy = 1.05 + dy * d;
          // カメラの位置（半径 RAD の球）が、その高さで遮る障害物に重ならない
          if (arena.overlapsObstacle({ x: cx, z: cz, r: RAD - 0.02 }, cy - 0.45 - 1e-6)) inside++;
        }
      }
    }
    expect(inside).toBe(0);
  });
});
