/**
 * 技の表示名（操作ガイド・技表。ADR-024）。キーは ATTACKS の id。
 * 画面に出す短い名前（ガイドのチップに収まるよう、全角 6 字までを目安にする）。
 */
export const MOVE_NAMES: Readonly<Record<string, string>> = {
  // 片手剣
  combo1: '袈裟斬り',
  combo2: '逆袈裟',
  combo3: '突き',
  comboHop: '跳び退き斬り',
  comboSpin: '回転斬り',
  comboUpper: '打ち上げ',
  comboSlam: '落下斬り',
  hopThrust: '飛び込み突き',
  slamRip: '地擦り斬り上げ',
  swallow: '燕返し',
  spinRev: '逆回転斬り',
  spinRise: '回転斬り上げ',
  lungeSlash: '抜き払い',
  sweepBack: '返し薙ぎ',
  heavy: '溜め斬り',
  lunge: '踏み込み突き',
  dash: 'ダッシュ斬り',
  retreat: '下がり払い',
  sweep: '横薙ぎ',
  // 槍
  sp1: '突き',
  sp2: '二段突き',
  sp3: '薙ぎ払い',
  spLunge: '踏み込み突き',
  spRetreat: '跳び退き突き',
  spSpin: '回転薙ぎ',
  spDash: '跳び突き',
  spRise: '突き上げ',
  spHeavy: '溜め突き',
  // 大剣
  gs1: '袈裟斬り',
  gs2: '逆袈裟',
  gsLunge: '踏み込み突き',
  gsRetreat: '薙ぎ払い',
  gsSpin: '大回転斬り',
  gsDash: '跳び叩きつけ',
  gsRise: '斬り上げ',
  gsHeavy: '唐竹割り',
  gsSpin2: '連携回転斬り',
  gsDrop: '叩き落とし',
  gsLungeSweep: '突き払い',
  gsRetreatLunge: '飛び込み突き',
  gsRiseSlam: '飛翔叩きつけ',
  gsHeavyRip: '地擦り斬り上げ',
  gsSmash: '地割り',
  gsBounce: '跳ね上げ',
  gsCrush: '大叩き割り',
  gsSpin3: '逆の大回転',
  gsSpinSlam: '回転叩きつけ',
  gsReturnSweep: '薙ぎ返し',
  // 杖（魔弾の連打。魔法は SKILLS の名前）
  stBolt1: '魔弾',
  stBolt2: '魔弾（払い上げ）',
  stBolt3: '大魔弾',
};

/** 技の表示名。未登録なら id のまま（データを足して名前を忘れたとき、画面で気づける） */
export function moveName(id: string): string {
  return MOVE_NAMES[id] ?? id;
}
