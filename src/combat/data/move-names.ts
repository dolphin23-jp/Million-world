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
  heavy: '溜め斬り',
  lunge: '踏み込み突き',
  dash: 'ダッシュ斬り',
  retreat: '下がり払い',
  sweep: '横薙ぎ',
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
  gsSmash: '地割り',
};

/** 技の表示名。未登録なら id のまま（データを足して名前を忘れたとき、画面で気づける） */
export function moveName(id: string): string {
  return MOVE_NAMES[id] ?? id;
}
