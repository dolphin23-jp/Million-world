import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../core/math';
import { Shake } from '../core/shake';
import { LOCKON } from '../combat/data/lockon';
import { lockYaw } from '../combat/lockon';

/**
 * 三人称カメラ（docs/04-controls.md）。
 * 回転入力は sim ステップで即時反映、位置の追従は描画フレームで減衰させる。
 * ロックオン中は、sim で yaw を対象の方へ減衰補間し（stepLock）、描画で注視点を対象寄りに、距離を離れた敵が映る分だけ引く。
 * ピッチは入力のまま。ロックを解くと、その時の向きのまま通常の操作に戻る。
 */

export const CAMERA = {
  distance: 4.9,
  /** 注視点の高さ（キャラの胸あたり） */
  lookHeight: 1.05,
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
  /** 命中などの画面の揺れ。実時間で進む（ヒットストップ中も揺れる） */
  readonly shake = new Shake();
  private readonly follow = new THREE.Vector3();
  private initialized = false;
  /** ロック中の対象位置（sim で更新）と、プレイヤーとの距離。描画で注視点・距離に使う */
  private lockActive = false;
  private lockX = 0;
  private lockZ = 0;
  private lockDist = 0;
  /** 0（通常）〜 1（ロック）。切り替わりをなめらかにする（描画で更新） */
  private lockBlend = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, 0.1, 500);
  }

  /** sim ステップ: 入力の回転差分を適用 */
  rotate(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, CAMERA.pitchMin, CAMERA.pitchMax);
  }

  /**
   * sim ステップ: ロック中は yaw を対象の方へ寄せる。target が null ならロックなし（yaw は触らない）。
   * 位置はプレイヤー (px, pz) と対象 (tx, tz)。dt は固定の 1/60
   */
  stepLock(dt: number, px: number, pz: number, target: { x: number; z: number } | null): void {
    if (!target) {
      this.lockActive = false;
      return;
    }
    const dx = target.x - px;
    const dz = target.z - pz;
    this.lockActive = true;
    this.lockX = target.x;
    this.lockZ = target.z;
    this.lockDist = Math.hypot(dx, dz);
    if (this.lockDist > 0.05) this.yaw = dampAngle(this.yaw, lockYaw(dx, dz), LOCKON.camYawLambda, dt);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** 描画フレーム: 追従対象（足元のワールド座標）に向けて更新 */
  update(targetFoot: THREE.Vector3, frameDt: number): void {
    _target.set(targetFoot.x, targetFoot.y + CAMERA.lookHeight, targetFoot.z);
    // ロック: 注視点を対象寄りに。距離は離れた敵が映る分だけ引く
    this.lockBlend = damp(this.lockBlend, this.lockActive ? 1 : 0, 6, frameDt);
    const bias = LOCKON.focusBias * this.lockBlend;
    if (bias > 0.001) {
      _target.x += (this.lockX - targetFoot.x) * bias;
      _target.z += (this.lockZ - targetFoot.z) * bias;
    }
    const extra = clamp((this.lockDist - 3) * LOCKON.distanceGain, 0, LOCKON.distanceMax) * this.lockBlend;
    if (!this.initialized) {
      this.follow.copy(_target);
      this.initialized = true;
    } else {
      this.follow.x = damp(this.follow.x, _target.x, CAMERA.followLambda, frameDt);
      this.follow.y = damp(this.follow.y, _target.y, CAMERA.followLambda, frameDt);
      this.follow.z = damp(this.follow.z, _target.z, CAMERA.followLambda, frameDt);
    }
    const cp = Math.cos(this.pitch);
    _offset.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.distance + extra);
    this.camera.position.copy(this.follow).add(_offset);
    // 床より下に潜らない
    if (this.camera.position.y < 0.35) this.camera.position.y = 0.35;
    this.camera.lookAt(this.follow);
    // 揺れはカメラのローカルの右・上へ。注視点は動かさないので、画面全体が震えて見える
    this.shake.update(frameDt);
    if (this.shake.x !== 0 || this.shake.y !== 0) {
      this.camera.translateX(this.shake.x);
      this.camera.translateY(this.shake.y);
    }
  }
}
