import * as THREE from 'three';
import { clamp, damp } from '../core/math';

/**
 * 三人称カメラ（docs/04-controls.md）。
 * 回転入力は sim ステップで即時反映、位置の追従は描画フレームで減衰させる。
 * ロックオン連動は M3 で追加する。
 */

export const CAMERA = {
  distance: 5.4,
  /** 注視点の高さ（キャラの胸あたり） */
  lookHeight: 1.1,
  pitchMin: -0.15,
  pitchMax: 1.05,
  defaultPitch: 0.38,
  /** 追従の速さ（大きいほど速い） */
  followLambda: 14,
  fov: 50,
} as const;

const _target = new THREE.Vector3();
const _offset = new THREE.Vector3();

export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = Math.PI; // キャラの背後（キャラ初期向き +Z を見下ろす位置）
  pitch: number = CAMERA.defaultPitch;
  distance: number = CAMERA.distance;
  private readonly follow = new THREE.Vector3();
  private initialized = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, 0.1, 500);
  }

  /** sim ステップ: 入力の回転差分を適用 */
  rotate(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, CAMERA.pitchMin, CAMERA.pitchMax);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** 描画フレーム: 追従対象（足元のワールド座標）に向けて更新 */
  update(targetFoot: THREE.Vector3, frameDt: number): void {
    _target.set(targetFoot.x, targetFoot.y + CAMERA.lookHeight, targetFoot.z);
    if (!this.initialized) {
      this.follow.copy(_target);
      this.initialized = true;
    } else {
      this.follow.x = damp(this.follow.x, _target.x, CAMERA.followLambda, frameDt);
      this.follow.y = damp(this.follow.y, _target.y, CAMERA.followLambda, frameDt);
      this.follow.z = damp(this.follow.z, _target.z, CAMERA.followLambda, frameDt);
    }
    const cp = Math.cos(this.pitch);
    _offset.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.distance);
    this.camera.position.copy(this.follow).add(_offset);
    // 床より下に潜らない
    if (this.camera.position.y < 0.35) this.camera.position.y = 0.35;
    this.camera.lookAt(this.follow);
  }
}
