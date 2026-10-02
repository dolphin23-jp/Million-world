import * as THREE from 'three';
import type { InputIntent } from '../input/intent';
import { ATTACKS, DODGE, MOVE, attackTotalFrames, type AttackDef } from '../combat/data/attacks';
import { addOutline, createToonMaterial } from '../render/toon';
import { clamp, easeInCubic, easeOutCubic, lerp, lerpAngle, rotateTowards, smoothstep } from '../core/math';
import type { Circle } from '../world/collision';

/**
 * プレイヤー（M0 プレースホルダー）。
 * sim 側の状態（位置・向き・行動状態・フレーム）と、render 側の見た目（カプセル＋剣）を分離する。
 * 見た目は補間係数 alpha を使って sim ステップ間を滑らかにする。
 */

export type PlayerState = 'idle' | 'run' | 'attack' | 'dodge';

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _qC = new THREE.Quaternion();

export class Player {
  // ---- sim 状態 ----
  readonly body: Circle = { x: 0, z: 0, r: MOVE.radius };
  yaw = 0;
  velX = 0;
  velZ = 0;
  state: PlayerState = 'idle';
  stateFrame = 0;
  attack: AttackDef | null = null;
  private attackBuffered = false;
  private dodgeDirX = 0;
  private dodgeDirZ = 1;
  /** 直近の速度の大きさ（見た目用） */
  speed = 0;

  // 補間用の前ステップ
  private prevX = 0;
  private prevZ = 0;
  private prevYaw = 0;
  private prevStateFrame = 0;

  // ---- 見た目 ----
  readonly root = new THREE.Group();
  /** 足元基準。前傾・上下動に使う */
  private readonly bodyPivot = new THREE.Group();
  /** 体の中心基準。回避の前転に使う */
  private readonly rollPivot = new THREE.Group();
  private readonly swordPivot = new THREE.Group();
  private readonly idleSwordQuat = new THREE.Quaternion();

  constructor() {
    this.root.name = 'player';
    this.buildVisual();
    this.setSwordDirection(this.idleSwordQuat, 0.55, -0.8, -0.25);
    this.swordPivot.quaternion.copy(this.idleSwordQuat);
  }

  // ======================= sim =======================

  /** 1 sim ステップ。cameraYaw は入力をワールド方向に変換するために使う */
  step(dt: number, intent: InputIntent, cameraYaw: number): void {
    this.prevX = this.body.x;
    this.prevZ = this.body.z;
    this.prevYaw = this.yaw;
    this.prevStateFrame = this.stateFrame;

    // 入力をワールド方向へ（カメラ基準）
    const fx = -Math.sin(cameraYaw);
    const fz = -Math.cos(cameraYaw);
    const rx = Math.cos(cameraYaw);
    const rz = -Math.sin(cameraYaw);
    const mx = rx * intent.moveX + fx * intent.moveY;
    const mz = rz * intent.moveX + fz * intent.moveY;
    const mLen = Math.hypot(mx, mz);

    if (intent.attackPressed) this.attackBuffered = true;

    switch (this.state) {
      case 'idle':
      case 'run':
        this.stepLocomotion(dt, mx, mz, mLen);
        if (intent.dodgePressed) {
          this.beginDodge(mx, mz, mLen);
        } else if (this.attackBuffered) {
          this.beginAttack(ATTACKS.slash1!, mx, mz, mLen);
        }
        break;
      case 'attack':
        this.stepAttack(dt, mx, mz, mLen, intent);
        break;
      case 'dodge':
        this.stepDodge(dt, intent);
        break;
    }

    this.body.x += this.velX * dt;
    this.body.z += this.velZ * dt;
    this.speed = Math.hypot(this.velX, this.velZ);
    this.stateFrame++;
  }

