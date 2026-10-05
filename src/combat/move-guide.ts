import { ATTACKS, CHARGES, type AttackDef, type ChargeDef } from './data/attacks';
import { moveName } from './data/move-names';
import type { Moveset } from './data/moveset';
import { pickAttack, pickChargeRelease, pickFollowUp, type AfterDodge, type StickDir } from './moveset';

/**
 * 操作ガイドの表示内容（純粋関数。ADR-024）: いまの状況から「何を押すと何が出るか」を決める。DOM は src/ui/move-guide.ts。
 *
 * ガイドは攻撃ボタンの「スティックの向き」の読み方を、いつも同じ 5 つの枠（タップ・前・横・後ろ・長押し）で見せる:
 *  - 立っているとき: 枠 = 始動の技（ボタンを押すと出る技）。いまのスティックの向きで出る枠が光る
 *  - 攻撃中: 枠 = 次に続けられる技（AttackDef.next / branches）。受付が開くまで待ち、開いたら光る。いまのスティックで出る枠は金の縁
 *  - 溜め中: 段階と、離したときに出る技（最大まで溜めたときに変わる技も）
 * 横・後ろの枠はロック中の向き（ロックなしでは倒した向きは全部「前」）なので、ロックしていないときは暗くして「ロック」と添える。
 */

export type GuideSlot = 'tap' | 'forward' | 'side' | 'back' | 'hold';
export const GUIDE_SLOTS: readonly GuideSlot[] = ['tap', 'forward', 'side', 'back', 'hold'];

export interface GuideChip {
  slot: GuideSlot;
  /** 技名。この枠に出せる技が無ければ null */
  name: string | null;
  /** いまのスティックの向きで出る枠 */
  selected: boolean;
  /** 受付が開いていて、いま押せば出る（立っているときは常に true） */
  ready: boolean;
  /** ロック中でないと出せない向き（横・後ろ）で、いまはロックしていない */
  needsLock: boolean;
  /** 枠の下に添える一言（長押しの「最大 地割り」など）。無ければ null */
  note: string | null;
}

/** 次段の受付の進み。wait = 受付が開くまで（amount 0→1）、open = 受付中（amount 1→0。0 になると連携が切れる）、none = 続きの無い技 */
export interface GuideWindow {
  phase: 'none' | 'wait' | 'open';
  amount: number;
  /** 続きの入力を先に押してある（受付が開いた瞬間に出る） */
  queued: boolean;
}

export interface GuideCharge {
  /** 溜めの段階（0〜levels）と段階の数、次の段階までの進み（0〜1。最大なら 1） */
  level: number;
  levels: number;
  progress: number;
  /** 離したときに出る技と、最大まで溜めたときに出る技（変わらなければ null） */
  release: string;
  max: string | null;
}

export interface GuideView {
  /** hidden = 出さない（ガード・被弾・戦闘不能） */
  mode: 'hidden' | 'ready' | 'attack' | 'charge';
  /** ready: 回避中・回避直後の一言（無ければ ''）。attack: いまの技名 */
  title: string;
  /** attack: 連携の履歴（技名。古い → 新しい。最後がいまの技） */
  trail: readonly string[];
  window: GuideWindow;
  /** 常に GUIDE_SLOTS の順 */
  chips: readonly GuideChip[];
  charge: GuideCharge | null;
}

export type GuidePlayerState = 'idle' | 'run' | 'attack' | 'charge' | 'guard' | 'dodge' | 'hit' | 'dead' | 'air' | 'land' | 'traverse';

export interface GuideContext {
  state: GuidePlayerState;
  moveset: Moveset;
  /** 溜めの定義（CHARGES のキー） */
  chargeId: string;
  /** 攻撃中: いまの技と連携の履歴（技の id。古い → 新しい） */
  attackId: string | null;
  trail: readonly string[];
  /** 状態に入ってからのフレームと、攻撃の次段の受付が開くフレーム・全体のフレーム */
  frame: number;
  cancelFrame: number;
  total: number;
  queued: boolean;
  stick: StickDir;
  locked: boolean;
  /** 立っているとき: 回避の直後か。回避中: その回避の種類（回避中の攻撃はダッシュになる） */
  afterDodge: AfterDodge;
  chargeLevel: number;
}

export interface GuideData {
  attacks: Readonly<Record<string, Pick<AttackDef, 'next' | 'branches'>>>;
  charges: Readonly<Record<string, Pick<ChargeDef, 'levels' | 'frames' | 'next' | 'levelNext'>>>;
  name: (id: string) => string;
}

const DEFAULT_DATA: GuideData = { attacks: ATTACKS, charges: CHARGES, name: moveName };

const NO_WINDOW: GuideWindow = { phase: 'none', amount: 0, queued: false };

function chip(slot: GuideSlot, name: string | null, o: Partial<GuideChip> = {}): GuideChip {
  return { slot, name, selected: false, ready: true, needsLock: false, note: null, ...o };
}

export function buildGuide(ctx: GuideContext, data: GuideData = DEFAULT_DATA): GuideView {
  const empty = GUIDE_SLOTS.map((s) => chip(s, null, { ready: false }));
  switch (ctx.state) {
    case 'attack':
      return ctx.attackId !== null && data.attacks[ctx.attackId] ? attackView(ctx, data) : { mode: 'hidden', title: '', trail: [], window: NO_WINDOW, chips: empty, charge: null };
    case 'charge':
      return chargeView(ctx, data, empty);
    case 'idle':
    case 'run':
    case 'dodge':
      return readyView(ctx, data);
    default:
      return { mode: 'hidden', title: '', trail: [], window: NO_WINDOW, chips: empty, charge: null };
  }
}

