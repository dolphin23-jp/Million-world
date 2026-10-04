/**
 * 入力の抽象化。ゲームロジックはこの InputIntent だけを見る（ADR-006）。
 * タッチ・キーボードなど各 InputSource が自分の状態を書き込み、
 * InputAggregator が 1 sim ステップ分にまとめる。
 */

export interface InputIntent {
  /** 移動ベクトル（画面基準: x 右, y 上）。長さ 0..1 */
  moveX: number;
  moveY: number;
  /** カメラ回転の入力（この sim ステップでの差分、単位: ラジアン） */
  camYaw: number;
  camPitch: number;
  /** 押下エッジ（このステップで押された） */
  attackPressed: boolean;
  /** 攻撃ボタンを押している間 true（レベル）。長押しの溜めに使う（ADR-018）。押した瞬間は attackPressed も true */
  attackHeld: boolean;
  dodgePressed: boolean;
  /** ガードボタンの押下エッジと、押している間 true（レベル）。構えは押している間だけ（ADR-020） */
  guardPressed: boolean;
  guardHeld: boolean;
  /** 装備の切替ボタンの押下エッジ（次の装備へ。Game が扱う） */
  equipPressed: boolean;
  lockPressed: boolean;
  /** アイテムの使用ボタンの押下エッジ（選んでいるアイテムを使う。ADR-030）と、選択の切替（キーボード用。-1 前 / +1 次 / 0 なし）。Game が扱う */
  itemPressed: boolean;
  itemCycle: number;
  /** スキルボタンの押下エッジ（選んでいるスキルを使う。ADR-031）と、選択の切替（キーボード用）。Game が扱う */
  skillPressed: boolean;
  skillCycle: number;
  /** ロックオン対象切替（-1 左 / +1 右 / 0 なし） */
  lockSwitch: number;
}

export function createEmptyIntent(): InputIntent {
  return {
    moveX: 0,
    moveY: 0,
    camYaw: 0,
    camPitch: 0,
    attackPressed: false,
    attackHeld: false,
    dodgePressed: false,
    guardPressed: false,
    guardHeld: false,
    equipPressed: false,
    lockPressed: false,
    itemPressed: false,
    itemCycle: 0,
    skillPressed: false,
    skillCycle: 0,
    lockSwitch: 0,
  };
}

/** 各入力デバイスはこれを実装し、aggregator に登録する */
export interface InputSource {
  /** 自分の状態を intent に加算する。エッジ系は OR、連続値は加算 */
  collect(intent: InputIntent): void;
  /** 1 sim ステップ消費後に呼ばれる。エッジ系の内部フラグをクリアする */
  endStep(): void;
}

export class InputAggregator {
  private readonly sources: InputSource[] = [];
  readonly intent: InputIntent = createEmptyIntent();

  add(source: InputSource): void {
    this.sources.push(source);
  }

  /** sim ステップ冒頭に呼ぶ。intent を今ステップの値に更新する */
  beginStep(): InputIntent {
    const it = this.intent;
    it.moveX = 0;
    it.moveY = 0;
    it.camYaw = 0;
    it.camPitch = 0;
    it.attackPressed = false;
    it.attackHeld = false;
    it.dodgePressed = false;
    it.guardPressed = false;
    it.guardHeld = false;
    it.equipPressed = false;
    it.lockPressed = false;
    it.itemPressed = false;
    it.itemCycle = 0;
    it.skillPressed = false;
    it.skillCycle = 0;
    it.lockSwitch = 0;
    for (const s of this.sources) s.collect(it);
    const len = Math.hypot(it.moveX, it.moveY);
    if (len > 1) {
      it.moveX /= len;
      it.moveY /= len;
    }
    return it;
  }

  /** sim ステップ末尾に呼ぶ */
  endStep(): void {
    for (const s of this.sources) s.endStep();
  }
}
