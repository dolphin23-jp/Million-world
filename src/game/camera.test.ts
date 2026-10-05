import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CAMERA, ThirdPersonCamera } from './camera';
import { World, type Obstacle } from '../world/world';

const worldOf = (...obstacles: Obstacle[]): World => new World({ radius: 14, obstacles });
const foot = new THREE.Vector3();
const distToFocus = (cam: ThirdPersonCamera, fx: number, fz: number): number => Math.hypot(cam.camera.position.x - fx, cam.camera.position.z - fz);

describe('ThirdPersonCamera: 障害物との衝突', () => {
  // カメラの向き yaw = π のとき、カメラはプレイヤーの −Z 側（cos π = −1）に付く
  const pillarBehind = (): World => worldOf({ kind: 'circle', x: 0, z: -2.5, r: 0.55, top: 4.5 });

  it('背後の柱の手前までカメラが寄る（柱の中に入らない）。world なしなら従来どおりの距離', () => {
    const free = new ThirdPersonCamera(1);
    free.update(foot.set(0, 0, 0), 1 / 60);
    const full = distToFocus(free, 0, 0);
    expect(full).toBeGreaterThan(4);
    const cam = new ThirdPersonCamera(1);
    cam.update(foot.set(0, 0, 0), 1 / 60, pillarBehind());
    const d = distToFocus(cam, 0, 0);
    expect(d).toBeLessThan(2.5 - 0.55); // 柱の面（水平 1.95）より手前
    expect(d).toBeGreaterThan(0.5);
  });

  it('遮りが外れると、距離はなめらかに元へ戻る（寄せるのは即座）。最小の距離より近づかない', () => {
    const cam = new ThirdPersonCamera(1);
    const w = pillarBehind();
    cam.update(foot.set(0, 0, 0), 1 / 60, w);
    const near = distToFocus(cam, 0, 0);
    // 柱の無い世界へ: 1 フレームでは戻りきらず、時間がたてば元の距離へ戻る
    const open = worldOf();
    cam.update(foot.set(0, 0, 0), 1 / 60, open);
    const step = distToFocus(cam, 0, 0);
    expect(step).toBeGreaterThan(near);
    expect(step).toBeLessThan(near + 0.5);
    for (let i = 0; i < 240; i++) cam.update(foot.set(0, 0, 0), 1 / 60, open);
    expect(distToFocus(cam, 0, 0)).toBeGreaterThan(4);
    // とても近い柱でも、最小の距離（collisionMinDistance）より中へは入らない
    const tight = new ThirdPersonCamera(1);
    tight.update(foot.set(0, 0, 0), 1 / 60, worldOf({ kind: 'circle', x: 0, z: -1.2, r: 0.55, top: 4.5 }));
    const dist3d = tight.camera.position.distanceTo(new THREE.Vector3(0, CAMERA.lookHeight, 0));
    expect(dist3d).toBeGreaterThanOrEqual(CAMERA.collisionMinDistance - 0.05);
  });

  it('低い障害物（岩）の上は見通せる（カメラは寄らない）。固定（pin）中は寄せない', () => {
    const cam = new ThirdPersonCamera(1);
    cam.update(foot.set(0, 0, 0), 1 / 60, worldOf({ kind: 'circle', x: 0, z: -2.5, r: 0.9, top: 0.85 }));
    expect(distToFocus(cam, 0, 0)).toBeGreaterThan(4);
    const pinned = new ThirdPersonCamera(1);
    pinned.pin(0, 1, 0);
    pinned.update(foot.set(5, 0, 5), 1 / 60, pillarBehind());
    expect(distToFocus(pinned, 0, 0)).toBeGreaterThan(4);
  });
});