  private stepLocomotion(dt: number, mx: number, mz: number, mLen: number): void {
    if (mLen > 0.01) {
      const targetYaw = Math.atan2(mx, mz);
      this.yaw = rotateTowards(this.yaw, targetYaw, MOVE.turnSpeed * dt);
      const tvx = mx * MOVE.runSpeed;
      const tvz = mz * MOVE.runSpeed;
      this.velX = approach(this.velX, tvx, MOVE.accel * dt);
      this.velZ = approach(this.velZ, tvz, MOVE.accel * dt);
      this.setState('run');
    } else {
      this.velX = approach(this.velX, 0, MOVE.decel * dt);
      this.velZ = approach(this.velZ, 0, MOVE.decel * dt);
      if (Math.hypot(this.velX, this.velZ) < 0.05) {
        this.velX = 0;
        this.velZ = 0;
        this.setState('idle');
      }
    }
  }

  private beginAttack(def: AttackDef, mx: number, mz: number, mLen: number): void {
    this.attackBuffered = false;
    this.attack = def;
    this.setState('attack');
    // 入力方向があれば即座にそちらを向く（タッチでは向き直りの猶予が重要）
    if (mLen > 0.2) this.yaw = Math.atan2(mx, mz);
    this.velX = 0;
    this.velZ = 0;
  }

  private stepAttack(dt: number, mx: number, mz: number, mLen: number, intent: InputIntent): void {
    const a = this.attack!;
    const f = this.stateFrame;
    const total = attackTotalFrames(a);
    const activeStart = a.startup;
    const activeEnd = a.startup + a.active;

    // 持続中は前進（踏み込み）
    if (f >= activeStart && f < activeEnd) {
      const v = a.lunge / (a.active / 60);
      this.velX = Math.sin(this.yaw) * v;
      this.velZ = Math.cos(this.yaw) * v;
    } else {
      this.velX = approach(this.velX, 0, MOVE.decel * 2 * dt);
      this.velZ = approach(this.velZ, 0, MOVE.decel * 2 * dt);
    }

    // 回避キャンセル（持続終了後）
    if (intent.dodgePressed && f >= activeEnd) {
      this.beginDodge(mx, mz, mLen);
      return;
    }
    // 次段キャンセル
    if (this.attackBuffered && f >= a.cancelFrame && a.next) {
      this.beginAttack(ATTACKS[a.next]!, mx, mz, mLen);
      return;
    }
    if (f >= total) {
      this.attack = null;
      this.attackBuffered = false;
      this.setState(mLen > 0.01 ? 'run' : 'idle');
    }
  }

  private beginDodge(mx: number, mz: number, mLen: number): void {
    if (mLen > 0.2) {
      this.dodgeDirX = mx / mLen;
      this.dodgeDirZ = mz / mLen;
    } else {
      // 無入力なら後方へ
      this.dodgeDirX = -Math.sin(this.yaw);
      this.dodgeDirZ = -Math.cos(this.yaw);
    }
    this.yaw = Math.atan2(this.dodgeDirX, this.dodgeDirZ);
    this.attack = null;
    this.attackBuffered = false;
    this.setState('dodge');
  }

  private stepDodge(_dt: number, intent: InputIntent): void {
    const f = this.stateFrame;
    const t = clamp(f / DODGE.frames, 0, 1);
    const v = DODGE.speed * (1 - easeInCubic(t));
    this.velX = this.dodgeDirX * v;
    this.velZ = this.dodgeDirZ * v;
    if (intent.attackPressed) this.attackBuffered = true;
    if (f >= DODGE.cancelFrame && this.attackBuffered) {
      this.beginAttack(ATTACKS.slash1!, this.dodgeDirX, this.dodgeDirZ, 1);
      return;
    }
    if (f >= DODGE.frames) {
      this.setState('idle');
    }
  }

  private setState(s: PlayerState): void {
    if (this.state === s) return;
    this.state = s;
    this.stateFrame = 0;
    this.prevStateFrame = 0;
  }

  /** 無敵中か（M2 のヒット判定で使う） */
  get invulnerable(): boolean {
    return this.state === 'dodge' && this.stateFrame >= DODGE.invulnStart && this.stateFrame <= DODGE.invulnEnd;
  }

  // ======================= render =======================

  /** 補間済みの位置（カメラ追従用） */
  getInterpolatedPosition(alpha: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(lerp(this.prevX, this.body.x, alpha), 0, lerp(this.prevZ, this.body.z, alpha));
    return out;
  }

