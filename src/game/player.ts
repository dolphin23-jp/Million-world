import * as THREE from 'three';
import type { InputIntent } from '../input/intent';
import { ATTACKS, DODGE, HIT_STUN, MOVE, PLAYER_STATS, dodgeRoot, resolveAttack, rootMotionOf, type AttackDef, type AttackFrames } from '../combat/data/attacks';
import { applyDamage, createHealth, type DamageResult } from '../combat/health';
import { HitTracker, isActiveFrame, type HitEvent, type Hurtbox } from '../combat/hit';
import { Knockback } from '../combat/knockback';
import { lerp, lerpAngle, rotateTowards } from '../core/math';
import { PLAYER_ID } from './combat';
import type { ToonMaterial } from '../render/toon';
import type { CharacterAsset } from '../character/loader';
import { Animator } from '../character/animator';
import { bakeAttack, type BakeStats, type FrameTrace } from '../character/authoring';
import { AUTHORED_ATTACKS } from '../character/data/authored';
import { HERO } from '../character/data/hero';
import { captureRig, type CapturedRig } from '../character/rig-capture';
import { buildSword } from './sword';

/**
 * プレイヤー。sim 側の状態（位置・向き・行動状態・フレーム）と、render 側の見た目（GLB + アニメ）を分離する。
 * 見た目は補間係数 alpha で sim ステップ間を滑らかにし、状態の変化を見てクリップを切り替える。
 */

export type PlayerState = 'idle' | 'run' | 'attack' | 'dodge' | 'hit' | 'dead';

export class Player {
  // ---- sim 状態 ----
  /** 当たり判定。被弾側のハートボックスを兼ねる（円 + id + 無敵）。invulnerable は refreshHurtbox() で更新する */
  readonly body: Hurtbox = { id: PLAYER_ID, x: 0, z: 0, r: MOVE.radius, invulnerable: false };
  readonly health = createHealth(PLAYER_STATS.maxHp);
  yaw = 0;
  velX = 0;
  velZ = 0;
  state: PlayerState = 'idle';
  stateFrame = 0;
  attack: AttackDef | null = null;
  attackFrames: AttackFrames | null = null;
  /** この攻撃で当てた対象の記録（1 攻撃 1 対象 1 回）。攻撃を始めるたびにリセットする */
  readonly hitTracker = new HitTracker();
  /** 被弾の記録。hitSerial は被弾のたびに増える（見た目側が被弾を検出するため） */
  hitSerial = 0;
  lastHit: HitEvent | null = null;
  private readonly knockback = new Knockback();
  /** 被弾後の無敵の残りフレーム */
  private hurtInvuln = 0;
  private attackBuffered = false;
  private dodgeDirX = 0;
  private dodgeDirZ = 1;
  /** 直近の速度の大きさ（見た目用） */
  speed = 0;
  /**
   * 照準（ロックオン中の対象の位置。Game が毎ステップ設定する）。あれば、攻撃は対象の方を向いて始まり、
   * 立ち止まっているときも対象の方を向く（走るときはスティックの向き）
   */
  private aimX = 0;
  private aimZ = 0;
  private hasAim = false;
  /** 状態が切り替わるたびに増える（見た目側が遷移を検出するため） */
  stateSerial = 0;

  // 補間用の前ステップ
  private prevX = 0;
  private prevZ = 0;
  private prevYaw = 0;

  // ---- 見た目 ----
  readonly root = new THREE.Group();
  private visual: HeroVisual | null = null;

  constructor() {
    this.root.name = 'player';
  }

  /** 読み込んだキャラクター資産を見た目として装着する */
  attachVisual(asset: CharacterAsset): void {
    this.visual = new HeroVisual(asset);
    this.root.add(this.visual.root);
  }

  // ======================= sim =======================

  /** ロックオン対象の位置を教える（null で照準なし）。step() の前に呼ぶ */
  setAim(target: { x: number; z: number } | null): void {
    this.hasAim = target !== null;
    if (target) {
      this.aimX = target.x;
      this.aimZ = target.z;
    }
  }

