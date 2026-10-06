/**
 * 杖の攻撃（詠唱。ADR-048）。すべて AttackDef.cast を持ち、当たり判定は持たない（魔法の当たりは SpellSystem・魔弾の飛び道具が決める）。
 * 通常攻撃は魔弾の 1 ルート連打（stBolt1 → stBolt2 → stBolt3。next）。魔法（スキル）は 1 つずつの詠唱（spThunder など。スキルの steps が指す）。
 * 手付けの詠唱クリップは src/character/data/spell-casts.ts、魔法の中身は data/spells.ts。杖には溜めも、スティックの向きでの分岐も無い。
 * ここの攻撃は ATTACKS には入れない（ATTACKS の一般的な検査 = 発生・持続・全体の長さは、剣の技の約束。詠唱は長くてよい）。探すときは findAttack（skill-attacks.ts）。
 */

import type { AuthoredAttack } from '../../character/authoring';
import { BOLT1_HOLD_T, BOLT2_HOLD_T, SP_BLIZZARD, SP_EXPLOSION, SP_FLAME, SP_HURRICANE, SP_REGEN, SP_THUNDER, ST_BOLT1, ST_BOLT2, ST_BOLT3 } from '../../character/data/spell-casts';
import { ATTACKS, type AttackDef, type CastDef } from './attacks';
import type { SpellId, SpellSkillId } from './spells';

/** 当たり判定を持たない詠唱の、ダミーの当たり（resolvePlayerAttack は cast のある攻撃を見ない。型を満たすだけ） */
const NO_HIT = { kind: 'arc', range: 0.01, halfAngle: 0.01 } as const;

interface CastSpec {
  id: string;
  clip: AuthoredAttack;
  spell: SpellId;
  /** 魔法を放つ時刻（秒） */
  at: number;
  channel?: CastDef['channel'];
  /** 次の詠唱（通常攻撃の連打）を受け付ける時刻と、その技 */
  cancelAt?: number;
  next?: string;
  fade?: number;
}

function castAttack(o: CastSpec): AttackDef {
  return {
    id: o.id,
    segment: o.clip.name,
    authored: o.clip,
    segmentDuration: o.clip.duration,
    activeStart: o.at,
    activeEnd: o.at + 0.05,
    cancelAt: o.cancelAt ?? 999,
    trail: [0, 0.01],
    rate: 1,
    lunge: 0,
    ...(o.next !== undefined ? { next: o.next } : {}),
    cast: { spell: o.spell, at: o.at, ...(o.channel !== undefined ? { channel: o.channel } : {}) },
    hitbox: NO_HIT,
    damage: 0,
    hitStop: 0,
    knockback: 0,
    // 放ったあとなら、回避でやめられる（放つ前は詠唱を続ける。放つ前に被弾すると中断される）
    dodgeCancelAt: o.at + 0.03,
    fade: o.fade ?? 0.08,
  };
}

export const SPELL_ATTACKS: Record<string, AttackDef> = {
  // ---- 通常攻撃: 魔弾 → 魔弾 → 大魔弾（1 ルートの連打）----
  stBolt1: castAttack({ id: 'stBolt1', clip: ST_BOLT1, spell: 'bolt1', at: 0.3, cancelAt: BOLT1_HOLD_T, next: 'stBolt2', fade: 0.1 }),
  stBolt2: castAttack({ id: 'stBolt2', clip: ST_BOLT2, spell: 'bolt2', at: 0.28, cancelAt: BOLT2_HOLD_T, next: 'stBolt3', fade: 0.05 }),
  stBolt3: castAttack({ id: 'stBolt3', clip: ST_BOLT3, spell: 'bolt3', at: 0.5, fade: 0.05 }),
  // ---- 魔法（スキル）----
  spThunder: castAttack({ id: 'spThunder', clip: SP_THUNDER, spell: 'thunder', at: 0.95, fade: 0.12 }),
  spBlizzard: castAttack({ id: 'spBlizzard', clip: SP_BLIZZARD, spell: 'blizzard', at: 0.6, fade: 0.12 }),
  spFlame: castAttack({ id: 'spFlame', clip: SP_FLAME, spell: 'flame', at: 0.6, channel: { seconds: 2.4, turnRate: 2.4 }, fade: 0.12 }),
  spExplosion: castAttack({ id: 'spExplosion', clip: SP_EXPLOSION, spell: 'explosion', at: 1.05, fade: 0.12 }),
  spRegen: castAttack({ id: 'spRegen', clip: SP_REGEN, spell: 'regen', at: 0.6, fade: 0.12 }),
  spHurricane: castAttack({ id: 'spHurricane', clip: SP_HURRICANE, spell: 'hurricane', at: 0.85, fade: 0.12 }),
};

/** 魔法（スキル）ごとの詠唱の攻撃 id */
export const SPELL_ATTACK_OF: Record<SpellSkillId, string> = {
  thunder: 'spThunder',
  blizzard: 'spBlizzard',
  flame: 'spFlame',
  explosion: 'spExplosion',
  regen: 'spRegen',
  hurricane: 'spHurricane',
};

/** 技表・操作ガイドが読む、剣の技と杖の詠唱をまとめた表（id で引く）。ATTACKS と SPELL_ATTACKS の id は重ならない */
export const MOVE_ATTACKS: Readonly<Record<string, AttackDef>> = { ...ATTACKS, ...SPELL_ATTACKS };
