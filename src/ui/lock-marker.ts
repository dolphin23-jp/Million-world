import * as THREE from 'three';

/**
 * ロックオンのマーカー（DOM）。ロック対象の胸のあたりに、照準の枠を出す。
 * ロックした瞬間・対象が切り替わった瞬間に、大きいところから絞り込む（見て分かる合図）。実時間（描画の dt）で動く。
 */

const _v = new THREE.Vector3();
const SNAP_SECONDS = 0.18;

export class LockMarker {
  private readonly el: HTMLElement;
  private shownId: number | null = null;
  private snap = 0;

  constructor(layer: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'lock-marker';
    this.el.style.display = 'none';
    // 四隅の枠（CSS で描く）
    for (let i = 0; i < 4; i++) {
      const corner = document.createElement('i');
      corner.className = `c${i}`;
      this.el.appendChild(corner);
    }
    layer.appendChild(this.el);
  }

  /** target は対象の位置（胸の高さ）。null でなし。id が変わったら絞り込みを起こす。カメラの行列は更新済みであること */
  update(camera: THREE.Camera, target: { id: number; x: number; y: number; z: number } | null, frameDt: number, width: number, height: number): void {
    if (!target) {
      if (this.shownId !== null) {
        this.el.style.display = 'none';
        this.shownId = null;
      }
      return;
    }
    _v.set(target.x, target.y, target.z).project(camera);
    if (_v.z > 1) {
      this.el.style.display = 'none';
      return;
    }
    if (target.id !== this.shownId) {
      this.shownId = target.id;
      this.snap = SNAP_SECONDS;
    }
    this.snap = Math.max(0, this.snap - frameDt);
    const t = this.snap / SNAP_SECONDS;
    const scale = 1 + t * t * 1.6;
    const sx = (_v.x * 0.5 + 0.5) * width;
    const sy = (-_v.y * 0.5 + 0.5) * height;
    this.el.style.display = '';
    this.el.style.opacity = String(1 - t * 0.5);
    this.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
  }
}
