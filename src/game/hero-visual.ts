import * as THREE from 'three';
import type { Player } from './player';
import type { ToonMaterial } from '../render/toon';
import type { CharacterAsset } from '../character/loader';
import { Animator } from '../character/animator';
import { bakeAttack, type BakeStats, type FrameTrace } from '../character/authoring';
import { AUTHORED_ATTACKS, SHIELD_VARIANT, hasShieldVariant } from '../character/data/authored';
import { SHIELD_CARRY, SHIELD_IDLE } from '../character/data/guard';
import { HERO } from '../character/data/hero';
import { captureRig, type CapturedRig } from '../character/rig-capture';
import { BONE } from '../character/rig';
import { approach } from '../core/math';
import { buildSword } from './sword';
import { buildShield, shieldMount } from './shield';

/**
 * プレイヤーの見た目（GLB キャラ + 手付けクリップ + 剣・盾）。sim の状態（Player）を読んで、クリップの切替・発光・武器の表示を決める。
 * player.ts から分けた（見た目の部品が増えたため）。sim 側は Player、ここは描画フレームで進める。
 */

/** 剣の刃の根元寄り・先端（剣のローカル Y。src/game/sword.ts の刃は y = 0.1〜1.16） */
const BLADE_BASE_Y = 0.3;
const BLADE_TIP_Y = 1.17;

