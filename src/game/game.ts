import * as THREE from 'three';
import { GameLoop } from '../core/loop';
import { InputAggregator, type InputIntent } from '../input/intent';
import { TouchInput } from '../input/touch';
import { KeyboardInput } from '../input/keyboard';
import { RendererHost } from '../render/renderer';
import { PostPipeline } from '../render/post';
import { AdaptiveResolution, buildLevels } from '../render/adaptive-resolution';
import { SkyDome } from '../render/sky';
import { Arena } from '../world/arena';
import { clampInsideArena, pushOutOfCircle, separateCircles } from '../world/collision';
import { Player } from './player';
import { resolveEnemyAttacks, resolvePlayerAttack } from './combat';
import { cutProjectiles, resolveProjectilesOnPlayer, resolveReflectedProjectiles, type ProjectileHandlers } from './projectile-combat';
import { MAX_PROJECTILES, ProjectileSystem, spawnShot, type Projectile, type ProjectileEnd } from '../combat/projectile';
import { summonPoints, type SummonPoint } from '../ai/summon';
import { PROJECTILES, PROJECTILE_HEIGHT } from '../combat/data/projectiles';
import { ProjectileRenderer } from '../render/projectiles';
import type { Circle } from '../world/collision';
import { Mystical } from '../combat/mystical';
import { Inventory } from '../combat/inventory';
import { SkillBook } from '../combat/skills';
import { SKILLS, isSkillId, type SkillDef } from '../combat/data/skills';
import { ITEMS, ITEM_ORDER, ITEM_RULES, type ItemId } from '../combat/data/items';
import { MYSTICAL } from '../combat/data/mystical';
import { Enemy } from '../ai/enemy';
import { stepSwarm } from '../ai/swarm';
import { AudioBus } from '../platform/audio';
import { Sfx, distanceGain } from '../audio/sfx';
import type { SfxName } from '../audio/data/sfx';
import { ENEMIES, type EnemyDef, type EnemyId } from '../ai/data/enemies';
import { EnemyVisual } from './enemy-visual';
import { TelegraphCircles, TelegraphLanes } from '../render/telegraph';
import { HitStop } from '../core/hitstop';
import { HitFx } from '../render/hit-fx';
import { GroundFx } from '../render/ground-fx';
import { SwordTrail } from '../render/sword-trail';
import { DamageNumbers } from '../ui/damage-numbers';
import { EnemyBars } from '../ui/enemy-bars';
import { LockMarker } from '../ui/lock-marker';
import { LockOn } from '../combat/lockon-state';
import { Encounter, spawnPoint, type EncounterEvent } from './encounter';
import { DEMO_ENCOUNTER, type EncounterDef } from '../ai/data/encounters';
import type { Hurtbox } from '../combat/hit';
import { hitFeedback } from '../combat/feedback';
import { GROUND_IMPACT, HIT_FEEDBACK } from '../combat/data/hit-feedback';
import { GUARD_FEEDBACK, type ParryEffectDef } from '../combat/data/guard';
import { DEFAULT_LOADOUT, LOADOUTS, nextLoadout, type LoadoutId } from '../combat/data/loadouts';
import { FX_TINT } from '../render/hit-fx';
import type { HitEvent } from '../combat/hit';
import type { DamageResult } from '../combat/health';
import { ThirdPersonCamera } from './camera';
import { Hud } from '../ui/hud';
import { MoveGuide } from '../ui/move-guide';
import { MoveList } from '../ui/move-list';
import { buildGuide, type GuideContext } from '../combat/move-guide';
import { buildMoveTree } from '../combat/move-tree';
import { onVisibility } from '../platform/safari';
import { loadCharacter } from '../character/loader';
import { HERO } from '../character/data/hero';

/**
 * ゲーム全体を束ねる。sim（step）と render を分け、sim は InputIntent だけを入力に取る。
 */

const _pos = new THREE.Vector3();
const _bladeBase = new THREE.Vector3();
const _bladeTip = new THREE.Vector3();
const SUN_DIR = new THREE.Vector3(0.55, 0.75, 0.35).normalize();

export interface GameOptions {
  canvas: HTMLCanvasElement;
  debug?: boolean;
  /** 描画の pixelRatio を固定する（動的解像度を止める）。?dpr= から渡す */
  pixelRatio?: number;
  /** false で動的解像度を止める（既定は有効）。?adaptive=0 から渡す */
  adaptive?: boolean;
  /** 開発用: 敵も戦闘の進行も無い、モーションを確かめるためだけの場。?sandbox=1 から渡す（tools/motion-sheet.mjs が使う） */
  sandbox?: boolean;
}

/** 動的解像度の段（大きい順）。デバイスの DPR を超える段は buildLevels が潰す */
const PIXEL_RATIO_LEVELS = [1.5, 1.25, 1.0];

/** 敵 1 体ぶんの sim と見た目 */
interface EnemyEntry {
  enemy: Enemy;
  visual: EnemyVisual;
  /** 効果音を鳴らし終えた状態遷移（Enemy.stateSerial） */
  seenSerial: number;
  /** 弾を作り終えた発射（Enemy.fireSerial）・床の演出を起こし終えた地面叩き（impactSerial）・演出を起こし終えた体勢崩し（breakSerial） */
  seenFire: number;
  seenImpact: number;
  seenBreak: number;
  /** 召喚（Enemy.summonSerial）・段階（Enemy.phaseSerial）の演出を起こし終えた値 */
  seenSummon: number;
  seenPhase: number;
}

/** プレイヤーの攻撃ごとの振りの効果音 */
const SWING_SFX: Record<string, SfxName> = {
  combo1: 'swing1',
  combo2: 'swing2',
  combo3: 'swing3',
  comboHop: 'swingRetreat',
  comboSpin: 'swingSweep',
  comboUpper: 'swingDash',
  comboSlam: 'swingHeavy',
  hopThrust: 'swingLunge',
  lungeSlash: 'swingSweep',
  sweepBack: 'swingSweep',
  heavy: 'swingHeavy',
  lunge: 'swingLunge',
  dash: 'swingDash',
  retreat: 'swingRetreat',
  sweep: 'swingSweep',
  // 大剣（片手剣より低く長い）
  gs1: 'gsSwing1',
  gs2: 'gsSwing2',
  gsLunge: 'gsSwingLunge',
  gsRetreat: 'gsSwingRetreat',
  gsSpin: 'gsSwingSpin',
  gsDash: 'gsSwingDash',
  gsRise: 'gsSwingRise',
  gsHeavy: 'gsSwingHeavy',
  gsSmash: 'gsSwingSmash',
  gsDrop: 'gsSwingDrop',
  gsSpin2: 'gsSwingSpin',
  gsLungeSweep: 'gsSwingRetreat',
  gsRetreatLunge: 'gsSwingLunge',
  gsRiseSlam: 'gsSwingDash',
  gsHeavyRip: 'gsSwingRise',
  // 剣技（ADR-031 / 032）。多段の技は、2 つ目以降の窓が開くたびにも鳴らす（Player.swingSerial）
  skQuad1: 'swing1',
  skQuad2: 'swing2',
  skQuad3: 'swing1',
  skQuad4: 'swing2',
  skFlurry: 'swingLunge',
  skWhirl: 'swingSweep',
  skGsSweep1: 'gsSwingRetreat',
  skGsSweep2: 'gsSwing2',
  skGsSlam: 'gsSwingSmash',
  skGsIssen: 'gsSwingLunge',
};
/** 敵の攻撃の音（敵の種類ごと。無ければ enemySwing） */
const ENEMY_ATTACK_SFX: Partial<Record<string, SfxName>> = { boar: 'boarCharge', lantern: 'orbShot', bat: 'batSwoop' };
/** 敵の予備動作の合図（敵の種類ごと。無ければ telegraph）。群れの小蝙蝠は小さく短い鳴き声（何体も鳴るので） */
const ENEMY_WINDUP_SFX: Partial<Record<string, SfxName>> = { bat: 'batSqueak' };
/** 溜めの段階が上がったときの合図 */
const CHARGE_LEVEL_SFX: readonly SfxName[] = ['chargeLevel1', 'chargeLevel2'];

