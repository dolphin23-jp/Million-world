/**
 * 攻撃のフレームデータ（ADR-004）。
 * 定義はアニメーション区間上の「秒」で書き、resolveAttack() が sim フレーム（60Hz）に変換する。
 * これにより再生速度（rate）を変えても発生・持続・硬直の対応が崩れない。
 */

import { rootZCurve, type AuthoredAttack } from '../../character/authoring';
import { COMBO1 } from '../../character/data/combo1';
import { COMBO2 } from '../../character/data/combo2';
import { COMBO3 } from '../../character/data/combo3';
import { DODGE_BACK, DODGE_CLIP } from '../../character/data/dodge';
import { HEAVY, HEAVY_CHARGE } from '../../character/data/heavy';
import { LUNGE } from '../../character/data/lunge';
import { DASH } from '../../character/data/dash';
import { RETREAT } from '../../character/data/retreat';
import { SWEEP } from '../../character/data/sweep';
import { GS1, GS2 } from '../../character/data/gs-combo';
import { GS_DASH, GS_LUNGE, GS_RETREAT, GS_RISE, GS_SPIN } from '../../character/data/gs-moves';
import { GS_CHARGE, GS_HEAVY } from '../../character/data/gs-heavy';
import { GS_SMASH } from '../../character/data/gs-smash';
import { GS_DROP } from '../../character/data/gs-drop';
import { GS_HEAVY_RIP, GS_LUNGE_SWEEP, GS_RETREAT_LUNGE, GS_RISE_SLAM, GS_SPIN2 } from '../../character/data/gs-chain';
import { COMBO_HOP, COMBO_SPIN, COMBO_UPPER } from '../../character/data/combo-chain';
import { COMBO_SLAM, HOP_THRUST, LUNGE_SLASH, SWEEP_BACK } from '../../character/data/sword-chain';
import { SLAM_RIP, SPIN_REV, SPIN_RISE, SWALLOW } from '../../character/data/sword-chain-ex';
import { GS_BOUNCE, GS_CRUSH, GS_RETURN_SWEEP, GS_SPIN3, GS_SPIN_SLAM } from '../../character/data/gs-chain-ex';
import { SP1, SP2, SP3 } from '../../character/data/sp-combo';
import { SP_DASH, SP_LUNGE, SP_RETREAT, SP_RISE, SP_SPIN } from '../../character/data/sp-moves';
import { SP_CHARGE, SP_HEAVY } from '../../character/data/sp-heavy';
import { SP_PIERCE, SP_TWIRL, SP_UPPER } from '../../character/data/sp-chain';
import type { HitboxDef } from '../hit';
import type { SpellId } from './spells';

const deg = (d: number) => (d * Math.PI) / 180;

/**
 * 当たりの窓（ADR-031。多段ヒットの技）: 1 つの攻撃のなかに、当たりが出る時間帯を複数持つ（高速突き 5 連・回転斬りの前後など）。
 * 窓が無い攻撃は、従来どおり activeStart〜activeEnd の 1 つの窓（AttackDef.hitbox・ダメージ）。
 * 窓があるときも activeStart / activeEnd は「最初の窓の開始 / 最後の窓の終わり」に合わせておく（剣筋・テストが読む）。
 */
export interface HitWindow {
  /** 区間先頭からの秒（activeStart / activeEnd と同じ基準） */
  start: number;
  end: number;
  /** この窓の当たりの形（省略 = AttackDef.hitbox） */
  hitbox?: HitboxDef;
  /** 攻撃者の向きからのずれ（rad。回転斬りの後ろ半分 = π） */
  yawOffset?: number;
  /** この窓のダメージ・ノックバック・ヒットストップの倍率（省略 = 1） */
  damageScale?: number;
  knockbackScale?: number;
  hitStopScale?: number;
  /**
   * 「当てた記録」を共有する組。同じ値の窓は、同じ敵に重ねて当たらない（直撃と衝撃波が同じ敵に 2 回当たらない）。
   * 組が変わるたびに記録が消える（= 別の窓は同じ敵に当たり直す）。省略 = 窓ごとに別の組
   */
  group?: number;
}

/**
 * スーパーアーマー（ADR-031）: from〜to（区間先頭からの秒）のあいだ、breakDamage 未満のダメージではひるまない（ダメージは受ける。短い無敵はつく）。
 * breakDamage 以上の攻撃（岩鬼・ボスの重い攻撃など）には割られて、ひるむ（連なりも途切れる）
 */
export interface ArmorDef {
  from: number;
  to: number;
  breakDamage: number;
}

/** 地面を叩いた演出の 1 回ぶん（時刻 = 区間先頭からの秒、位置 = 攻撃者の正面へ m、強さ = 0.3〜1.5） */
export interface ImpactDef {
  t: number;
  dist: number;
  power: number;
}

/**
 * 詠唱（ADR-048。杖）: この攻撃は当たり判定を持たず、時刻 at に魔法 spell を放つ（Player.castSerial が増える。放つ魔法の中身は data/spells.ts）。
 * 放つ前に被弾して中断されたら魔法は出ない（スキルならクールダウンも消費しない）。回避でキャンセルできるのは放ったあとから（dodgeCancelAt を at の直後に置く）
 */
export interface CastDef {
  spell: SpellId;
  /** 魔法を放つ時刻（区間先頭からの秒。詠唱が終わる = 杖を振り下ろす・突き出す瞬間）。AttackDef.activeStart と同じにする */
  at: number;
  /** 持続魔法（火炎放射）: 放ったあと seconds 秒のあいだ、その場で保って放出し続け、向きだけ turnRate（rad/s）で変えられる。無ければ放ったら終わり（吹雪のように、放った向きに固定） */
  channel?: { seconds: number; turnRate: number };
}

export interface TipDef {
  from: number;
  scale: number;
}

export interface AttackDef {
  id: string;
  /** 使うアニメーション区間名（src/character/data/hero.ts の segments）。手付けの攻撃ではクリップ名（authored.name） */
  segment: string;
  /** 手付けアニメ（ADR-012）。あれば前進は lunge ではなく、この rootZ のカーブに従う */
  authored?: AuthoredAttack;
  /** 区間の長さ（秒）。resolve 時にアニメーター側の実測で上書きしてもよい */
  segmentDuration: number;
  /** 区間先頭からの秒: ヒット判定の開始・終了、次段キャンセル受付の開始 */
  activeStart: number;
  activeEnd: number;
  cancelAt: number;
  /** 剣筋（トレイル）を出す区間。区間先頭からの秒 [開始, 終了]。持続フレームの少し前から、振り抜きの終わりまで */
  trail: readonly [number, number];
  /** 再生速度 */
  rate: number;
  /** 持続中に前進する距離（m）。手付け（authored）の攻撃では使わない */
  lunge: number;
  /** 次段の攻撃 id。なければコンボ終端（branches があれば、スティックを倒して押したときだけ続きがある） */
  next?: string;
  /**
   * 次段の受付で、押した瞬間のスティックの向き（ロック中は対象に対して。classifyStick）で技を変える（ADR-023）。
   * 向きが無いとき（スティックを倒していない）は next。next が無い技では、ここに書いた向きで押したときだけ続きがある（コンボの延長）。
   * 前へ倒したままボタンを連打する人が多いので、next のある技の 'forward' は、普通の続き（next）を奪わない向き（横・後ろ）を使うこと
   */
  branches?: Partial<Record<'forward' | 'back' | 'side', string>>;
  /**
   * 地面を叩く技（ADR-023）: 剣が床に当たる時刻（区間先頭からの秒）と、そのとき剣先が床に触れる位置（攻撃者の正面へ m）、強さ（0.3〜1.5。砂ぼこり・揺れ・ヒットストップ）。
   * その時刻に砂ぼこりの輪・画面の揺れ・ヒットストップ・音を出す（敵に当たらなくても出る）
   */
  impact?: ImpactDef;
  /** 遅れて広がる、2 つ目以降の輪（飛翔崩山の二重の衝撃波。ADR-034）。impact と同じ形で、時刻ごとに地面の演出を出す */
  echoes?: readonly ImpactDef[];
  /** この攻撃へ入るときのクロスフェード秒（省略時 0.08）。前の技との姿勢差が大きいほど長くする */
  fade?: number;
  /**
   * 当たる領域（攻撃者の XZ 位置・向きに付く。ADR-014）。持続フレーム（activeStart〜activeEnd）のあいだ毎フレーム評価する。
   * 数値は技の見た目に合わせる: 斬りは振りの弧（扇形）、突きは剣の伸びる線。届く距離は腕と剣の長さ（約 1.8m）＋ 踏み込み分
   */
  hitbox: HitboxDef;
  /** ダメージ・ヒットストップ長（sim フレーム）・ノックバック（m） */
  damage: number;
  hitStop: number;
  knockback: number;
  /** 多段ヒットの当たりの窓（HitWindow）。無ければ activeStart〜activeEnd の 1 つ */
  windows?: readonly HitWindow[];
  /** スーパーアーマー（ArmorDef）。無ければひるむ */
  armor?: ArmorDef;
  /** 詠唱（杖）。あれば当たり判定は持たず、at に魔法を放つ（CastDef） */
  cast?: CastDef;
  /**
   * 穂先の利（槍。ADR-049）: 攻撃者の中心から相手の中心までの距離が from（m）以上の命中は、ダメージが scale 倍になる（HitEvent.tip）。
   * 近づきすぎず、間合いの先端で当てる遊び。技の長さ（hitbox）の外縁の手前に from を置く。ほかの武器は持たない
   */
  tip?: TipDef;
  /** 回避・ガードでキャンセルできるようになる時刻（区間先頭からの秒）。省略 = activeEnd（持続の終わり）。多段の技は、最初の窓のあとに置くと途中でやめられる。溜めのある技は、溜めの途中（activeStart より前）にも置ける */
  dodgeCancelAt?: number;
}

