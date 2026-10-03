/**
 * 技の選択の数値と、武器ごとの技のセット（ADR-018）。コマンド構成は案 A（攻撃 / 回避 / ガード。ADR-013）。
 * どの入力でどの技が出るかは src/combat/moveset.ts（純粋関数）が決め、ここは「何を・どの数値で」だけを持つ。
 */

/** 攻撃を押した瞬間のスティックの読み方 */
export const STICK_RULES = {
  /** この大きさ（0..1）以上倒していれば「倒している」 */
  threshold: 0.3,
  /** ロック中、対象の向きから ±forwardConeDeg 以内なら「前」、backConeDeg 以上離れていれば「後ろ」、その間は「横」 */
  forwardConeDeg: 50,
  backConeDeg: 130,
} as const;

/** 回避が終わってから、この間（sim フレーム）に押した攻撃は「回避直後」の技になる */
export const DASH_WINDOW_FRAMES = 12;

/**
 * 長押し: 1 段目をこのフレーム数押し続けたら、溜めに移る（軽い攻撃を遅らせないよう、押した瞬間から 1 段目の予備動作に入り、そのまま続ける）。
 * 溜めのクリップは 1 段目の CHARGE_ENTER_T（0.15s = 9f）の姿勢から続くので、この値と合わせる（combo1 の斬りは 0.17s から始まる）。
 */
export const CHARGE_HOLD_FRAMES = 9;

/** 技のセット（攻撃 id）。ATTACKS のキー */
export interface Moveset {
  /** スティックなし: 弱攻撃の 1 段目（以降は AttackDef.next で連なる） */
  light: string;
  /** スティック前: 踏み込み */
  lunge: string;
  /** スティック後ろ（ロック中）: 下がりながらの払い */
  retreat: string;
  /** スティック横（ロック中）: 横薙ぎ */
  sweep: string;
  /** ロール直後: ダッシュ斬り */
  dashRoll: string;
  /** 後ろステップ直後: 追い斬り */
  dashBack: string;
}

export const SWORD_MOVESET: Moveset = {
  light: 'combo1',
  lunge: 'lunge',
  retreat: 'retreat',
  sweep: 'sweep',
  dashRoll: 'dash',
  dashBack: 'lunge',
};