/** 最後の敵を倒したときのスローモーション（倍率、実時間の秒） */
const FINISH_SLOW = { scale: 0.3, seconds: 0.9 };
/** プレイヤーが倒れたときのスローモーション */
const DEFEAT_SLOW = { scale: 0.35, seconds: 1.2 };

export class Game {
  readonly host: RendererHost;
  readonly scene = new THREE.Scene();
  readonly cam: ThirdPersonCamera;
  readonly post: PostPipeline;
  readonly sky: SkyDome;
  readonly arena: Arena;
  readonly player: Player;
  readonly enemies: EnemyEntry[] = [];
  /** enemies の sim だけを並べた配列（毎ステップ配列を作らないため。spawn / 取り除きで同期する） */
  private readonly enemySims: Enemy[] = [];
  private nextEnemyId = 1;
  /** 戦闘の進行（ウェーブ・勝敗・リザルトの集計）。再戦のたびに作り直す */
  encounter: Encounter = new Encounter(DEMO_ENCOUNTER);
  private encounterStarted = false;
  private readonly sandbox: boolean;
  /** 音声の土台（解放は開始画面のタップ。platform/audio.ts）と、効果音の再生 */
  readonly audio = new AudioBus();
  readonly sfx = new Sfx(this.audio);
  private seenPlayerSerial = 0;
  /** 溜めの段階の合図を鳴らし終えた段階（構えを出たら 0） */
  private seenChargeLevel = 0;
  readonly hitStop = new HitStop();
  readonly hitFx = new HitFx();
  /** 地面を叩いた演出（砂ぼこりの輪・ひび割れ・破片。ADR-023） */
  readonly groundFx = new GroundFx();
  /** 敵の攻撃の予告の床表示（突進の通り道。ADR-025） */
  private readonly lanes = new TelegraphLanes();
  /** 全周の攻撃の予告の円（岩鬼の地ならし。ADR-027） */
  private readonly circles = new TelegraphCircles();
  /** 飛び道具（提灯の鬼火。ADR-026）の sim と描画 */
  private readonly projectiles = new ProjectileSystem();
  private readonly projectileFx = new ProjectileRenderer(MAX_PROJECTILES, PROJECTILES.wisp.radius);
  /** ミスティカルドッジ（ジャスト回避。ADR-030）。発動中は敵と敵の弾だけが遅い。mysticalWas = 前ステップで発動中だったか（切れた瞬間の合図用） */
  readonly mystical = new Mystical();
  private mysticalWas = false;
  /** アイテム欄（薬瓶。ADR-030）。敵を倒すと確率で増え、ボタンで使う。dropRng はドロップの抽選の乱数（開発・テストで差し替えられる） */
  readonly inventory = new Inventory();
  dropRng: () => number = Math.random;
  private seenInventorySerial = -1;
  /** スキル欄（剣技。ADR-031）。seenSkillSerial = クールダウンと演出を起こし終えた Player.skillSerial、skillUiKey = スキルボタンの表示を合わせ終えた状態 */
  readonly skills = new SkillBook();
  private seenSkillSerial = 0;
  private skillUiKey = '';
  /** ボスが呼んだ手下の id（倒してもアイテムを落とさない = 呼ばせて稼げないように） */
  private readonly summonedIds = new Set<number>();
  /** 地面を叩いた合図（Player.impactSerial）を処理し終えた値 */
  private seenImpact = 0;
  /** スーパーアーマーで受けた合図（Player.armorSerial）を処理し終えた値 */
  private seenArmor = 0;
  /** 多段の技の 2 つ目以降の振り（Player.swingSerial）の音を鳴らし終えた値 */
  private seenSwing = 0;
  readonly damageNumbers: DamageNumbers;
  readonly enemyBars: EnemyBars;
  readonly lockMarker: LockMarker;
  /** ロックオンの状態。対象は敵の id */
  readonly lockOn = new LockOn();
  /** ロックできる敵の体（生きているものだけ。毎ステップ作り直して使い回す） */
  private readonly lockCands: Hurtbox[] = [];
  private lockIndicator = false;
  readonly swordTrail = new SwordTrail();
  readonly input = new InputAggregator();
  readonly touch: TouchInput;
  readonly hud: Hud;
  /** 操作ガイド（下の帯）と技表（ADR-024）。技表を開いているあいだは戦闘を止める */
  private readonly moveGuide: MoveGuide;
  private readonly moveList: MoveList;
  private paused = false;
  private readonly guideCtx: GuideContext = {
    state: 'idle', moveset: LOADOUTS[DEFAULT_LOADOUT].moveset, chargeId: LOADOUTS[DEFAULT_LOADOUT].charge, attackId: null, trail: [], frame: 0, cancelFrame: 0, total: 0,
    queued: false, stick: 'none', locked: false, afterDodge: null, chargeLevel: 0,
  };
  readonly loop: GameLoop;
  readonly adaptive: AdaptiveResolution;
  private readonly startTime = performance.now();
  /** 開発用: 外部（スクリーンショットツール等）から入力を注入する */
  private injected: Partial<InputIntent> | null = null;
  /** 資産の読込が終わり start() できる状態か */
  ready = false;