/** resolveAttack が sim フレームに直した当たりの窓。start は含み、end は含まない（isActiveFrame と同じ） */
export interface ResolvedWindow {
  start: number;
  end: number;
  def: HitWindow;
  /** 記録を共有する組（HitWindow.group。省略は窓の番号） */
  group: number;
}

export interface AttackFrames {
  startup: number;
  active: number;
  recovery: number;
  cancelFrame: number;
  total: number;
  /** 回避・ガードでキャンセルできるフレーム（既定は持続の終わり） */
  dodgeCancel: number;
  /** 当たりの窓（フレーム）。窓が無い攻撃は空 */
  windows: readonly ResolvedWindow[];
  /** スーパーアーマーの区間（フレーム。from 含む・to 含まない）と、割れるダメージ。無ければ null */
  armor: { from: number; to: number; breakDamage: number } | null;
  /** 地面を叩く演出の時刻（フレーム）と位置・強さ。impact と echoes を時刻の順に。無ければ空 */
  impacts: readonly { frame: number; dist: number; power: number }[];
}

export function resolveAttack(a: AttackDef): AttackFrames {
  const toFrames = (sec: number) => Math.max(0, Math.round((sec * 60) / a.rate));
  const startup = toFrames(a.activeStart);
  const activeEndF = Math.max(startup + 1, toFrames(a.activeEnd));
  const total = Math.max(activeEndF + 1, toFrames(a.segmentDuration));
  const windows: ResolvedWindow[] = (a.windows ?? []).map((w, i) => {
    const start = toFrames(w.start);
    return { start, end: Math.max(start + 1, toFrames(w.end)), def: w, group: w.group ?? i };
  });
  return {
    startup,
    active: activeEndF - startup,
    recovery: total - activeEndF,
    cancelFrame: Math.min(total, Math.max(activeEndF, toFrames(a.cancelAt))),
    total,
    dodgeCancel: a.dodgeCancelAt === undefined ? activeEndF : Math.min(total, Math.max(1, toFrames(a.dodgeCancelAt))),
    windows,
    armor: a.armor ? { from: toFrames(a.armor.from), to: toFrames(a.armor.to), breakDamage: a.armor.breakDamage } : null,
    impacts: [...(a.impact ? [a.impact] : []), ...(a.echoes ?? [])].map((im) => ({ frame: toFrames(im.t), dist: im.dist, power: im.power })),
  };
}

/** 手付けの攻撃の前進カーブ（開始からの秒 → ルートの前進量 m）。初回に作って使い回す */
const rootCurves = new Map<string, (t: number) => number>();
export function rootMotionOf(a: AttackDef): ((t: number) => number) | null {
  if (!a.authored) return null;
  let c = rootCurves.get(a.id);
  if (!c) rootCurves.set(a.id, (c = rootZCurve(a.authored)));
  return c;
}