  /** 毎描画フレーム: sim 状態から見た目を作る */
  syncVisual(alpha: number, timeSec: number): void {
    this.root.position.set(lerp(this.prevX, this.body.x, alpha), 0, lerp(this.prevZ, this.body.z, alpha));
    this.root.rotation.y = lerpAngle(this.prevYaw, this.yaw, alpha);

    const frame = lerp(this.prevStateFrame, this.stateFrame, alpha);
    const bp = this.bodyPivot;
    bp.rotation.set(0, 0, 0);
    bp.position.set(0, 0, 0);
    bp.scale.set(1, 1, 1);
    this.rollPivot.rotation.set(0, 0, 0);

    switch (this.state) {
      case 'idle': {
        const breath = Math.sin(timeSec * 2.2) * 0.012;
        bp.scale.set(1 - breath * 0.5, 1 + breath, 1 - breath * 0.5);
        this.swordPivot.quaternion.slerp(this.idleSwordQuat, 0.2);
        break;
      }
      case 'run': {
        const k = clamp(this.speed / MOVE.runSpeed, 0, 1);
        bp.position.y = Math.abs(Math.sin(timeSec * 11)) * 0.06 * k;
        bp.rotation.x = 0.16 * k; // 前傾
        bp.rotation.z = Math.sin(timeSec * 11) * 0.05 * k;
        // 走り中は剣を少し後ろへ
        this.setSwordDirection(_qA, 0.5, -0.6, -0.65);
        this.swordPivot.quaternion.slerp(_qA, 0.15);
        break;
      }
      case 'attack': {
        const a = this.attack!;
        this.poseSwordForAttack(a, frame);
        const activeStart = a.startup;
        const activeEnd = a.startup + a.active;
        // 体の捻り: 発生で溜め、持続で前へ
        const windT = smoothstep(0, activeStart, frame);
        const swingT = smoothstep(activeStart, activeEnd, frame);
        const recoverT = smoothstep(activeEnd, attackTotalFrames(a), frame);
        const lean = lerp(-0.12 * windT, 0.22, swingT) * (1 - recoverT * 0.8);
        bp.rotation.x = lean;
        bp.rotation.y = lerp(-0.35 * windT, 0.45, swingT) * (1 - recoverT);
        break;
      }
      case 'dodge': {
        const t = clamp(frame / DODGE.frames, 0, 1);
        // 前転: 体の中心を軸に進行方向（ローカル +Z）へ 1 回転
        this.rollPivot.rotation.x = easeOutCubic(t) * Math.PI * 2;
        bp.position.y = Math.sin(t * Math.PI) * 0.2;
        this.setSwordDirection(_qA, 0.4, -0.3, -0.85);
        this.swordPivot.quaternion.slerp(_qA, 0.3);
        break;
      }
    }
  }

  private poseSwordForAttack(a: AttackDef, frame: number): void {
    const s = a.swing;
    const activeStart = a.startup;
    const activeEnd = a.startup + a.active;
    const total = attackTotalFrames(a);
    this.setSwordDirection(_qA, ...s.windup);
    this.setSwordDirection(_qB, ...s.mid);
    this.setSwordDirection(_qC, ...s.end);
    const q = this.swordPivot.quaternion;
    if (frame < activeStart) {
      // 溜め: 現在姿勢 → windup
      const t = easeOutCubic(clamp(frame / activeStart, 0, 1));
      q.slerp(_qA, Math.min(1, t * 0.6 + 0.2));
    } else if (frame < activeEnd) {
      // 振り: windup → mid → end（持続時間で等速に近く）
      const t = clamp((frame - activeStart) / a.active, 0, 1);
      if (t < 0.5) q.copy(_qA).slerp(_qB, t * 2);
      else q.copy(_qB).slerp(_qC, (t - 0.5) * 2);
    } else {
      // 硬直: end → idle
      const t = smoothstep(activeEnd, total, frame);
      q.copy(_qC).slerp(this.idleSwordQuat, easeOutCubic(t));
    }
  }

  /** 剣先の向き（キャラ基準）を quaternion にする */
  private setSwordDirection(out: THREE.Quaternion, x: number, y: number, z: number): THREE.Quaternion {
    _dir.set(x, y, z).normalize();
    return out.setFromUnitVectors(UP, _dir);
  }

