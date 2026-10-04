import * as THREE from 'three';
import type { HitStyle } from '../combat/feedback';

/**
 * ダメージ数字（DOM）。命中位置のワールド座標を画面へ投影して、上へ浮かびながら消える。
 * 実時間（描画の dt）で進める。ヒットストップ中も数字は出て動く。要素は使い回す（プール）。
 */

interface Item {
  el: HTMLElement;
  active: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  /** 画面上のずらし（px）。同じ場所に重なっても読めるように */
  jitter: number;
  scale: number;
}

const LIFE = 0.9;
const RISE_PX = 70;
const _v = new THREE.Vector3();

export class DamageNumbers {
  private readonly items: Item[] = [];
  private next = 0;

  constructor(layer: HTMLElement, size = 16) {
    for (let i = 0; i < size; i++) {
      const el = document.createElement('div');
      el.className = 'dmg';
      el.style.display = 'none';
      layer.appendChild(el);
      this.items.push({ el, active: false, age: 0, life: LIFE, x: 0, y: 0, z: 0, jitter: 0, scale: 1 });
    }
  }

  /** world は命中位置。style で大きさと色が変わる（guard = ガードで受けた削り、riposte = 弾かれた敵への反撃） */
  spawn(x: number, y: number, z: number, value: number, style: HitStyle | 'hurt' | 'guard' | 'riposte' | 'heal' | 'crit'): void {
    this.put(x, y, z, style === 'crit' ? `${Math.round(value)}!` : String(Math.round(value)), style);
  }

  /** 数字ではなく文字（パリィの「PARRY」など）を同じ要領で浮かべる。scale は文字の大きさの倍率（大剣のパリィは大きく） */
  spawnText(x: number, y: number, z: number, text: string, style: 'parry' | 'warn' | 'break' | 'mystic' | 'heal' | 'item' | 'skill' | 'armor' | 'level', scale = 1): void {
    this.put(x, y, z, text, style, scale);
  }

  private put(x: number, y: number, z: number, text: string, style: HitStyle | 'hurt' | 'guard' | 'riposte' | 'crit' | 'parry' | 'warn' | 'break' | 'mystic' | 'heal' | 'item' | 'skill' | 'armor' | 'level', scale = 1): void {
    // 空きがなければ一番古いものを使う（リングバッファ）
    const it = this.items[this.next]!;
    this.next = (this.next + 1) % this.items.length;
    it.active = true;
    it.age = 0;
    it.life = style === 'kill' || style === 'crit' ? LIFE * 1.25 : LIFE;
    it.x = x;
    it.y = y;
    it.z = z;
    it.jitter = (Math.random() - 0.5) * 36;
    it.scale = (style === 'crit' ? 1.75 : style === 'kill' ? 1.6 : style === 'heavy' || style === 'riposte' ? 1.3 : style === 'parry' || style === 'warn' || style === 'break' || style === 'mystic' || style === 'heal' || style === 'skill' || style === 'armor' || style === 'level' ? 1.15 : style === 'guard' ? 0.8 : 1) * scale;
    it.el.textContent = text;
    it.el.className = `dmg dmg-${style}`;
    it.el.style.display = '';
  }

  /** 毎描画フレーム。カメラは行列が更新済みであること（描画のあとに呼ぶ）。width/height は CSS px */
  update(camera: THREE.Camera, frameDt: number, width: number, height: number): void {
    for (const it of this.items) {
      if (!it.active) continue;
      it.age += frameDt;
      if (it.age >= it.life) {
        it.active = false;
        it.el.style.display = 'none';
        continue;
      }
      const t = it.age / it.life;
      _v.set(it.x, it.y, it.z).project(camera);
      if (_v.z > 1) {
        it.el.style.display = 'none'; // カメラの背後
        continue;
      }
      it.el.style.display = '';
      const sx = (_v.x * 0.5 + 0.5) * width + it.jitter;
      // 上へ浮かぶ（出だしが速く、だんだん止まる）
      const rise = RISE_PX * (1 - (1 - t) * (1 - t));
      const sy = (-_v.y * 0.5 + 0.5) * height - rise;
      // 出だしに弾む（0.6 → 1.25 → 1.0）。最後は縮んで消える
      const pop = t < 0.1 ? 0.6 + (t / 0.1) * 0.65 : t < 0.2 ? 1.25 - ((t - 0.1) / 0.1) * 0.25 : 1;
      const fade = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      it.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%) scale(${(pop * it.scale).toFixed(3)})`;
      it.el.style.opacity = fade.toFixed(2);
    }
  }

  clear(): void {
    for (const it of this.items) {
      it.active = false;
      it.el.style.display = 'none';
    }
  }
}
