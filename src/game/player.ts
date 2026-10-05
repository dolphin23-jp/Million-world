import * as THREE from 'three';
import type { InputIntent } from '../input/intent';
import { ATTACKS, CHARGES, DODGES, DODGE_RULES, HIT_STUN, MOVE, PLAYER_STATS, resolveAttack, rootMotionOf, type AttackDef, type AttackFrames, type ChargeDef, type DodgeKind, type ResolvedWindow } from '../combat/data/attacks';
import { findAttack } from '../combat/data/skill-attacks';
import { DEFAULT_LOADOUT, LOADOUTS, type LoadoutDef, type LoadoutId } from '../combat/data/loadouts';
import { PARRY_EFFECTS, type GuardDef, type ParryEffectDef } from '../combat/data/guard';
import { guardOutcome as resolveGuardOutcome, guardedDamage, type GuardOutcome } from '../combat/guard';
import { afterDodgeOf, classifyStick, pickAttack, pickChargeRelease, pickFollowUp, type AfterDodge, type StickDir } from '../combat/moveset';
import { applyDamage, createHealth, type DamageResult } from '../combat/health';
import { BASE_MODIFIERS, type Modifiers } from '../combat/modifiers';
import { JUMP } from '../combat/data/jump';
import { AIR_STEP_UP, STEP_UP, openWorld, type World } from '../world/world';
import { HitTracker, isActiveFrame, type HitEvent, type Hurtbox } from '../combat/hit';
import { Knockback } from '../combat/knockback';
import type { SkillRun } from '../combat/skills';
import type { SkillId } from '../combat/data/skills';
import { angleDelta, approach, lerp, lerpAngle, rotateTowards } from '../core/math';
import { PLAYER_ID } from './combat';
import type { CharacterAsset } from '../character/loader';
import { HERO } from '../character/data/hero';
import { HeroVisual } from './hero-visual';

/**
 * プレイヤー。sim 側の状態（位置・向き・行動状態・フレーム）と、render 側の見た目（GLB + アニメ）を分離する。
 * 見た目は補間係数 alpha で sim ステップ間を滑らかにし、状態の変化を見てクリップを切り替える。
 */

export type PlayerState = 'idle' | 'run' | 'attack' | 'charge' | 'guard' | 'dodge' | 'hit' | 'dead' | 'air' | 'land';

/** 世界を渡されなかったとき（単体テスト）の、障害物の無い平らな世界 */
const FLAT_WORLD: World = openWorld(1e6);

/** スーパーアーマーが攻撃を耐えたあとの短い無敵（フレーム）。続けて当たって一気に削られないようにする */
const ARMOR_INVULN_FRAMES = 24;

/** ガードを押してから、構えに入れる状況になるまで待てるフレーム（先行入力。攻撃の硬直中などに押しても構えられる） */
const GUARD_BUFFER_FRAMES = 12;

/** 連携の履歴（Player.chain）に残す技の数 */
const MAX_CHAIN = 6;
/** 構えているあいだの向き直りの速さ（走るときの旋回速度に対する倍率） */
const GUARD_TURN_SCALE = 0.6;