  constructor(opts: GameOptions) {
    this.sandbox = opts.sandbox ?? false;
    this.adaptive = new AdaptiveResolution({ levels: buildLevels(window.devicePixelRatio || 1, PIXEL_RATIO_LEVELS) });
    if (opts.pixelRatio !== undefined || opts.adaptive === false) this.adaptive.lock();
    this.host = new RendererHost({ canvas: opts.canvas, maxPixelRatio: opts.pixelRatio ?? this.adaptive.ratio });
    this.cam = new ThirdPersonCamera(this.host.width / this.host.height);
    this.hud = new Hud();
    this.hud.setDebugVisible(opts.debug ?? true);
    this.moveGuide = new MoveGuide(document.getElementById('move-guide')!);
    this.moveList = new MoveList();
    this.moveList.onGuideVisible((on) => this.moveGuide.setVisible(on));
    this.moveList.onOpen((open) => (this.paused = open));
    this.damageNumbers = new DamageNumbers(document.getElementById('fx-layer')!);
    this.enemyBars = new EnemyBars(document.getElementById('fx-layer')!);
    this.lockMarker = new LockMarker(document.getElementById('fx-layer')!);

    // --- シーン ---
    this.scene.fog = new THREE.Fog(0xbfd9ff, 30, 120);
    this.sky = new SkyDome(undefined, SUN_DIR);
    this.scene.add(this.sky.mesh);

    const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x6a5a92, 1.1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
    sun.position.copy(SUN_DIR).multiplyScalar(30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 80;
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun);
    this.scene.add(sun.target);

    this.arena = new Arena();
    this.scene.add(this.arena.group);

    this.player = new Player();
    this.scene.add(this.player.root);
    this.scene.add(this.hitFx.group);
    this.scene.add(this.groundFx.group);
    this.scene.add(this.lanes.group);
    this.scene.add(this.circles.group);
    this.scene.add(this.projectileFx.group);
    this.scene.add(this.swordTrail.mesh);
    this.hud.onRetry(() => {
      this.sfx.play('ui');
      this.restart();
    });

    // --- 入力 ---
    this.touch = new TouchInput();
    this.touch.onItemChoose = (id) => {
      if (!(id in ITEMS)) return;
      this.inventory.select(id as ItemId);
      this.sfx.play('ui');
    };
    this.touch.onSkillChoose = (id) => {
      if (isSkillId(id) && this.skills.select(id)) this.sfx.play('ui');
    };
    this.touch.setEquipLabel(this.player.loadout.name);
    this.refreshMoveList();
    this.input.add(this.touch);
    this.input.add(new KeyboardInput());
    this.input.add({
      collect: (it) => {
        if (!this.injected) return;
        Object.assign(it, this.injected);
      },
      endStep: () => {
        this.injected = null;
      },
    });

    // --- ポストプロセス ---
    this.post = new PostPipeline(this.host.renderer, this.scene, this.cam.camera, {
      bloomStrength: 0.32,
      bloomRadius: 0.45,
      bloomThreshold: 0.8,
      samples: 4,
    });
    this.host.onResize = (w, h, pr) => {
      this.cam.setAspect(w / h);
      this.post.setSize(w, h, pr);
    };
    this.host.applySize();

    // --- ループ ---
    this.loop = new GameLoop({
      step: (dt) => this.step(dt),
      render: (alpha, frameDt) => this.render(alpha, frameDt),
    });
    onVisibility((visible) => {
      if (visible) {
        if (!this.loop.isRunning) this.loop.start();
      } else {
        this.loop.stop();
      }
    });
  }

  /** 資産を読み込む。開始前に 1 度呼ぶ */
  async preload(): Promise<void> {
    const asset = await loadCharacter(`${import.meta.env.BASE_URL}${HERO.url}`);
    this.player.attachVisual(asset);
    this.ready = true;
  }

  start(): void {
    if (!this.ready) throw new Error('preload() が終わっていません');
    // 戦闘は開始画面のタップのあとに始める（最初の WAVE のバナーが、タップ待ちのあいだに流れて消えないように）
    if (!this.encounterStarted) this.startEncounter();
    this.loop.start();
  }

  /** 開発用: 次の sim ステップに入力を 1 回だけ注入する */
  inject(intent: Partial<InputIntent>): void {
    this.injected = intent;
  }

  /** 開発用: 指定ステップ数だけ即座に sim を進める（スクリーンショット用） */
  stepNow(count: number): void {
    for (let i = 0; i < count; i++) this.step(1 / 60);
  }

  /**
   * 開発用: 描画を 1/60 秒刻みで指定回数だけ即座に行う。ループを止めてスクリーンショットを撮るとき、
   * 実時間で減衰する演出（フラッシュ・揺れ）を決まった状態にするために使う
   */
  renderNow(count = 1): void {
    for (let i = 0; i < count; i++) this.render(1, 1 / 60);
  }

  /**
   * 開発用: 描画（GPU への draw）を省いて、アニメーション・剣筋・カメラだけを 1/60 秒刻みで進める。
   * モーションを 1 フレームずつ送って、見たいフレームだけ renderNow で描くのに使う（描画を大量に積むと SwiftShader が追いつかない）
   */
  tickVisual(count = 1): void {
    for (let i = 0; i < count; i++) this.render(1, 1 / 60, false);
  }

  /** 敵を 1 体、(x, z) に出す。プレイヤーの方を向く */
  spawnEnemy(type: keyof typeof ENEMIES, x: number, z: number): Enemy {
    const enemy = new Enemy(ENEMIES[type], this.nextEnemyId++, x, z);
    enemy.place(x, z, Math.atan2(this.player.body.x - x, this.player.body.z - z));
    const visual = new EnemyVisual(type);
    this.scene.add(visual.root);
    this.enemies.push({ enemy, visual, seenSerial: enemy.stateSerial, seenFire: enemy.fireSerial, seenImpact: enemy.impactSerial, seenBreak: enemy.breakSerial, seenSummon: enemy.summonSerial, seenPhase: enemy.phaseSerial });
    this.enemySims.push(enemy);
    return enemy;
  }

  /** ウェーブの敵を出す（出現位置はプレイヤーから見てアリーナの向こう側。encounter.ts の spawnPoint） */
  private spawnWave(index: number): void {
    for (const w of this.encounter.def.waves[index] ?? []) {
      const p = spawnPoint(w, this.player.body.x, this.player.body.z, this.arena.radius);
      this.spawnEnemy(w.type, p.x, p.z);
    }
  }

  /** 戦闘を始める（最初のウェーブがすぐ出る）。def を渡すと別の構成で始められる（開発・スクリーンショット用） */
  private startEncounter(def: EncounterDef = DEMO_ENCOUNTER): void {
    this.encounterStarted = true;
    this.encounter = new Encounter(def);
    this.hud.setPlayerHp(this.player.health.hp, this.player.health.max);
    if (this.sandbox) return; // サンドボックスは敵もウェーブも出さない
    this.applyEncounterEvent(this.encounter.step(0, false));
  }

  private applyEncounterEvent(ev: EncounterEvent | null): void {
    if (!ev) return;
    if (ev.type === 'spawn') {
      this.spawnWave(ev.wave);
      // ボスのウェーブは「BOSS」（最後のウェーブでもある）
      const boss = (this.encounter.def.waves[ev.wave] ?? []).some((w) => (ENEMIES[w.type] as EnemyDef).boss === true);
      this.hud.showBanner(boss ? 'BOSS' : ev.last && this.encounter.waveCount > 1 ? 'FINAL WAVE' : `WAVE ${ev.wave + 1}`);
      this.sfx.play('wave');
    } else {
      const r = this.encounter.result();
      if (r) this.hud.showResult(r);
      this.sfx.play(ev.phase === 'victory' ? 'victory' : 'defeat');
    }
  }

  /** プレイヤーの攻撃が敵に当たった。ヒットストップ・画面の揺れ・エフェクト・ダメージ数字を起こす */
  private onPlayerHit(ev: HitEvent, enemy: Enemy, result: DamageResult, riposte = false): void {
    const fb = hitFeedback(ev, result.killed);
    this.hitStop.trigger(fb.hitStop);
    this.cam.shake.trigger(fb.shakeAmp, fb.shakeSeconds);
    const y = HIT_FEEDBACK.impactHeight;
    // 弾かれた敵への反撃は、水色がかった閃光と大きな数字で「反撃が通った」を見せる
    this.hitFx.burst(ev.x, y, ev.z, ev.dirX, ev.dirZ, fb.power, riposte ? FX_TINT.parry : undefined);
    this.damageNumbers.spawn(enemy.body.x, y + 0.5, enemy.body.z, result.dealt, riposte && !result.killed ? 'riposte' : fb.style);
    this.sfx.play(fb.style === 'heavy' || riposte ? 'hitHeavy' : 'hit');
    if (result.killed) this.sfx.play('kill');
    if (result.killed) {
      this.encounter.onKill();
      this.dropItems(enemy);
      // ボスを倒すと手下（呼ばれた小蝙蝠など）は消える（倒した数には入らない）
      if (enemy.def.boss) for (const e of this.enemySims) if (e !== enemy) e.vanish();
      // 最後のウェーブの最後の 1 体: スローモーション
      if (this.encounter.onLastWave && !this.enemySims.some((e) => !e.dead)) this.hitStop.slow(FINISH_SLOW.scale, FINISH_SLOW.seconds);
    }
  }