export const ATTACKS: Record<string, AttackDef> = {
  // 1 段目: 手付けの右袈裟斬り（src/character/data/combo1.ts、0.66s）。予備動作 0 → 0.17、斬り 0.17 → 0.31。
  // 剣先は 0.233s に体の前を通る最高速（約 89m/s = 1 フレーム 1.5m。tools/scratch/combo-diag.scratch.ts で実測）なので、当たりはその前後 0.20〜0.28s。
  // 前足（左）は 0.235 に腰の 0.36 m 前へ着地し（腰が 0.14 m 沈む）、ルートは 0.57m 進む（0.37s まで）。振り抜き（〜0.37s）の終わりから次段を受け付ける。
  combo1: {
    id: 'combo1',
    segment: 'combo1',
    authored: COMBO1,
    segmentDuration: COMBO1.duration,
    activeStart: 0.2,
    activeEnd: 0.28,
    cancelAt: 0.37,
    trail: [0.14, 0.38],
    rate: 1,
    lunge: 0,
    next: 'combo2',
    // 受付でロック中にスティックを後ろへ倒して押すと、跳び退き斬り上げ（comboHop。ADR-023）。そのまま押せば 2 段目
    branches: { back: 'comboHop' },
    hitbox: { kind: 'arc', range: 2.0, halfAngle: deg(65) },
    damage: 10,
    hitStop: 4,
    knockback: 0.3,
  },
  // 2 段目: 手付けの右逆袈裟（src/character/data/combo2.ts、0.67s）。1 段目の受付時点（0.37s）の姿勢から続けて始まる（continueFrom）。
  // 右足が弧を描いて 0.16s に腰の 0.3 m 前へ着地し、剣先が体の前を通る最高速は 0.167s（約 67m/s）。当たりはその前後 0.14〜0.21s。
  // 振り抜き（〜0.34s）の終わりから次段を受け付ける。踏み込みはルート 0.58m（0.26s まで）。
  combo2: {
    id: 'combo2',
    segment: 'combo2',
    authored: COMBO2,
    segmentDuration: COMBO2.duration,
    activeStart: 0.14,
    activeEnd: 0.21,
    cancelAt: 0.34,
    trail: [0.09, 0.32],
    rate: 1,
    lunge: 0,
    next: 'combo3',
    // 受付でロック中にスティックを横へ倒して押すと、回転斬り（comboSpin）。そのまま押せば 3 段目
    branches: { side: 'comboSpin' },
    hitbox: { kind: 'arc', range: 2.0, halfAngle: deg(65) },
    damage: 12,
    hitStop: 5,
    knockback: 0.4,
    fade: 0.05,
  },
  // 3 段目: 手付けの突き（src/character/data/combo3.ts、0.64s）。2 段目の受付時点（0.34s）の姿勢から続けて始まる。
  // 引き絞りは 0〜0.13s、突き出しは 0.13〜0.2s（剣先が体の前へ伸び切る）。右足は 0.17s に着地し、当たりは 0.15〜0.24s。
  // 踏み込みは幅 0.8m のランジでルート 0.6m（0.3s まで）。
  combo3: {
    id: 'combo3',
    segment: 'combo3',
    authored: COMBO3,
    segmentDuration: COMBO3.duration,
    activeStart: 0.15,
    activeEnd: 0.24,
    // 受付は突き切った姿勢を保つ 0.34s から。前へ倒して押したときだけ打ち上げ（comboUpper）に続く（そのまま押すだけでは続かない。3 連で終わる。ADR-023）
    cancelAt: 0.34,
    trail: [0.1, 0.34],
    rate: 1,
    lunge: 0,
    branches: { forward: 'comboUpper' },
    hitbox: { kind: 'line', length: 2.2, radius: 0.3 },
    damage: 18,
    hitStop: 8,
    knockback: 1.2,
    fade: 0.05,
  },
  // 跳び退き斬り上げ（1 段目の受付でロック中に後ろへ倒して攻撃。ADR-023）: 左前下へ振り抜いた剣を引き込み、後ろへ 1.0 m 跳びながら左下から右上へ斬り上げる。0.17 に前を通る最高速。当たりは跳び始めの 0.13〜0.22s。
  // 間合いを取り直しながら敵を押し返す安全な逆襲（下がりながらの払いより威力が高い）。1 段目の受付時点（0.37s）の姿勢から続ける（continueFrom）。
  comboHop: {
    id: 'comboHop',
    segment: 'comboHop',
    authored: COMBO_HOP,
    segmentDuration: COMBO_HOP.duration,
    activeStart: 0.13,
    activeEnd: 0.22,
    // 跳び退いて着地したあと（右上へ抜けた姿勢を保つ 0.26〜0.4s）に前へ倒して攻撃すると飛び込み突き（ADR-024）
    cancelAt: 0.32,
    trail: [0.08, 0.28],
    rate: 1,
    lunge: 0,
    branches: { forward: 'hopThrust' },
    hitbox: { kind: 'arc', range: 2.1, halfAngle: deg(75) },
    damage: 12,
    hitStop: 6,
    knockback: 1.8,
    fade: 0.05,
  },
  // 回転斬り（2 段目の受付でロック中に横へ倒して攻撃。ADR-023）: 右上へ振り抜いた体を右へ巻き込んで沈み、跳び上がって体ごと左へ 1 回転しながら水平の円を描く。回転は 0.12〜0.34s、剣が全周を通るのは 0.16〜0.32s（当たりもこの間）。
  // 全方位を薙ぐ。2 段目の受付時点（0.34s）の姿勢から続ける（continueFrom）。
  comboSpin: {
    id: 'comboSpin',
    segment: 'comboSpin',
    authored: COMBO_SPIN,
    segmentDuration: COMBO_SPIN.duration,
    activeStart: 0.16,
    activeEnd: 0.32,
    // 着地して剣を右へ伸ばした姿勢を保つ 0.4〜0.5s に、ロック中に横へ倒して攻撃すると、逆回転斬り（ADR-047）
    cancelAt: 0.44,
    trail: [0.12, 0.34],
    rate: 1,
    lunge: 0,
    branches: { side: 'spinRev' },
    hitbox: { kind: 'arc', range: 2.1, halfAngle: deg(180) },
    damage: 15,
    hitStop: 7,
    knockback: 1.6,
    fade: 0.05,
  },
  // 打ち上げ（3 段目の突きの受付で前へ倒して攻撃。ADR-023）: 突き切った剣を右腰へ引き戻して沈み、跳び上がりながら下から縦に斬り上げる。0.2 に前を通る最高速。当たりは 0.16〜0.27s。
  // 敵を打ち上げるような強い一撃（片手剣の 4 段目に当たる。ダメージは 3 段目より大きく、ノックバックも大きい）。3 段目の受付時点（0.34s）の姿勢から続ける（continueFrom）。
  comboUpper: {
    id: 'comboUpper',
    segment: 'comboUpper',
    authored: COMBO_UPPER,
    segmentDuration: COMBO_UPPER.duration,
    activeStart: 0.16,
    activeEnd: 0.27,
    // 着地して剣を頭上へ掲げた姿勢を保つ 0.42〜0.52s から、落下斬りへ続く（ADR-024）
    cancelAt: 0.42,
    trail: [0.1, 0.32],
    rate: 1,
    lunge: 0,
    next: 'comboSlam',
    hitbox: { kind: 'arc', range: 2.3, halfAngle: deg(60) },
    damage: 22,
    hitStop: 10,
    knockback: 2.6,
    fade: 0.06,
  },
  // 重撃（溜めを放つ）: 手付けの縦斬り（src/character/data/heavy.ts、0.62s）。溜め（CHARGES.sword の構え = 頭上）から始まり、右足を踏み込んで 0.18s に剣が体の前を水平に通る最高速（約 84m/s）、
  // 0.25s で前下に叩きつけて止まる。当たりは最高速の前後 0.15〜0.23s（5 フレーム）。右足が 0.18s に腰の 0.4 m 前へ飛び込んで着地し、ルートは 0.81m 進む（単発なので戻りの途中まで進んでよい）。
  // 溜めの段階で威力が上がる（CHARGES.sword.levelPower）。次段は無い（単発）。
  heavy: {
    id: 'heavy',
    segment: 'heavy',
    authored: HEAVY,
    segmentDuration: HEAVY.duration,
    activeStart: 0.15,
    activeEnd: 0.23,
    cancelAt: 999,
    trail: [0.1, 0.34],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'arc', range: 2.2, halfAngle: deg(55) },
    damage: 34,
    hitStop: 12,
    knockback: 2.2,
    fade: 0.04,
  },
  // 踏み込み突き（スティック前 + 攻撃）: 大きく踏み込んで体ごと突く。距離を詰める技。右足が 0.21s に腰の 0.45 m 前へ着地し、ルートは 1.3 m 進む。当たりは最高速（0.21s）の前後 0.17〜0.27s。
  lunge: {
    id: 'lunge',
    segment: 'lunge',
    authored: LUNGE,
    segmentDuration: LUNGE.duration,
    activeStart: 0.17,
    activeEnd: 0.27,
    // 突き切った姿勢を保つ 0.42〜0.5s から、抜き払いへ続く（ADR-024）
    cancelAt: 0.42,
    trail: [0.12, 0.34],
    rate: 1,
    lunge: 0,
    next: 'lungeSlash',
    hitbox: { kind: 'line', length: 2.6, radius: 0.34 },
    damage: 14,
    hitStop: 7,
    knockback: 1.4,
    fade: 0.06,
  },
  // ダッシュ斬り（ロール直後）: 着地の低い姿勢から、右足を踏み込んで剣を右下から左上へ斜めにすくい上げる（逆袈裟の斬り上げ）。0.17s に剣が前を通る最高速。当たりは 0.14〜0.23s。ロールの着地の姿勢から続ける（continueFrom）。
  dash: {
    id: 'dash',
    segment: 'dash',
    authored: DASH,
    segmentDuration: DASH.duration,
    activeStart: 0.14,
    activeEnd: 0.23,
    cancelAt: 999,
    trail: [0.09, 0.32],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'arc', range: 2.2, halfAngle: deg(70) },
    damage: 16,
    hitStop: 8,
    knockback: 1.0,
    fade: 0.05,
  },
  // 下がりながらの払い（ロック中に後ろ + 攻撃）: 後ろへ 1.1 m 跳びながら右から左へ水平に払って敵を押し返す。0.16s に前を通る最高速。当たりは 0.135〜0.215s（跳び始め）。
  retreat: {
    id: 'retreat',
    segment: 'retreat',
    authored: RETREAT,
    segmentDuration: RETREAT.duration,
    activeStart: 0.135,
    activeEnd: 0.215,
    cancelAt: 999,
    trail: [0.1, 0.3],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'arc', range: 2.1, halfAngle: deg(85) },
    damage: 9,
    hitStop: 5,
    knockback: 1.8,
    fade: 0.06,
  },
  // 横薙ぎ（ロック中に横 + 攻撃）: 右へ大きくひねって溜め、左足を踏み込みながら体ごと右から左へ水平に薙ぐ。範囲が広い。0.23s に前を通る最高速。当たりは 0.19〜0.28s。
  sweep: {
    id: 'sweep',
    segment: 'sweep',
    authored: SWEEP,
    segmentDuration: SWEEP.duration,
    activeStart: 0.19,
    activeEnd: 0.28,
    // 払い切った姿勢を保つ 0.38〜0.52s から、返し薙ぎへ続く（ADR-024）
    cancelAt: 0.4,
    trail: [0.15, 0.38],
    rate: 1,
    lunge: 0,
    next: 'sweepBack',
    hitbox: { kind: 'arc', range: 2.2, halfAngle: deg(105) },
    damage: 13,
    hitStop: 6,
    knockback: 1.2,
    fade: 0.07,
  },

  // ---- 片手剣の連携の続き（ADR-024。src/character/data/sword-chain.ts）----
  // 返し薙ぎ（横薙ぎの受付で攻撃）: 左へ薙ぎ抜けた剣を左から右へ薙ぎ返す。0.18 に体の前を通る最高速（右足が着地）。当たりは 0.14〜0.22s。
  sweepBack: {
    id: 'sweepBack',
    segment: 'sweepBack',
    authored: SWEEP_BACK,
    segmentDuration: SWEEP_BACK.duration,
    activeStart: 0.14,
    activeEnd: 0.22,
    cancelAt: 999,
    trail: [0.07, 0.3],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'arc', range: 2.2, halfAngle: deg(105) },
    damage: 11,
    hitStop: 6,
    knockback: 1.2,
    fade: 0.05,
  },
  // 抜き払い（踏み込み突きの受付で攻撃）: 突き切った剣を右腰へ引き戻しながら左足を踏み抜けて、右から左へ水平に払う。0.19 に前を通る最高速。当たりは 0.15〜0.23s。
  lungeSlash: {
    id: 'lungeSlash',
    segment: 'lungeSlash',
    authored: LUNGE_SLASH,
    segmentDuration: LUNGE_SLASH.duration,
    activeStart: 0.15,
    activeEnd: 0.23,
    cancelAt: 999,
    trail: [0.1, 0.32],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'arc', range: 2.3, halfAngle: deg(100) },
    damage: 15,
    hitStop: 7,
    knockback: 1.4,
    fade: 0.05,
  },
  // 飛び込み突き（跳び退き斬り上げの受付で前へ倒して攻撃）: 取り直した間合いを右足から大きく飛び込んで突き返す（1.5 m）。0.22 に最高速。当たりは 0.18〜0.28s。
  hopThrust: {
    id: 'hopThrust',
    segment: 'hopThrust',
    authored: HOP_THRUST,
    segmentDuration: HOP_THRUST.duration,
    activeStart: 0.18,
    activeEnd: 0.28,
    cancelAt: 999,
    trail: [0.12, 0.36],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'line', length: 2.8, radius: 0.34 },
    damage: 18,
    hitStop: 8,
    knockback: 1.8,
    fade: 0.05,
  },
  // 落下斬り（打ち上げの受付で攻撃）: もう一度跳び上がって、真上から叩きつける。0.24 に最高速、0.27 に剣が床を叩く（小さな衝撃の輪）。当たりは 0.22〜0.3s。
  comboSlam: {
    id: 'comboSlam',
    segment: 'comboSlam',
    authored: COMBO_SLAM,
    segmentDuration: COMBO_SLAM.duration,
    activeStart: 0.22,
    activeEnd: 0.3,
    // 叩きつけた姿勢を保つ 0.28〜0.42s に前へ倒して攻撃すると、地擦り斬り上げ（ADR-047）
    cancelAt: 0.34,
    trail: [0.12, 0.34],
    rate: 1,
    lunge: 0,
    impact: { t: 0.28, dist: 1.5, power: 0.55 },
    branches: { forward: 'slamRip' },
    hitbox: { kind: 'arc', range: 2.3, halfAngle: deg(60) },
    damage: 26,
    hitStop: 11,
    knockback: 2.4,
    fade: 0.05,
  },

  // ---- 片手剣の連携の続き 第 2 弾（ADR-047。src/character/data/sword-chain-ex.ts）----
  // 地擦り斬り上げ（落下斬りの受付で前へ倒して攻撃）: 床に叩きつけた剣を、地面をかすめて右下から左上へ斬り上げる。0.17 に前を通る最高速（右足が着地）。当たりは 0.14〜0.22s。
  slamRip: {
    id: 'slamRip',
    segment: 'slamRip',
    authored: SLAM_RIP,
    segmentDuration: SLAM_RIP.duration,
    activeStart: 0.14,
    activeEnd: 0.22,
    // 左上へ振り上げた姿勢を保つ 0.28〜0.42s から、燕返しへ続く
    cancelAt: 0.34,
    trail: [0.08, 0.3],
    rate: 1,
    lunge: 0,
    next: 'swallow',
    hitbox: { kind: 'arc', range: 2.3, halfAngle: deg(70) },
    damage: 20,
    hitStop: 8,
    knockback: 2.0,
    fade: 0.05,
  },
  // 逆回転斬り（回転斬りの受付でロック中に横へ倒して攻撃）: 右へ回り切った体を左へ引き戻して沈み、跳び上がって今度は右へ 1 回転しながら水平の円を描く（回転斬りと逆向きの旋風）。回転は 0.12〜0.34s、剣が全周を通るのは 0.16〜0.32s（当たりもこの間）。
  spinRev: {
    id: 'spinRev',
    segment: 'spinRev',
    authored: SPIN_REV,
    segmentDuration: SPIN_REV.duration,
    activeStart: 0.16,
    activeEnd: 0.32,
    // 着地して剣を左へ伸ばした姿勢を保つ 0.44〜0.54s から、回転斬り上げへ続く
    cancelAt: 0.46,
    trail: [0.12, 0.34],
    rate: 1,
    lunge: 0,
    next: 'spinRise',
    hitbox: { kind: 'arc', range: 2.1, halfAngle: deg(180) },
    damage: 16,
    hitStop: 7,
    knockback: 1.6,
    fade: 0.05,
  },
  // 回転斬り上げ（逆回転斬りの受付で攻撃）: 回り切って左へ伸ばした剣を左下へ引き込み、前へ跳び上がりながら左下から右上へ斬り上げる。0.2 に前を通る最高速。当たりは 0.15〜0.26s。旋風の締め（敵を打ち上げる強い一撃）。
  spinRise: {
    id: 'spinRise',
    segment: 'spinRise',
    authored: SPIN_RISE,
    segmentDuration: SPIN_RISE.duration,
    activeStart: 0.15,
    activeEnd: 0.26,
    cancelAt: 999,
    trail: [0.1, 0.32],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'arc', range: 2.3, halfAngle: deg(65) },
    damage: 22,
    hitStop: 10,
    knockback: 2.6,
    fade: 0.06,
  },
  // 燕返し（地擦り斬り上げの受付で攻撃。片手剣の 7 連目）: 左上へ斬り上げた剣を、同じ線で右下へ斬り下ろし（0.15 に最高速）、間を置かず斬り上げ返す（0.28 に最高速）。当たりは 2 つ（2 つ目が強い）。連携の締め。
  swallow: {
    id: 'swallow',
    segment: 'swallow',
    authored: SWALLOW,
    segmentDuration: SWALLOW.duration,
    activeStart: 0.135,
    activeEnd: 0.315,
    cancelAt: 999,
    trail: [0.08, 0.38],
    rate: 1,
    lunge: 0,
    windows: [
      { start: 0.135, end: 0.185, damageScale: 0.9, hitStopScale: 0.6 },
      { start: 0.265, end: 0.315, damageScale: 1.6, knockbackScale: 1.8, hitStopScale: 1.5 },
    ],
    hitbox: { kind: 'arc', range: 2.3, halfAngle: deg(75) },
    damage: 16,
    hitStop: 8,
    knockback: 1.6,
    // 1 つ目の太刀のあとなら、回避でやめられる
    dodgeCancelAt: 0.2,
    fade: 0.05,
  },

  // ======== 大剣（両手持ち。src/character/data/gs-*.ts。ADR-021）========
  // 重く手数は少ない。片手剣の同種の技より、予備動作が長く（0.3 秒）、ダメージは約 2 倍、範囲は広く、ヒットストップとノックバックは大きい。硬直も長い。
  // 1 段目: 右上から左下への袈裟斬り（0.92s）。0 → 0.3 振りかぶる（0.24〜0.3 は頂点で一拍）、0.37 に体の前を通る最高速、左足は 0.37 に着地。当たりはその前後 0.32〜0.42s（6 フレーム）。
  // 振り抜き（〜0.44s）の終わりから次段を受け付ける（0.56s の姿勢を保つ）。ルートは 0.7m（0.5s まで）。
  gs1: {
    id: 'gs1',
    segment: 'gs1',
    authored: GS1,
    segmentDuration: GS1.duration,
    activeStart: 0.32,
    activeEnd: 0.42,
    cancelAt: 0.56,
    trail: [0.26, 0.5],
    rate: 1,
    lunge: 0,
    next: 'gs2',
    // 受付でスティックを横へ倒して押すと、連携回転斬り（gsSpin2）。そのまま押せば 2 段目（ADR-023）
    branches: { side: 'gsSpin2' },
    hitbox: { kind: 'arc', range: 2.7, halfAngle: deg(85) },
    damage: 22,
    hitStop: 8,
    knockback: 1.0,
    fade: 0.1,
  },
  // 2 段目: 左下から右上への逆袈裟（0.86s）。1 段目の受付時点（0.56s）の姿勢から続けて始まる。0.21 に体の前を通る最高速（右足が着地）。当たりは 0.17〜0.27s。コンボの終わり（硬直は長い）。
  gs2: {
    id: 'gs2',
    segment: 'gs2',
    authored: GS2,
    segmentDuration: GS2.duration,
    activeStart: 0.17,
    activeEnd: 0.27,
    // 受付は振り抜きの姿勢を保つ 0.46s から。前へ倒して押したときだけ叩き落とし（gsDrop）に続く（そのまま押すだけでは続かない。2 連で終わる）
    cancelAt: 0.46,
    trail: [0.1, 0.34],
    rate: 1,
    lunge: 0,
    branches: { forward: 'gsDrop' },
    hitbox: { kind: 'arc', range: 2.8, halfAngle: deg(90) },
    damage: 30,
    hitStop: 10,
    knockback: 1.6,
    fade: 0.05,
  },
  // 踏み込み突き（スティック前 + 攻撃）: 腰を落として引き絞り（0.18〜0.27 は一拍）、0.35 に最高速で貫く（右足が着地）。点で突くので範囲は狭い（線）が、届く距離は長く（3.0m）、威力と踏み込み（1.5m）が大きい。当たりは 0.3〜0.42s。
  gsLunge: {
    id: 'gsLunge',
    segment: 'gsLunge',
    authored: GS_LUNGE,
    segmentDuration: GS_LUNGE.duration,
    activeStart: 0.3,
    activeEnd: 0.42,
    // 突き切った姿勢を保つ 0.5〜0.66s から、突き払いへ続く（ADR-024）
    cancelAt: 0.5,
    trail: [0.24, 0.5],
    rate: 1,
    lunge: 0,
    next: 'gsLungeSweep',
    hitbox: { kind: 'line', length: 3.0, radius: 0.36 },
    damage: 26,
    hitStop: 9,
    knockback: 2.2,
    fade: 0.1,
  },
  // 下がりながらの薙ぎ払い（ロック中に後ろ + 攻撃）: 後ろへ 1.3m 跳びながら、右から左へ水平に薙いで敵を押し返す。0.2 に前を通る最高速。当たりは 0.15〜0.27s（跳び始め）。
  gsRetreat: {
    id: 'gsRetreat',
    segment: 'gsRetreat',
    authored: GS_RETREAT,
    segmentDuration: GS_RETREAT.duration,
    activeStart: 0.15,
    activeEnd: 0.27,
    // 払い切って着地した姿勢を保つ 0.38〜0.5s に前へ倒して攻撃すると、飛び込み突き（ADR-024）
    cancelAt: 0.4,
    trail: [0.1, 0.34],
    rate: 1,
    lunge: 0,
    branches: { forward: 'gsRetreatLunge' },
    hitbox: { kind: 'arc', range: 2.8, halfAngle: deg(100) },
    damage: 18,
    hitStop: 6,
    knockback: 2.4,
    fade: 0.1,
  },
  // 大回転斬り（ロック中に横 + 攻撃）: 腰を沈めて右へ巻き込み、跳び上がって体ごと 1 回転する。全方位（円）を薙ぐ。回転は 0.2〜0.4s、剣が全周を通るのは 0.22〜0.44s（当たりもこの間）。
  gsSpin: {
    id: 'gsSpin',
    segment: 'gsSpin',
    authored: GS_SPIN,
    segmentDuration: GS_SPIN.duration,
    activeStart: 0.22,
    activeEnd: 0.44,
    cancelAt: 999,
    trail: [0.18, 0.46],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'arc', range: 2.7, halfAngle: deg(180) },
    damage: 30,
    hitStop: 9,
    knockback: 2.0,
    fade: 0.1,
  },
  // 跳び叩きつけ（ロール直後）: 転がって着地した低い姿勢から、剣を引き上げて前へ 1.6m 跳び、真上から叩きつける（0.36 に両足で着地）。当たりは叩きつけの 0.3〜0.4s。ロールの着地の姿勢（0.43s）から続ける。
  gsDash: {
    id: 'gsDash',
    segment: 'gsDash',
    authored: GS_DASH,
    segmentDuration: GS_DASH.duration,
    activeStart: 0.3,
    activeEnd: 0.4,
    cancelAt: 999,
    trail: [0.22, 0.46],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'arc', range: 2.8, halfAngle: deg(65) },
    damage: 34,
    hitStop: 12,
    knockback: 2.6,
    fade: 0.05,
  },
  // 斬り上げ（後ろステップ直後）: 下がったあと、低い姿勢から踏み込んで右下から左上へすくい上げる。0.23 に前を通る最高速（右足が着地）。当たりは 0.18〜0.28s。後ろステップの着地の姿勢（0.36s）から続ける。
  gsRise: {
    id: 'gsRise',
    segment: 'gsRise',
    authored: GS_RISE,
    segmentDuration: GS_RISE.duration,
    activeStart: 0.18,
    activeEnd: 0.28,
    // 左上へ振り抜いた姿勢を保つ 0.34〜0.5s から、飛翔叩きつけへ続く（ADR-024）
    cancelAt: 0.38,
    trail: [0.12, 0.38],
    rate: 1,
    lunge: 0,
    next: 'gsRiseSlam',
    hitbox: { kind: 'arc', range: 2.7, halfAngle: deg(80) },
    damage: 24,
    hitStop: 8,
    knockback: 1.8,
    fade: 0.05,
  },
  // 溜め斬り（溜めを放つ。CHARGES.greatsword）: 頭上の構えから、左足を大きく踏み込んで真上から真下へ叩き割る（唐竹割り）。0.22 に体の前を通る最高速（左足が着地）、0.3 に叩きつけて止まる。
  // 当たりは 0.17〜0.3s（8 フレーム）。範囲は広い扇形（3.0m、180°）。威力は溜めの段階で上がる。ルートは 1.3m 進む。
  gsHeavy: {
    id: 'gsHeavy',
    segment: 'gsHeavy',
    authored: GS_HEAVY,
    segmentDuration: GS_HEAVY.duration,
    activeStart: 0.17,
    activeEnd: 0.3,
    // 叩きつけた姿勢を保つ 0.3〜0.58s から、地擦り斬り上げへ続く（ADR-024）
    cancelAt: 0.4,
    trail: [0.12, 0.4],
    rate: 1,
    lunge: 0,
    next: 'gsHeavyRip',
    hitbox: { kind: 'arc', range: 3.0, halfAngle: deg(90) },
    damage: 60,
    hitStop: 14,
    knockback: 3.4,
    fade: 0.04,
  },
  // 連携回転斬り（1 段目の受付で横へ倒して攻撃。ADR-023）: 左前下へ振り抜いた剣を引き込んで沈み、跳び上がって体ごと右へ 1 回転しながら水平の円を描く。全方位を薙ぐ（円）。
  // 回転は 0.14〜0.42s、剣が全周を通るのは 0.2〜0.38s（当たりもこの間）。1 段目の受付時点（0.56s）の姿勢から続ける（continueFrom）。
  gsSpin2: {
    id: 'gsSpin2',
    segment: 'gsSpin2',
    authored: GS_SPIN2,
    segmentDuration: GS_SPIN2.duration,
    activeStart: 0.2,
    activeEnd: 0.4,
    // 着地して沈んだ姿勢を保つ 0.46〜0.64s に、ロック中に横へ倒して攻撃すると、逆の大回転（ADR-047）
    cancelAt: 0.5,
    trail: [0.16, 0.44],
    rate: 1,
    lunge: 0,
    branches: { side: 'gsSpin3' },
    hitbox: { kind: 'arc', range: 2.7, halfAngle: deg(180) },
    damage: 28,
    hitStop: 9,
    knockback: 2.0,
    fade: 0.06,
  },
  // 叩き落とし（2 段目の受付で前へ倒して攻撃。ADR-023）: 2 段目の斬り上げで右上へ抜けた剣を、右肩の後ろへ振りかぶり直して、左前の床へ斜めに叩き落とす。0.24 に最高速、0.29 に切っ先が床を叩いて止まり（小さな衝撃の輪）、少し跳ね返る。
  // 当たりは 0.22〜0.35s（床に着く手前から跳ね返りまで）。2 連の締めの重い一撃（地割りの 6 割）。2 段目の受付時点（0.46s）の姿勢から続ける（continueFrom）。
  gsDrop: {
    id: 'gsDrop',
    segment: 'gsDrop',
    authored: GS_DROP,
    segmentDuration: GS_DROP.duration,
    activeStart: 0.22,
    activeEnd: 0.35,
    // 落ち着いた姿勢を保つ 0.5〜0.62s に前へ倒して攻撃すると、跳ね上げ（ADR-047）
    cancelAt: 0.52,
    trail: [0.14, 0.37],
    rate: 1,
    lunge: 0,
    impact: { t: 0.29, dist: 1.7, power: 0.7 },
    branches: { forward: 'gsBounce' },
    hitbox: { kind: 'arc', range: 3.0, halfAngle: deg(95) },
    damage: 38,
    hitStop: 11,
    knockback: 2.8,
    fade: 0.06,
  },
  // 地割り（溜めを最大まで溜めて放つ。CHARGES.greatsword.levelNext。ADR-023）: さらに高く振りかぶって沈み、左足を踏み込んで真上から床へ叩きつける。0.24 に体の前を通る最高速、0.3 に切っ先が床を叩いて止まり（衝撃の輪・ひび割れ・砂ぼこり）、
  // 剣が少し跳ね返って（0.4 に最高、切っ先の高さ 0.5m）沈んで落ち着く。当たりは床に着く手前から跳ね返りまで 0.26〜0.4s（9 フレーム）で、衝撃が周りへ広がる分、範囲は広い（3.3m、220°）。威力は溜めの段階（最大 1.8 倍）。硬直は長い（1.1s）。
  gsSmash: {
    id: 'gsSmash',
    segment: 'gsSmash',
    authored: GS_SMASH,
    segmentDuration: GS_SMASH.duration,
    activeStart: 0.26,
    activeEnd: 0.4,
    cancelAt: 999,
    trail: [0.14, 0.42],
    rate: 1,
    lunge: 0,
    impact: { t: 0.3, dist: 1.9, power: 1 },
    hitbox: { kind: 'arc', range: 3.3, halfAngle: deg(110) },
    damage: 60,
    hitStop: 14,
    knockback: 3.8,
    fade: 0.04,
  },

  // ---- 大剣の連携の続き（ADR-024。src/character/data/gs-chain.ts）----
  // 突き払い（踏み込み突きの受付で攻撃）: 突き切った剣を右へ引き戻しながら左足を踏み抜けて、右から左へ水平に薙ぎ払う。0.24 に前を通る最高速。当たりは 0.2〜0.3s。
  gsLungeSweep: {
    id: 'gsLungeSweep',
    segment: 'gsLungeSweep',
    authored: GS_LUNGE_SWEEP,
    segmentDuration: GS_LUNGE_SWEEP.duration,
    activeStart: 0.2,
    activeEnd: 0.3,
    // 左へ払い切った姿勢を保つ 0.36〜0.48s から、薙ぎ返しへ続く（ADR-047）
    cancelAt: 0.44,
    trail: [0.14, 0.38],
    rate: 1,
    lunge: 0,
    next: 'gsReturnSweep',
    hitbox: { kind: 'arc', range: 2.9, halfAngle: deg(100) },
    damage: 30,
    hitStop: 9,
    knockback: 2.2,
    fade: 0.05,
  },
  // 飛び込み突き（下がりながらの薙ぎ払いの受付で前へ倒して攻撃）: 取り直した間合いを牛の構えから飛び込んで貫く（1.65 m）。0.35 に最高速。当たりは 0.31〜0.41s。
  gsRetreatLunge: {
    id: 'gsRetreatLunge',
    segment: 'gsRetreatLunge',
    authored: GS_RETREAT_LUNGE,
    segmentDuration: GS_RETREAT_LUNGE.duration,
    activeStart: 0.31,
    activeEnd: 0.41,
    cancelAt: 999,
    trail: [0.24, 0.5],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'line', length: 3.1, radius: 0.38 },
    damage: 34,
    hitStop: 10,
    knockback: 2.6,
    fade: 0.05,
  },
  // 飛翔叩きつけ（斬り上げの受付で攻撃）: 前へ跳び上がって真上から叩きつける。0.3 に最高速、0.33 に剣が床を叩く（衝撃の輪）。当たりは 0.26〜0.38s。
  gsRiseSlam: {
    id: 'gsRiseSlam',
    segment: 'gsRiseSlam',
    authored: GS_RISE_SLAM,
    segmentDuration: GS_RISE_SLAM.duration,
    activeStart: 0.26,
    activeEnd: 0.38,
    cancelAt: 999,
    trail: [0.18, 0.44],
    rate: 1,
    lunge: 0,
    impact: { t: 0.33, dist: 1.9, power: 0.8 },
    hitbox: { kind: 'arc', range: 2.8, halfAngle: deg(70) },
    damage: 40,
    hitStop: 13,
    knockback: 3.0,
    fade: 0.05,
  },
  // 地擦り斬り上げ（溜め斬りの受付で攻撃）: 床に叩きつけた剣を地面をかすめて斬り上げる。0.2 に前を通る最高速（右足が着地）。当たりは 0.15〜0.26s。
  gsHeavyRip: {
    id: 'gsHeavyRip',
    segment: 'gsHeavyRip',
    authored: GS_HEAVY_RIP,
    segmentDuration: GS_HEAVY_RIP.duration,
    activeStart: 0.15,
    activeEnd: 0.26,
    cancelAt: 999,
    trail: [0.08, 0.34],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'arc', range: 3.0, halfAngle: deg(85) },
    damage: 32,
    hitStop: 10,
    knockback: 2.4,
    fade: 0.05,
  },

  // ---- 大剣の連携の続き 第 2 弾（ADR-047。src/character/data/gs-chain-ex.ts）----
  // 跳ね上げ（叩き落としの受付で前へ倒して攻撃）: 床を叩いて弾かれた剣の反動で、左下から右上へ一気に斬り上げる。0.21 に前を通る最高速（右足が着地）。当たりは 0.16〜0.27s。
  gsBounce: {
    id: 'gsBounce',
    segment: 'gsBounce',
    authored: GS_BOUNCE,
    segmentDuration: GS_BOUNCE.duration,
    activeStart: 0.16,
    activeEnd: 0.27,
    // 右上へ抜けて起き上がった姿勢を保つ 0.3〜0.5s から、大叩き割りへ続く
    cancelAt: 0.46,
    trail: [0.1, 0.36],
    rate: 1,
    lunge: 0,
    next: 'gsCrush',
    hitbox: { kind: 'arc', range: 3.0, halfAngle: deg(85) },
    damage: 34,
    hitStop: 10,
    knockback: 2.6,
    fade: 0.06,
  },
  // 大叩き割り（跳ね上げの受付で攻撃。大剣の 5 連目）: 頭上へ引き上げ、右足を大きく踏み込んで真上から叩き割る。0.27 に最高速、0.33 に切っ先が床を叩く（衝撃の輪）。当たりは 0.22〜0.35s。連携の締めの重い一撃。
  gsCrush: {
    id: 'gsCrush',
    segment: 'gsCrush',
    authored: GS_CRUSH,
    segmentDuration: GS_CRUSH.duration,
    activeStart: 0.22,
    activeEnd: 0.35,
    cancelAt: 999,
    trail: [0.14, 0.4],
    rate: 1,
    lunge: 0,
    impact: { t: 0.33, dist: 1.9, power: 0.9 },
    hitbox: { kind: 'arc', range: 3.1, halfAngle: deg(100) },
    damage: 52,
    hitStop: 13,
    knockback: 3.4,
    fade: 0.06,
  },
  // 逆の大回転（連携回転斬りの受付でロック中に横へ倒して攻撃）: 右へ回り切った体を右へ巻き込んで沈み、跳び上がって今度は左へ 1 回転して水平の円を描く。全方位を薙ぐ。回転は 0.14〜0.42s、剣が全周を通るのは 0.2〜0.38s（当たりもこの間）。
  gsSpin3: {
    id: 'gsSpin3',
    segment: 'gsSpin3',
    authored: GS_SPIN3,
    segmentDuration: GS_SPIN3.duration,
    activeStart: 0.2,
    activeEnd: 0.4,
    // 着地して沈んだ姿勢を保つ 0.46〜0.64s に前へ倒して攻撃すると、回転叩きつけ
    cancelAt: 0.5,
    trail: [0.16, 0.44],
    rate: 1,
    lunge: 0,
    branches: { forward: 'gsSpinSlam' },
    hitbox: { kind: 'arc', range: 2.7, halfAngle: deg(180) },
    damage: 28,
    hitStop: 9,
    knockback: 2.0,
    fade: 0.06,
  },
  // 回転叩きつけ（逆の大回転の受付で前へ倒して攻撃）: 回り切った剣を引き上げ、前へ高く跳んで真上から叩きつける。0.3 に最高速、0.33 に剣が床を叩く（衝撃の輪）。当たりは 0.26〜0.38s。旋風の締め。
  gsSpinSlam: {
    id: 'gsSpinSlam',
    segment: 'gsSpinSlam',
    authored: GS_SPIN_SLAM,
    segmentDuration: GS_SPIN_SLAM.duration,
    activeStart: 0.26,
    activeEnd: 0.38,
    cancelAt: 999,
    trail: [0.18, 0.44],
    rate: 1,
    lunge: 0,
    impact: { t: 0.33, dist: 1.9, power: 0.85 },
    hitbox: { kind: 'arc', range: 2.8, halfAngle: deg(80) },
    damage: 42,
    hitStop: 13,
    knockback: 3.0,
    fade: 0.05,
  },
  // 薙ぎ返し（突き払いの受付で攻撃）: 左へ払い切った剣を、そのまま左から右へ薙ぎ返す。0.24 に前を通る最高速（右足が着地）。当たりは 0.19〜0.3s。
  gsReturnSweep: {
    id: 'gsReturnSweep',
    segment: 'gsReturnSweep',
    authored: GS_RETURN_SWEEP,
    segmentDuration: GS_RETURN_SWEEP.duration,
    activeStart: 0.19,
    activeEnd: 0.3,
    cancelAt: 999,
    trail: [0.12, 0.38],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'arc', range: 2.9, halfAngle: deg(100) },
    damage: 30,
    hitStop: 9,
    knockback: 2.2,
    fade: 0.06,
  },

  // ======== 槍（両手持ち・右手が前。src/character/data/sp-*.ts。ADR-049）========
  // 長い間合いの突きが中心。片手剣より間合いが長く（突き 2.6m。穂先は構えの時点で体の 2m 前にある）、手数が多く、1 発は軽い。範囲は線（細い）なので、群れには当てにくい。
  // 1 段目: 突き（0.62s）。右手を腰へ引き（0〜0.1）、0.19 に穂先が最も伸びる（右足が着地）。当たりは 0.14〜0.22s。伸びた姿勢を保つ 0.3s から次段を受け付ける。
  sp1: {
    id: 'sp1',
    segment: 'sp1',
    authored: SP1,
    segmentDuration: SP1.duration,
    activeStart: 0.14,
    activeEnd: 0.22,
    cancelAt: 0.3,
    trail: [0.1, 0.28],
    rate: 1,
    lunge: 0,
    // 受付で次の押しがあれば 2 段目（二段突き）。ロック中に横へ倒して押せば、払い上げ（ADR-049）
    next: 'sp2',
    branches: { side: 'spUpper' },
    hitbox: { kind: 'line', length: 2.6, radius: 0.3 },
    tip: { from: 2.65, scale: 1.3 },
    damage: 11,
    hitStop: 5,
    knockback: 0.5,
    fade: 0.08,
  },
  // 2 段目: 二段突き（0.55s）。1 段目の受付時点（0.3s）の姿勢から続ける。0.17 に穂先が最も伸びる（右足が着地）。当たりは 0.14〜0.21s。突き切った姿勢を保つ 0.27s から次段を受け付ける。
  sp2: {
    id: 'sp2',
    segment: 'sp2',
    authored: SP2,
    segmentDuration: SP2.duration,
    activeStart: 0.14,
    activeEnd: 0.21,
    cancelAt: 0.27,
    trail: [0.1, 0.26],
    rate: 1,
    lunge: 0,
    next: 'sp3',
    hitbox: { kind: 'line', length: 2.6, radius: 0.3 },
    tip: { from: 2.65, scale: 1.3 },
    damage: 12,
    hitStop: 5,
    knockback: 0.6,
    fade: 0.05,
  },
  // 3 段目: 薙ぎ払い（0.82s）。2 段目の受付時点（0.27s）の姿勢から続ける。体を左から右へ回して払う（0.24 に穂先が体の前を通る最高速）。当たりは 0.2〜0.31s。コンボの終わり（硬直は長め）。
  sp3: {
    id: 'sp3',
    segment: 'sp3',
    authored: SP3,
    segmentDuration: SP3.duration,
    activeStart: 0.2,
    activeEnd: 0.31,
    cancelAt: 0.5,
    trail: [0.14, 0.38],
    rate: 1,
    lunge: 0,
    // 受付で前へ倒して押すと、貫き突き（そのまま押すだけでは続かない。薙ぎ払いで終わり）
    branches: { forward: 'spPierce' },
    hitbox: { kind: 'arc', range: 2.5, halfAngle: deg(100) },
    tip: { from: 2.4, scale: 1.25 },
    damage: 17,
    hitStop: 8,
    knockback: 1.6,
    fade: 0.05,
  },
  // 踏み込み突き（スティック前 + 攻撃）: 腰を落として引き絞り（0.2〜0.27 は一拍）、0.36 に最高速で飛び込んで貫く（右足が着地）。槍の突きのうち、踏み込みがいちばん長い技（線 2.9m + 踏み込み 1.4m）。当たりは 0.3〜0.42s。ルートは 1.5m 進む。
  spLunge: {
    id: 'spLunge',
    segment: 'spLunge',
    authored: SP_LUNGE,
    segmentDuration: SP_LUNGE.duration,
    activeStart: 0.3,
    activeEnd: 0.42,
    cancelAt: 0.5,
    trail: [0.24, 0.5],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'line', length: 2.9, radius: 0.32 },
    tip: { from: 2.9, scale: 1.3 },
    damage: 19,
    hitStop: 8,
    knockback: 1.8,
    fade: 0.1,
  },
  // 跳び退き突き（ロック中に後ろ + 攻撃）: 後ろへ 1.3m 跳びながら穂先を突き出し、敵を押し返す。0.24 に最も伸びる。当たりは 0.2〜0.3s（跳んでいるあいだ）。
  spRetreat: {
    id: 'spRetreat',
    segment: 'spRetreat',
    authored: SP_RETREAT,
    segmentDuration: SP_RETREAT.duration,
    activeStart: 0.2,
    activeEnd: 0.3,
    cancelAt: 0.4,
    trail: [0.14, 0.34],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'line', length: 2.8, radius: 0.34 },
    tip: { from: 2.8, scale: 1.3 },
    damage: 10,
    hitStop: 6,
    knockback: 2.4,
    fade: 0.1,
  },
  // 回転薙ぎ（ロック中に横 + 攻撃）: 腰を沈めて左へ巻き込み、跳び上がって体ごと右へ 1 回転する。全方位（円）を薙ぐ。回転は 0.2〜0.46s、穂先が全周を通るのは 0.23〜0.43s（当たりもこの間）。
  spSpin: {
    id: 'spSpin',
    segment: 'spSpin',
    authored: SP_SPIN,
    segmentDuration: SP_SPIN.duration,
    activeStart: 0.23,
    activeEnd: 0.43,
    cancelAt: 999,
    trail: [0.2, 0.46],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'arc', range: 2.4, halfAngle: deg(180) },
    tip: { from: 2.3, scale: 1.2 },
    damage: 16,
    hitStop: 7,
    knockback: 1.8,
    fade: 0.1,
  },
  // 跳び突き（ロール直後）: 転がって着地した低い姿勢から、槍を引き上げて前へ 1.5m 跳び、斜め下へ突き下ろす（0.36 に両足で着地）。当たりは 0.3〜0.4s。ロールの着地の姿勢（0.43s）から続ける。
  spDash: {
    id: 'spDash',
    segment: 'spDash',
    authored: SP_DASH,
    segmentDuration: SP_DASH.duration,
    activeStart: 0.3,
    activeEnd: 0.4,
    cancelAt: 999,
    trail: [0.22, 0.46],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'line', length: 2.8, radius: 0.36 },
    tip: { from: 2.8, scale: 1.3 },
    damage: 20,
    hitStop: 9,
    knockback: 2.0,
    fade: 0.05,
  },
  // 突き上げ（後ろステップ直後）: 下がったあと、低い姿勢から踏み込んで槍を下から斜め上へ突き上げる。0.23 に最も伸びる（右足が着地）。当たりは 0.18〜0.28s。後ろステップの着地の姿勢（0.36s）から続ける。
  spRise: {
    id: 'spRise',
    segment: 'spRise',
    authored: SP_RISE,
    segmentDuration: SP_RISE.duration,
    activeStart: 0.18,
    activeEnd: 0.28,
    cancelAt: 0.38,
    trail: [0.12, 0.38],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'line', length: 2.7, radius: 0.4 },
    tip: { from: 2.7, scale: 1.3 },
    damage: 15,
    hitStop: 7,
    knockback: 1.6,
    fade: 0.05,
  },
  // 溜め突き（溜めを放つ。CHARGES.spear）: 深い引き絞りから、体ごと一気に飛び込んで貫く。0.17 に最高速（右足が着地）。当たりは 0.14〜0.25s。槍のいちばん長い間合い（線 3.1m + 踏み込み 1.6m）。
  // 威力は溜めの段階で上がる。ルートは 1.6m 進む。突き切った姿勢を保つ（〜0.46s）あとは戻り（硬直は長い）。
  spHeavy: {
    id: 'spHeavy',
    segment: 'spHeavy',
    authored: SP_HEAVY,
    segmentDuration: SP_HEAVY.duration,
    activeStart: 0.14,
    activeEnd: 0.25,
    cancelAt: 999,
    trail: [0.1, 0.34],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'line', length: 3.1, radius: 0.36 },
    tip: { from: 3.0, scale: 1.35 },
    damage: 36,
    hitStop: 13,
    knockback: 3.2,
    fade: 0.04,
  },
  // 払い上げ（1 段目の受付で横へ倒して攻撃）: 左へ巻き込んで沈み、体を回しながら穂先を下から右上へすくい上げる（0.26 に最高速。左足が着地）。当たりは 0.2〜0.32s。1 段目の受付時点（0.3s）の姿勢から続ける。連携の終わり。
  spUpper: {
    id: 'spUpper',
    segment: 'spUpper',
    authored: SP_UPPER,
    segmentDuration: SP_UPPER.duration,
    activeStart: 0.2,
    activeEnd: 0.32,
    cancelAt: 999,
    trail: [0.14, 0.38],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'arc', range: 2.5, halfAngle: deg(75) },
    tip: { from: 2.4, scale: 1.25 },
    damage: 15,
    hitStop: 7,
    knockback: 2.0,
    fade: 0.05,
  },
  // 貫き突き（3 段目の受付で前へ倒して攻撃）: 深く引き絞り、体ごと踏み込んで全体重で貫く（0.23 に最高速。右足が着地）。当たりは 0.18〜0.28s。突き切った姿勢を保つ 0.36s から回し払いを受け付ける。3 段目の受付時点（0.5s）の姿勢から続ける。
  spPierce: {
    id: 'spPierce',
    segment: 'spPierce',
    authored: SP_PIERCE,
    segmentDuration: SP_PIERCE.duration,
    activeStart: 0.18,
    activeEnd: 0.28,
    cancelAt: 0.36,
    trail: [0.12, 0.34],
    rate: 1,
    lunge: 0,
    next: 'spTwirl',
    hitbox: { kind: 'line', length: 2.9, radius: 0.34 },
    tip: { from: 2.9, scale: 1.3 },
    damage: 20,
    hitStop: 9,
    knockback: 2.4,
    fade: 0.05,
  },
  // 回し払い（貫き突きの受付で攻撃）: 引き戻した槍を、左へ巻いてから右へ速く薙ぐ（0.18 に最高速。左足が着地）。当たりは 0.14〜0.24s。連携の終わり。
  spTwirl: {
    id: 'spTwirl',
    segment: 'spTwirl',
    authored: SP_TWIRL,
    segmentDuration: SP_TWIRL.duration,
    activeStart: 0.14,
    activeEnd: 0.24,
    cancelAt: 0.36,
    trail: [0.08, 0.3],
    rate: 1,
    lunge: 0,
    hitbox: { kind: 'arc', range: 2.5, halfAngle: deg(85) },
    tip: { from: 2.4, scale: 1.25 },
    damage: 17,
    hitStop: 7,
    knockback: 2.0,
    fade: 0.05,
  },
};