export class Player {
  // ---- sim 状態 ----
  /** 当たり判定。被弾側のハートボックスを兼ねる（円 + id + 無敵）。invulnerable は refreshHurtbox() で更新する */
  readonly body: Hurtbox = { id: PLAYER_ID, x: 0, z: 0, r: MOVE.radius, invulnerable: false };
  readonly health = createHealth(PLAYER_STATS.maxHp);
  /**
   * 効果の集計（成長のステータス・将来のパッシブや装備。ADR-033）。戦闘の数値はここから読む。Game が成長が変わるたびに setModifiers で渡す
   * （最大体力・移動・攻撃の速さ・無敵・パリィの受付・受けるダメージ・ダメージとノックバックの倍率）
   */
  mods: Readonly<Modifiers> = BASE_MODIFIERS;
  yaw = 0;
  velX = 0;
  velZ = 0;
  /**
   * 縦の動き（M7-2。ADR-040）: 足の高さ y（m。地面 = 0。障害物の上に乗ると上面の高さ）・縦の速さ velY（上向きが正）・足場に立っているか。
   * 重力と足場の判定は、状態（攻撃・回避・ひるみ…）に関わらず毎ステップ進む（縁から出れば落ちる）。ジャンプを始められるのは立っている・走っているとき
   */
  y = 0;
  velY = 0;
  grounded = true;
  /** 世界（障害物・足場の高さ）。Game が渡す。渡さなければ障害物の無い平らな世界 */
  world: World = FLAT_WORLD;
  state: PlayerState = 'idle';
  stateFrame = 0;
  attack: AttackDef | null = null;
  attackFrames: AttackFrames | null = null;
  /** この攻撃で当てた対象の記録（1 攻撃 1 対象 1 回。多段の技は窓の組ごと）。攻撃を始めるたび・窓の組が変わるたびにリセットする */
  readonly hitTracker = new HitTracker();
  /** 多段ヒットの技（AttackDef.windows）で、いま当たりが出ている窓の番号（-1 = 出ていない）と、記録をリセットした窓の組。step() の終わりに更新する */
  private winIdx = -1;
  /** 多段ヒットの技で、2 つ目以降の窓の組が開くたびに増える（Game が振りの音を鳴らす。最初の窓の音は攻撃の開始で鳴らす） */
  swingSerial = 0;
  private winGroup = -1;
  /** スーパーアーマーが攻撃を耐えたたびに増える（Game が演出を出すのに読む） */
  armorSerial = 0;
  /** 被弾の記録。hitSerial は被弾のたびに増える（見た目側が被弾を検出するため） */
  hitSerial = 0;
  lastHit: HitEvent | null = null;
  private readonly knockback = new Knockback();
  /** 被弾後の無敵の残りフレーム */
  private hurtInvuln = 0;
  /** ミスティカルドッジの間か（Game が setMystical で設定する）。true の間は無敵 */
  private mystical = false;
  /**
   * 剣技（ADR-031）。requestSkill で頼まれた連なり（1 ステップだけ有効 = step の終わりで捨てる。始められたかは skillSerial の増加で分かる）、
   * 実行中の連なりと進み具合、始めたたびに増える合図と直近のスキル（Game が演出・クールダウンを起こすのに読む）
   */
  private pendingSkill: SkillRun | null = null;
  private skillRun: { run: SkillRun; i: number } | null = null;
  skillSerial = 0;
  lastSkill: SkillId | null = null;
  private attackBuffered = false;
  /** 直近の sim ステップでのスティックの向き（対象に対して。ロックなしは倒していれば前）。操作ガイドが読む（ADR-024） */
  stickDir: StickDir = 'none';
  /** 連携の履歴（技の id。古い → 新しい）。次段の受付から続けた技は足し、そうでなければ始めた技だけになる。操作ガイドが読む */
  chain: string[] = [];
  /** いまの攻撃の威力の倍率（溜めの段階で上がる。ダメージ・ノックバック・ヒットストップに掛かる。src/game/combat.ts） */
  attackPower = 1;
  /** 溜め（攻撃の長押し）の構え。charge 状態のときだけ非 null。chargeLevel は構えが整ってからの保持で上がる段階（0, 1, 2）*/
  charge: ChargeDef | null = null;
  chargeLevel = 0;
  /** 攻撃ボタンを今のステップで押しているか、いまの攻撃を始めてからずっと押し続けているか（長押しの判定） */
  private heldNow = false;
  /** 溜めの構えに入ってから、攻撃ボタンを離したか（構えが整う前に離しても、整うまで待って放つため） */
  private chargeReleased = false;
  private heldSinceBegin = false;
  /** 装備（ADR-020）。技のセット・溜め・ガード・走る速さ・クリップの版が決まる。equip() で替える（素手が標準） */
  loadout: LoadoutDef = LOADOUTS[DEFAULT_LOADOUT];
  /** 装備を替えるたびに増える（見た目側が盾の表示を切り替えるため） */
  equipSerial = 0;
  /** 構えているあいだ（guard 状態）の防御の定義。guard 状態のときだけ非 null */
  guard: GuardDef | null = null;
  /** ガードで受け止めた直後の硬直の残り（そのあいだは構えを解けず、攻撃・回避もできない） */
  guardStun = 0;
  /** ガードで受け止めた・パリィしたたびに増える（見た目・効果音が検出するため）と、直近のその攻撃 */
  guardHitSerial = 0;
  parrySerial = 0;
  lastGuardHit: HitEvent | null = null;
  /** ガードを押した先行入力の残りフレームと、構えを解いたあと次に構えられるまでの残り */
  private guardBuffer = 0;
  private guardLock = 0;
  /** いまの（または直近の）回避の種類。見た目が読むのでクリップを選べる */
  dodgeKind: DodgeKind = 'roll';
  /** 直近の回避が終わってからの経過フレーム（回避直後の攻撃 = ダッシュ斬りの判定。回避中は 0） */
  private framesSinceDodge = 9999;
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
  /** 剣が地面を叩いた瞬間（AttackDef.impact）のたびに増える。位置（XZ）と強さは lastImpact（Game が演出を出すのに読む） */
  impactSerial = 0;
  readonly lastImpact = { x: 0, z: 0, power: 0 };

  // 補間用の前ステップ
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;
  private prevYaw = 0;

  /** ジャンプの先行入力・縁の猶予・踏み切りの沈みの残りフレーム（JUMP）*/
  private jumpBuffer = 0;
  private coyote = 0;
  private jumpDelay = 0;
  /** 跳んだたび・着地したたびに増える（Game が音・砂ぼこりを出すのに読む）。着地の落下の速さ（m/s）は lastLandSpeed */
  jumpSerial = 0;
  landSerial = 0;
  lastLandSpeed = 0;

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
    this.prevY = this.y;
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

    this.stickDir = classifyStick(mLen, Math.atan2(mx, mz), this.aimYaw() ?? this.yaw, this.hasAim);
    if (intent.attackPressed) this.attackBuffered = true;
    this.heldNow = intent.attackHeld;
    if (this.state !== 'dodge' && this.framesSinceDodge < 9999) this.framesSinceDodge++;
    // ガードの先行入力（押した瞬間から GUARD_BUFFER_FRAMES のあいだ、構えに入れる状況になれば構える）と、構え直しの待ち
    if (intent.guardPressed) this.guardBuffer = GUARD_BUFFER_FRAMES;
    else if (this.guardBuffer > 0) this.guardBuffer--;
    if (this.guardLock > 0) this.guardLock--;
    // ジャンプの先行入力（押した瞬間から JUMP.jumpBuffer フレーム）と、縁の猶予（足場から離れているあいだだけ減る）
    if (intent.jumpPressed) this.jumpBuffer = JUMP.jumpBuffer;
    else if (this.jumpBuffer > 0) this.jumpBuffer--;
    if (!this.grounded && this.coyote > 0) this.coyote--;

