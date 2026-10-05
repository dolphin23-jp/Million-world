import type { AuthoredAttack, AuthoredKey, Ease } from '../authoring';
import { FROM_STANCE, GS_READY, GS_TWO_HAND } from './greatsword';

/**
 * ジャンプ（M7-2。ADR-040）の手付けクリップ 3 本: 跳び上がり（jump）→ 落下（fall）→ 着地（land）。座標の約束は combo1.ts と同じ（胸の座標系）。
 * 高さはクリップではなく sim（Player.y）が決める。クリップは体の姿勢だけ: 腰の沈み・伸び・足の畳み方・腕の広げ方。ルートは動かさない（rootZ なし）。
 *
 *  - jump: 0 → 0.05 沈む（踏み切りの沈み = JUMP.squatFrames と同じ長さ。足は地面に付いたまま）→ 0.14 まで蹴り出して伸びる（足が腰に付いてぶら下がる）→ 頂点まで保つ。
 *    左膝を前へ引き上げ、右足は後ろへ流す（立ち止まっての跳躍でも、走っての跳躍でも収まる非対称の姿勢）。腕は体の横へ広げてバランスを取る
 *  - fall: 頂点から落ちるあいだ。足が地面を探して伸び、腕は広がったまま。終端の姿勢で止まる（clamp）
 *  - land: 足が地面に着き（世界へ固定し直す）、膝と腰を沈めて衝撃を受け、立ち上がる。着地の硬直（JUMP.land.frames = 9f）の少し後ろまでの長さ
 *
 * 3 本は続けて再生されるので、fall は jump の終わりから、land は fall の終わりから始まる（continueFrom。つなぎ目で姿勢が跳ばない）。
 * 武器の版: 片手剣（盾なし）は左手を自由に広げる。盾を持つときは焼き直しで左腕が盾の位置に固定される（hasShieldVariant）。
 * 大剣は両手持ちなので、腕は構えのまま（GS_READY）、腰・胸だけ片手剣と同じに動かす（'jump@greatsword' ほか。HeroVisual が大剣の版として探す）。
 */

type V3 = [number, number, number];

/** 足の指定: 地面に固定（x, z は idle の足位置からのずれ。腰を沈めて膝を曲げる）か、腰に付いてぶら下がる（腰の骨から (lx, ly, lz)） */
type Foot = { pin: [number, number] } | { hang: V3 };

interface Beat {
  t: number;
  ease: Ease;
  /** 腰の高さ（立ちからの差。m）と前後（m） */
  hipsY: number;
  hipsZ?: number;
  /** 腰・胸・頭のピッチ（度。前へ倒れる向きが正） */
  hips: number;
  chest: number;
  head: number;
  l: Foot;
  r: Foot;
  /** 腕（片手剣のとき）: 右手の握り [方位°, 仰角°, 距離 m]（右肩から）と、左手首（左肩から）。省略 = 前のキーのまま */
  grip?: V3;
  left?: V3;
}

function footKey(f: Foot, side: 'footL' | 'footR'): Pick<AuthoredKey, 'footL' | 'footR'> {
  if ('pin' in f) return { [side]: { rel: 0, x: f.pin[0], z: f.pin[1], lift: 0, knee: 0 } };
  return { [side]: { rel: 1, lx: f.hang[0], ly: f.hang[1], lz: f.hang[2], knee: 0 } };
}

/** 構え（GS_READY）の腰・胸の値を、片手剣用の値に足す（両手持ちの版。腰を少し落とし、体を右へひねった構えのまま跳ぶ） */
const READY = GS_READY;

function build(name: string, duration: number, beats: Beat[], opts: { twoHanded: boolean; continueFrom?: AuthoredAttack }): AuthoredAttack {
  const keys: AuthoredKey[] = [];
  for (const b of beats) {
    const k: AuthoredKey = { t: b.t, ease: b.ease };
    if (opts.twoHanded) {
      k.hips = { y: b.hipsY + READY.hips.y, z: (b.hipsZ ?? 0) + READY.hips.z, pitch: b.hips + READY.hips.pitch, yaw: READY.hips.yaw };
      k.chest = { pitch: b.chest + READY.chest.pitch, yaw: READY.chest.yaw };
      k.head = { pitch: b.head, yaw: READY.head.yaw };
    } else {
      k.hips = { y: b.hipsY, z: b.hipsZ ?? 0, pitch: b.hips };
      k.chest = { pitch: b.chest };
      k.head = { pitch: b.head };
      if (b.grip) k.grip = b.grip;
      if (b.left) k.left = b.left;
    }
    Object.assign(k, footKey(b.l, 'footL'), footKey(b.r, 'footR'));
    keys.push(k);
  }
  const def: AuthoredAttack = { name, duration, keys };
  if (opts.twoHanded) {
    def.twoHanded = GS_TWO_HAND;
    def.continueFrom = opts.continueFrom ? { attack: opts.continueFrom, t: opts.continueFrom.duration } : FROM_STANCE;
  } else if (opts.continueFrom) {
    def.continueFrom = { attack: opts.continueFrom, t: opts.continueFrom.duration };
  }
  return def;
}