/**
 * 溜め（攻撃の長押し。ADR-018）: 1 段目を holdFrames 押し続けると（軽い攻撃を遅らせないよう、押した瞬間から 1 段目の予備動作に入り、そのまま続ける）、1 段目の予備動作の途中の姿勢から構えのクリップ（頭上へ振りかぶる）へ移り、そこで止まる。
 * 離すと next（重撃）を放つ。構えが整ってからの保持の長さで段階が上がり、威力が上がる。
 */
export interface ChargeDef {
  id: string;
  /** 構えへ入る手付けのクリップ。終端の姿勢で止まる */
  clip: AuthoredAttack;
  /** 1 段目をこのフレーム数押し続けたら、溜めへ移る（クリップが 1 段目から続く時刻 × 60。1 段目の斬りが始まる前） */
  holdFrames: number;
  /** クリップのフレーム数（この間は離しても構えを続け、整ってから放つ） */
  frames: number;
  /** 構えが整ってから、この保持フレーム数以上で段階 1, 2, … になる */
  levels: readonly number[];
  /** 段階ごとの威力の倍率（長さ = levels.length + 1。ダメージ・ノックバック・ヒットストップに掛かる） */
  levelPower: readonly number[];
  /** 構えのまま保てる最大のフレーム数（超えたら自動で放つ） */
  maxHoldFrames: number;
  /** 放つ攻撃の id（ATTACKS のキー） */
  next: string;
  /**
   * 段階ごとに放つ攻撃を変える（長さ = levels.length + 1。undefined は next）。最大の段階まで溜めたときだけ出る技など（ADR-023）。
   * 威力の倍率（levelPower）はどの技にも掛かる
   */
  levelNext?: readonly (string | undefined)[];
  /** 構えに入ってからこのフレーム以降は、回避でキャンセルできる */
  dodgeCancelFrame: number;
}