    switch (this.state) {
      case 'idle':
      case 'run':
        if (!this.grounded) {
          // 足場の縁から歩いて出た（落ちる）。ひるみ・回避などのあとに足場が無くなっていた場合もここ
          this.setState('air');
          this.stepAir(dt, mx, mz, mLen);
          break;
        }
        this.stepLocomotion(dt, mx, mz, mLen);
        if (intent.dodgePressed) {
          this.beginDodge(mx, mz, mLen);
        } else if (this.jumpBuffer > 0) {
          this.beginJump();
        } else if (this.pendingSkill) {
          this.beginSkill(this.pendingSkill, mx, mz, mLen);
        } else if (this.canGuard()) {
          this.beginGuard();
        } else if (this.attackBuffered) {
          this.beginAttackFromInput(mx, mz, mLen);
        }
        break;
      case 'attack':
        this.stepAttack(dt, mx, mz, mLen, intent);
        break;
      case 'charge':
        this.stepCharge(dt, mx, mz, mLen, intent);
        break;
      case 'guard':
        this.stepGuard(dt, mx, mz, mLen, intent);
        break;
      case 'dodge':
        this.stepDodge(dt, mx, mz, mLen, intent);
        break;
      case 'air':
        this.stepAir(dt, mx, mz, mLen);
        break;
      case 'land':
        this.stepLand(dt, mx, mz, mLen, intent);
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
    // 障害物の外へ押し出して（足の高さで、止める障害物と乗れる段差が決まる）、足場に立つ・落ちる。押し出された先でまた別の障害物に重なるなら Game がもう一度押し出す
    this.world.moveCircle(this.body, this.y, this.grounded ? STEP_UP : AIR_STEP_UP);
    this.stepVertical(dt);
    this.speed = Math.hypot(this.velX, this.velZ);
    this.stateFrame++;
    if (this.hurtInvuln > 0) this.hurtInvuln--;
    this.pendingSkill = null;
    this.updateWindow();
    this.refreshHurtbox();
  }

  /**
   * 多段ヒットの技の窓を、いまの stateFrame（描画されている姿勢の時刻）に合わせる。窓の組が変わったら「当てた記録」を消す
   * （次の窓では同じ敵にもう一度当たる）。窓の無い攻撃・攻撃していないときは -1
   */
  private updateWindow(): void {
    const fr = this.attackFrames;
    this.winIdx = -1;
    if (this.state !== 'attack' || !fr || fr.windows.length === 0) return;
    for (let i = 0; i < fr.windows.length; i++) {
      const w = fr.windows[i]!;
      if (this.stateFrame >= w.start && this.stateFrame < w.end) {
        this.winIdx = i;
        if (w.group !== this.winGroup) {
          if (this.winGroup !== -1) this.swingSerial++;
          this.winGroup = w.group;
          this.hitTracker.reset();
        }
        return;
      }
    }
  }

  /** いま当たりが出ている窓（多段ヒットの技）。窓の無い攻撃・窓のあいだは null。resolvePlayerAttack・cutProjectiles が読む */
  get hitWindow(): ResolvedWindow | null {
    const fr = this.attackFrames;
    return this.winIdx >= 0 && fr ? (fr.windows[this.winIdx] ?? null) : null;
  }

  /**
   * 剣技を頼む（ADR-031）。次の step() で、始められる状態（立っている・走っている・攻撃 / 回避の次段の受付）なら始まる。
   * 始まったかは skillSerial が増えたかで分かる（始められない状態では何も起こらず、頼みは次の step の終わりで捨てる）
   */
  requestSkill(run: SkillRun): void {
    this.pendingSkill = run;
  }

  /**
   * 敵の攻撃を受ける。ダメージを適用し、攻撃・回避を中断してひるみ（HP が 0 なら死亡）に入り、ノックバックを受ける。
   * 無敵（回避の無敵フレーム・被弾後の無敵・死亡）の間は呼ばれない想定（body.invulnerable で当たり判定が除外する）
   */
  takeHit(ev: HitEvent): DamageResult {
    const r = applyDamage(this.health, this.takenDamage(ev.damage));
    this.hitSerial++;
    this.lastHit = ev;
    // スーパーアーマー（剣技の一部。AttackDef.armor）: 割れない重さの攻撃は、ダメージは受けるが、ひるまず・飛ばされず、攻撃を続ける（短い無敵はつく）
    if (!r.killed && this.armoredAgainst(ev.damage)) {
      this.armorSerial++;
      this.hurtInvuln = ARMOR_INVULN_FRAMES;
      this.refreshHurtbox();
      return r;
    }
    this.attack = null;
    this.attackFrames = null;
    this.attackBuffered = false;
    this.skillRun = null;
    this.charge = null;
    this.chargeLevel = 0;
    this.guard = null;
    this.guardStun = 0;
    this.guardBuffer = 0;
    this.hurtInvuln = HIT_STUN.invulnFrames;
    this.jumpDelay = 0;
    this.velX = 0;
    this.velZ = 0;
    // 攻撃してきた側を向いて受ける（ひるみのアニメは正面から受けた姿）
    this.yaw = Math.atan2(-ev.dirX, -ev.dirZ);
    this.knockback.start(ev.dirX, ev.dirZ, ev.knockback, HIT_STUN.knockbackFrames);
    this.setState(r.killed ? 'dead' : 'hit', true);
    this.refreshHurtbox();
    return r;
  }

  /**
   * 効果の集計を入れ替える。最大体力が変わったら、増えた分だけ体力も増やす（減ったら、最大を超えないように切る）。
   * 戦闘中（一時停止メニューからの振り分け）でも安全に呼べる
   */
  setModifiers(m: Readonly<Modifiers>): void {
    this.mods = m;
    const max = PLAYER_STATS.maxHp + m.maxHp;
    const delta = max - this.health.max;
    this.health.max = max;
    if (this.state !== 'dead') this.health.hp = Math.min(max, Math.max(1, this.health.hp + Math.max(0, delta)));
  }

  /**
   * 闘気（敵を倒したあとの一時的な攻撃力の加算。パッシブ。KillBuff.bonus。ADR-037）。Game が毎 sim ステップ入れる（0 = なし）。
   * ダメージの倍率（damageMul）に足される
   */
  buffBonus = 0;

  /** 攻撃のダメージ・ノックバックの倍率（STR・パッシブ・闘気。AttackerView）。resolvePlayerAttack が読む */
  get damageMul(): number {
    return this.mods.damage + this.buffBonus;
  }

  /** 連携・剣技の 3 発目以降のとき、そのダメージの倍率（パッシブの連撃の心得。連携の履歴 chain が 3 つ以上のとき。それ以外は 1）。AttackerView */
  get comboMul(): number {
    return this.chain.length >= 3 ? this.mods.comboDamage : 1;
  }

