/** ロックオンの数値（docs/04-controls.md、ADR-016）。手触りはここだけを触る */
export const LOCKON = {
  /** この距離（m）以内の敵だけロックできる */
  maxRange: 16,
  /** ロック中、この距離を超えて離れたら解除する */
  breakRange: 22,
  /** 対象選びの重み。点数 = 距離 × (1 + angleBias × 正面からのずれ / π)。0 なら最寄り、大きいほど画面の正面を優先 */
  angleBias: 0.7,
  /** カメラが対象の方へ向く速さ（大きいほど速い。sim で yaw を減衰補間する） */
  camYawLambda: 8,
  /** 注視点をプレイヤーから対象へ寄せる割合（0 = プレイヤー、1 = 対象） */
  focusBias: 0.3,
  /** 離れた敵まで映るよう、距離 3m を超えた分 × distanceGain だけカメラを引く（最大 distanceMax m） */
  distanceGain: 0.25,
  distanceMax: 2.5,
  /** 対象切替の連続を防ぐ間隔（sim フレーム） */
  switchCooldownFrames: 14,
  /** ロック中の対象が、柱などに遮られて見えない時間がこれ（sim フレーム）を超えたら、ロックを解く（見える別の敵がいれば移る。M7-4b。ADR-044） */
  hiddenBreakFrames: 90,
} as const;
