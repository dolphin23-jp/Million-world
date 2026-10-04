import * as THREE from 'three';
import { Game } from './game/game';
import { installGestureGuards } from './platform/safari';
import { DEFAULT_LOADOUT, LOADOUTS, LOADOUT_ORDER, isLoadoutId, type LoadoutId } from './combat/data/loadouts';
import { TIERS } from './ai/data/tiers';

/** 選んだ装備を覚えておく場所。ストレージが使えない（プライベートブラウズ等）ときは覚えないだけ（ゲームは動く） */
const LOADOUT_KEY = 'mw.loadout';
function readSavedLoadout(): string | null {
  try {
    return localStorage.getItem(LOADOUT_KEY);
  } catch {
    return null;
  }
}
function saveLoadout(id: LoadoutId): void {
  try {
    localStorage.setItem(LOADOUT_KEY, id);
  } catch {
    // 覚えられなくても続ける
  }
}

declare global {
  interface Window {
    /** 開発・検証ツール用のフック */
    __mw?: { game: Game; THREE: typeof THREE; sfxLab?: import('./debug/sfx-lab').SfxLab; motionLab?: import('./debug/motion-lab').MotionLab };
  }
}

function boot(): void {
  installGestureGuards();
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('#game canvas が見つかりません');

  const params = new URLSearchParams(location.search);
  const dprParam = Number(params.get('dpr'));
  const game = new Game({
    canvas,
    debug: params.get('debug') !== '0',
    // ?dpr=1.25 で解像度を固定、?adaptive=0 で動的解像度だけ止める（計測・スクリーンショット用）
    ...(dprParam > 0 ? { pixelRatio: dprParam } : {}),
    adaptive: params.get('adaptive') !== '0',
    sandbox: params.get('sandbox') === '1',
  });
  window.__mw = { game, THREE };
  // 装備: ?loadout=sword-shield（開発・検証用）> 前回選んだもの > 既定（素手の片手剣）
  const urlLoadout = params.get('loadout');
  const savedLoadout = readSavedLoadout();
  const initialLoadout: LoadoutId = isLoadoutId(urlLoadout) ? urlLoadout : isLoadoutId(savedLoadout) ? savedLoadout : DEFAULT_LOADOUT;
  game.setLoadout(initialLoadout);
  // ?mute=1 で効果音を鳴らさない
  if (params.get('mute') === '1') game.audio.muted = true;
  // ?sfxlab=1: 効果音を書き出して数値検査するための開発用フック（tools/sfx-check.mjs が使う）
  if (params.has('sfxlab')) void import('./debug/sfx-lab').then((m) => (window.__mw!.sfxLab = m.installSfxLab()));
  // ?motionlab=1: 手付けモーションを実リグで焼いて統計を返す開発用フック（手首のねじれを減らす値の探索など。通常起動では読み込まない）
  if (params.has('motionlab')) void import('./debug/motion-lab').then((m) => (window.__mw!.motionLab = m.installMotionLab(game)));
  // ?perf=1: 実機で fps の原因を切り分ける計測モード（通常起動では読み込まない）
  if (params.has('perf')) void import('./debug/perf-probe').then((m) => m.installPerfProbe(game));

  game.hud.setStartHint('読み込み中…');
  const loaded = game.preload().catch((e: unknown) => {
    console.error(e);
    game.hud.setStartHint('読み込みに失敗しました。再読み込みしてください');
    throw e;
  });

  if (params.has('autostart')) {
    void loaded.then(() => {
      game.hud.hideStart();
      game.start();
    });
  } else {
    // 開始画面で装備を選べる（選んだものは次回も使う）
    game.hud.setupLoadoutPicker(
      LOADOUT_ORDER.map((id) => ({ id, name: LOADOUTS[id].name, detail: LOADOUTS[id].detail })),
      initialLoadout,
      (id) => {
        if (!isLoadoutId(id)) return;
        game.setLoadout(id);
        saveLoadout(id);
      },
    );
    // 敵の段階（色違いの強化版）。解放済みの段階だけ選べる（クリアすると次が解放される。選んだ段階はセーブされる。ADR-036）
    game.hud.setupTierPicker(
      TIERS.map((t) => ({ tier: t.tier, name: t.name, detail: `推奨 Lv ${t.recommendedLevel}`, unlocked: t.tier <= game.progress.unlocked })),
      game.progress.tier,
      (tier) => {
        game.setTier(tier);
      },
    );
    // 読込完了まではタップしても始まらないが、タップ自体は受け付ける（音声解放に使う予定）
    void Promise.all([loaded.then(() => game.hud.setStartHint('タップして開始')), game.hud.waitForStart(() => game.audio.unlock())]).then(() => game.start());
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