  /** 反撃（弾かれた敵・体勢を崩した敵への攻撃）のダメージの倍率（パッシブの追い打ち）。AttackerView */
  get riposteMul(): number {
    return this.mods.riposteDamage;
  }

  get knockbackMul(): number {
    return this.mods.knockback;
  }

  /** 会心率・会心ダメージの倍率（DEX・パッシブ。AttackerView）。resolvePlayerAttack が命中ごとに抽選する */
  get critRate(): number {
    return this.mods.critRate;
  }

  get critDamage(): number {
    return this.mods.critDamage;
  }

  /** 受けるダメージ（VIT による軽減。ダメージのある攻撃は最低 1 は通る） */
  private takenDamage(damage: number): number {
    if (damage <= 0) return 0;
    return Math.max(1, Math.round(damage * this.mods.damageTaken));
  }

  /** いまスーパーアーマーが効いていて、damage の攻撃では割れないか */
  private armoredAgainst(damage: number): boolean {
    const fr = this.attackFrames;
    const ar = fr?.armor;
    if (this.state !== 'attack' || !ar) return false;
    return this.stateFrame >= ar.from && this.stateFrame < ar.to && damage < ar.breakDamage;
  }

  /** スーパーアーマーが効いている最中か（見た目の光に使う） */
  get armored(): boolean {
    const fr = this.attackFrames;
    const ar = fr?.armor;
    return this.state === 'attack' && !!ar && this.stateFrame >= ar.from && this.stateFrame < ar.to;
  }

  /** ロックオンの照準があるか（横・後ろの入力が使える。操作ガイドが読む） */
  get locked(): boolean {
    return this.hasAim;
  }

  /** 回避の直後か（立っているとき）。回避中は、その回避の種類（回避中に押した攻撃もダッシュになる）。操作ガイドが読む */
  get afterDodge(): AfterDodge {
    return this.state === 'dodge' ? this.dodgeKind : afterDodgeOf(this.framesSinceDodge, this.dodgeKind);
  }

  /** 続きの攻撃を先に押してある（次段の受付が開いた瞬間に出る）。操作ガイドが読む */
  get attackQueued(): boolean {
    return this.attackBuffered;
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
    this.charge = null;
    this.chargeLevel = 0;
    this.guard = null;
    this.guardStun = 0;
    this.guardBuffer = 0;
    this.guardLock = 0;
    this.attackPower = 1;
    this.framesSinceDodge = 9999;
    this.hurtInvuln = 0;
    this.mystical = false;
    this.skillRun = null;
    this.pendingSkill = null;
    this.knockback.cancel();
    this.velX = 0;
    this.velZ = 0;
    this.y = this.prevY = 0;
    this.velY = 0;
    this.grounded = true;
    this.jumpBuffer = this.coyote = this.jumpDelay = 0;
    this.body.x = this.prevX = 0;
    this.body.z = this.prevZ = 0;
    this.yaw = this.prevYaw = 0;
    this.setState('idle', true);
    this.refreshHurtbox();
  }

  private refreshHurtbox(): void {
    this.body.invulnerable = this.invulnerable;
  }

  /** 走る・止まる。speedScale は着地の硬直中の移動の遅さ。changeState = false なら、状態（idle / run）は切り替えない（着地の硬直中） */
  private stepLocomotion(dt: number, mx: number, mz: number, mLen: number, speedScale = 1, changeState = true): void {
    if (mLen > 0.01) {
      const targetYaw = Math.atan2(mx, mz);
      this.yaw = rotateTowards(this.yaw, targetYaw, MOVE.turnSpeed * dt);
      const speed = MOVE.runSpeed * this.loadout.runSpeedScale * this.mods.moveSpeed * speedScale;
      this.velX = approach(this.velX, mx * speed, MOVE.accel * dt);
      this.velZ = approach(this.velZ, mz * speed, MOVE.accel * dt);
      if (changeState) this.setState('run');
    } else {
      this.velX = approach(this.velX, 0, MOVE.decel * dt);
      this.velZ = approach(this.velZ, 0, MOVE.decel * dt);
      // 立ち止まっているときは対象の方を向く
      if (this.hasAim) this.yaw = rotateTowards(this.yaw, Math.atan2(this.aimX - this.body.x, this.aimZ - this.body.z), MOVE.turnSpeed * dt);
      if (Math.hypot(this.velX, this.velZ) < 0.05) {
        this.velX = 0;
        this.velZ = 0;
        if (changeState) this.setState('idle');
      }
    }
  }

  // ======================= 縦の動き（ジャンプ・落下・着地。M7-2） =======================

  /** 跳ぶ（踏み切りの沈みに入る）。沈みが終わると launch。走っている勢いはそのまま保つ */
  private beginJump(): void {
    this.jumpBuffer = 0;
    this.jumpDelay = JUMP.squatFrames;
    this.setState('air', true);
    // 沈みなし（0 フレーム）の設定なら、すぐ跳ぶ
    if (this.jumpDelay === 0) this.launch();
  }

  private launch(): void {
    this.velY = JUMP.speed;
    this.grounded = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpSerial++;
  }

  /**
   * 空中（踏み切りの沈みを含む）。沈みのあいだは地面に付いたまま。跳んだあとは勢いを保ち、スティックで少し曲げられる（上限は走る速さ）。
   * 足場の縁から歩いて落ちた直後（縁の猶予 JUMP.coyote）なら、ジャンプを押して跳べる
   */
  private stepAir(dt: number, mx: number, mz: number, mLen: number): void {
    if (this.jumpDelay > 0) {
      if (--this.jumpDelay === 0) this.launch();
      return;
    }
    if (this.jumpBuffer > 0 && this.coyote > 0) this.launch();
    if (mLen > 0.01) {
      const speed = MOVE.runSpeed * this.loadout.runSpeedScale * this.mods.moveSpeed;
      this.yaw = rotateTowards(this.yaw, Math.atan2(mx, mz), MOVE.turnSpeed * JUMP.airTurnScale * dt);
      this.velX = approach(this.velX, mx * speed, JUMP.airAccel * dt);
      this.velZ = approach(this.velZ, mz * speed, JUMP.airAccel * dt);
    } else {
      this.velX = approach(this.velX, 0, JUMP.airDrag * dt);
      this.velZ = approach(this.velZ, 0, JUMP.airDrag * dt);
    }
  }