  /** 剣が地面を叩いた（AttackDef.impact。地割り・叩き落とし）。敵に当たらなくても、砂ぼこりの輪・ひび割れ・揺れ・ヒットストップ・音を出す */
  private onGroundImpact(): void {
    const p = this.player;
    if (p.impactSerial === this.seenImpact) return;
    this.seenImpact = p.impactSerial;
    const { x, z, power } = p.lastImpact;
    this.groundFx.burst(x, z, power);
    this.cam.shake.trigger(GROUND_IMPACT.shake.amp * power, GROUND_IMPACT.shake.seconds * Math.min(1.4, 0.7 + power * 0.3));
    this.hitStop.trigger(Math.round(GROUND_IMPACT.hitStop * power));
    this.sfx.play('groundSmash', { gain: Math.min(GROUND_IMPACT.sfx.maxGain, GROUND_IMPACT.sfx.gain * power) });
  }

  /** 敵の攻撃がプレイヤーに当たった。ヒットストップ・画面の揺れ・赤いフラッシュ・エフェクト・ダメージ数字・HP バー */
  private onEnemyHit(ev: HitEvent, result: DamageResult): void {
    const fb = hitFeedback(ev, result.killed);
    this.hitStop.trigger(fb.hitStop);
    this.cam.shake.trigger(fb.shakeAmp, fb.shakeSeconds);
    this.hitFx.burst(ev.x, HIT_FEEDBACK.playerImpactHeight, ev.z, ev.dirX, ev.dirZ, fb.power);
    this.damageNumbers.spawn(this.player.body.x, HIT_FEEDBACK.playerImpactHeight + 0.7, this.player.body.z, result.dealt, 'hurt');
    this.hud.flashHurt();
    this.hud.setPlayerHp(this.player.health.hp, this.player.health.max);
    // スーパーアーマーで受けた（剣技の最中。ひるまずダメージだけ受けた）: 「ARMOR」の文字と、受け止める金属の音（被弾の音のかわり）
    const armored = this.player.armorSerial !== this.seenArmor;
    this.seenArmor = this.player.armorSerial;
    if (armored) {
      this.damageNumbers.spawnText(this.player.body.x, 2.1, this.player.body.z, 'ARMOR', 'armor', 0.9);
      this.sfx.play('guard');
    } else {
      this.sfx.play('hurt');
    }
    this.encounter.onPlayerHit(result.dealt);
    if (result.killed) this.hitStop.slow(DEFEAT_SLOW.scale, DEFEAT_SLOW.seconds);
  }

  /**
   * 敵の攻撃をガードで受け止めた（ADR-020）。被弾より小さい演出（短いヒットストップ・小さな揺れ・暖かい火花）と、通った削りダメージ。
   * 赤いフラッシュは出さない（防げた）
   */
  private onEnemyGuarded(ev: HitEvent, result: DamageResult): void {
    this.hitStop.trigger(GUARD_FEEDBACK.hitStop);
    this.cam.shake.trigger(GUARD_FEEDBACK.shake.amp, GUARD_FEEDBACK.shake.seconds);
    this.hitFx.burst(ev.x, HIT_FEEDBACK.playerImpactHeight, ev.z, ev.dirX, ev.dirZ, 0.55, FX_TINT.guard);
    this.damageNumbers.spawn(this.player.body.x, HIT_FEEDBACK.playerImpactHeight + 0.7, this.player.body.z, result.dealt, 'guard');
    this.hud.setPlayerHp(this.player.health.hp, this.player.health.max);
    this.sfx.play('guard');
    this.encounter.onPlayerGuard(result.dealt);
    if (result.killed) this.hitStop.slow(DEFEAT_SLOW.scale, DEFEAT_SLOW.seconds);
  }

  /**
   * 敵の攻撃をパリィで弾いた。強いヒットストップと揺れ、水色の大きな閃光、「PARRY」の文字（強さは構えごとの効果 fx。大剣のダウンは盾の体勢崩しより大きい）。
   * 敵は体勢を崩す・倒れる（Enemy.parried）
   */
  private onEnemyParried(ev: HitEvent, enemy: Enemy, fx: ParryEffectDef): void {
    this.hitStop.trigger(fx.hitStop);
    this.cam.shake.trigger(fx.shake.amp, fx.shake.seconds);
    this.hitFx.burst(ev.x, HIT_FEEDBACK.playerImpactHeight, ev.z, ev.dirX, ev.dirZ, fx.burst, FX_TINT.parry);
    this.damageNumbers.spawnText(enemy.body.x, enemy.def.height + 0.35, enemy.body.z, 'PARRY', 'parry', fx.labelScale);
    this.sfx.play(fx.sfx);
    this.encounter.onParry();
  }

  /**
   * ジャスト回避（回避の無敵で、当たるはずだった攻撃を避けた。ADR-030）: ミスティカルドッジを発動する。
   * 発動した・すでに発動中なら true（避けた攻撃は記録され、あとで刺さらない）。クールダウン中は何も起こさず false。
   * 発動の演出: 強いヒットストップ・画面の揺れ・青紫の閃光・「MYSTICAL」の文字・音
   */
  private onJustDodge(): boolean {
    if (this.mystical.trigger()) {
      const p = this.player;
      p.setMystical(true);
      this.mysticalWas = true;
      const b = MYSTICAL.burst;
      this.hitStop.trigger(b.hitStop);
      this.cam.shake.trigger(b.shake.amp, b.shake.seconds);
      this.hitFx.burst(p.body.x, HIT_FEEDBACK.playerImpactHeight, p.body.z, Math.sin(p.yaw), Math.cos(p.yaw), b.power, FX_TINT.mystic);
      this.damageNumbers.spawnText(p.body.x, 1.9, p.body.z, 'MYSTICAL', 'mystic', 1.25);
      this.sfx.play('mysticalStart');
    }
    return this.mystical.active;
  }

  /** ミスティカルドッジが切れた（時間が戻る）。小さな合図の音 */
  private onMysticalEnd(): void {
    this.sfx.play('mysticalEnd');
  }

  /**
   * 倒した敵のドロップ（ADR-030）: 敵ごとの確率で抽選して、落ちたものはその場でストックに入る（拾う操作は要らない）。
   * 呼ばれた手下・ドロップの無い敵（ボス）は抽選しない（救済の数え方にも入れない）。出た瞬間に、緑の光・名前の文字・音
   */
  private dropItems(enemy: Enemy): void {
    const def = enemy.def as EnemyDef;
    if (!def.drops || def.drops.length === 0 || this.summonedIds.has(enemy.id)) return;
    for (const id of this.inventory.rollDrops(def.drops, this.dropRng)) {
      if (this.inventory.add(id) === 0) continue;
      this.hitFx.burst(enemy.body.x, 0.9, enemy.body.z, 0, 0, 0.7, FX_TINT.heal);
      this.damageNumbers.spawnText(enemy.body.x, Math.min(enemy.def.height + 0.1, 1.9), enemy.body.z, `＋${ITEMS[id].name}`, 'item');
      this.sfx.play('itemGet');
    }
  }

