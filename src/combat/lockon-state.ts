import { LOCKON } from './data/lockon';
import { lockStillValid, pickTarget, switchTarget, type LockCandidate } from './lockon';

/**
 * ロックオンの状態（純粋ロジック。Game が毎 sim ステップ update を呼ぶ）。
 *
 *  - ロックボタン: ロック中なら解除、そうでなければ最寄り（画面の正面寄り）の敵をロック。対象がいなければ何も起きない
 *  - 切替（横スワイプ・Q/E）: ロック中だけ。連続しないよう switchCooldownFrames の間隔を空ける
 *  - 対象が倒れたら、残っている敵の中から自動で次の対象に移る（いなければ解除）。breakRange を超えて離れたら解除
 */

export type LockEvent = 'lock' | 'unlock' | 'switch';

export interface LockUpdate {
  /** ロックボタンが押された（このステップ） */
  pressed: boolean;
  /** 切替の向き: +1 右、−1 左、0 なし */
  switchDir: number;
  px: number;
  pz: number;
  camYaw: number;
  /** ロックできる敵（生きているものだけ） */
  cands: readonly LockCandidate[];
}

export class LockOn {
  targetId: number | null = null;
  private cooldown = 0;

  get locked(): boolean {
    return this.targetId !== null;
  }

  /** 状態が変わったら種類を返す（効果音・見た目用） */
  update(u: LockUpdate): LockEvent | null {
    if (this.cooldown > 0) this.cooldown--;
    let event: LockEvent | null = null;

    if (u.pressed) {
      if (this.targetId !== null) {
        this.release();
        return 'unlock';
      }
      const id = pickTarget(u.px, u.pz, u.camYaw, u.cands);
      if (id !== null) {
        this.targetId = id;
        this.cooldown = 0;
        event = 'lock';
      }
      return event;
    }

    if (this.targetId !== null) {
      const cur = u.cands.find((c) => c.id === this.targetId);
      if (!cur) {
        // 倒れた（候補から消えた）: 残りの敵へ自動で移る
        const next = pickTarget(u.px, u.pz, u.camYaw, u.cands);
        if (next === null) {
          this.release();
          return 'unlock';
        }
        this.targetId = next;
        event = 'switch';
      } else if (!lockStillValid(u.px, u.pz, cur)) {
        this.release();
        return 'unlock';
      }
    }

    if (this.targetId !== null && u.switchDir !== 0 && this.cooldown <= 0) {
      const next = switchTarget(this.targetId, u.switchDir > 0 ? 1 : -1, u.px, u.pz, u.cands);
      if (next !== this.targetId) {
        this.targetId = next;
        this.cooldown = LOCKON.switchCooldownFrames;
        event = 'switch';
      }
    }
    return event;
  }

  release(): void {
    this.targetId = null;
    this.cooldown = 0;
  }
}
