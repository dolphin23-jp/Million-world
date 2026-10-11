import * as THREE from 'three';
import type { Player } from './player';
import type { ToonMaterial } from '../render/toon';
import type { CharacterAsset } from '../character/loader';
import { Animator, overlayPose } from '../character/animator';
import { bakeAttack, type AuthoredAttack, type BakeStats, type FrameTrace } from '../character/authoring';
import { AUTHORED_ATTACKS, GREATSWORD_VARIANT, SHIELD_VARIANT, SPEAR_VARIANT, STAFF_VARIANT, hasShieldVariant } from '../character/data/authored';
import { GS_CARRY, GS_IDLE } from '../character/data/greatsword';
import { SP_CARRY, SP_IDLE } from '../character/data/spear';
import { STAFF_CARRY, STAFF_IDLE } from '../character/data/staff';
import { SHIELD_CARRY, SHIELD_IDLE } from '../character/data/guard';
import type { WeaponId } from '../combat/data/loadouts';
import { HERO } from '../character/data/hero';
import { traverseDef, traverseName, type TraverseSpec } from '../character/data/traverse';
import { captureRig, type CapturedRig } from '../character/rig-capture';
import { BONE } from '../character/rig';
import { PostureTrim } from '../character/posture';
import { POSTURE_LEAN, POSTURE_SHARE, POSTURE_SPEED } from '../character/data/posture';
import { approach } from '../core/math';
import { buildSword } from './sword';
import { buildGreatsword } from './greatsword';
import { buildSpear } from './spear';
import { buildStaff } from './staff';
import { buildShield, shieldMount } from './shield';

/**
 * プレイヤーの見た目（GLB キャラ + 手付けクリップ + 剣・盾）。sim の状態（Player）を読んで、クリップの切替・発光・武器の表示を決める。
 * player.ts から分けた（見た目の部品が増えたため）。sim 側は Player、ここは描画フレームで進める。
 */

/** 武器の見た目の部品: メッシュと、刃の素材（溜めの光り方を変える）、剣筋の帯の根元寄り・先端（武器のローカル Y） */
interface WeaponView {
  group: THREE.Group;
  steel: ToonMaterial;
  baseIntensity: number;
  baseEmissive: THREE.Color;
  baseY: number;
  tipY: number;
  /** 光ったときの発光色（剣・大剣は金色、杖の宝珠は青白い魔力の色） */
  glowColor: THREE.Color;
}

/** 両手持ち（大剣）で、手付けの腕を持ち替える骨（走りは胴・脚だけ元の動きにして、腕は構えの姿勢で固定する） */
const ARM_BONES: ReadonlySet<string> = new Set([BONE.shoulderR, BONE.armR, BONE.foreR, BONE.handR, BONE.shoulderL, BONE.armL, BONE.foreL, BONE.handL]);

/** GLB キャラクターとアニメーションの見た目側 */
export class HeroVisual {
  readonly root: THREE.Group;
  private readonly animator: Animator;
  private seenSerial = -1;
  private seenHit = 0;
  private seenEquip = -1;
  /** 乗り上がり・乗り越えのあいだ、剣・盾を隠しているか（両手を自由に使う。M7-3） */
  private weaponsHidden = false;
  /** 空中で、上昇のクリップ（jump）を再生中か（false = 落下の fall）。上昇から落下へ切り替わる瞬間を検出する */
  private airRising = false;
  private seenGuardHit = 0;
  private seenParry = 0;
  /** ガードで受け止めた・パリィした瞬間の盾（剣）の閃光（1 → 0 に減衰。実時間） */
  private guardFlash = 0;
  /** 被弾のフラッシュ（0..1 で減衰。実時間で減らす） */
  private flash = 0;
  /** 発光に使うキャラのマテリアル（トゥーン）。発光色は黒（なし）から始まる */
  private readonly skinMats: ToonMaterial[];
  /** 武器（片手剣・大剣。どちらも右手のソケットに付け、装備しているほうだけ見せる） */
  private readonly weapons: Record<WeaponId, WeaponView>;
  private weapon: WeaponView;
  /** 盾（左前腕）。盾を装備しているときだけ見せる */
  private readonly shield: THREE.Group;
  private readonly shieldMat: ToonMaterial;
  /** 溜めの光（0..1。段階に向けて近づく）と、段階が上がった瞬間の閃光（1 → 0 に減衰） */
  private swordGlow = 0;
  private glowPulse = 0;
  /** 魔法を放った合図（Player.castSerial）を処理し終えた値 */
  private seenCast = 0;
  private seenChargeLevel = 0;
  /** 立ち姿の前傾補正（ADR-024）と、いまの傾き（度。状態に応じて出し入れする）。骨が見つからないときは補正なし */
  private readonly posture: PostureTrim | null;
  private lean = 0;
  /** 手付けアニメの元になったリグ情報と、焼いたときの統計（デバッグ・検証用） */
  readonly capture: CapturedRig;
  readonly authoredStats: Record<string, BakeStats> = {};
  readonly authoredTrace: Record<string, FrameTrace[]> = {};