  /**
   * 着地の硬直: ゆっくりなら動ける。cancelFrame から攻撃・回避・ガード・剣技で、jumpFrame から再びジャンプで、硬直を切り上げられる。
   * 空中で押した攻撃・ガード・ジャンプの先行入力は、ここで出る
   */
  private stepLand(dt: number, mx: number, mz: number, mLen: number, intent: InputIntent): void {
    const f = this.stateFrame;
    const l = JUMP.land;
    this.stepLocomotion(dt, mx, mz, mLen, l.moveScale, false);
    if (!this.grounded) {
      // 着地の硬直のうちに足場の縁から出た（落ちる）
      this.setState('air');
      return;
    }
    if (f >= l.cancelFrame) {
      if (intent.dodgePressed) {
        this.beginDodge(mx, mz, mLen);
        return;
      }
      if (this.pendingSkill) {
        this.beginSkill(this.pendingSkill, mx, mz, mLen);
        return;
      }
      if (this.canGuard()) {
        this.beginGuard();
        return;
      }
      if (this.attackBuffered) {
        this.beginAttackFromInput(mx, mz, mLen);
        return;
      }
    }
    if (this.jumpBuffer > 0 && f >= l.jumpFrame) {
      this.beginJump();
      return;
    }
    if (f >= l.frames) this.setState(mLen > 0.01 ? 'run' : 'idle');
  }

  /**
   * 足場・重力（状態に関わらず毎ステップ）。立っているあいだは足場の高さへ吸い付く（STEP_UP までの段差は乗る・降りる。それ以上の落差は落ちる）。
   * 宙にいるあいだは重力で落ち、足場に当たったら着地する（上昇中は着地しない = 跳び上がって縁を越えられる）。
   */
  private stepVertical(dt: number): void {
    const w = this.world;
    if (this.grounded) {
      const ground = w.groundHeight(this.body.x, this.body.z, this.y, STEP_UP);
      if (this.y - ground <= STEP_UP) {
        this.y = ground;
        this.velY = 0;
        return;
      }
      // 足場の縁から出て、段差より深く落ちる
      this.grounded = false;
      this.velY = 0;
      this.coyote = JUMP.coyote;
    }
    const ground = w.groundHeight(this.body.x, this.body.z, this.y, AIR_STEP_UP);
    this.velY = Math.max(-JUMP.maxFallSpeed, this.velY - JUMP.gravity * dt);
    const ny = this.y + this.velY * dt;
    if (this.velY <= 0 && ny <= ground) {
      this.lastLandSpeed = -this.velY;
      this.y = ground;
      this.velY = 0;
      this.grounded = true;
      this.coyote = 0;
      this.landSerial++;
      if (this.state === 'air') this.setState('land', true);
    } else {
      this.y = ny;
    }
  }

  /** 体を押し出すときに使う、足元の段差の許容（立っているときは STEP_UP、宙にいるときは AIR_STEP_UP）。Game の最後の押し出しが使う */
  get stepUp(): number {
    return this.grounded ? STEP_UP : AIR_STEP_UP;
  }

  /** 上昇中か（跳び上がる・踏み切りの沈み。見た目が上昇と落下で姿勢を替えるのに読む） */
  get rising(): boolean {
    return this.state === 'air' && (this.velY > 0 || this.jumpDelay > 0);
  }

  /**
   * 攻撃ボタンの押下から技を選んで始める（ADR-018）。スティック（ロック中は対象に対しての向き）と、直前の回避（ダッシュ）で決まる。
   * コンボの 2 段目以降（AttackDef.next）と、溜めの放ち（重撃）はここを通らない
   */
  private beginAttackFromInput(mx: number, mz: number, mLen: number): void {
    const ref = this.aimYaw() ?? this.yaw;
    const stick = classifyStick(mLen, Math.atan2(mx, mz), ref, this.hasAim);
    const afterDodge = afterDodgeOf(this.framesSinceDodge, this.dodgeKind);
    this.beginAttack(ATTACKS[pickAttack(this.loadout.moveset, { stick, afterDodge })]!, mx, mz, mLen);
  }

  /** 照準（ロック対象）の方の yaw。照準がない、またはほぼ重なっていれば null */
  private aimYaw(): number | null {
    if (!this.hasAim) return null;
    const dx = this.aimX - this.body.x;
    const dz = this.aimZ - this.body.z;
    return Math.hypot(dx, dz) > 0.05 ? Math.atan2(dx, dz) : null;
  }