  step(dt: number, intent: InputIntent, cameraYaw: number): void {
    this.prevX = this.body.x;
    this.prevZ = this.body.z;
    this.prevYaw = this.yaw;

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
        } else if (intent.heavyPressed) {
          this.beginAttack(ATTACKS.heavy!, mx, mz, mLen);
        } else if (this.attackBuffered) {
          this.beginAttack(ATTACKS.combo1!, mx, mz, mLen);
        }
        break;
      case 'attack':
        this.stepAttack(dt, mx, mz, mLen, intent);
        break;
      case 'dodge':
        this.stepDodge(dt, intent);
        break;
      case 'hit':
        // ひるみ: 操作できない。ノックバックの速度で動き、終わったら待機へ（先行入力は残る）
        this.velX = this.knockback.velX;
        this.velZ = this.knockback.velZ;
        this.knockback.step();
        if (this.stateFrame >= HIT_STUN.frames) this.setState('idle');
        break;
      case 'dead':
        this.velX = this.knockback.velX;
        this.velZ = this.knockback.velZ;
        this.knockback.step();
        break;
    }

    this.body.x += this.velX * dt;
    this.body.z += this.velZ * dt;
    this.speed = Math.hypot(this.velX, this.velZ);
    this.stateFrame++;
    if (this.hurtInvuln > 0) this.hurtInvuln--;
    this.refreshHurtbox();
  }

  /**
   * 敵の攻撃を受ける。ダメージを適用し、攻撃・回避を中断してひるみ（HP が 0 なら死亡）に入り、ノックバックを受ける。
   * 無敵（回避の無敵フレーム・被弾後の無敵・死亡）の間は呼ばれない想定（body.invulnerable で当たり判定が除外する）
   */
  takeHit(ev: HitEvent): DamageResult {
    const r = applyDamage(this.health, ev.damage);
    this.hitSerial++;
    this.lastHit = ev;
    this.attack = null;
    this.attackFrames = null;
    this.attackBuffered = false;
    this.hurtInvuln = HIT_STUN.invulnFrames;
    this.velX = 0;
    this.velZ = 0;
    // 攻撃してきた側を向いて受ける（ひるみのアニメは正面から受けた姿）
    this.yaw = Math.atan2(-ev.dirX, -ev.dirZ);
    this.knockback.start(ev.dirX, ev.dirZ, ev.knockback, HIT_STUN.knockbackFrames);
    this.setState(r.killed ? 'dead' : 'hit', true);
    this.refreshHurtbox();
    return r;
  }

  get dead(): boolean {
    return this.state === 'dead';
  }

  /** 最初の状態に戻す（再戦。M3 のリザルト・再戦ができるまでは死亡から自動で呼ぶ） */
  reset(): void {
    this.health.hp = this.health.max;
    this.attack = null;
    this.attackFrames = null;
    this.attackBuffered = false;
    this.hurtInvuln = 0;
    this.knockback.cancel();
    this.velX = 0;
    this.velZ = 0;
    this.body.x = this.prevX = 0;
    this.body.z = this.prevZ = 0;
    this.yaw = this.prevYaw = 0;
    this.setState('idle', true);
    this.refreshHurtbox();
  }

  private refreshHurtbox(): void {
    this.body.invulnerable = this.invulnerable;
  }

  private stepLocomotion(dt: number, mx: number, mz: number, mLen: number): void {
    if (mLen > 0.01) {
      const targetYaw = Math.atan2(mx, mz);
      this.yaw = rotateTowards(this.yaw, targetYaw, MOVE.turnSpeed * dt);
      this.velX = approach(this.velX, mx * MOVE.runSpeed, MOVE.accel * dt);
      this.velZ = approach(this.velZ, mz * MOVE.runSpeed, MOVE.accel * dt);
      this.setState('run');
    } else {
      this.velX = approach(this.velX, 0, MOVE.decel * dt);
      this.velZ = approach(this.velZ, 0, MOVE.decel * dt);
      // 立ち止まっているときは対象の方を向く
      if (this.hasAim) this.yaw = rotateTowards(this.yaw, Math.atan2(this.aimX - this.body.x, this.aimZ - this.body.z), MOVE.turnSpeed * dt);
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
    this.attackFrames = resolveAttack(def);
    this.hitTracker.reset();
    this.setState('attack', true);
    // 照準（ロックオン対象）があれば即座にそちらを向く。なければ入力方向（タッチでは向き直りの猶予が重要）
    if (this.hasAim && Math.hypot(this.aimX - this.body.x, this.aimZ - this.body.z) > 0.05) {
      this.yaw = Math.atan2(this.aimX - this.body.x, this.aimZ - this.body.z);
    } else if (mLen > 0.2) {
      this.yaw = Math.atan2(mx, mz);
    }
    this.velX = 0;
    this.velZ = 0;
  }

  private stepAttack(dt: number, mx: number, mz: number, mLen: number, intent: InputIntent): void {
    const a = this.attack!;
    const fr = this.attackFrames!;
    const f = this.stateFrame;
    const activeStart = fr.startup;
    const activeEnd = fr.startup + fr.active;

    const root = rootMotionOf(a);
    if (root) {
      // 手付け: ステップ f の後の累計の前進量が rootZ(((f + 1) * rate)/60) になるよう、毎ステップの差分で動く。
      // 見た目のアニメは攻撃開始の描画で 1 フレーム進んでいる（開始ステップの次の描画で時間 1/60）ので、sim を 1 フレーム先にそろえる。
      // ずれると接地した足が（ルート速度 × 1 フレーム）だけ滑る（実測で最大 3cm）
      const v = (root(((f + 1) * a.rate) / 60) - root((f * a.rate) / 60)) * 60;
      this.velX = Math.sin(this.yaw) * v;
      this.velZ = Math.cos(this.yaw) * v;
    } else if (f >= activeStart && f < activeEnd) {
      // 持続中は前進（踏み込み）
      const v = a.lunge / (fr.active / 60);
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
    if (this.attackBuffered && f >= fr.cancelFrame && a.next) {
      this.beginAttack(ATTACKS[a.next]!, mx, mz, mLen);
      return;
    }
    if (f >= fr.total) {
      this.attack = null;
      this.attackFrames = null;
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
    this.attackFrames = null;
    this.attackBuffered = false;
    this.setState('dodge', true);
  }

  private stepDodge(_dt: number, intent: InputIntent): void {
    const f = this.stateFrame;
    // 手付けのダッシュ: 攻撃（stepAttack）と同じく、1 フレーム先にそろえた rootZ の差分で進む
    const v = (dodgeRoot((f + 1) / 60) - dodgeRoot(f / 60)) * 60;
    this.velX = this.dodgeDirX * v;
    this.velZ = this.dodgeDirZ * v;
    if (intent.attackPressed) this.attackBuffered = true;
    if (f >= DODGE.cancelFrame && this.attackBuffered) {
      this.beginAttack(ATTACKS.combo1!, this.dodgeDirX, this.dodgeDirZ, 1);
      return;
    }
    if (f >= DODGE.frames) {
      this.setState('idle');
    }
  }

  private setState(s: PlayerState, forceRestart = false): void {
    if (this.state === s && !forceRestart) return;
    this.state = s;
    this.stateFrame = 0;
    this.stateSerial++;
  }

  /**
   * 攻撃の持続フレームの中か（ヒット判定を出す間）。step() の後に読む: そのとき stateFrame は
   * 「攻撃を始めてから進んだ sim フレーム」で、描画されている姿勢のアニメ時刻 stateFrame/60 に等しい
   */
  get attackActive(): boolean {
    const fr = this.attackFrames;
    return this.state === 'attack' && fr !== null && isActiveFrame(fr.startup, fr.active, this.stateFrame);
  }

  /**
   * 剣筋（トレイル）を出す区間か。attack.trail は区間先頭からの秒で、描画されている姿勢のアニメ時刻は stateFrame / 60 × rate
   * （attackActive と同じ対応）
   */
  get trailActive(): boolean {
    const a = this.attack;
    if (this.state !== 'attack' || !a) return false;
    const t = (this.stateFrame / 60) * a.rate;
    return t >= a.trail[0] && t <= a.trail[1];
  }

  /** 被弾後の無敵の残りフレーム（0 = 無敵ではない）。見た目の点滅用 */
  get hurtInvulnFrames(): number {
    return this.state === 'dead' ? 0 : this.hurtInvuln;
  }

  /** 無敵中か（敵の攻撃のヒット判定で使う）: 回避の無敵フレーム、被弾後の無敵、死亡後 */
  get invulnerable(): boolean {
    if (this.state === 'dead' || this.hurtInvuln > 0) return true;
    return this.state === 'dodge' && this.stateFrame >= DODGE.invulnStart && this.stateFrame <= DODGE.invulnEnd;
  }

  // ======================= render =======================

  getInterpolatedPosition(alpha: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(lerp(this.prevX, this.body.x, alpha), 0, lerp(this.prevZ, this.body.z, alpha));
    return out;
  }

  /** 剣の刃の根元側と先の世界座標（剣筋用）。見た目が読み込まれていなければ false。syncVisual のあとに呼ぶ */
  getBladePoints(base: THREE.Vector3, tip: THREE.Vector3): boolean {
    return this.visual?.getBladePoints(base, tip) ?? false;
  }

  /** 毎描画フレーム。animDt はヒットストップ等のスケール済み時間、frameDt は実時間（フラッシュの減衰用） */
  syncVisual(alpha: number, animDt: number, frameDt: number): void {
    this.root.position.set(lerp(this.prevX, this.body.x, alpha), 0, lerp(this.prevZ, this.body.z, alpha));
    this.root.rotation.y = lerpAngle(this.prevYaw, this.yaw, alpha) + HERO.forwardYawOffset;
    this.visual?.update(this, animDt, frameDt);
  }
}

/** 剣の刃の根元寄り・先端（剣のローカル Y。src/game/sword.ts の刃は y = 0.1〜1.16） */
const BLADE_BASE_Y = 0.3;
const BLADE_TIP_Y = 1.17;

/** GLB キャラクターとアニメーションの見た目側 */
class HeroVisual {
  readonly root: THREE.Group;
  private readonly animator: Animator;
  private seenSerial = -1;
  private seenHit = 0;
  /** 被弾のフラッシュ（0..1 で減衰。実時間で減らす） */
  private flash = 0;
  /** 発光に使うキャラのマテリアル（トゥーン）。発光色は黒（なし）から始まる */
  private readonly skinMats: ToonMaterial[];
  private readonly sword: THREE.Group;
  /** 手付けアニメの元になったリグ情報と、焼いたときの統計（デバッグ・検証用） */
  readonly capture: CapturedRig;
  readonly authoredStats: Record<string, BakeStats> = {};
  readonly authoredTrace: Record<string, FrameTrace[]> = {};

  constructor(asset: CharacterAsset) {
    this.root = asset.root;
    this.skinMats = asset.meshes.map((m) => m.material as ToonMaterial);
    this.animator = new Animator(asset.root, asset.clips);
    for (const [name, seg] of Object.entries(HERO.segments)) {
      this.animator.defineSegment(name, seg.clip, seg.start, seg.end);
    }
    // 手付けの攻撃: 資産の骨から Rig を作り、キー → IK → 60fps のクリップに焼く（ADR-012）
    this.capture = captureRig(asset, {
      idleClip: HERO.clips.idle,
      hingeClip: HERO.clips.run,
      handFinger: HERO.hand.right.f,
      grip: { posCm: HERO.sword.position, quat: HERO.sword.quaternion },
    });
    for (const def of Object.values(AUTHORED_ATTACKS)) {
      const { clip, stats, trace } = bakeAttack(this.capture.rig, def, 60, this.capture.extras);
      this.animator.addClip(def.name, clip);
      this.authoredStats[def.name] = stats;
      this.authoredTrace[def.name] = trace;
    }
    // 剣: ボーン空間は cm（Armature 0.01 倍）なのでソケットを 100 倍にして m 単位の剣を置く
    this.sword = buildSword();
    const bone = asset.bones.get(HERO.sword.bone);
    const socket = new THREE.Group();
    socket.name = 'sword-socket';
    socket.position.fromArray(HERO.sword.position);
    socket.quaternion.fromArray(HERO.sword.quaternion);
    socket.scale.setScalar(100);
    socket.add(this.sword);
    if (bone) bone.add(socket);
    else console.warn(`[hero] ボーンがありません: ${HERO.sword.bone}`);

    this.animator.play(HERO.clips.idle, { loop: true, fade: 0 });
  }

  /** 刃（剣のローカル +Y が刃先方向）の根元寄りと先端の世界座標。アニメ更新直後の骨の位置から求める */
  getBladePoints(base: THREE.Vector3, tip: THREE.Vector3): boolean {
    this.sword.updateWorldMatrix(true, false);
    base.set(0, BLADE_BASE_Y, 0);
    tip.set(0, BLADE_TIP_Y, 0);
    this.sword.localToWorld(base);
    this.sword.localToWorld(tip);
    return true;
  }

  /** 被弾のフラッシュと、被弾後の無敵中の点滅（発光）。frameDt は実時間 */
  private updateGlow(p: Player, frameDt: number): void {
    if (p.hitSerial !== this.seenHit) {
      this.seenHit = p.hitSerial;
      this.flash = 1;
    }
    this.flash = Math.max(0, this.flash - frameDt / 0.14);
    // 無敵のあいだ 3 フレームおきに明滅（回避の無敵とは区別する。被弾後だけ）
    const blink = p.hurtInvulnFrames > 0 && Math.floor(p.hurtInvulnFrames / 3) % 2 === 0 ? 0.28 : 0;
    const amount = Math.max(this.flash * 0.75, blink);
    for (const m of this.skinMats) {
      m.emissive.setRGB(1, 0.55 + 0.45 * (1 - amount), 0.5 + 0.5 * (1 - amount));
      m.emissiveIntensity = amount;
    }
  }

  update(p: Player, dt: number, frameDt: number): void {
    if (p.stateSerial !== this.seenSerial) {
      this.seenSerial = p.stateSerial;
      this.onStateEnter(p);
    }
    this.updateGlow(p, frameDt);
    if (p.state === 'run') {
      const rate = Math.max(HERO.runRateMin, p.speed / HERO.runCycleSpeed);
      this.animator.setRate(rate);
    }
    this.animator.update(dt);
  }

  private onStateEnter(p: Player): void {
    switch (p.state) {
      case 'idle':
        this.animator.play(HERO.clips.idle, { loop: true, fade: 0.25 });
        break;
      case 'run':
        this.animator.play(HERO.clips.run, { loop: true, fade: 0.15 });
        break;
      case 'attack': {
        const a = p.attack!;
        this.animator.play(a.segment, { loop: false, fade: a.fade ?? 0.08, rate: a.rate, clamp: true, restart: true });
        break;
      }
      case 'dodge':
        this.animator.play('dodge', { loop: false, fade: 0.08, rate: 1, clamp: true, restart: true });
        break;
      case 'hit':
        this.animator.play('hit', { loop: false, fade: 0.04, rate: HERO.hit.rate, clamp: true, restart: true });
        break;
      case 'dead':
        this.animator.play(HERO.clips.death, { loop: false, fade: 0.1, rate: 1, clamp: true, restart: true });
        break;
    }
  }
}

function approach(v: number, target: number, maxDelta: number): number {
  const d = target - v;
  if (Math.abs(d) <= maxDelta) return target;
  return v + Math.sign(d) * maxDelta;
}