  constructor(asset: CharacterAsset, traverseSpecs: readonly TraverseSpec[] = []) {
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
      handFrames: HERO.handFrames,
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
    // 大剣を持つとき: 待機は構えの息づかい（'idle@greatsword'）、走りは構えの腕のまま胴・脚だけ走りの動き（ロールは AUTHORED_ATTACKS の 'dodge@greatsword'）
    const gsIdle = bakeAttack(this.capture.rig, GS_IDLE, 60, this.capture.extras);
    this.animator.addClip(gsIdle.clip.name, gsIdle.clip);
    this.authoredStats[gsIdle.clip.name] = gsIdle.stats;
    this.authoredTrace[gsIdle.clip.name] = gsIdle.trace;
    const carry = this.animator.getClip(GS_CARRY.name);
    const run = this.animator.getClip(HERO.clips.run);
    if (carry && run) this.animator.addClip(HERO.clips.run + GREATSWORD_VARIANT, overlayPose(HERO.clips.run + GREATSWORD_VARIANT, run, carry, ARM_BONES, carry.duration));
    // 槍を持つとき（ADR-049）: 待機は構えの息づかい（'idle@spear'）、走りは担ぎの腕のまま胴・脚だけ走りの動き、ジャンプ・落下・着地も腕は担ぎのまま（ロールは 'dodge@spear'）
    const spIdle = bakeAttack(this.capture.rig, SP_IDLE, 60, this.capture.extras);
    this.animator.addClip(spIdle.clip.name, spIdle.clip);
    this.authoredStats[spIdle.clip.name] = spIdle.stats;
    this.authoredTrace[spIdle.clip.name] = spIdle.trace;
    const spCarry = this.animator.getClip(SP_CARRY.name);
    if (spCarry && run) this.animator.addClip(HERO.clips.run + SPEAR_VARIANT, overlayPose(HERO.clips.run + SPEAR_VARIANT, run, spCarry, ARM_BONES, spCarry.duration));
    if (spCarry) {
      for (const n of ['jump', 'fall', 'land']) {
        const base = this.animator.getClip(n);
        if (base) this.animator.addClip(n + SPEAR_VARIANT, overlayPose(n + SPEAR_VARIANT, base, spCarry, ARM_BONES, spCarry.duration));
      }
    }
    // 杖を持つとき（ADR-048）: 待機は杖を立てた構えの息づかい（'idle@staff'）、走りは杖を立てて持つ腕のまま胴・脚だけ走りの動き
    const staffIdle = bakeAttack(this.capture.rig, STAFF_IDLE, 60, this.capture.extras);
    this.animator.addClip(staffIdle.clip.name, staffIdle.clip);
    this.authoredStats[staffIdle.clip.name] = staffIdle.stats;
    this.authoredTrace[staffIdle.clip.name] = staffIdle.trace;
    const staffCarry = this.animator.getClip(STAFF_CARRY.name);
    if (staffCarry && run) this.animator.addClip(HERO.clips.run + STAFF_VARIANT, overlayPose(HERO.clips.run + STAFF_VARIANT, run, staffCarry, ARM_BONES, staffCarry.duration));
    // ジャンプ・落下・着地も、腕は杖を立てて持つまま（剣の握りのままだと、杖が体の横へ突き出る）
    if (staffCarry) {
      for (const n of ['jump', 'fall', 'land']) {
        const base = this.animator.getClip(n);
        if (base) this.animator.addClip(n + STAFF_VARIANT, overlayPose(n + STAFF_VARIANT, base, staffCarry, ARM_BONES, staffCarry.duration));
      }
    }
    // 乗り上がり・乗り越え（M7-3）: 世界の障害物の高さ・厚みの分を焼いておく（ほかの組み合わせは使うときに焼く）
    for (const spec of traverseSpecs) this.ensureTraverse(traverseName(spec), traverseDef(spec));
    // 武器: ボーン空間は cm（Armature 0.01 倍）なのでソケットを 100 倍にして m 単位の剣を置く。片手剣・大剣とも同じ右手のソケット（装備しているほうだけ見せる）
    const bone = asset.bones.get(HERO.sword.bone);
    const socket = new THREE.Group();
    socket.name = 'sword-socket';
    socket.position.fromArray(HERO.sword.position);
    socket.quaternion.fromArray(HERO.sword.quaternion);
    socket.scale.setScalar(100);
    const sword = this.makeWeapon(buildSword(), BLADE_RANGE.sword);
    const greatsword = this.makeWeapon(buildGreatsword(), BLADE_RANGE.greatsword);
    const spear = this.makeWeapon(buildSpear(), BLADE_RANGE.spear);
    const staff = this.makeWeapon(buildStaff(), BLADE_RANGE.staff, STAFF_GLOW_COLOR);
    socket.add(sword.group);
    socket.add(greatsword.group);
    socket.add(spear.group);
    socket.add(staff.group);
    this.weapons = { sword, greatsword, spear, staff };
    this.weapon = sword;
    greatsword.group.visible = false;
    spear.group.visible = false;
    staff.group.visible = false;
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

    this.posture = this.makePosture(asset);
    this.animator.play(HERO.clips.idle, { loop: true, fade: 0 });
  }

