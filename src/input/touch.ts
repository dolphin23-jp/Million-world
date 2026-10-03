import type { InputIntent, InputSource } from './intent';
import { TOUCH } from './data/touch';

/**
 * タッチ入力（docs/04-controls.md）。
 * 左半分: 浮動スティック / 右半分: カメラドラッグ / 右下: ボタン群。
 * Pointer Events で pointerId ごとに追跡するのでマルチタッチに対応する。
 * マウスでも同じ経路で動く（開発用）。
 */

interface Elements {
  layer: HTMLElement;
  stickZone: HTMLElement;
  stickBase: HTMLElement;
  stickKnob: HTMLElement;
  camZone: HTMLElement;
  btnAttack: HTMLElement;
  btnDodge: HTMLElement;
  btnLock: HTMLElement;
}

function q<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as T;
}

export class TouchInput implements InputSource {
  private readonly el: Elements;

  // スティック
  private stickPointer: number | null = null;
  private originX = 0;
  private originY = 0;
  private stickX = 0; // -1..1（画面基準、右が正）
  private stickY = 0; // -1..1（画面基準、上が正）

  // カメラ
  private camPointer: number | null = null;
  private camLastX = 0;
  private camLastY = 0;
  private camDxPx = 0; // sim ステップ間に溜める
  private camDyPx = 0;
  /** 1 回のドラッグで横に動いた量。しきい値を越えたら対象切替の入力を 1 回出す（ロック中だけゲームが使う） */
  private swipePx = 0;
  private swipeFired = false;
  private switchEdge = 0;

  // ボタンのエッジ
  private attackEdge = false;
  /** 攻撃ボタンを押している間 true */
  private attackHeld = false;
  private dodgeEdge = false;
  private lockEdge = false;

  constructor() {
    this.el = {
      layer: q('touch-layer'),
      stickZone: q('stick-zone'),
      stickBase: q('stick-base'),
      stickKnob: q('stick-knob'),
      camZone: q('cam-zone'),
      btnAttack: q('btn-attack'),
      btnDodge: q('btn-dodge'),
      btnLock: q('btn-lock'),
    };
    this.bindStick();
    this.bindCamera();
    // 攻撃は押している間も読む（長押しの溜め。ADR-018）
    this.bindButton(
      this.el.btnAttack,
      () => {
        this.attackEdge = true;
        this.attackHeld = true;
      },
      () => (this.attackHeld = false),
    );
    this.bindButton(this.el.btnDodge, () => (this.dodgeEdge = true));
    this.bindButton(this.el.btnLock, () => (this.lockEdge = true));
  }

  /** ロックオン状態の見た目（入力層はロジックを知らないので外から教える） */
  setLockIndicator(on: boolean): void {
    this.el.btnLock.classList.toggle('active', on);
  }

  collect(intent: InputIntent): void {
    intent.moveX += this.stickX;
    intent.moveY += this.stickY;
    intent.camYaw += -this.camDxPx * TOUCH.camYawPerPx;
    intent.camPitch += this.camDyPx * TOUCH.camPitchPerPx;
    this.camDxPx = 0;
    this.camDyPx = 0;
    if (this.attackEdge) intent.attackPressed = true;
    if (this.dodgeEdge) intent.dodgePressed = true;
    if (this.attackHeld) intent.attackHeld = true;
    if (this.lockEdge) intent.lockPressed = true;
    if (this.switchEdge !== 0) intent.lockSwitch = this.switchEdge;
  }

  endStep(): void {
    this.attackEdge = false;
    this.dodgeEdge = false;
    this.lockEdge = false;
    this.switchEdge = 0;
  }

  // ---------------- スティック ----------------

  private bindStick(): void {
    const zone = this.el.stickZone;
    zone.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== null) return;
      e.preventDefault();
      this.stickPointer = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this.originX = e.clientX;
      this.originY = e.clientY;
      this.updateStick(e.clientX, e.clientY);
      this.el.stickBase.style.display = 'block';
      this.placeBase();
    });
    const move = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      e.preventDefault();
      // 原点追従: 指が遠くに行ったら原点を引き寄せる
      const dx = e.clientX - this.originX;
      const dy = e.clientY - this.originY;
      const d = Math.hypot(dx, dy);
      if (d > TOUCH.stickFollowRadius) {
        const k = (d - TOUCH.stickFollowRadius) / d;
        this.originX += dx * k;
        this.originY += dy * k;
        this.placeBase();
      }
      this.updateStick(e.clientX, e.clientY);
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.stickX = 0;
      this.stickY = 0;
      this.el.stickBase.style.display = 'none';
      this.el.stickKnob.style.transform = 'translate(0px, 0px)';
    };
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
  }

  private placeBase(): void {
    this.el.stickBase.style.left = `${this.originX}px`;
    this.el.stickBase.style.top = `${this.originY}px`;
  }

  private updateStick(x: number, y: number): void {
    let dx = x - this.originX;
    let dy = y - this.originY;
    const d = Math.hypot(dx, dy);
    if (d < TOUCH.stickDeadzone) {
      this.stickX = 0;
      this.stickY = 0;
      this.el.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      return;
    }
    // デッドゾーンを超えた分を 0..1 に正規化
    const mag = Math.min(1, (d - TOUCH.stickDeadzone) / (TOUCH.stickRadius - TOUCH.stickDeadzone));
    const nx = dx / d;
    const ny = dy / d;
    this.stickX = nx * mag;
    this.stickY = -ny * mag; // 画面上方向を +Y に
    const knobD = Math.min(d, TOUCH.stickRadius);
    dx = nx * knobD;
    dy = ny * knobD;
    this.el.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  // ---------------- カメラ ----------------

  private bindCamera(): void {
    const zone = this.el.camZone;
    zone.addEventListener('pointerdown', (e) => {
      if (this.camPointer !== null) return;
      e.preventDefault();
      this.camPointer = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this.camLastX = e.clientX;
      this.camLastY = e.clientY;
      this.swipePx = 0;
      this.swipeFired = false;
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.camPointer) return;
      e.preventDefault();
      this.camDxPx += e.clientX - this.camLastX;
      this.camDyPx += e.clientY - this.camLastY;
      // 横スワイプで対象切替（右へ払えば右の敵）。1 回のドラッグで 1 回だけ
      this.swipePx += e.clientX - this.camLastX;
      if (!this.swipeFired && Math.abs(this.swipePx) >= TOUCH.lockSwitchSwipePx) {
        this.switchEdge = this.swipePx > 0 ? 1 : -1;
        this.swipeFired = true;
      }
      this.camLastX = e.clientX;
      this.camLastY = e.clientY;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.camPointer) return;
      this.camPointer = null;
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
  }

  // ---------------- ボタン ----------------

  private bindButton(btn: HTMLElement, onPress: () => void, onRelease?: () => void): void {
    let pid: number | null = null;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (pid !== null) return;
      pid = e.pointerId;
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('pressed');
      onPress();
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      pid = null;
      btn.classList.remove('pressed');
      onRelease?.();
    };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('lostpointercapture', end);
  }
}
