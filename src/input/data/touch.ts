/** タッチ操作の定数（docs/04-controls.md）。手触り調整はここだけを触る */
export const TOUCH = {
  /** スティックの最大半径（CSS px）。この距離で入力 1.0 */
  stickRadius: 60,
  /** デッドゾーン（CSS px） */
  stickDeadzone: 8,
  /** 指がこの距離を越えると原点が追従する（CSS px） */
  stickFollowRadius: 80,
  /** カメラ感度（ラジアン / CSS px） */
  camYawPerPx: 0.0045,
  camPitchPerPx: 0.0035,
  /** ロックオン中、横スワイプでの対象切替しきい値（CSS px） */
  lockSwitchSwipePx: 90,
} as const;