  private makePosture(asset: CharacterAsset): PostureTrim | null {
    const get = (name: string) => asset.bones.get(name);
    const b = { hips: get(BONE.hips), spine02: get(BONE.spine02), spine01: get(BONE.spine01), spine: get(BONE.spine), neck: get(BONE.neck), head: get(BONE.head), upLegL: get(BONE.upLegL), upLegR: get(BONE.upLegR) };
    if (!b.hips || !b.spine02 || !b.spine01 || !b.spine || !b.neck || !b.head || !b.upLegL || !b.upLegR) {
      console.warn('[hero] 姿勢の補正に使う骨がありません');
      return null;
    }
    return new PostureTrim({ hips: b.hips, spine02: b.spine02, spine01: b.spine01, spine: b.spine, neck: b.neck, head: b.head, upLegL: b.upLegL, upLegR: b.upLegR }, POSTURE_SHARE);
  }

  private makeWeapon(group: THREE.Group, range: { baseY: number; tipY: number }, glowColor: THREE.Color = CHARGE_COLOR): WeaponView {
    const steel = group.userData.steel as ToonMaterial;
    return { group, steel, baseIntensity: steel.emissiveIntensity, baseEmissive: steel.emissive.clone(), baseY: range.baseY, tipY: range.tipY, glowColor };
  }

