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

/**
 * 大剣の技のセット（ADR-021）。長押しの溜め斬り（gsHeavy）は CHARGES.greatsword。
 * ロール直後は跳び叩きつけ、後ろステップ直後は斬り上げ（片手剣は後ろステップ直後に踏み込み突き）。横は全方位の大回転、後ろは下がりながらの薙ぎ払い。
 */
export const GREATSWORD_MOVESET: Moveset = {
  light: 'gs1',
  lunge: 'gsLunge',
  retreat: 'gsRetreat',
  sweep: 'gsSpin',
  dashRoll: 'gsDash',
  dashBack: 'gsRise',
};

/**
 * 杖の技のセット（ADR-048）。通常攻撃は **1 ルートの連打だけ**（魔弾 → 魔弾 → 大魔弾。AttackDef.next）で、スティックの向き・回避の直後でも同じ 1 発目が出る
 * （剣のような踏み込み・薙ぎ・ダッシュ斬りの使い分けは無い）。溜め（長押し）も無い（LoadoutDef.charge = null）。
 * 魔法（落雷・吹雪・火炎放射 ほか）はスキルボタン（画面に並列）で出す。
 */
export const STAFF_MOVESET: Moveset = {
  light: 'stBolt1',
  lunge: 'stBolt1',
  retreat: 'stBolt1',
  sweep: 'stBolt1',
  dashRoll: 'stBolt1',
  dashBack: 'stBolt1',
};