/** GLB キャラクターとアニメーションの見た目側 */
export class HeroVisual {
  readonly root: THREE.Group;
  private readonly animator: Animator;
  private seenSerial = -1;
  private seenHit = 0;
  private seenEquip = -1;
  private seenGuardHit = 0;
  private seenParry = 0;
  /** ガードで受け止めた・パリィした瞬間の盾（剣）の閃光（1 → 0 に減衰。実時間） */
  private guardFlash = 0;
  /** 被弾のフラッシュ（0..1 で減衰。実時間で減らす） */
  private flash = 0;
  /** 発光に使うキャラのマテリアル（トゥーン）。発光色は黒（なし）から始まる */
  private readonly skinMats: ToonMaterial[];
  private readonly sword: THREE.Group;
  /** 盾（左前腕）。盾を装備しているときだけ見せる */
  private readonly shield: THREE.Group;
  private readonly shieldMat: ToonMaterial;
  /** 剣の刃のマテリアルと、素の発光（溜めの光り方はここから変える） */
  private readonly steel: ToonMaterial;
  private readonly steelBaseIntensity: number;
  private readonly steelBaseEmissive = new THREE.Color();
  /** 溜めの光（0..1。段階に向けて近づく）と、段階が上がった瞬間の閃光（1 → 0 に減衰） */
  private swordGlow = 0;
  private glowPulse = 0;
  private seenChargeLevel = 0;
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
      // 盾を持つときの版: 左腕を盾の持ち位置に固定して焼き直す（ガードのクリップは自分で左腕を決めるので除く）
      if (hasShieldVariant(def.name)) {
        const v = bakeAttack(this.capture.rig, def, 60, this.capture.extras, { leftHold: SHIELD_CARRY, suffix: SHIELD_VARIANT });
        this.animator.addClip(def.name + SHIELD_VARIANT, v.clip);
        this.authoredStats[def.name + SHIELD_VARIANT] = v.stats;
        this.authoredTrace[def.name + SHIELD_VARIANT] = v.trace;
      }
    }
    // 盾を持つときの待機（左腕を盾の位置に固定した息づかいだけの待機）。名前は 'idle@shield' で、clipName が盾版として探す
    const shieldIdle = bakeAttack(this.capture.rig, SHIELD_IDLE, 60, this.capture.extras, { leftHold: SHIELD_CARRY });
    this.animator.addClip(shieldIdle.clip.name, shieldIdle.clip);
    this.authoredStats[shieldIdle.clip.name] = shieldIdle.stats;
    this.authoredTrace[shieldIdle.clip.name] = shieldIdle.trace;
    // 剣: ボーン空間は cm（Armature 0.01 倍）なのでソケットを 100 倍にして m 単位の剣を置く
    this.sword = buildSword();
    this.steel = this.sword.userData.steel as ToonMaterial;
    this.steelBaseIntensity = this.steel.emissiveIntensity;
    this.steelBaseEmissive.copy(this.steel.emissive);
    const bone = asset.bones.get(HERO.sword.bone);
    const socket = new THREE.Group();
    socket.name = 'sword-socket';
    socket.position.fromArray(HERO.sword.position);
    socket.quaternion.fromArray(HERO.sword.quaternion);
    socket.scale.setScalar(100);
    socket.add(this.sword);
    if (bone) bone.add(socket);
    else console.warn(`[hero] ボーンがありません: ${HERO.sword.bone}`);

    // 盾: 左前腕のボーンに付ける。面の向きは肘の蝶番軸から決める（shieldMount）。装備したときだけ見せる
    this.shield = buildShield();
    this.shieldMat = this.shield.userData.material as ToonMaterial;
    const foreL = asset.bones.get(BONE.foreL);
    if (foreL) {
      const rig = this.capture.rig;
      const mount = shieldMount(rig.data.hinges.armL.f, rig.length(BONE.foreL, BONE.handL));
      const shieldSocket = new THREE.Group();
      shieldSocket.name = 'shield-socket';
      shieldSocket.position.copy(mount.position);
      shieldSocket.quaternion.copy(mount.quaternion);
      shieldSocket.scale.setScalar(100);
      shieldSocket.add(this.shield);
      foreL.add(shieldSocket);
    } else console.warn(`[hero] ボーンがありません: ${BONE.foreL}`);
    this.shield.visible = false;

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
    this.updateSwordGlow(p, frameDt);
    this.updateShieldGlow(p, frameDt);
  }

  /**
   * 盾の光: パリィの受付のあいだ水色に光り（弾けるタイミングが見える）、受け止めた・弾いた瞬間に暖色に閃く。
   * 盾を持たないときは何もしない（剣の閃光は updateSwordGlow の glowPulse）
   */
  private updateShieldGlow(p: Player, frameDt: number): void {
    this.guardFlash = Math.max(0, this.guardFlash - frameDt / 0.18);
    if (!this.shield.visible) return;
    const m = this.shieldMat;
    m.emissive.copy(PARRY_COLOR).multiplyScalar(p.parryWindow ? 0.75 : 0);
    if (this.guardFlash > 0) m.emissive.add(_flash.copy(GUARD_FLASH_COLOR).multiplyScalar(this.guardFlash));
    m.emissiveIntensity = 1;
  }

  /**
   * 溜めの光: 構えのあいだ刃が段階に応じて光る（段階 0 → 0.35, 1 → 0.7, 2 → 1。金色へ寄る）。段階が上がった瞬間に閃く。
   * 溜めを放った攻撃（威力 > 1）は、威力に応じた光のまま薄れていく（重撃が強いほど派手に見える）
   */
  private updateSwordGlow(p: Player, frameDt: number): void {
    let target = 0;
    if (p.state === 'charge') {
      target = CHARGE_GLOW[Math.min(p.chargeLevel, CHARGE_GLOW.length - 1)]!;
      if (p.chargeLevel > this.seenChargeLevel) this.glowPulse = 1;
    } else if (p.state === 'attack' && p.attackPower > 1) {
      target = Math.min(1, (p.attackPower - 1) / 0.6);
    }
    this.seenChargeLevel = p.state === 'charge' ? p.chargeLevel : 0;
    // 立ち上がりは速く（構えに入ってすぐ光り始める）、消えるのはゆっくり
    this.swordGlow = approach(this.swordGlow, target, frameDt / (target > this.swordGlow ? 0.15 : 0.45));
    this.glowPulse = Math.max(0, this.glowPulse - frameDt / 0.16);
    const k = Math.min(1, this.swordGlow + this.glowPulse * 0.5);
    this.steel.emissive.copy(this.steelBaseEmissive).lerp(CHARGE_COLOR, k);
    this.steel.emissiveIntensity = this.steelBaseIntensity + 1.8 * k;
  }

  update(p: Player, dt: number, frameDt: number): void {
    if (p.equipSerial !== this.seenEquip) {
      this.seenEquip = p.equipSerial;
      this.shield.visible = p.loadout.offhand === 'shield';
    }
    if (p.stateSerial !== this.seenSerial) {
      this.seenSerial = p.stateSerial;
      this.onStateEnter(p);
    }
    this.onGuardEvents(p);
    this.updateGlow(p, frameDt);
    if (p.state === 'run') {
      const rate = Math.max(HERO.runRateMin, p.speed / HERO.runCycleSpeed);
      this.animator.setRate(rate);
    }
    this.animator.update(dt);
  }

  /** 手付けクリップの名前（盾を持つときは、左腕を盾の位置に固定して焼き直した版があればそれ） */
  private clipName(base: string, p: Player): string {
    const v = base + p.loadout.clipVariant;
    return p.loadout.clipVariant !== '' && this.animator.has(v) ? v : base;
  }

  /** ガードで受け止めた・パリィしたときの反動の動きと閃光 */
  private onGuardEvents(p: Player): void {
    if (p.guardHitSerial !== this.seenGuardHit) {
      this.seenGuardHit = p.guardHitSerial;
      this.guardFlash = 1;
      // 素手のとき（剣で受ける）は刃が光る
      if (p.loadout.offhand === 'none') this.glowPulse = 1;
      if (p.guarding && p.guard) this.animator.play(p.guard.clips.hit.name, { loop: false, fade: 0.03, rate: 1, clamp: true, restart: true });
    }
    if (p.parrySerial !== this.seenParry) {
      this.seenParry = p.parrySerial;
      this.guardFlash = 1;
      const c = p.guard?.clips.parry;
      if (p.guarding && c) this.animator.play(c.name, { loop: false, fade: 0.03, rate: 1, clamp: true, restart: true });
    }
  }

  private onStateEnter(p: Player): void {
    switch (p.state) {
      case 'idle':
        this.animator.play(this.clipName(HERO.clips.idle, p), { loop: true, fade: 0.25 });
        break;
      case 'run':
        this.animator.play(HERO.clips.run, { loop: true, fade: 0.15 });
        break;
      case 'attack': {
        const a = p.attack!;
        this.animator.play(this.clipName(a.segment, p), { loop: false, fade: a.fade ?? 0.08, rate: a.rate, clamp: true, restart: true });
        break;
      }
      case 'dodge':
        this.animator.play(this.clipName(p.dodgeKind === 'back' ? 'dodgeBack' : 'dodge', p), { loop: false, fade: 0.06, rate: 1, clamp: true, restart: true });
        break;
      case 'charge':
        // 構えは終端の姿勢で止まる（clamp）。離すまで保つ
        this.animator.play(this.clipName(p.charge!.clip.name, p), { loop: false, fade: 0.05, rate: 1, clamp: true, restart: true });
        break;
      case 'guard':
        // 構えも終端の姿勢で止まる。構えるあいだ保つ（盾のクリップは左腕を自分で決めるので版は無い）
        this.animator.play(p.guard!.clips.enter.name, { loop: false, fade: 0.06, rate: 1, clamp: true, restart: true });
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

/** パリィの受付中の盾の光（水色）と、受け止めた・弾いた瞬間の閃光（暖色） */
const PARRY_COLOR = new THREE.Color(0.3, 0.8, 1);
const GUARD_FLASH_COLOR = new THREE.Color(1, 0.85, 0.5);
const _flash = new THREE.Color();

/** 溜めの段階ごとの刃の光（0..1）と、最大のときの発光色（金色） */
const CHARGE_GLOW = [0.35, 0.7, 1] as const;
const CHARGE_COLOR = new THREE.Color(0xffc24a);
