import { bakeAttack, type AuthoredAttack, type BakeStats, type FrameTrace } from '../character/authoring';
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
  bake(def: AuthoredAttack): { stats: BakeStats; trace: FrameTrace[] };
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
      const { stats, trace } = bakeAttack(cap.rig, def, 60, cap.extras);
      return { stats, trace };
    },
  };
}