export const CHARGES: Record<string, ChargeDef> = {
  sword: {
    id: 'sword',
    clip: HEAVY_CHARGE,
    holdFrames: 9,
    frames: Math.ceil(HEAVY_CHARGE.duration * 60),
    levels: [24, 54],
    levelPower: [1, 1.25, 1.6],
    maxHoldFrames: 100,
    next: 'heavy',
    dodgeCancelFrame: 8,
  },
  // 大剣: 1 段目（gs1）の予備動作の途中（12f = 0.2s）から頭上の構えへ。段階は片手剣より長く溜めるぶん、威力の伸びが大きい（最大 1.8 倍 × 60 = 108）
  greatsword: {
    id: 'greatsword',
    clip: GS_CHARGE,
    holdFrames: 12,
    frames: Math.ceil(GS_CHARGE.duration * 60),
    levels: [30, 66],
    levelPower: [1, 1.3, 1.8],
    maxHoldFrames: 120,
    next: 'gsHeavy',
    // 最大まで溜めたときだけ地割り（床へ叩きつけて衝撃が広がる）。途中で離せば溜め斬り（ADR-023）
    levelNext: [undefined, undefined, 'gsSmash'],
    dodgeCancelFrame: 8,
  },
  // 槍: 1 段目（sp1）の引き絞り（6f = 0.1s）から、さらに深い引き絞りへ。威力の伸びは大剣より小さい（最大 1.8 倍 × 36 = 65）。離すと溜め突き（貫く線）
  spear: {
    id: 'spear',
    clip: SP_CHARGE,
    holdFrames: 6,
    frames: Math.ceil(SP_CHARGE.duration * 60),
    levels: [24, 56],
    levelPower: [1, 1.35, 1.8],
    maxHoldFrames: 110,
    next: 'spHeavy',
    dodgeCancelFrame: 8,
  },
};