  private beginAttack(def: AttackDef, mx: number, mz: number, mLen: number, power = 1, continuing = false): void {
    this.attackBuffered = false;
    // 剣技の連なりは、剣技として始めた攻撃（beginSkill・連なりの次段）だけが持つ。ふつうの攻撃を始めたら連なりは終わり
    this.skillRun = null;
    // 連携の履歴: 次段の受付から続けた技は足す（長さは MAX_CHAIN まで）。そうでなければ、この技だけから始める
    if (continuing) {
      this.chain.push(def.id);
      if (this.chain.length > MAX_CHAIN) this.chain.shift();
    } else {
      this.chain.length = 0;
      this.chain.push(def.id);
    }
    // 攻撃の速さ（DEX）: 倍率が 1 でなければ、rate を掛けた写しを使う（攻撃を始めるたびに 1 つだけ作る。フレーム・アニメ・ルートの進みが同じ rate に従う）
    const speed = this.mods.attackSpeed;
    this.attack = speed === 1 ? def : { ...def, rate: def.rate * speed };
    this.attackFrames = resolveAttack(this.attack);
    this.attackPower = power;
    this.winIdx = -1;
    this.winGroup = -1;
    // 長押しの判定: この攻撃を始めたときに押していて、そこから離していなければ、1 段目の途中で溜めへ移る
    this.heldSinceBegin = this.heldNow;
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

  /** 剣技を始める（連なりの 1 段目）。以降の段は stepAttack が受付のたびに自動で続ける。始めたことを skillSerial / lastSkill で知らせる */
  private beginSkill(run: SkillRun, mx: number, mz: number, mLen: number): void {
    const first = run.steps[0]!;
    this.beginAttack(findAttack(first.attack)!, mx, mz, mLen, first.power);
    // 攻撃ボタンの長押しで溜めに移らない（剣技はスキルボタンから始めた）
    this.heldSinceBegin = false;
    this.skillRun = { run, i: 0 };
    this.skillSerial++;
    this.lastSkill = run.skill;
    this.pendingSkill = null;
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

    // 地面を叩く技: 剣が床に当たる時刻に演出の合図を出す（描画されている姿勢の時刻 = stateFrame / 60 が impact.t になる step）。echoes があれば、遅れて広がる輪もそれぞれの時刻に
    for (const im of fr.impacts) {
      if (f + 1 !== im.frame) continue;
      this.impactSerial++;
      this.lastImpact.x = this.body.x + Math.sin(this.yaw) * im.dist;
      this.lastImpact.z = this.body.z + Math.cos(this.yaw) * im.dist;
      this.lastImpact.power = im.power * this.attackPower;
    }
    // 長押し: 1 段目を押し続けていたら、予備動作の途中で溜めへ移る（離したら通常の 1 段目のまま）
    if (!intent.attackHeld) this.heldSinceBegin = false;
    if (a.id === this.loadout.moveset.light && this.heldSinceBegin && f >= CHARGES[this.loadout.charge]!.holdFrames && f < fr.startup) {
      this.beginCharge(CHARGES[this.loadout.charge]!);
      return;
    }
    // 回避キャンセル（持続終了後。多段の技は dodgeCancelAt = 最初の窓のあと から）
    if (intent.dodgePressed && f >= fr.dodgeCancel) {
      this.beginDodge(mx, mz, mLen);
      return;
    }
    // ガードキャンセル（同じ時刻から。先行入力のあるとき）
    if (f >= fr.dodgeCancel && this.canGuard()) {
      this.beginGuard();
      return;
    }
    // 剣技: 受付が開いたら、押さなくても連なりの次の段へ自動で続く（向きはスティック・ロック対象）。受付のあいだに別のスキルを頼まれたら、そちらを始める
    if (this.pendingSkill && f >= fr.cancelFrame) {
      this.beginSkill(this.pendingSkill, mx, mz, mLen);
      return;
    }
    const sk = this.skillRun;
    if (sk && f >= fr.cancelFrame) {
      const next = sk.run.steps[sk.i + 1];
      if (next) {
        this.beginAttack(findAttack(next.attack)!, mx, mz, mLen, next.power, true);
        this.skillRun = { run: sk.run, i: sk.i + 1 };
        return;
      }
    }
    // 次段キャンセル（押した瞬間のスティックの向きで続く技が変わる。AttackDef.branches）
    if (this.attackBuffered && f >= fr.cancelFrame && (a.next || a.branches)) {
      const ref = this.aimYaw() ?? this.yaw;
      const follow = pickFollowUp(a.next, a.branches, classifyStick(mLen, Math.atan2(mx, mz), ref, this.hasAim));
      if (follow) {
        this.beginAttack(ATTACKS[follow]!, mx, mz, mLen, 1, true);
        return;
      }
    }
    if (f >= fr.total) {
      this.attack = null;
      this.attackFrames = null;
      this.attackBuffered = false;
      this.setState(mLen > 0.01 ? 'run' : 'idle');
    }
  }

  /** 溜めの構えに入る（1 段目の予備動作の途中から）。動けない。離すと重撃、段階は保持の長さで上がる */
  private beginCharge(c: ChargeDef): void {
    this.charge = c;
    this.chargeLevel = 0;
    this.chargeReleased = !this.heldNow;
    this.attack = null;
    this.attackFrames = null;
    this.attackBuffered = false;
    this.setState('charge', true);
    this.velX = 0;
    this.velZ = 0;
  }

  /**
   * 溜め中: その場で構えを保つ（向きだけロック対象へ向き直る）。構えが整って（c.frames）から、離すか最大保持に達したら重撃を放つ。
   * 構えが整う前に離しても、整うまで待ってから放つ。構えに入って dodgeCancelFrame 以降は回避でキャンセルできる
   */
  private stepCharge(dt: number, mx: number, mz: number, mLen: number, intent: InputIntent): void {
    const c = this.charge!;
    const f = this.stateFrame;
    this.velX = approach(this.velX, 0, MOVE.decel * dt);
    this.velZ = approach(this.velZ, 0, MOVE.decel * dt);
    const aim = this.aimYaw();
    if (aim !== null) this.yaw = rotateTowards(this.yaw, aim, MOVE.turnSpeed * dt);
    // 構えが整ってからの保持フレームで段階が上がる
    const held = Math.max(0, f - c.frames);
    let level = 0;
    for (const need of c.levels) if (held >= need) level++;
    this.chargeLevel = level;
    if (!intent.attackHeld) this.chargeReleased = true;

    if (intent.dodgePressed && f >= c.dodgeCancelFrame) {
      this.charge = null;
      this.chargeLevel = 0;
      this.chargeReleased = false;
      this.beginDodge(mx, mz, mLen);
      return;
    }
    if (f >= c.dodgeCancelFrame && this.canGuard()) {
      this.charge = null;
      this.chargeLevel = 0;
      this.chargeReleased = false;
      this.beginGuard();
      return;
    }
    if ((this.chargeReleased && f >= c.frames) || held >= c.maxHoldFrames) {
      const power = c.levelPower[level] ?? 1;
      this.charge = null;
      this.chargeReleased = false;
      this.beginAttack(ATTACKS[pickChargeRelease(c.next, c.levelNext, level)]!, mx, mz, mLen, power);
    }
  }

  /**
   * 回避を始める。種類は入力で決まる（DODGE_RULES）:
   *  - スティックを倒している → その向きへ向きを変えて前転（ロール）。ただしロック中に、対象から離れる向き（真後ろ ± backCone）なら、
   *    対象を向いたまま後ろステップ
   *  - 入力なし → 向きを保ったまま後ろステップ（ロック中は対象を向いたまま）
   */
  private beginDodge(mx: number, mz: number, mLen: number): void {
    // 基準の向き: ロック中は対象の方、そうでなければいまの向き
    const ref = this.hasAim && Math.hypot(this.aimX - this.body.x, this.aimZ - this.body.z) > 0.05 ? Math.atan2(this.aimX - this.body.x, this.aimZ - this.body.z) : this.yaw;
    if (mLen > 0.2) {
      const stick = Math.atan2(mx, mz);
      if (this.hasAim && Math.abs(angleDelta(ref + Math.PI, stick)) < (DODGE_RULES.backConeDeg * Math.PI) / 180) {
        this.dodgeKind = 'back';
        this.yaw = ref;
      } else {
        this.dodgeKind = 'roll';
        this.yaw = stick;
      }
    } else {
      this.dodgeKind = 'back';
      this.yaw = ref;
    }
    this.attack = null;
    this.attackFrames = null;
    this.attackBuffered = false;
    this.setState('dodge', true);
  }

  private stepDodge(_dt: number, mx: number, mz: number, mLen: number, intent: InputIntent): void {
    const f = this.stateFrame;
    const def = DODGES[this.dodgeKind];
    // 手付けの回避: 攻撃（stepAttack）と同じく、1 フレーム先にそろえた rootZ の差分で、向き（yaw）の前後へ進む（後ろステップは負）
    const v = (def.root((f + 1) / 60) - def.root(f / 60)) * 60;
    this.velX = Math.sin(this.yaw) * v;
    this.velZ = Math.cos(this.yaw) * v;
    if (intent.attackPressed) this.attackBuffered = true;
    if (f >= def.cancelFrame && this.pendingSkill) {
      // 回避の途中からの剣技（連なりの 1 段目から。回避直後の攻撃ではなく、剣技として始める）
      this.framesSinceDodge = 9999;
      this.beginSkill(this.pendingSkill, mx, mz, mLen);
      return;
    }
    if (f >= def.cancelFrame && this.attackBuffered) {
      // この攻撃自体がダッシュ。回避は終わったことにして、あとの攻撃を「回避直後」にしない
      this.framesSinceDodge = 9999;
      // 回避の途中からの攻撃: ロールならダッシュ斬り、後ろステップなら踏み込み（pickAttack）。向きは回避の向き（ロック中は対象）
      this.beginAttack(ATTACKS[pickAttack(this.loadout.moveset, { stick: 'none', afterDodge: this.dodgeKind })]!, Math.sin(this.yaw), Math.cos(this.yaw), 1);
      return;
    }
    if (f >= def.cancelFrame && this.canGuard()) {
      this.framesSinceDodge = 9999;
      this.beginGuard();
      return;
    }
    if (f >= def.frames) {
      this.framesSinceDodge = 0;
      this.setState('idle');
    }
  }

  // ======================= 装備・ガード =======================

  /**
   * 装備を替える（ADR-020）。立っている・走っているあいだだけ受け付ける（攻撃・回避・構えの途中では替えない）。
   * 替えたら true（すでにその装備なら何もせず true）。
   */
  equip(id: LoadoutId): boolean {
    if (this.loadout.id === id) return true;
    if (this.state !== 'idle' && this.state !== 'run') return false;
    this.loadout = LOADOUTS[id];
    this.equipSerial++;
    this.guardLock = 0;
    return true;
  }

  /** ガードの先行入力が残っていて、構え直しの待ちが明けているか（構えに入れる状況かは呼ぶ側が決める） */
  private canGuard(): boolean {
    return this.guardBuffer > 0 && this.guardLock <= 0;
  }

  /** 構えに入る。その場で止まる（慣性で滑らない）。進行中の攻撃・溜めは捨てる */
  private beginGuard(): void {
    this.guard = this.loadout.guard;
    this.guardStun = 0;
    this.guardBuffer = 0;
    this.attack = null;
    this.attackFrames = null;
    this.attackBuffered = false;
    this.charge = null;
    this.chargeLevel = 0;
    this.velX = 0;
    this.velZ = 0;
    this.knockback.cancel();
    this.setState('guard', true);
  }

  /**
   * 構え中: その場から動けない（向きだけ変えられる。ロック中は対象へ、そうでなければスティックの向きへ）。ガードボタンを離したら解く
   * （構えに入って minHoldFrames までは解けない。受け止めた直後の硬直 guardStun のあいだも解けない・キャンセルできない）。
   * cancelFrame 以降は攻撃・回避でキャンセルできる（弾いた直後の反撃はここから出る）
   */
  private stepGuard(dt: number, mx: number, mz: number, mLen: number, intent: InputIntent): void {
    const g = this.guard!;
    const f = this.stateFrame;
    // 受け止めたときのノックバックだけで動く
    this.velX = this.knockback.velX;
    this.velZ = this.knockback.velZ;
    this.knockback.step();
    if (this.guardStun > 0) {
      this.guardStun--;
    } else {
      const turnTo = this.aimYaw() ?? (mLen > 0.3 ? Math.atan2(mx, mz) : null);
      if (turnTo !== null) this.yaw = rotateTowards(this.yaw, turnTo, MOVE.turnSpeed * GUARD_TURN_SCALE * dt);
      if (f >= g.cancelFrame) {
        if (intent.dodgePressed) {
          this.guard = null;
          this.beginDodge(mx, mz, mLen);
          return;
        }
        if (this.attackBuffered) {
          this.guard = null;
          this.beginAttackFromInput(mx, mz, mLen);
          return;
        }
      }
      if (!intent.guardHeld && f >= g.minHoldFrames) {
        this.guard = null;
        this.guardLock = g.lockFrames;
        this.setState(mLen > 0.01 ? 'run' : 'idle');
      }
    }
  }

  /** 構えているか（敵の攻撃を防ぐ状態か） */
  get guarding(): boolean {
    return this.state === 'guard' && this.guard !== null;
  }

  /** パリィの受付中か（構えに入ってから parryFrames 以内。見た目が盾を光らせるのに使う）。step() の後に読む */
  get parryWindow(): boolean {
    const g = this.guard;
    return this.state === 'guard' && g !== null && g.parryFrames > 0 && this.stateFrame >= 1 && this.stateFrame <= g.parryFrames + this.mods.parryFrames;
  }

  /** 敵の攻撃（ev）に対する防御の結果。被弾の前に呼ぶ。構えていなければ 'none' */
  guardOutcome(ev: HitEvent): GuardOutcome {
    if (this.state !== 'guard' || !this.guard) return 'none';
    return resolveGuardOutcome(this.guard, this.stateFrame, this.yaw, ev.dirX, ev.dirZ, this.mods.parryFrames);
  }

  /**
   * ガードで受け止める。ダメージを軽減して通し（削り。HP が 0 なら倒れる）、少し押されて、硬直（guardStun）に入る。構えは保つ。
   * 向きは変えない（被弾と違い、受けた側を向き直さない）
   */
  guardBlock(ev: HitEvent): DamageResult {
    const g = this.guard!;
    const r = applyDamage(this.health, this.takenDamage(guardedDamage(ev.damage, g)));
    this.guardHitSerial++;
    this.lastGuardHit = ev;
    this.guardStun = g.hitStunFrames;
    this.knockback.start(ev.dirX, ev.dirZ, ev.knockback * g.knockbackScale, HIT_STUN.knockbackFrames);
    if (r.killed) {
      this.guard = null;
      this.guardStun = 0;
      this.velX = 0;
      this.velZ = 0;
      this.setState('dead', true);
    }
    return r;
  }

  /** パリィ成功。ダメージも押されもなし（敵が弾かれる）。構えは保つので、そのまま反撃できる。弾かれた敵の反応（構えごとの効果）を返す */
  parry(ev: HitEvent): ParryEffectDef {
    this.parrySerial++;
    this.lastGuardHit = ev;
    return PARRY_EFFECTS[this.guard!.parryEffect];
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
    if (this.state !== 'attack' || fr === null) return false;
    // 多段ヒットの技は、窓のあいだだけ当たりが出る
    if (fr.windows.length > 0) return this.winIdx >= 0;
    return isActiveFrame(fr.startup, fr.active, this.stateFrame);
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

  /** 無敵中か（敵の攻撃のヒット判定で使う）: 回避の無敵フレーム、被弾後の無敵、ミスティカルドッジの間、死亡後 */
  get invulnerable(): boolean {
    if (this.state === 'dead' || this.hurtInvuln > 0 || this.mystical) return true;
    return this.inDodgeInvuln;
  }

  /** 回避の無敵フレームの中か（ほかの無敵の理由は問わない） */
  private get inDodgeInvuln(): boolean {
    if (this.state !== 'dodge') return false;
    const d = DODGES[this.dodgeKind];
    return this.stateFrame >= d.invulnStart && this.stateFrame <= d.invulnEnd + this.mods.dodgeInvuln;
  }

  /**
   * 回避の無敵が「敵の攻撃を避けさせている」状態か: 回避の無敵フレームの中で、被弾後の無敵・ミスティカルドッジなど
   * ほかの無敵の理由がない。この間に当たるはずだった攻撃が来たらジャスト回避（ミスティカルドッジ。ADR-030）
   */
  get dodging(): boolean {
    return this.state !== 'dead' && this.hurtInvuln <= 0 && !this.mystical && this.inDodgeInvuln;
  }

  /** ミスティカルドッジの無敵を入れる・切る。当たり判定にもすぐ反映する */
  setMystical(on: boolean): void {
    if (this.mystical === on) return;
    this.mystical = on;
    this.refreshHurtbox();
  }

  /** ミスティカルドッジの無敵の最中か（DefenderView.evading） */
  get evading(): boolean {
    return this.mystical && this.state !== 'dead';
  }

  /** 体力を回復する（アイテム）。実際に増えた量を返す。死んでいるときは回復しない */
  heal(amount: number): number {
    if (this.state === 'dead') return 0;
    const before = this.health.hp;
    this.health.hp = Math.min(this.health.max, before + Math.max(0, Math.round(amount)));
    return this.health.hp - before;
  }

  // ======================= render =======================

  getInterpolatedPosition(alpha: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(lerp(this.prevX, this.body.x, alpha), lerp(this.prevY, this.y, alpha), lerp(this.prevZ, this.body.z, alpha));
    return out;
  }

  /** 剣の刃の根元側と先の世界座標（剣筋用）。見た目が読み込まれていなければ false。syncVisual のあとに呼ぶ */
  getBladePoints(base: THREE.Vector3, tip: THREE.Vector3): boolean {
    return this.visual?.getBladePoints(base, tip) ?? false;
  }

  /** 毎描画フレーム。animDt はヒットストップ等のスケール済み時間、frameDt は実時間（フラッシュの減衰用） */
  syncVisual(alpha: number, animDt: number, frameDt: number): void {
    this.root.position.set(lerp(this.prevX, this.body.x, alpha), lerp(this.prevY, this.y, alpha), lerp(this.prevZ, this.body.z, alpha));
    this.root.rotation.y = lerpAngle(this.prevYaw, this.yaw, alpha) + HERO.forwardYawOffset;
    this.visual?.update(this, animDt, frameDt);
  }
}