// ---------------------------------------------------------------- 跳び上がり

/** 沈む → 蹴り出して伸びる → 頂点まで保つ（0.05 = JUMP.squatFrames / 60） */
const RISE_BEATS: Beat[] = [
  { t: 0.05, ease: 'io', hipsY: -0.2, hipsZ: 0.04, hips: 10, chest: 20, head: -10, l: { pin: [0, 0.05] }, r: { pin: [0, -0.05] }, grip: [22, -50, 0.44], left: [-50, -55, 0.43] },
  { t: 0.14, ease: 'out', hipsY: 0.12, hipsZ: 0, hips: -4, chest: -6, head: 0, l: { hang: [0.11, -0.62, 0.26] }, r: { hang: [-0.11, -0.74, -0.14] }, grip: [40, -5, 0.42], left: [-60, 5, 0.43] },
  { t: 0.45, ease: 'io', hipsY: 0.14, hipsZ: 0, hips: -2, chest: -2, head: 2, l: { hang: [0.11, -0.58, 0.28] }, r: { hang: [-0.11, -0.76, -0.18] }, grip: [45, 8, 0.43], left: [-65, 12, 0.43] },
];

/** 落下: 足が地面を探して伸び、少し前へ傾く。終端で止まる */
const FALL_BEATS: Beat[] = [
  { t: 0.3, ease: 'io', hipsY: 0.03, hipsZ: 0, hips: 4, chest: 4, head: 0, l: { hang: [0.11, -0.72, 0.12] }, r: { hang: [-0.11, -0.76, -0.06] }, grip: [48, 18, 0.44], left: [-68, 22, 0.43] },
];

/** 着地: 足が着いて（世界に固定）膝と腰を沈める → 立ち上がる。腕は下がって idle へ */
const LAND_BEATS: Beat[] = [
  { t: 0.035, ease: 'out', hipsY: -0.3, hipsZ: 0.05, hips: 8, chest: 18, head: -8, l: { pin: [0, 0.12] }, r: { pin: [0, -0.1] }, grip: [22, -55, 0.45], left: [-45, -55, 0.43] },
  { t: 0.2, ease: 'io', hipsY: 0, hipsZ: 0, hips: 0, chest: 0, head: 0, l: { pin: [0, 0] }, r: { pin: [0, 0] } },
];

function variant(twoHanded: boolean): { jump: AuthoredAttack; fall: AuthoredAttack; land: AuthoredAttack } {
  const sfx = twoHanded ? '@greatsword' : '';
  const jump = build('jump' + sfx, 0.45, RISE_BEATS, { twoHanded });
  const fall = build('fall' + sfx, 0.3, FALL_BEATS, { twoHanded, continueFrom: jump });
  const land = build('land' + sfx, 0.2, LAND_BEATS, { twoHanded, continueFrom: fall });
  // 着地の最後の腕は idle（片手剣）。キーに書かないと前の姿勢（広げた腕）のままになるので、終わりのキーに idle を書く
  if (!twoHanded) {
    const last = land.keys[land.keys.length - 1]!;
    last.grip = 'idle';
    last.left = 'idle';
    last.blade = 'idle';
    last.face = 'idle';
    last.pole = 'idle';
    last.leftPole = 'idle';
  }
  return { jump, fall, land };
}

const SWORD = variant(false);
const GREATSWORD = variant(true);

export const JUMP_CLIP = SWORD.jump;
export const FALL_CLIP = SWORD.fall;
export const LAND_CLIP = SWORD.land;
export const GS_JUMP = GREATSWORD.jump;
export const GS_FALL = GREATSWORD.fall;
export const GS_LAND = GREATSWORD.land;