  /**
   * 選んでいるアイテムを使う（アイテムボタンのタップ・U キー）。体力が満タン・持っていない・使い直しの待ちのときは使わない（数は減らない）。
   * 使えたら体力を回復して、緑の光・回復量の数字・音
   */
  private useItem(): void {
    const p = this.player;
    if (p.dead) return;
    const r = this.inventory.use(p.health.max - p.health.hp);
    if (!r.ok) {
      if (r.reason !== 'wait' && ITEM_RULES.denySound) this.sfx.play('itemDeny');
      return;
    }
    const healed = p.heal(ITEMS[r.item].heal);
    this.hud.setPlayerHp(p.health.hp, p.health.max);
    this.hitFx.burst(p.body.x, HIT_FEEDBACK.playerImpactHeight, p.body.z, 0, 0, 0.8, FX_TINT.heal);
    this.damageNumbers.spawn(p.body.x, HIT_FEEDBACK.playerImpactHeight + 0.7, p.body.z, healed, 'heal');
    this.sfx.play('potion');
  }

  /**
   * 選んでいるスキルを使う（スキルボタンのタップ・O キー）。連なりを Player に頼む（立っている・走っている・攻撃 / 回避の受付なら始まる）。
   * 選べるスキルが無い・クールダウン中は「使えない」音。クールダウンに入るのは、実際に始まったとき（onSkillStart）
   */
  private useSkill(): void {
    const p = this.player;
    if (p.dead) return;
    const run = this.skills.prepare(p.loadout.weapon);
    if (!run) {
      this.sfx.play('itemDeny');
      return;
    }
    p.requestSkill(run);
  }

  /** 剣技が始まった（Player.skillSerial が増えた）: クールダウンに入り、技名の文字・音を出す */
  private onSkillStart(): void {
    const p = this.player;
    this.seenSkillSerial = p.skillSerial;
    const id = p.lastSkill;
    if (!id) return;
    this.skills.start(id);
    this.damageNumbers.spawnText(p.body.x, 1.95, p.body.z, SKILLS[id].name, 'skill', 1.2);
    this.sfx.play('skillStart');
  }

  /** スキルボタンの表示（いま選んでいるもの・一覧）とクールダウンの扇を合わせる。装備を替えると系統が替わって一覧も替わる */
  private syncSkillUi(): void {
    const fam = this.player.loadout.weapon;
    const key = `${fam}:${this.skills.serial}`;
    if (key !== this.skillUiKey) {
      this.skillUiKey = key;
      const opt = (d: SkillDef) => ({ id: d.id, label: d.short, sub: d.name, badge: `Lv${this.skills.level(d.id)}`, icon: 'blade' as const, color: d.family === 'greatsword' ? '#ffb86f' : '#7fd8ff' });
      this.touch.skill.setOptions(this.skills.available(fam).map(opt));
      const sel = this.skills.selectedFor(fam);
      this.touch.skill.setFace(sel ? opt(sel) : null);
    }
    const sel = this.skills.selectedFor(fam);
    this.touch.skill.setCooldown(sel ? this.skills.cooldownRatio(sel.id) : 0);
    const it = ITEMS[this.inventory.selected];
    this.touch.item.setCooldown(this.inventory.cooldown / it.cooldownFrames);
  }

  /** アイテムボタンの表示（いま選んでいるもの・一覧）を、数や選択が変わったときだけ作り直す */
  private syncItemUi(): void {
    if (this.seenInventorySerial === this.inventory.serial) return;
    this.seenInventorySerial = this.inventory.serial;
    const inv = this.inventory;
    const opt = (id: ItemId) => ({ id, label: ITEMS[id].short, sub: ITEMS[id].name, badge: String(inv.count(id)), dim: inv.count(id) === 0, icon: 'bottle' as const, color: ITEMS[id].color });
    this.touch.item.setOptions(ITEM_ORDER.map(opt));
    this.touch.item.setFace(opt(inv.selected));
  }

  /** 弾き返す先（撃った敵の体）。いなければ（倒した・取り除いた）null */
  private readonly ownerBody = (id: number): Circle | null => {
    for (const e of this.enemySims) if (e.id === id && !e.dead) return e.body;
    return null;
  };

  /** 敵の弾の命中・防御・消滅の演出（近接の攻撃と同じ演出を、弾の位置で起こす） */
  private readonly projectileHandlers: ProjectileHandlers = {
    onHit: (ev, _p, result) => this.onEnemyHit(ev, result),
    onGuard: (ev, _p, result) => this.onEnemyGuarded(ev, result),
    onParry: (ev, p, fx) => this.onProjectileParried(ev, p, fx),
    onEnd: (p, reason) => this.onProjectileEnd(p, reason),
    onJustDodge: () => void this.onJustDodge(),
  };
  /** ボスの HP バーの段階の目盛り（HP の割合）。ボスが変わったときだけ作り直す */
  private bossTicks: readonly number[] = [];
  private bossTicksFor: string | null = null;
  /** 召喚の出現位置の作業用（毎回作らない） */
  private readonly summonBuf: SummonPoint[] = [];
  private readonly onProjectileEndCb = (p: Projectile, reason: ProjectileEnd): void => this.onProjectileEnd(p, reason);

  /**
   * 敵の弾をパリィで弾き返した。弾いた手応えは近接のパリィと同じ演出（強さは構えごとの効果）で、「PARRY」の文字は弾の位置に出す。
   * 弾は水色になって撃った敵へ飛んでいく（Projectile.reflect）
   */
  private onProjectileParried(ev: HitEvent, p: Projectile, fx: ParryEffectDef): void {
    this.hitStop.trigger(fx.hitStop);
    this.cam.shake.trigger(fx.shake.amp, fx.shake.seconds);
    // 弾は自分の目の前で弾くので、近接のパリィ（敵の縁）より閃光を小さくする（画面いっぱいに被らないように）
    this.hitFx.burst(ev.x, PROJECTILE_HEIGHT, ev.z, ev.dirX, ev.dirZ, fx.burst * 0.6, FX_TINT.parry);
    this.damageNumbers.spawnText(p.x, PROJECTILE_HEIGHT + 0.5, p.z, 'PARRY', 'parry', fx.labelScale);
    this.sfx.play(fx.sfx);
    this.encounter.onParry();
  }

  /** 弾が消えた。寿命・縁で消えた弾と斬り落とした弾は、小さな閃光とはじける音（当たった・受け止めたときは、その演出がある） */
  private onProjectileEnd(p: Projectile, reason: ProjectileEnd): void {
    if (reason === 'clear' || reason === 'hit' || reason === 'guard') return;
    const cut = reason === 'cut';
    this.hitFx.burst(p.x, PROJECTILE_HEIGHT, p.z, p.dirX, p.dirZ, cut ? 0.55 : 0.3, p.team === 'player' ? FX_TINT.parry : FX_TINT.orb);
    this.sfx.play('orbBreak', { gain: cut ? 1 : 0.6 });
    if (cut) this.hitStop.trigger(2);
  }

