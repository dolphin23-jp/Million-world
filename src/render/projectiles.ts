import * as THREE from 'three';
import { lerp } from '../core/math';
import { PROJECTILE_HEIGHT } from '../combat/data/projectiles';
import type { Projectile, ProjectileSystem } from '../combat/projectile';
import { addOutline } from './toon';

/**
 * 飛び道具（鬼火。ADR-026）の描画。sim は src/combat/projectile.ts、ここは描くだけ。
 * 鬼火のかたち: 白い核の球 + 後ろへ尾を引く炎（円錐。ベタ塗りのトゥーン調）+ 球の輪郭線 + 加算のにじみ（ブルームに乗る）+ 床に落ちる光（奥行きの目印）。
 * 敵の弾は紫、パリィで弾き返した弾は水色（パリィの閃光と同じ色。「自分の弾になった」が読める）。
 * 枠はプール（MAX 個を最初に作って使い回す）。ヒットストップ中は animDt が 0 で、尾のゆらぎも止まる。
 */

const COLORS = {
  enemy: { core: 0xd9c9ff, flame: 0x8f6bff, halo: 0x9a78ff, outline: 0x2a1458 },
  player: { core: 0xcff4ff, flame: 0x5fd8ff, halo: 0x7fe8ff, outline: 0x0d4a63 },
} as const;

/** 核の見た目の半径に対する当たりの半径の比（当たりのほうが少し大きい = 光の縁がかすったように見える） */
const CORE_RATIO = 0.85;
const FLAME_LENGTH = 0.95;
/** 撃たれた直後に、小さい球が膨らむ長さ（sim フレーム） */
const BIRTH_FRAMES = 6;

interface Slot {
  root: THREE.Group;
  coreMat: THREE.MeshBasicMaterial;
  outlineMat: THREE.ShaderMaterial;
  flame: THREE.Mesh;
  flameMat: THREE.MeshBasicMaterial;
  haloMat: THREE.SpriteMaterial;
  halo: THREE.Sprite;
  glow: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  /** 色を最後に合わせた陣営（毎フレームの色の書き込みを避ける） */
  team: Projectile['team'] | null;
}

export const WISP_COLORS = COLORS;

let glowTex: THREE.CanvasTexture | null = null;

/** やわらかい丸（にじみ・床の光の共通。中心が白く、縁へ向けて消える）。全部の鬼火・提灯の溜めで 1 枚を共有する */
export function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const n = 64;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  glowTex = tex;
  return tex;
}

export class ProjectileRenderer {
  readonly group = new THREE.Group();
  private readonly slots: Slot[] = [];
  private time = 0;

  constructor(count: number, radius: number) {
    this.group.name = 'projectiles';
    const coreR = radius * CORE_RATIO;
    const coreGeo = new THREE.SphereGeometry(coreR, 14, 10);
    // 尾: 底が核の中心、先が −Z（飛ぶ向きの後ろ）の円錐
    const flameGeo = new THREE.ConeGeometry(coreR * 0.95, FLAME_LENGTH, 10, 1, true);
    flameGeo.rotateX(-Math.PI / 2);
    flameGeo.translate(0, 0, -FLAME_LENGTH / 2);
    const haloTex = glowTexture();
    const glowGeo = new THREE.PlaneGeometry(1, 1);
    glowGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < count; i++) {
      const root = new THREE.Group();
      root.visible = false;
      const coreMat = new THREE.MeshBasicMaterial({ color: COLORS.enemy.core, toneMapped: false, fog: false });
      const core = new THREE.Mesh(coreGeo, coreMat);
      const outline = addOutline(core, { color: COLORS.enemy.outline, thickness: 0.03 });
      const outlineMat = outline.material as THREE.ShaderMaterial;
      root.add(core);
      const flameMat = new THREE.MeshBasicMaterial({ color: COLORS.enemy.flame, toneMapped: false, fog: false, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
      const flame = new THREE.Mesh(flameGeo, flameMat);
      root.add(flame);
      const haloMat = new THREE.SpriteMaterial({ map: haloTex, color: COLORS.enemy.halo, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const halo = new THREE.Sprite(haloMat);
      halo.renderOrder = 7;
      root.add(halo);
      // 床に落ちる光（根元からの高さぶん下げる。root は高さ PROJECTILE_HEIGHT にある）
      const glowMat = new THREE.MeshBasicMaterial({ map: haloTex, color: COLORS.enemy.halo, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.55 });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.renderOrder = 3;
      glow.frustumCulled = false;
      root.add(glow);
      this.group.add(root);
      this.slots.push({ root, coreMat, outlineMat, flame, flameMat, haloMat, halo, glow, glowMat, team: null });
    }
  }

  /** 毎描画フレーム。animDt はヒットストップで止まる時間（尾のゆらぎ）、alpha は sim の補間 */
  update(system: ProjectileSystem, alpha: number, animDt: number): void {
    this.time += animDt;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      const p = system.pool[i];
      if (!p || !p.alive) {
        s.root.visible = false;
        continue;
      }
      s.root.visible = true;
      if (s.team !== p.team) {
        s.team = p.team;
        const c = COLORS[p.team];
        s.coreMat.color.set(c.core);
        s.flameMat.color.set(c.flame);
        s.haloMat.color.set(c.halo);
        s.glowMat.color.set(c.halo);
        (s.outlineMat.uniforms.uColor!.value as THREE.Color).set(c.outline);
      }
      const bob = Math.sin(this.time * 9 + i * 1.7) * 0.04;
      s.root.position.set(lerp(p.prevX, p.x, alpha), PROJECTILE_HEIGHT + bob, lerp(p.prevZ, p.z, alpha));
      s.root.rotation.y = Math.atan2(p.dirX, p.dirZ);
      // 撃たれた直後は小さく、膨らんで収まる。弾き返した直後は一瞬大きく光る
      const born = Math.min(1, (p.age + alpha) / BIRTH_FRAMES);
      const pulse = 1 + 0.08 * Math.sin(this.time * 24 + i);
      const scale = (0.45 + 0.55 * born) * pulse;
      s.root.scale.setScalar(scale);
      // 尾のゆらぎ（長さと太さ）。弾き返した弾は速いので尾が長い
      const flick = 1 + 0.22 * Math.sin(this.time * 31 + i * 2.3);
      const fast = p.speed / p.def.speed;
      s.flame.scale.set(1 + 0.12 * Math.sin(this.time * 27 + i), 1 + 0.12 * Math.cos(this.time * 23 + i), flick * (0.7 + 0.35 * fast));
      const haloSize = (p.def.radius * 6.5 + 0.18 * Math.sin(this.time * 17 + i)) / scale;
      s.halo.scale.set(haloSize, haloSize, 1);
      s.haloMat.opacity = 0.62 + 0.12 * Math.sin(this.time * 13 + i);
      // 床の光は高さぶん下へ。弾が床から離れているぶん、少し大きく淡く
      s.glow.position.y = (-PROJECTILE_HEIGHT - bob + 0.03) / scale;
      const g = (1.5 + 0.3 * Math.sin(this.time * 11 + i)) / scale;
      s.glow.scale.set(g, 1, g);
    }
  }

  /** すべて隠す（戦闘のやり直し） */
  clear(): void {
    for (const s of this.slots) s.root.visible = false;
  }
}