  private buildVisual(): void {
    const skin = createToonMaterial({ color: 0xffd9c2, steps: 2, shadowLevel: 0.62, rimColor: 0xffe9d6, rimStrength: 0.25 });
    const cloth = createToonMaterial({ color: 0x3a63d9, steps: 3, shadowLevel: 0.48, rimColor: 0xbcd0ff, rimStrength: 0.45 });
    const clothDark = createToonMaterial({ color: 0x1d2a66, steps: 2, shadowLevel: 0.5, rimStrength: 0.3 });
    const hair = createToonMaterial({ color: 0x2b2340, steps: 2, shadowLevel: 0.55, rimColor: 0x8f7cff, rimStrength: 0.6, rimPower: 2.5 });
    const accent = createToonMaterial({ color: 0xffd36a, steps: 2, shadowLevel: 0.6, rimStrength: 0.4 });
    const steel = createToonMaterial({
      color: 0xdfe6f2,
      steps: 2,
      shadowLevel: 0.55,
      rimColor: 0xffffff,
      rimStrength: 0.9,
      rimPower: 2.0,
      emissive: 0x2b3a55,
      emissiveIntensity: 0.6,
    });

    const outer = this.bodyPivot;
    outer.position.y = 0;
    this.root.add(outer);
    // rollPivot は体の中心（y=0.85）に置き、子はその分だけ下げて配置する
    const ROLL_Y = 0.85;
    this.rollPivot.position.y = ROLL_Y;
    outer.add(this.rollPivot);
    const bp = new THREE.Group();
    bp.position.y = -ROLL_Y;
    this.rollPivot.add(bp);

    // 胴（カプセル）
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.55, 6, 16), cloth);
    torso.position.y = 0.85;
    torso.castShadow = true;
    bp.add(torso);
    addOutline(torso);

    // 腰帯
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.1, 16), accent);
    belt.position.y = 0.66;
    belt.castShadow = true;
    bp.add(belt);
    addOutline(belt, { thickness: 0.02 });

    // 脚（短いカプセル 2 本）
    const legGeo = new THREE.CapsuleGeometry(0.11, 0.3, 4, 10);
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, clothDark);
      leg.position.set(sx * 0.14, 0.28, 0);
      leg.castShadow = true;
      bp.add(leg);
      addOutline(leg, { thickness: 0.02 });
    }

    // 頭
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 16), skin);
    head.position.y = 1.5;
    head.castShadow = true;
    bp.add(head);
    addOutline(head);

    // 髪（頭を少し覆う半球 + 前髪の房）
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.29, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
    hairCap.position.y = 1.53;
    hairCap.castShadow = true;
    bp.add(hairCap);
    addOutline(hairCap);
    const bang = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 6), hair);
    bang.position.set(0.1, 1.5, 0.24);
    bang.rotation.x = Math.PI * 0.95;
    bang.rotation.z = -0.3;
    bp.add(bang);
    addOutline(bang, { thickness: 0.02 });

    // 目（向きが分かるように前面に 2 つ）
    const eyeGeo = new THREE.SphereGeometry(0.035, 8, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1430 });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(sx * 0.1, 1.5, 0.235);
      eye.scale.set(1, 1.6, 0.6);
      bp.add(eye);
    }

    // 剣（右手付近をピボットに）
    this.swordPivot.position.set(0.42, 1.0, 0.12);
    bp.add(this.swordPivot);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.014), steel);
    blade.position.y = 0.62;
    blade.castShadow = true;
    this.swordPivot.add(blade);
    addOutline(blade, { thickness: 0.02 });
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.06), accent);
    guard.position.y = 0.06;
    this.swordPivot.add(guard);
    addOutline(guard, { thickness: 0.02 });
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, 0.22, 8), clothDark);
    grip.position.y = -0.08;
    this.swordPivot.add(grip);
    addOutline(grip, { thickness: 0.02 });
  }
}

function approach(v: number, target: number, maxDelta: number): number {
  const d = target - v;
  if (Math.abs(d) <= maxDelta) return target;
  return v + Math.sign(d) * maxDelta;
}