  /** 召喚（ボスの号令。Enemy.summon）: 周りに手下を呼ぶ。生きている同種が max 以上なら呼ばない。出た位置に閃光 */
  private summonMinions(boss: Enemy): void {
    const req = boss.summon;
    if (!req) return;
    const type = req.type as EnemyId;
    if (!ENEMIES[type]) return;
    let alive = 0;
    for (const e of this.enemySims) if (!e.dead && e.def.id === type) alive++;
    const n = Math.min(req.count, Math.max(0, req.max - alive));
    if (n <= 0) return;
    summonPoints(boss.body.x, boss.body.z, n, req.radius, boss.summonSerial, this.arena.radius, this.summonBuf);
    for (let i = 0; i < n; i++) {
      const p = this.summonBuf[i]!;
      this.summonedIds.add(this.spawnEnemy(type, p.x, p.z).id);
      this.hitFx.burst(p.x, 1.0, p.z, 0, 0, 0.8, FX_TINT.orb);
    }
    this.sfx.play('orbShot', { gain: 0.8 });
  }

  /** 敵が撃った弾を作る（Enemy.fireSerial が増えたら、その出どころ Enemy.shot から。扇・輪は本数ぶんを fanOffset の向きに） */
  private spawnProjectiles(): void {
    for (const entry of this.enemies) {
      const e = entry.enemy;
      if (e.fireSerial === entry.seenFire) continue;
      entry.seenFire = e.fireSerial;
      spawnShot(this.projectiles, e.id, e.body.x, e.body.z, e.shot);
    }
  }

  /** 装備を次へ替える（切替ボタン）。替えられない状態（攻撃・回避・構えの途中など）では何もしない */
  private cycleLoadout(): void {
    this.setLoadout(nextLoadout(this.player.loadout.id));
  }

  /** 装備を替える（開始画面の選択・切替ボタン・開発用）。替えられたら true */
  setLoadout(id: LoadoutId): boolean {
    const before = this.player.loadout.id;
    if (!this.player.equip(id)) return false;
    this.touch.setEquipLabel(LOADOUTS[id].name);
    this.refreshMoveList();
    if (id !== before) this.sfx.play('equip');
    return true;
  }

  /** 技表を、いまの装備の技で作り直す */
  private refreshMoveList(): void {
    const l = this.player.loadout;
    this.moveList.setMoves(l.name, buildMoveTree(l.moveset, l.charge));
  }

  /** ミスティカルドッジの画面の色・ゲージ（発動中は残り、切れたあとは次までの溜まり具合） */
  private updateMysticalHud(): void {
    const m = this.mystical;
    if (m.active) this.hud.setMystical('active', m.ratio, m.warning);
    else if (m.cooldown > 0) this.hud.setMystical('cooling', 1 - m.cooldownRatio, false);
    else this.hud.setMystical('ready', 0, false);
  }

  /** 操作ガイドを、いまのプレイヤーの状態から更新する（毎描画フレーム。文脈のオブジェクトは使い回す） */
  private updateMoveGuide(): void {
    const p = this.player;
    const c = this.guideCtx;
    c.state = p.state;
    c.moveset = p.loadout.moveset;
    c.chargeId = p.loadout.charge;
    c.attackId = p.attack?.id ?? null;
    c.trail = p.chain;
    c.frame = p.stateFrame;
    c.cancelFrame = p.attackFrames?.cancelFrame ?? 0;
    c.total = p.attackFrames?.total ?? 0;
    c.queued = p.attackQueued;
    c.stick = p.stickDir;
    c.locked = p.locked;
    c.afterDodge = p.afterDodge;
    c.chargeLevel = p.chargeLevel;
    this.moveGuide.update(buildGuide(c));
  }

