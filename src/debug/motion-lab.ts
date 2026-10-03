import { AuthoredSampler, bakeAttack, type AuthoredAttack, type BakeStats, type FrameTrace } from '../character/authoring';
import { AUTHORED_ATTACKS } from '../character/data/authored';
import { plane } from '../character/data/cutting-plane';
import { pose } from '../character/data/stagger';
import type { Game } from '../game/game';
import type { HeroVisual } from '../game/hero-visual';

/**
 * 手付けモーションの実験場（開発用。`?motionlab=1` のときだけ読み込む）。ページの中で、実際のリグ（Meshy のキャラ）に対して
 * AuthoredAttack を焼き、統計（腕のクランプ・手首の曲がり/ねじれなど）とフレームごとの値を返す。
 * ビルドし直さずに、手首のねじれを減らす roll の値や面の向きを何通りも試して選ぶために使う（tools/motion-check.mjs の --stats / --trace と同じ値）。
 */

export interface MotionLab {
  /** 登録済みの手付けクリップ（コピーして値を変えて bake に渡す） */
  attacks: Record<string, AuthoredAttack>;
  plane: typeof plane;
  pose: typeof pose;
  bake(def: AuthoredAttack): { stats: BakeStats; trace: FrameTrace[]; hipsY: number[] };
  /** 時刻 t の入力値（体の向きは度、足は m）。クリップのつなぎ目や回転の値を調べる */
  sample(def: AuthoredAttack, t: number): Record<string, number>;
}

export function installMotionLab(game: Game): MotionLab {
  return {
    attacks: AUTHORED_ATTACKS,
    plane,
    pose,
    bake(def) {
      // Player.visual は private（開発用フックなので型を越えて読む。tools/motion-check.mjs も同じ経路）
      const visual = (game.player as unknown as { visual: HeroVisual | null }).visual;
      if (!visual) throw new Error('キャラクターの読み込みが終わっていません');
      const cap = visual.capture;
      const { clip, stats, trace } = bakeAttack(cap.rig, def, 60, cap.extras);
      // Hips の高さ（m。クリップの Hips.position は cm）
      const pos = clip.tracks.find((t) => t.name === 'Hips.position');
      const hipsY: number[] = [];
      if (pos) for (let i = 1; i < pos.values.length; i += 3) hipsY.push(Math.round(pos.values[i]!) / 100);
      return { stats, trace, hipsY };
    },
    sample(def, t) {
      const visual = (game.player as unknown as { visual: HeroVisual | null }).visual;
      if (!visual) throw new Error('キャラクターの読み込みが終わっていません');
      const s = new AuthoredSampler(visual.capture.rig, def);
      const p = s.sample(t, s.newInput());
      const deg = (r: number) => Math.round((r * 180) / Math.PI * 10) / 10;
      const r3 = (v: number) => Math.round(v * 1000) / 1000;
      return {
        rootZ: r3(p.rootZ),
        hipsYaw: deg(p.hips.yaw), hipsPitch: deg(p.hips.pitch), hipsY: r3(p.hips.y), hipsZ: r3(p.hips.z),
        chestYaw: deg(p.chest.yaw), chestPitch: deg(p.chest.pitch),
        headYaw: deg(p.head.yaw), headPitch: deg(p.head.pitch),
        footLz: r3(p.footL.z), footLrel: r3(p.footL.rel ?? 0), footLpitch: deg(p.footL.pitch), footRz: r3(p.footR.z), footRrel: r3(p.footR.rel ?? 0),
      };
    },
  };
}
