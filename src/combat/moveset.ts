import { DASH_WINDOW_FRAMES, STICK_RULES, type Moveset } from './data/moveset';
import { angleDelta } from '../core/math';

/**
 * 入力から技を選ぶ（純粋関数。ADR-018）。攻撃ボタンを押した瞬間の状況（スティック・ロック・直前の回避）だけで決まる。
 * コンボの 2 段目以降（AttackDef.next）と、溜め（長押し）はここを通らない（Player が続きを管理する）。
 */

export type StickDir = 'none' | 'forward' | 'back' | 'side';

/** どの回避の直後か（null = 回避直後ではない） */
export type AfterDodge = 'roll' | 'back' | null;

export interface AttackContext {
  stick: StickDir;
  afterDodge: AfterDodge;
}

/**
 * スティックを「対象に対して」どちらへ倒しているか。
 *  - 倒していない（threshold 未満）→ none
 *  - ロックなし → forward（攻撃は倒した向きを向いて始まるので、常に前。走りながらの攻撃 = 踏み込み）
 *  - ロック中 → 対象の向き（refYaw）から見て、前（±forwardCone）/ 後ろ（backCone 以上）/ 横
 */
export function classifyStick(mLen: number, stickYaw: number, refYaw: number, locked: boolean): StickDir {
  if (mLen < STICK_RULES.threshold) return 'none';
  if (!locked) return 'forward';
  const d = Math.abs(angleDelta(refYaw, stickYaw));
  if (d <= (STICK_RULES.forwardConeDeg * Math.PI) / 180) return 'forward';
  if (d >= (STICK_RULES.backConeDeg * Math.PI) / 180) return 'back';
  return 'side';
}

/** 回避の直後なら、その回避に応じたダッシュの技。そうでなければスティックで選ぶ */
export function pickAttack(m: Moveset, ctx: AttackContext): string {
  if (ctx.afterDodge === 'roll') return m.dashRoll;
  if (ctx.afterDodge === 'back') return m.dashBack;
  switch (ctx.stick) {
    case 'forward':
      return m.lunge;
    case 'back':
      return m.retreat;
    case 'side':
      return m.sweep;
    default:
      return m.light;
  }
}

/**
 * コンボの次段の受付で、どの技へ続けるか（ADR-023）。AttackDef.branches がスティックの向きごとの技を持つ。
 * スティックを倒していない、またはその向きの技が無ければ next（コンボの普通の続き）。続きが無ければ undefined（コンボの終わり）。
 */
export function pickFollowUp(next: string | undefined, branches: Partial<Record<'forward' | 'back' | 'side', string>> | undefined, stick: StickDir): string | undefined {
  if (stick === 'none') return next;
  return branches?.[stick] ?? next;
}

/** 溜め（長押し）を放つとき、段階に応じてどの技を出すか（ChargeDef.levelNext。無ければ next） */
export function pickChargeRelease(next: string, levelNext: readonly (string | undefined)[] | undefined, level: number): string {
  return levelNext?.[level] ?? next;
}

/** 回避が終わってからの経過フレームから、回避直後かを判定する（dodgeKind は直近の回避の種類） */
export function afterDodgeOf(framesSinceDodge: number, kind: 'roll' | 'back'): AfterDodge {
  return framesSinceDodge <= DASH_WINDOW_FRAMES ? kind : null;
}