  private step(dt: number): void {
    // start() を通らずに sim だけ進める開発用の経路（stepNow）でも、戦闘が始まっていることを保証する
    if (!this.encounterStarted) this.startEncounter();
    const intent = this.input.beginStep();
    if (this.encounter.ended) {
      // リザルトの間は操作を受け付けない（カメラだけ回せる）
      intent.moveX = 0;
      intent.moveY = 0;
      intent.attackPressed = false;
      intent.dodgePressed = false;
      intent.attackHeld = false;
      intent.guardPressed = false;
      intent.guardHeld = false;
      intent.equipPressed = false;
      intent.lockPressed = false;
      intent.lockSwitch = 0;
      intent.itemPressed = false;
      intent.itemCycle = 0;
      intent.skillPressed = false;
      intent.skillCycle = 0;
    }
    // アイテム: 選択の切替（キーボード）・使い直しの待ち・使用
    if (intent.itemCycle !== 0) this.inventory.cycle(intent.itemCycle);
    this.inventory.step();
    if (intent.itemPressed) this.useItem();
    // スキル: 選択の切替（キーボード）・クールダウンを進める・使用の頼み（始められたかは player.step のあとに skillSerial で分かる）
    if (intent.skillCycle !== 0) this.skills.cycle(this.player.loadout.weapon, intent.skillCycle);
    this.skills.step();
    if (intent.skillPressed) this.useSkill();
    // 装備の切替（立っている・走っているあいだだけ）
    if (intent.equipPressed) this.cycleLoadout();

    // ロックオン: 対象の選択・切替・解除。ロック中はカメラが対象の方を向き（ヨーの入力は使わない）、プレイヤーは対象を照準にする
    if (this.player.dead) this.lockOn.release();
    this.lockCands.length = 0;
    for (const e of this.enemySims) if (!e.dead) this.lockCands.push(e.body);
    const lockEvent = this.lockOn.update({
      pressed: intent.lockPressed,
      switchDir: intent.lockSwitch,
      px: this.player.body.x,
      pz: this.player.body.z,
      camYaw: this.cam.yaw,
      cands: this.lockCands,
    });
    if (lockEvent) this.sfx.play(lockEvent);
    const locked = this.lockedEnemy();
    this.cam.rotate(locked ? 0 : intent.camYaw, intent.camPitch);
    this.cam.stepLock(dt, this.player.body.x, this.player.body.z, locked ? locked.body : null);
    this.player.setAim(locked ? locked.body : null);
    if (this.lockOn.locked !== this.lockIndicator) {
      this.lockIndicator = this.lockOn.locked;
      this.touch.setLockIndicator(this.lockIndicator);
    }

    // ミスティカルドッジ（ADR-030）: 倒れた・リザルトでは消す。時間を 1 ステップ進めて、このステップで敵と敵の弾を進めるか決める。プレイヤーの無敵は発動中だけ
    if (this.player.dead || this.encounter.ended) this.mystical.reset();
    const enemiesRun = this.mystical.step();
    this.player.setMystical(this.mystical.active);
    if (this.mysticalWas && !this.mystical.active) this.onMysticalEnd();
    this.mysticalWas = this.mystical.active;

    this.player.step(dt, intent, this.cam.yaw);
    if (this.player.skillSerial !== this.seenSkillSerial) this.onSkillStart();
    this.soundPlayerState();
    this.onGroundImpact();

    const alive = !this.player.dead;
    // 攻撃権: 同時に予備動作〜攻撃に入れる敵の数を制限する（残りは近くで構えて待つ）
    if (enemiesRun) stepSwarm(this.enemySims, dt, this.player.body.x, this.player.body.z, alive, this.encounter.def.maxAttackers);
    this.soundEnemyStates();
    this.enemyEvents();
    // 敵の弾: 撃たれた弾を作って 1 ステップ飛ばす（寿命・アリーナの縁で消える）
    this.spawnProjectiles();
    if (enemiesRun) this.projectiles.step(dt, this.arena.radius, this.onProjectileEndCb);
    // 先にプレイヤーの攻撃を解決する。同じフレームに当たり合うなら、プレイヤーが先に当てて敵の攻撃を中断する（敵の弾は斬り落とされる）
    resolvePlayerAttack(this.player, this.enemySims, (ev, enemy, result, riposte) => this.onPlayerHit(ev, enemy, result, riposte));
    cutProjectiles(this.projectiles, this.player, this.onProjectileEndCb);
    resolveEnemyAttacks(this.enemySims, this.player, (ev, _enemy, result) => this.onEnemyHit(ev, result), {
      onGuard: (ev, _enemy, result) => this.onEnemyGuarded(ev, result),
      onParry: (ev, enemy, fx) => this.onEnemyParried(ev, enemy, fx),
      onJustDodge: () => this.onJustDodge(),
    });
    // 敵の弾 → プレイヤー（ガード・パリィ・無敵の判定は近接の攻撃と同じ）。弾き返した弾 → 敵（大ダメージ。反撃と同じ扱い）
    resolveProjectilesOnPlayer(this.projectiles, this.player, this.ownerBody, this.projectileHandlers);
    resolveReflectedProjectiles(this.projectiles, this.enemySims, (ev, enemy, result) => this.onPlayerHit(ev, enemy, result, true), this.onProjectileEndCb);

    // 生きている敵は体を持つ（プレイヤーを押し出し、敵どうしは重ならない）。アリーナの外へは出ない
    for (let i = 0; i < this.enemySims.length; i++) {
      const a = this.enemySims[i]!;
      if (a.dead) continue;
      // 飛んでいる敵（群れの小蝙蝠）はプレイヤーを押し出さず、地上の敵とも押し合わない（飛んでいる敵どうしだけが重ならない）
      if (!a.def.flying) pushOutOfCircle(this.player.body, a.body);
      for (let j = i + 1; j < this.enemySims.length; j++) {
        const b = this.enemySims[j]!;
        if (!b.dead && (a.def.flying ?? false) === (b.def.flying ?? false)) separateCircles(a.body, b.body);
      }
    }
    for (const { enemy } of this.enemies) clampInsideArena(enemy.body, 0, 0, this.arena.radius);
    clampInsideArena(this.player.body, 0, 0, this.arena.radius);

    // 演出が終わった敵を取り除く
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const entry = this.enemies[i]!;
      if (!entry.enemy.removable) continue;
      this.scene.remove(entry.visual.root);
      entry.visual.dispose();
      this.enemies.splice(i, 1);
      this.enemySims.splice(i, 1);
    }
    // 戦闘の進行: 全滅でウェーブが進み、最後を倒すか倒されるかでリザルト
    let living = 0;
    for (const e of this.enemySims) if (!e.dead) living++;
    if (!this.sandbox) this.applyEncounterEvent(this.encounter.step(living, this.player.dead));
    this.input.endStep();
  }

  /** プレイヤーの状態が変わった瞬間の効果音: 攻撃の振り（当たりの少し前に鳴らす）・回避 */
  private soundPlayerState(): void {
    const p = this.player;
    // 溜めの段階が上がった瞬間（段階 1, 2 の合図）。構えを出たら数え直す
    if (p.state === 'charge') {
      if (p.chargeLevel > this.seenChargeLevel) {
        const name = CHARGE_LEVEL_SFX[p.chargeLevel - 1];
        if (name) this.sfx.play(name);
      }
      this.seenChargeLevel = p.chargeLevel;
    } else {
      this.seenChargeLevel = 0;
    }
    if (p.swingSerial !== this.seenSwing) {
      this.seenSwing = p.swingSerial;
      const name = p.attack ? SWING_SFX[p.attack.id] : undefined;
      if (name) this.sfx.play(name, { gain: Math.min(1.1, 0.7 * p.attackPower) });
    }
    if (p.stateSerial === this.seenPlayerSerial) return;
    this.seenPlayerSerial = p.stateSerial;
    if (p.state === 'attack' && p.attack) {
      const name = SWING_SFX[p.attack.id];
      // 溜めを放った攻撃は威力に応じて少し大きく鳴らす
      if (name) this.sfx.play(name, { delay: Math.max(0, p.attack.activeStart - 0.07) / p.attack.rate, gain: Math.min(1.3, p.attackPower) });
    } else if (p.state === 'dodge') {
      this.sfx.play(p.dodgeKind === 'back' ? 'dodgeBack' : 'dodge');
    } else if (p.state === 'charge') {
      this.sfx.play('chargeStart');
    } else if (p.state === 'guard') {
      this.sfx.play('guardUp');
    }
  }

  /** 敵の状態が変わった瞬間の効果音: 予備動作の合図・攻撃の振り（距離で音量が変わる） */
  private soundEnemyStates(): void {
    for (const entry of this.enemies) {
      const e = entry.enemy;
      if (e.stateSerial === entry.seenSerial) continue;
      entry.seenSerial = e.stateSerial;
      const gain = distanceGain(Math.hypot(e.body.x - this.player.body.x, e.body.z - this.player.body.z));
      // 弾き飛ばされて倒れた敵が地面に落ちる音（倒れ切る 14f ≒ 0.23 秒の少し手前）
      if (e.state === 'down') this.sfx.play('knockdown', { gain, delay: 0.17 });
      if (e.state !== 'windup' && e.state !== 'attack') continue;
      if (e.state === 'windup' && e.attackDef.unblockable) {
        // ガード不能の予備動作: 防げる攻撃と違う鋭い合図と、頭上の警告（避けるしかない）
        this.sfx.play('unblockWarn', { gain: Math.max(gain, 0.7) });
        this.damageNumbers.spawnText(e.body.x, Math.min(e.def.height + 0.55, 1.9), e.body.z, 'ガード不能', 'warn');
      } else if (e.state === 'windup') this.sfx.play(ENEMY_WINDUP_SFX[e.def.id] ?? 'telegraph', { gain });
      else this.sfx.play(ENEMY_ATTACK_SFX[e.def.id] ?? 'enemySwing', { gain, delay: 0.02 });
    }
  }

  /**
   * 敵の状態の合図に応じた演出: 地面を叩いた（床の砂ぼこりの輪・ひび割れ・画面の揺れ・音）、体勢を崩された（強いヒットストップ・閃光・「BREAK」・音）。
   * 合図は Enemy.impactSerial / breakSerial（増えたら 1 回ずつ）
   */
  private enemyEvents(): void {
    for (const entry of this.enemies) {
      const e = entry.enemy;
      if (e.impactSerial !== entry.seenImpact) {
        entry.seenImpact = e.impactSerial;
        const power = e.attackDef.groundImpact ?? 1;
        const gain = distanceGain(Math.hypot(e.body.x - this.player.body.x, e.body.z - this.player.body.z));
        this.groundFx.burst(e.body.x, e.body.z, power);
        this.cam.shake.trigger(GROUND_IMPACT.shake.amp * power * gain, GROUND_IMPACT.shake.seconds * 1.1);
        this.sfx.play('groundSmash', { gain: Math.min(GROUND_IMPACT.sfx.maxGain, GROUND_IMPACT.sfx.gain * power) * Math.max(0.5, gain) });
      }
      if (e.summonSerial !== entry.seenSummon) {
        entry.seenSummon = e.summonSerial;
        this.summonMinions(e);
      }
      if (e.phaseSerial !== entry.seenPhase) {
        // ボスの段階が上がった: 咆哮（強いヒットストップ・画面の揺れ・閃光・文字・音）。技が増え、間隔が縮む
        entry.seenPhase = e.phaseSerial;
        this.hitStop.trigger(10);
        this.cam.shake.trigger(0.14, 0.55);
        this.hitFx.burst(e.body.x, e.def.height * 0.5, e.body.z, 0, 0, 1.6, FX_TINT.orb);
        this.damageNumbers.spawnText(e.body.x, Math.min(e.def.height, 2.4), e.body.z, e.phase >= 2 ? '激昂' : '怒り', 'warn', 1.5);
        this.sfx.play('bossRoar');
      }
      if (e.breakSerial !== entry.seenBreak) {
        entry.seenBreak = e.breakSerial;
        const fx = e.parryEffect;
        this.hitStop.trigger(fx.hitStop);
        this.cam.shake.trigger(fx.shake.amp, fx.shake.seconds);
        this.hitFx.burst(e.body.x, e.def.height * 0.6, e.body.z, 0, 0, fx.burst, FX_TINT.poise);
        this.damageNumbers.spawnText(e.body.x, Math.min(e.def.height + 0.35, 1.9), e.body.z, 'BREAK', 'break', fx.labelScale);
        this.sfx.play(fx.sfx);
      }
    }
  }

  /** ロック中の敵（なければ null） */
  private lockedEnemy(): Enemy | null {
    const id = this.lockOn.targetId;
    if (id === null) return null;
    return this.enemySims.find((e) => e.id === id) ?? null;
  }

  /** 戦闘を最初からやり直す（敵を消してプレイヤーを初期状態へ、ウェーブを 1 波目から）。リザルトの「もう一度」もこれを呼ぶ。def で構成を替えられる（開発用） */
  restart(def: EncounterDef = DEMO_ENCOUNTER): void {
    for (const { visual } of this.enemies) {
      this.scene.remove(visual.root);
      visual.dispose();
    }
    this.enemies.length = 0;
    this.enemySims.length = 0;
    this.player.reset();
    this.mystical.reset();
    this.mysticalWas = false;
    this.skills.reset();
    this.seenSkillSerial = this.player.skillSerial;
    this.seenArmor = this.player.armorSerial;
    this.seenSwing = this.player.swingSerial;
    this.inventory.reset();
    this.summonedIds.clear();
    this.lockOn.release();
    this.hitStop.reset();
    this.cam.shake.reset();
    this.hitFx.clear();
    this.groundFx.clear();
    this.lanes.clear();
    this.circles.clear();
    this.projectiles.clear();
    this.projectileFx.clear();
    this.swordTrail.clear();
    this.damageNumbers.clear();
    this.hud.hideResult();
    this.startEncounter(def);
  }

  private render(alpha: number, frameDt: number, draw = true): void {
    if (this.host.contextLost) return;
    this.host.renderer.info.reset();
    const now = performance.now();
    const t = (now - this.startTime) / 1000;
    // アニメーションは sim の時間スケール（ヒットストップ）に従う
    // ヒットストップ: sim だけ止める。アニメは sim の時間スケールに従い、カメラ・エフェクト・UI は実時間で進む
    this.loop.stepper.timeScale = this.paused ? 0 : this.hitStop.update(frameDt);
    const animDt = frameDt * this.loop.stepper.timeScale;
    this.player.syncVisual(alpha, animDt, frameDt);
    // ミスティカルドッジ中は、敵と敵の弾の見た目だけ遅い時間で進める（アニメの速さと、sim の補間）。プレイヤー・カメラ・エフェクトは等倍
    const enemyAlpha = this.mystical.visualAlpha(alpha);
    const enemyAnimDt = animDt * this.mystical.scale;
    for (const { enemy, visual } of this.enemies) visual.update(enemy, enemyAlpha, enemyAnimDt, frameDt);
    // 剣筋: アニメ更新直後の刃の位置を記録する。時間はアニメの時間（ヒットストップで止まる）
    if (this.player.getBladePoints(_bladeBase, _bladeTip)) {
      this.swordTrail.update(animDt, this.player.trailActive, _bladeBase, _bladeTip);
    }
    this.player.getInterpolatedPosition(alpha, _pos);
    // ボス（生きているもの）。カメラがボスの頭まで映るよう引くのに使い、HP バーにも使う
    let boss: Enemy | null = null;
    for (const e of this.enemySims) {
      if (e.def.boss && !e.dead) {
        boss = e;
        break;
      }
    }
    this.cam.boss = boss !== null;
    this.cam.update(_pos, frameDt);
    this.sky.follow(this.cam.camera);
    this.arena.animate(t);
    this.hitFx.update(frameDt);
    this.groundFx.update(frameDt);
    this.lanes.update(this.enemySims, frameDt);
    this.circles.update(this.enemySims);
    this.projectileFx.update(this.projectiles, enemyAlpha, enemyAnimDt);
    if (draw) this.post.render();
    this.damageNumbers.update(this.cam.camera, frameDt, this.host.width, this.host.height);
    const locked = this.lockedEnemy();
    this.enemyBars.update(this.cam.camera, this.enemySims, this.host.width, this.host.height, locked ? locked.id : null);
    this.lockMarker.update(
      this.cam.camera,
      locked ? { id: locked.id, x: locked.body.x, y: locked.def.height * 0.6, z: locked.body.z } : null,
      frameDt,
      this.host.width,
      this.host.height,
    );
    // ボスの HP は画面上部の専用のバーに出す（ロック対象のバーとは重ねない）。boss はカメラの更新の前に調べてある
    if (boss) {
      if (this.bossTicksFor !== boss.def.id) {
        this.bossTicksFor = boss.def.id;
        this.bossTicks = (boss.def.phases ?? []).map((p) => p.hpBelow);
      }
      this.hud.setBoss({ name: boss.def.name, hp: boss.health.hp, max: boss.health.max, poise: boss.poise ? boss.poise.ratio : null, phases: this.bossTicks });
    } else {
      this.hud.setBoss(null);
    }
    this.hud.setTarget(locked && !locked.def.boss ? { name: locked.def.name, hp: locked.health.hp, max: locked.health.max, poise: locked.poise ? locked.poise.ratio : null } : null);
    this.updateMoveGuide();
    this.updateMysticalHud();
    this.syncItemUi();
    this.syncSkillUi();
    // 実フレーム間隔で解像度を調整する。段が変わるとレンダターゲットを作り直すので、描画の後で行う
    const nextRatio = this.adaptive.update(frameDt * 1000);
    if (nextRatio !== null) this.host.setMaxPixelRatio(nextRatio);
    this.hud.updateDebug(frameDt, now, () => {
      const info = this.host.renderer.info.render;
      const e0 = this.enemies[0]?.enemy;
      const foe = e0 ? `${e0.state} hp ${e0.health.hp}/${e0.health.max}` : '-';
      return `sim ${this.loop.stepper.frame}  state ${this.player.state}:${this.player.stateFrame}  enemy ${foe}  lock ${this.lockOn.targetId ?? '-'}\n` +
        `calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k  dpr ${this.host.pixelRatio.toFixed(2)}`;
    });
  }
}
