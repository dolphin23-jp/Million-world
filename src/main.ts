import * as THREE from 'three';
import { Game } from './game/game';
import { installGestureGuards } from './platform/safari';

declare global {
  interface Window {
    /** 開発・検証ツール用のフック */
    __mw?: { game: Game; THREE: typeof THREE; sfxLab?: import('./debug/sfx-lab').SfxLab };
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
  // ?mute=1 で効果音を鳴らさない
  if (params.get('mute') === '1') game.audio.muted = true;
  // ?sfxlab=1: 効果音を書き出して数値検査するための開発用フック（tools/sfx-check.mjs が使う）
  if (params.has('sfxlab')) void import('./debug/sfx-lab').then((m) => (window.__mw!.sfxLab = m.installSfxLab()));
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
    // 読込完了まではタップしても始まらないが、タップ自体は受け付ける（音声解放に使う予定）
    void Promise.all([loaded.then(() => game.hud.setStartHint('タップして開始')), game.hud.waitForStart(() => game.audio.unlock())]).then(() => game.start());
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
