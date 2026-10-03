import * as THREE from 'three';

/**
 * 敵の頭上の HP バー（DOM）。傷を負って生きている敵にだけ出し、頭の上のワールド座標を画面へ投影して追う。
 * M3 の「ロックオン対象の HP」が入るまでの手がかり。要素は使い回す（プール）。
 */

interface BarTarget {
  readonly id: number;
  readonly health: { hp: number; max: number };
  readonly dead: boolean;
  readonly body: { x: number; z: number };
  readonly def: { height: number };
}

const _v = new THREE.Vector3();

export class EnemyBars {
  private readonly bars: { el: HTMLElement; fill: HTMLElement; lag: HTMLElement; shown: boolean }[] = [];

  constructor(layer: HTMLElement, size = 8) {
    for (let i = 0; i < size; i++) {
      const el = document.createElement('div');
      el.className = 'hp ebar';
      el.style.display = 'none';
      const lag = document.createElement('div');
      lag.className = 'hp-lag';
      const fill = document.createElement('div');
      fill.className = 'hp-fill';
      el.append(lag, fill);
      layer.appendChild(el);
      this.bars.push({ el, fill, lag, shown: false });
    }
  }

  /** 毎描画フレーム。カメラの行列は更新済みであること（描画のあとに呼ぶ）。width/height は CSS px */
  update(camera: THREE.Camera, targets: readonly BarTarget[], width: number, height: number, skipId: number | null = null): void {
    for (let i = 0; i < this.bars.length; i++) {
      const bar = this.bars[i]!;
      const t = targets[i];
      // ロック対象の HP は画面上部のバーに出すので、頭上のバーは出さない
      const visible = t !== undefined && !t.dead && t.health.hp < t.health.max && t.id !== skipId;
      if (!visible) {
        if (bar.shown) {
          bar.el.style.display = 'none';
          bar.shown = false;
        }
        continue;
      }
      _v.set(t.body.x, t.def.height + 0.3, t.body.z).project(camera);
      if (_v.z > 1) {
        bar.el.style.display = 'none';
        bar.shown = false;
        continue;
      }
      if (!bar.shown) {
        bar.el.style.display = '';
        bar.shown = true;
      }
      const x = (_v.x * 0.5 + 0.5) * width;
      const y = (-_v.y * 0.5 + 0.5) * height;
      bar.el.style.transform = `translate(${(x - 39).toFixed(1)}px, ${y.toFixed(1)}px)`;
      const w = `${(t.health.hp / t.health.max) * 100}%`;
      bar.fill.style.width = w;
      bar.lag.style.width = w;
    }
  }
}
