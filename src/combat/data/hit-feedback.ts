/**
 * 命中の演出の数値（M2）。ダメージの大きさ・とどめかどうかで、ヒットストップ・画面の揺れ・エフェクトの大きさ・ダメージ数字の見た目を決める。
 * 値はすべてここで調整する（実機で「軽い」「重い」を見ながら動かす）。
 */
export const HIT_FEEDBACK = {
  /** ダメージがこの値以上なら「強」の見た目（数字が大きく黄色、エフェクトが大きい） */
  heavyDamage: 30,
  /** 画面の揺れ（m）= base + perDamage × ダメージ。とどめは killScale 倍 */
  shake: { base: 0.015, perDamage: 0.0035, killScale: 1.6 },
  /** 画面の揺れの長さ（秒）= base + perDamage × ダメージ */
  shakeSeconds: { base: 0.1, perDamage: 0.003 },
  /** とどめで追加するヒットストップ（sim フレーム） */
  killExtraHitStop: 6,
  /** 攻撃 1 発のヒットストップの上限（sim フレーム。溜めの威力倍率を掛けたあと。大剣の溜め斬りが止まりすぎないように） */
  maxHitStop: 24,
  /** エフェクトの強さ = ダメージ / powerDamage を [powerMin, powerMax] に収めた値 */
  power: { damage: 40, min: 0.3, max: 1.2 },
  /** 命中エフェクト・ダメージ数字を出す高さ（敵の足元から m。胸のあたり） */
  impactHeight: 1.05,
  /** プレイヤーが被弾したときのエフェクト・数字の高さ（プレイヤーの足元から m。胸のあたり） */
  playerImpactHeight: 1.1,
} as const;