/** 回避の種類。ロール（入力方向へ向きを変えて前転）と、後ろステップ（向きを保って後ろへ跳ぶ） */
export type DodgeKind = 'roll' | 'back';

export interface DodgeDef {
  id: DodgeKind;
  /** 手付けのクリップ（src/character/data/dodge.ts） */
  clip: AuthoredAttack;
  /** 全体フレーム */
  frames: number;
  /** 無敵フレーム（開始からの範囲、両端含む） */
  invulnStart: number;
  invulnEnd: number;
  /** このフレーム以降は攻撃でキャンセル可能 */
  cancelFrame: number;
  /** ルートの前進カーブ（開始からの秒 → m。負は後ろ）。Player.stepDodge が毎ステップの差分で動く */
  root: (t: number) => number;
}

/**
 * 回避（手付け。src/character/data/dodge.ts）。前進は各クリップの rootZ のカーブに従う（攻撃の rootMotionOf と同じ）。
 *  - ロール: 0.08〜0.40s に体を丸めて転がり（約 2.1m）、0.43s に足から着地する。無敵は 3〜22f（蹴り出しから着地の寸前まで）
 *  - 後ろステップ: 0.07〜0.30s に後ろへ 2.0m 跳ぶ（空中は 0.12〜0.27s）。無敵は 2〜16f
 */
