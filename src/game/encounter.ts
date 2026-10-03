import { DEMO_ENCOUNTER, RANKS, type EncounterDef, type WaveEnemy } from '../ai/data/encounters';

/**
 * 戦闘の進行（純粋ロジック。three にも DOM にも依存しない）。ウェーブの出し方、勝敗、リザルトの集計。
 *
 *   fight: 最初のウェーブを出す → 全滅させたら waveGapFrames 待って次のウェーブ …
 *          最後のウェーブを全滅させて victoryDelayFrames 経ったら victory
 *          プレイヤーが倒れて defeatDelayFrames 経ったら defeat（同時に全滅していても、プレイヤーが倒れていれば defeat）
 *   victory / defeat: 終わり（リザルトを出す）。再戦は新しい Encounter を作る
 */

export type EncounterPhase = 'fight' | 'victory' | 'defeat';

export type EncounterEvent = { type: 'spawn'; wave: number; first: boolean; last: boolean } | { type: 'end'; phase: 'victory' | 'defeat' };

export interface ResultSummary {
  phase: 'victory' | 'defeat';
  /** 戦闘の時間（秒） */
  seconds: number;
  kills: number;
  hitsTaken: number;
  damageTaken: number;
  /** パリィで弾いた回数 */
  parries: number;
  /** 勝ったときだけ */
  rank: string | null;
}

export class Encounter {
  phase: EncounterPhase = 'fight';
  /** 最後に出したウェーブの番号（まだ出していなければ −1） */
  wave = -1;
  /** 戦闘の経過フレーム（終わったら止まる） */
  frames = 0;
  kills = 0;
  hitsTaken = 0;
  damageTaken = 0;
  parries = 0;
  private clearTimer = 0;
  private deadTimer = 0;

  constructor(readonly def: EncounterDef = DEMO_ENCOUNTER) {}

  get waveCount(): number {
    return this.def.waves.length;
  }

  get ended(): boolean {
    return this.phase !== 'fight';
  }

  /** 毎 sim ステップ。alive は生きている敵の数。ウェーブの出現か終了があればイベントを返す */
  step(alive: number, playerDead: boolean): EncounterEvent | null {
    if (this.phase !== 'fight') return null;
    this.frames++;

    if (playerDead) {
      if (++this.deadTimer >= this.def.defeatDelayFrames) {
        this.phase = 'defeat';
        return { type: 'end', phase: 'defeat' };
      }
      return null;
    }

    if (this.wave < 0) return this.spawn(0);
    if (alive > 0) {
      this.clearTimer = 0;
      return null;
    }
    this.clearTimer++;
    const last = this.wave + 1 >= this.def.waves.length;
    if (last) {
      if (this.clearTimer >= this.def.victoryDelayFrames) {
        this.phase = 'victory';
        return { type: 'end', phase: 'victory' };
      }
      return null;
    }
    if (this.clearTimer >= this.def.waveGapFrames) {
      this.clearTimer = 0;
      return this.spawn(this.wave + 1);
    }
    return null;
  }

  /** いま出ているウェーブが最後か（とどめのスローモーションなどの判断用） */
  get onLastWave(): boolean {
    return this.wave >= 0 && this.wave + 1 >= this.def.waves.length;
  }

  private spawn(wave: number): EncounterEvent {
    this.wave = wave;
    return { type: 'spawn', wave, first: wave === 0, last: wave + 1 >= this.def.waves.length };
  }

  onKill(): void {
    this.kills++;
  }

  onPlayerHit(damage: number): void {
    this.hitsTaken++;
    this.damageTaken += damage;
  }

  /** ガードで受け止めた（削りダメージだけ通った）。被弾の回数には数えず、被ダメージには入れる */
  onPlayerGuard(damage: number): void {
    this.damageTaken += damage;
  }

  onParry(): void {
    this.parries++;
  }

  result(): ResultSummary | null {
    if (this.phase === 'fight') return null;
    const seconds = this.frames / 60;
    return {
      phase: this.phase,
      seconds,
      kills: this.kills,
      hitsTaken: this.hitsTaken,
      damageTaken: this.damageTaken,
      parries: this.parries,
      rank: this.phase === 'victory' ? rankOf(seconds, this.damageTaken) : null,
    };
  }
}

/** 評価。RANKS を上から見て、時間も被ダメージも上限以下になる最初のランク。どれも満たさなければ C */
export function rankOf(seconds: number, damageTaken: number): string {
  for (const r of RANKS) if (seconds <= r.maxSeconds && damageTaken <= r.maxDamage) return r.rank;
  return 'C';
}

/**
 * ウェーブの敵の出現位置。基準の向きは「プレイヤーから見てアリーナの中心の向こう側」（プレイヤーが中心付近なら +Z）で、
 * そこから offset だけ回した向きの、中心から radius の円周上。アリーナの縁の内側（arenaRadius − 1.5）に収める。
 */
export function spawnPoint(w: WaveEnemy, playerX: number, playerZ: number, arenaRadius: number): { x: number; z: number } {
  let dx = -playerX;
  let dz = -playerZ;
  const d = Math.hypot(dx, dz);
  if (d < 1) {
    dx = 0;
    dz = 1;
  } else {
    dx /= d;
    dz /= d;
  }
  const base = Math.atan2(dz, dx);
  const a = base + w.offset;
  const r = Math.min(w.radius, arenaRadius - 1.5);
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}
