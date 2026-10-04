import { h, onPress, setText } from '../dom';
import type { MenuTab } from '../pause-menu';
import type { Progress } from '../../combat/progress';
import { TIERS } from '../../ai/data/tiers';

/**
 * メニューのタブ「段階」（ADR-036）: 敵の段階（色違いの強化版）の一覧。各段の名前・推奨レベル・敵の強さの倍率（HP・ダメージ・経験値）・クリア済みの印。
 * 解放済みの段階を選べる（次の挑戦から。選んだ段階はセーブされる）。「この段階で最初から」は、いまの戦闘を捨てて、選んだ段階で最初のウェーブから始める（二度押し）。
 * 解放していない段階は名前を伏せる（「？？？」）。
 */

export interface TierTabDeps {
  progress: Progress;
  /** いまのレベル（推奨レベルとの比べに使う） */
  level: () => number;
  /** 段階を選ぶ（選べたら true） */
  onSelect: (tier: number) => boolean;
  /** 選んだ段階で最初から始める（二度押しで呼ばれる） */
  onRestart: () => void;
}

interface Card {
  el: HTMLElement;
  title: HTMLElement;
  state: HTMLElement;
  stat: HTMLElement;
  pick: HTMLButtonElement;
}

export class TierTab implements MenuTab {
  readonly id = 'tier';
  readonly label = '段階';
  private readonly cards: Card[] = [];
  private restartBtn!: HTMLButtonElement;
  private restartTimer = 0;
  private note!: HTMLElement;

  constructor(private readonly d: TierTabDeps) {}

  build(root: HTMLElement): void {
    this.note = h('div', 'tr-note');
    root.appendChild(this.note);
    for (const t of TIERS) {
      const el = h('div', 'tr-card');
      el.dataset.tier = String(t.tier);
      const top = h('div', 'tr-top');
      const title = h('b', 'tr-title');
      const state = h('span', 'tr-state');
      top.append(title, state);
      const stat = h('div', 'tr-stat');
      const pick = h('button', 'menu-btn tr-pick', 'この段階にする');
      pick.type = 'button';
      onPress(
        pick,
        () => {
          if (this.d.onSelect(t.tier)) this.refresh();
          return false;
        },
        { repeat: false },
      );
      el.append(top, stat, pick);
      root.appendChild(el);
      this.cards.push({ el, title, state, stat, pick });
    }
    this.restartBtn = h('button', 'menu-btn danger', 'この段階で最初から（いまの戦闘をやめる）');
    this.restartBtn.type = 'button';
    onPress(
      this.restartBtn,
      () => {
        // 二度押しで実行（間違って押しても戦闘が消えない）。3.5 秒で元に戻る
        if (this.restartBtn.dataset.armed === '1') {
          this.disarm();
          this.d.onRestart();
        } else {
          this.restartBtn.dataset.armed = '1';
          this.restartBtn.textContent = '本当に最初から？ もう一度押すと始まります';
          window.clearTimeout(this.restartTimer);
          this.restartTimer = window.setTimeout(() => this.disarm(), 3500);
        }
        return false;
      },
      { repeat: false },
    );
    const foot = h('div', 'menu-foot');
    foot.appendChild(this.restartBtn);
    root.appendChild(foot);
  }

  private disarm(): void {
    window.clearTimeout(this.restartTimer);
    this.restartBtn.dataset.armed = '0';
    this.restartBtn.textContent = 'この段階で最初から（いまの戦闘をやめる）';
  }

  refresh(): void {
    this.disarm();
    const p = this.d.progress;
    const lv = this.d.level();
    const pct = (x: number): string => `×${Math.round(x * 100) / 100}`;
    setText(this.note, '敵が色違いの強化版になって、段階的に強くなる。クリアすると次の段階が解放される。選んだ段階は、次の挑戦（リザルトの「もう一度」・最初から）から。');
    TIERS.forEach((t, i) => {
      const c = this.cards[i]!;
      const unlocked = t.tier <= p.unlocked;
      const selected = t.tier === p.tier;
      c.el.classList.toggle('locked', !unlocked);
      c.el.classList.toggle('selected', unlocked && selected);
      setText(c.title, unlocked ? `${t.name}（敵: ${t.color === '' ? '並' : `${t.color}の色違い`}）` : '？？？');
      const cleared = t.tier <= p.cleared;
      setText(c.state, !unlocked ? `${t.tier - 1} をクリアで解放` : selected ? '選択中' : cleared ? 'クリア済み' : '未クリア');
      c.state.classList.toggle('cleared', unlocked && cleared);
      c.state.classList.toggle('current', unlocked && selected);
      setText(c.stat, unlocked ? `推奨 Lv ${t.recommendedLevel}${lv >= t.recommendedLevel ? '（達成）' : ''} ／ 敵のHP ${pct(t.hp)}・ダメージ ${pct(t.damage)} ／ 経験値 ${pct(t.xp)}` : '');
      c.pick.disabled = !unlocked || selected;
      c.pick.hidden = !unlocked;
    });
  }
}
