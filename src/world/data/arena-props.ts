import type { HazardDef, Obstacle, WorldDef } from '../world';

/**
 * 闘技場の障害物（M7-1。ADR-039）。当たり（World）と見た目（Arena）を同じ表から作る = 見えている物と止まる物がずれない。
 * 数値は仮置き（実機で配置・高さを見て調整）。三者の高さの目安（`world.ts` の STEP_UP = 0.45、弾の高さ PROJECTILE_HEIGHT = 1.1）:
 *  - 岩・低い壁（上面 0.85〜0.9）: 弾は上を通る・いずれまたいで越えられる（M7-2 のジャンプ・乗り越え）
 *  - 箱（上面 1.5）・石の壇（上面 2.2）: 弾を遮る・**登れる縁**（climbable。跳んでも乗れない高さを、掴んで登る。M7-3b）
 *  - 柱（上面 3.2〜4.5）: 弾を遮る・登れない
 *  - 木箱・樽（上面 0.9〜0.95。M7-4d）: 壊せる（壊すと世界から消える）。炎の床（M7-4e）は床の危険地帯
 */
export const ARENA_RADIUS = 14;

/** 見た目の種類（Arena が作る形） */
export type PropStyle = 'pillar' | 'column' | 'rock' | 'wall' | 'block' | 'crate' | 'barrel';

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

// 壊せる物（M7-4d。ADR-046）: 木箱 3 つ（上面 0.9。叩くと壊れる。猪の突進が突き破る）と樽 2 つ。壊すと薬瓶（小）が出ることがある。
// 縦・横の軸の上は空けた（ロックして向かい合う戦いの邪魔をしない）。木箱は上面が 0.9m なので、壊す前なら乗り上がって登れる
const CRATE = { hp: 30, drops: [{ item: 'potionS', chance: 0.3 }] } as const;
const BARREL = { hp: 20, drops: [{ item: 'potionS', chance: 0.2 }] } as const;
{
  // 木箱は 2 つ並べて置き（北西）と 1 つ（南西）、樽は北東と南東。中心に近い輪（半径 4〜5.5m）に置いて、柱・岩・壁との間を大きな敵（大将。半径 1.25m）が通れる広さに保つ
  const a = polar(112, 4.6);
  props.push({ style: 'crate', obstacle: { kind: 'box', x: a.x, z: a.z, hx: 0.45, hz: 0.45, yaw: 0.3, top: 0.9, breakable: CRATE } });
  const b = polar(126, 5.4);
  props.push({ style: 'crate', obstacle: { kind: 'box', x: b.x, z: b.z, hx: 0.45, hz: 0.45, yaw: -0.2, top: 0.9, breakable: CRATE } });
  const c = polar(244, 4.8);
  props.push({ style: 'crate', obstacle: { kind: 'box', x: c.x, z: c.z, hx: 0.45, hz: 0.45, yaw: 0.6, top: 0.9, breakable: CRATE } });
  for (const [angle, radius] of [[60, 4.4], [300, 5.2]] as const) {
    const p = polar(angle, radius);
    props.push({ style: 'barrel', obstacle: { kind: 'circle', x: p.x, z: p.z, r: 0.42, top: 0.95, breakable: BARREL } });
  }
}

export const ARENA_PROPS: readonly PropDef[] = props;

// 床の危険地帯（M7-4e。ADR-046）: 炎の床 2 か所（半径 1.6m）。踏むと燃える（跳べば避けられる・回避の無敵で抜けられる）。敵も燃える。
// 縦・横の軸の上と、出現の輪（半径 6m）を避けた。中心から外へ向かう道をふさがない位置
export const ARENA_HAZARDS: readonly HazardDef[] = [
  { ...polar(20, 5), r: 1.6, type: 'fire' },
  { ...polar(215, 4.6), r: 1.6, type: 'fire' },
];

export const ARENA_WORLD: WorldDef = { radius: ARENA_RADIUS, obstacles: ARENA_PROPS.map((p) => p.obstacle), hazards: ARENA_HAZARDS };