  /** 刃（武器のローカル +Y が刃先方向）の根元寄りと先端の世界座標。アニメ更新直後の骨の位置から求める */
  getBladePoints(base: THREE.Vector3, tip: THREE.Vector3): boolean {
    const w = this.weapon;
    w.group.updateWorldMatrix(true, false);
    base.set(0, w.baseY, 0);
    tip.set(0, w.tipY, 0);
    w.group.localToWorld(base);
    w.group.localToWorld(tip);
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
    } else if (p.state === 'attack' && p.loadout.weapon === 'staff') {
      // 杖（ADR-048）: 詠唱のあいだ宝珠が光を溜め、魔法を放った瞬間に閃く。放出（火炎放射）のあいだは強く光ったまま、放ったあとは薄れていく
      target = p.casting ? 1 : p.channeling ? 0.9 : 0.35;
    } else if (p.state === 'attack' && p.attackPower > 1) {
      target = Math.min(1, (p.attackPower - 1) / 0.6);
    }
    if (p.castSerial !== this.seenCast) {
      this.seenCast = p.castSerial;
      this.glowPulse = 1;
    }
    this.seenChargeLevel = p.state === 'charge' ? p.chargeLevel : 0;
    // 立ち上がりは速く（構えに入ってすぐ光り始める）、消えるのはゆっくり
    this.swordGlow = approach(this.swordGlow, target, frameDt / (target > this.swordGlow ? 0.15 : 0.45));
    this.glowPulse = Math.max(0, this.glowPulse - frameDt / 0.16);
    const k = Math.min(1, this.swordGlow + this.glowPulse * 0.5);
    const w = this.weapon;
    w.steel.emissive.copy(w.baseEmissive).lerp(w.glowColor, k);
    w.steel.emissiveIntensity = w.baseIntensity + 1.8 * k;
  }

  update(p: Player, dt: number, frameDt: number): void {
    if (p.equipSerial !== this.seenEquip) {
      this.seenEquip = p.equipSerial;
      this.weapon = this.weapons[p.loadout.weapon];
      this.syncWeapons(p);
      // 装備を替えたのは待機か走りのあいだ（Player.equip）。その状態のクリップを装備の版（盾・大剣の待機や走り）で選び直す
      this.onStateEnter(p);
    }
    if (p.stateSerial !== this.seenSerial) {
      this.seenSerial = p.stateSerial;
      this.onStateEnter(p);
    }
    // 乗り上がり・乗り越えのあいだは剣・盾を隠す（手付けのクリップは両手を自由に使うため）
    if ((p.state === 'traverse') !== this.weaponsHidden) {
      this.weaponsHidden = p.state === 'traverse';
      this.syncWeapons(p);
    }
    this.onGuardEvents(p);
    this.updateGlow(p, frameDt);
    if (p.state === 'run') {
      const rate = Math.max(HERO.runRateMin, p.speed / HERO.runCycleSpeed);
      this.animator.setRate(rate);
    }
    // 空中: 上昇（跳び上がりの姿勢）から落下（足を伸ばす姿勢）への切り替え。頂点で速度が下向きに変わる瞬間
    if (p.state === 'air' && p.rising !== this.airRising) this.playAir(p);
    // ミキサーが骨へ書き直さない値の上に補正が重ならないよう、更新の前に戻して、更新のあとにかけ直す
    this.posture?.release();
    this.animator.update(dt);
    if (this.posture) {
      const target = POSTURE_LEAN[p.loadout.weapon][p.state];
      this.lean = approach(this.lean, target, frameDt * (target > this.lean ? POSTURE_SPEED.toward : POSTURE_SPEED.away));
      this.posture.apply(this.lean);
    }
  }

  /** 乗り上がり・乗り越えのクリップを焼いて登録する（同じ名前なら何もしない）。武器を隠して両手を自由に使うので、武器の版は無い */
  private ensureTraverse(name: string, def: AuthoredAttack): void {
    if (this.animator.has(name)) return;
    const baked = bakeAttack(this.capture.rig, def, 60, this.capture.extras);
    this.animator.addClip(name, baked.clip);
    this.authoredStats[name] = baked.stats;
    this.authoredTrace[name] = baked.trace;
  }

  /** 装備している剣・盾を見せる（乗り上がり・乗り越えのあいだは隠す） */
  private syncWeapons(p: Player): void {
    this.shield.visible = !this.weaponsHidden && p.loadout.offhand === 'shield';
    for (const [id, w] of Object.entries(this.weapons)) w.group.visible = !this.weaponsHidden && id === p.loadout.weapon;
  }

  /** 手付けクリップの名前（盾を持つときは、左腕を盾の位置に固定して焼き直した版があればそれ） */
  private clipName(base: string, p: Player): string {
    const v = base + p.loadout.clipVariant;
    return p.loadout.clipVariant !== '' && this.animator.has(v) ? v : base;
  }

  /** 空中のクリップ: 上昇中（踏み切りの沈みを含む）は jump、落下は fall。どちらも終端の姿勢で止まる */
  private playAir(p: Player): void {
    this.airRising = p.rising;
    this.animator.play(this.clipName(this.airRising ? 'jump' : 'fall', p), { loop: false, fade: this.airRising ? 0.05 : 0.1, rate: 1, clamp: true, restart: true });
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
        this.animator.play(this.clipName(HERO.clips.run, p), { loop: true, fade: 0.15 });
        break;
      case 'attack': {
        const a = p.attack!;
        this.animator.play(this.clipName(a.segment, p), { loop: false, fade: a.fade ?? 0.08, rate: a.rate, clamp: true, restart: true });
        break;
      }
      case 'dodge':
        this.animator.play(this.clipName(p.dodgeKind === 'back' ? 'dodgeBack' : 'dodge', p), { loop: false, fade: 0.06, rate: 1, clamp: true, restart: true });
        break;
      case 'air':
        this.playAir(p);
        break;
      case 'land':
        // 着地: 足が着いて膝と腰を沈め、立ち上がる（硬直のあと idle / run へつなぐ）
        this.animator.play(this.clipName('land', p), { loop: false, fade: 0.03, rate: 1, clamp: true, restart: true });
        break;
      case 'traverse': {
        // 乗り上がり・乗り越え: 高さ・前進量ごとのクリップ。初めて使う仕様のときに焼く（同じ仕様は使い回す）
        const c = p.traverseClip;
        if (c) {
          this.ensureTraverse(c.name, c.def);
          this.animator.play(c.name, { loop: false, fade: 0.05, rate: 1, clamp: true, restart: true });
        }
        break;
      }
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

/** 剣筋の帯の根元寄りと先端（武器のローカル Y。刃は片手剣が y = 0.1〜1.16、大剣が 0.16〜1.62） */
const BLADE_RANGE: Record<WeaponId, { baseY: number; tipY: number }> = {
  sword: { baseY: 0.3, tipY: 1.17 },
  greatsword: { baseY: 0.5, tipY: 1.62 },
  // 槍: 柄の中ほどから穂先まで（突きは細い線、薙ぎ払いは柄ごと大きな帯になる）
  spear: { baseY: 0.9, tipY: 1.85 },
  // 杖は剣筋を出さない（詠唱は当たりを持たない）。帯の位置は宝珠の付近（念のため）
  staff: { baseY: 0.9, tipY: 1.3 },
};

/** パリィの受付中の盾の光（水色）と、受け止めた・弾いた瞬間の閃光（暖色） */
const PARRY_COLOR = new THREE.Color(0.3, 0.8, 1);
const GUARD_FLASH_COLOR = new THREE.Color(1, 0.85, 0.5);
const _flash = new THREE.Color();

/** 溜めの段階ごとの刃の光（0..1）と、最大のときの発光色（金色） */
const CHARGE_GLOW = [0.35, 0.7, 1] as const;
const CHARGE_COLOR = new THREE.Color(0xffc24a);
/** 杖の宝珠の発光（詠唱のあいだ光る。青白い魔力の色） */
const STAFF_GLOW_COLOR = new THREE.Color(0x9fe6ff);