export const DODGES: Record<DodgeKind, DodgeDef> = {
  roll: {
    id: 'roll',
    clip: DODGE_CLIP,
    frames: Math.ceil(DODGE_CLIP.duration * 60),
    invulnStart: 3,
    invulnEnd: 22,
    cancelFrame: 26,
    root: rootZCurve(DODGE_CLIP),
  },
  back: {
    id: 'back',
    clip: DODGE_BACK,
    frames: Math.ceil(DODGE_BACK.duration * 60),
    invulnStart: 2,
    invulnEnd: 16,
    cancelFrame: 22,
    root: rootZCurve(DODGE_BACK),
  },
};

/** どちらの回避を出すかの規則。ロック中に、対象から離れる向き（正面の真後ろ ± backCone）へスティックを倒していれば後ろステップ */
export const DODGE_RULES = {
  /** 度 */
  backConeDeg: 50,
} as const;

/** ロール（代表）。クリップ・無敵・キャンセルの検査と、既存の参照用 */
export const DODGE = DODGES.roll;

/** ロールの前進カーブ（開始からの秒 → ルートの前進量 m） */
export const dodgeRoot: (t: number) => number = DODGES.roll.root;

/** プレイヤーの被弾（敵の攻撃を受けたとき） */
export const HIT_STUN = {
  /** ひるみフレーム（アニメ区間 0.6 秒 / rate 1.5 = 0.4 秒）。この間は何もできない */
  frames: 24,
  /** ノックバックをかけるフレーム数（距離は敵の攻撃データ） */
  knockbackFrames: 10,
  /** 被弾から無敵になるフレーム（ひるみの 24f を含む。起き上がってから少し動ける） */
  invulnFrames: 56,
} as const;

export const PLAYER_STATS = {
  maxHp: 100,
} as const;

export const MOVE = {
  runSpeed: 4.8,
  /** 加速度（m/s^2） */
  accel: 40,
  /** 減速度（m/s^2） */
  decel: 48,
  /** 旋回速度（rad/s） */
  turnSpeed: 14,
  /** キャラの衝突半径（m） */
  radius: 0.38,
} as const;