/** 立っている・回避中: 攻撃ボタンを押すと出る技（始動の技） */
function readyView(ctx: GuideContext, data: GuideData): GuideView {
  const m = ctx.moveset;
  const dash = ctx.afterDodge !== null;
  const picked = dash ? null : pickAttack(m, { stick: ctx.stick, afterDodge: null });
  const sel = (id: string): boolean => picked === id;
  const charge = data.charges[ctx.chargeId];
  const maxId = charge ? pickChargeRelease(charge.next, charge.levelNext, charge.levels.length) : null;
  const holdName = charge ? data.name(charge.next) : null;
  const maxName = charge && maxId !== null && maxId !== charge.next ? data.name(maxId) : null;
  // 同じ技が複数の枠に入ることはあるが（ロックなしの前 = 倒した向き全部）、selected は向きの枠だけに付ける
  const chips: GuideChip[] = [
    chip('tap', data.name(m.light), { selected: !dash && ctx.stick === 'none' && sel(m.light) }),
    chip('forward', data.name(m.lunge), { selected: !dash && ctx.stick === 'forward' && sel(m.lunge) }),
    chip('side', data.name(m.sweep), { selected: !dash && ctx.stick === 'side' && sel(m.sweep), needsLock: !ctx.locked }),
    chip('back', data.name(m.retreat), { selected: !dash && ctx.stick === 'back' && sel(m.retreat), needsLock: !ctx.locked }),
    chip('hold', holdName, { note: maxName === null ? null : `最大 ${maxName}` }),
  ];
  const title = dash ? `${ctx.afterDodge === 'roll' ? 'ロール' : '後ろステップ'}直後 → ${data.name(ctx.afterDodge === 'roll' ? m.dashRoll : m.dashBack)}` : '';
  return { mode: 'ready', title, trail: [], window: NO_WINDOW, chips, charge: null };
}

/** 攻撃中: 次に続けられる技。受付が開くまで待ち、開いたら押せる */
function attackView(ctx: GuideContext, data: GuideData): GuideView {
  const a = data.attacks[ctx.attackId!]!;
  const hasFollow = a.next !== undefined || a.branches !== undefined;
  let window: GuideWindow = NO_WINDOW;
  if (hasFollow) {
    const span = Math.max(1, ctx.total - ctx.cancelFrame);
    window =
      ctx.frame < ctx.cancelFrame
        ? { phase: 'wait', amount: Math.min(1, ctx.frame / Math.max(1, ctx.cancelFrame)), queued: ctx.queued }
        : { phase: 'open', amount: Math.max(0, Math.min(1, 1 - (ctx.frame - ctx.cancelFrame) / span)), queued: ctx.queued };
  }
  const open = window.phase === 'open';
  const follow = pickFollowUp(a.next, a.branches, ctx.stick);
  const branch = (s: 'forward' | 'side' | 'back'): GuideChip => {
    const id = a.branches?.[s];
    return chip(s, id === undefined ? null : data.name(id), {
      selected: id !== undefined && ctx.stick === s && follow === id,
      ready: open && id !== undefined,
      needsLock: id !== undefined && s !== 'forward' && !ctx.locked,
    });
  };
  // 連打（そのまま押す）の枠: next。スティックを倒していても、その向きに専用の技が無ければ next が出る
  const branchOfStick = ctx.stick === 'none' ? undefined : a.branches?.[ctx.stick];
  const chips: GuideChip[] = [
    chip('tap', a.next === undefined ? null : data.name(a.next), { selected: a.next !== undefined && follow === a.next && branchOfStick === undefined, ready: open && a.next !== undefined }),
    branch('forward'),
    branch('side'),
    branch('back'),
    chip('hold', null, { ready: false }),
  ];
  return { mode: 'attack', title: data.name(ctx.attackId!), trail: ctx.trail.map((id) => data.name(id)), window, chips, charge: null };
}

function chargeView(ctx: GuideContext, data: GuideData, empty: readonly GuideChip[]): GuideView {
  const c = data.charges[ctx.chargeId];
  if (!c) return { mode: 'hidden', title: '', trail: [], window: NO_WINDOW, chips: empty, charge: null };
  const levels = c.levels.length;
  const level = Math.min(levels, Math.max(0, ctx.chargeLevel));
  const held = Math.max(0, ctx.frame - c.frames);
  const prev = level > 0 ? c.levels[level - 1]! : 0;
  const progress = level >= levels ? 1 : Math.max(0, Math.min(1, (held - prev) / Math.max(1, c.levels[level]! - prev)));
  const releaseId = pickChargeRelease(c.next, c.levelNext, level);
  const maxId = pickChargeRelease(c.next, c.levelNext, levels);
  const charge: GuideCharge = { level, levels, progress, release: data.name(releaseId), max: maxId !== releaseId ? data.name(maxId) : null };
  return { mode: 'charge', title: '溜め', trail: [], window: NO_WINDOW, chips: empty, charge };
}
