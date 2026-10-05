import type { Obstacle, WorldDef } from '../world';

/**
 * 闘技場の障害物（M7-1。ADR-039）。当たり（World）と見た目（Arena）を同じ表から作る = 見えている物と止まる物がずれない。
 * 数値は仮置き（実機で配置・高さを見て調整）。三者の高さの目安（`world.ts` の STEP_UP = 0.45、弾の高さ PROJECTILE_HEIGHT = 1.1）:
 *  - 岩・低い壁（上面 0.85〜0.9）: 弾は上を通る・いずれまたいで越えられる（M7-2 のジャンプ・乗り越え）
 *  - 箱（上面 1.5）・石の壇（上面 2.2）: 弾を遮る・**登れる縁**（climbable。跳んでも乗れない高さを、掴んで登る。M7-3b）
 *  - 柱（上面 3.2〜4.5）: 弾を遮る・登れない
 */
export const ARENA_RADIUS = 14;

/** 見た目の種類（Arena が作る形） */
export type PropStyle = 'pillar' | 'column' | 'rock' | 'wall' | 'block';

export interface PropDef {
  style: PropStyle;
  obstacle: Obstacle;
}

const polar = (angleDeg: number, radius: number): { x: number; z: number } => {
  const a = (angleDeg * Math.PI) / 180;
  return { x: Math.cos(a) * radius, z: Math.sin(a) * radius };
};

/** 円周の接線を長辺の向きにする箱の yaw（rad。three の rotation.y と同じ向きの約束。world.ts の BoxObstacle） */
const tangentYaw = (angleDeg: number): number => {
  const a = (angleDeg * Math.PI) / 180;
  return Math.atan2(-Math.cos(a), -Math.sin(a));
};

const props: PropDef[] = [];

// 縁の柱 8 本（これまでの飾りの柱。縁から 1.6m 内側。上面 4.5）
for (let i = 0; i < 8; i++) {
  const p = polar((i / 8) * 360 + 180 / 8, ARENA_RADIUS - 1.6);
  props.push({ style: 'pillar', obstacle: { kind: 'circle', x: p.x, z: p.z, r: 0.55, top: 4.5 } });
}

// 折れた太い柱 4 本（斜めの 4 方向。弾の遮蔽になる。縦と横の軸の上は空けて、ロックして向かい合う戦いの邪魔をしない）
for (let k = 0; k < 4; k++) {
  const p = polar(45 + 90 * k, 9);
  props.push({ style: 'column', obstacle: { kind: 'circle', x: p.x, z: p.z, r: 0.75, top: 3.2 } });
}

// 低い岩 2 本（上面 0.85。弾は上を通る）
for (const angle of [150, 330]) {
  const p = polar(angle, 7);
  props.push({ style: 'rock', obstacle: { kind: 'circle', x: p.x, z: p.z, r: 0.95, top: 0.85 } });
}

// 崩れた低い壁（長辺 4.4m・厚み 0.6m・上面 0.9。縁に沿う）と、石の箱（2m 角・上面 1.5）
{
  const wall = polar(200, 9.5);
  props.push({ style: 'wall', obstacle: { kind: 'box', x: wall.x, z: wall.z, hx: 2.2, hz: 0.3, yaw: tangentYaw(200), top: 0.9 } });
  const block = polar(340, 9);
  props.push({ style: 'block', obstacle: { kind: 'box', x: block.x, z: block.z, hx: 1, hz: 1, yaw: 0.4, top: 1.5, climbable: true } });
  // 石の壇（上面 2.2。縁の柱の手前。高い縁を掴んで登る）
  const terrace = polar(292.5, 9.4);
  props.push({ style: 'block', obstacle: { kind: 'box', x: terrace.x, z: terrace.z, hx: 1.5, hz: 1, yaw: tangentYaw(292.5), top: 2.2, climbable: true } });
}

export const ARENA_PROPS: readonly PropDef[] = props;

export const ARENA_WORLD: WorldDef = { radius: ARENA_RADIUS, obstacles: ARENA_PROPS.map((p) => p.obstacle) };
