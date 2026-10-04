import type { InputIntent, InputSource } from './intent';

/**
 * 開発用キーボード入力。WASD/矢印: 移動, J: 攻撃（押し続けると溜め）, K: 回避, H: ガード（押している間）, G: 装備の切替, U: アイテムを使う, I: アイテムの選択を次へ, O: スキルを使う, P: スキルの選択を次へ, L: ロックオン, Q/E: 対象切替, 矢印(Shift): カメラ。
 * 製品の操作系はタッチ専用（ADR-006）。これは PC での動作確認のためだけに存在する。
 */
export class KeyboardInput implements InputSource {
  private readonly down = new Set<string>();
  private attackEdge = false;
  private dodgeEdge = false;
  private guardEdge = false;
  private equipEdge = false;
  private lockEdge = false;
  private itemEdge = false;
  private itemCycle = 0;
  private skillEdge = false;
  private skillCycle = 0;
  private lockSwitch = 0;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      switch (e.code) {
        case 'KeyJ':
          this.attackEdge = true;
          break;
        case 'KeyK':
          this.dodgeEdge = true;
          break;
        case 'KeyH':
          this.guardEdge = true;
          break;
        case 'KeyG':
          this.equipEdge = true;
          break;
        case 'KeyL':
          this.lockEdge = true;
          break;
        case 'KeyU':
          this.itemEdge = true;
          break;
        case 'KeyI':
          this.itemCycle = 1;
          break;
        case 'KeyO':
          this.skillEdge = true;
          break;
        case 'KeyP':
          this.skillCycle = 1;
          break;
        case 'KeyQ':
          this.lockSwitch = -1;
          break;
        case 'KeyE':
          this.lockSwitch = 1;
          break;
      }
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  collect(intent: InputIntent): void {
    const d = this.down;
    let x = 0;
    let y = 0;
    if (d.has('KeyA')) x -= 1;
    if (d.has('KeyD')) x += 1;
    if (d.has('KeyW')) y += 1;
    if (d.has('KeyS')) y -= 1;
    intent.moveX += x;
    intent.moveY += y;
    const camSpeed = 0.045; // rad / step
    if (d.has('ArrowLeft')) intent.camYaw += camSpeed;
    if (d.has('ArrowRight')) intent.camYaw -= camSpeed;
    if (d.has('ArrowUp')) intent.camPitch -= camSpeed * 0.6;
    if (d.has('ArrowDown')) intent.camPitch += camSpeed * 0.6;
    if (this.attackEdge) intent.attackPressed = true;
    if (this.dodgeEdge) intent.dodgePressed = true;
    if (d.has('KeyJ')) intent.attackHeld = true;
    if (this.guardEdge) intent.guardPressed = true;
    if (d.has('KeyH')) intent.guardHeld = true;
    if (this.equipEdge) intent.equipPressed = true;
    if (this.lockEdge) intent.lockPressed = true;
    if (this.itemEdge) intent.itemPressed = true;
    if (this.itemCycle !== 0) intent.itemCycle = this.itemCycle;
    if (this.skillEdge) intent.skillPressed = true;
    if (this.skillCycle !== 0) intent.skillCycle = this.skillCycle;
    if (this.lockSwitch !== 0) intent.lockSwitch = this.lockSwitch;
  }

  endStep(): void {
    this.attackEdge = false;
    this.dodgeEdge = false;
    this.guardEdge = false;
    this.equipEdge = false;
    this.lockEdge = false;
    this.itemEdge = false;
    this.itemCycle = 0;
    this.skillEdge = false;
    this.skillCycle = 0;
    this.lockSwitch = 0;
  }
}
