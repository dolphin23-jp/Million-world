import { Game } from './game/game';
import { installGestureGuards } from './platform/safari';

declare global {
  interface Window {
    /** 開発・検証ツール用のフック */
    __mw?: { game: Game };
  }
}

function boot(): void {
  installGestureGuards();
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('#game canvas が見つかりません');

  const params = new URLSearchParams(location.search);
  const game = new Game({ canvas, debug: params.get('debug') !== '0' });
  window.__mw = { game };

  if (params.has('autostart')) {
    game.hud.hideStart();
    game.start();
  } else {
    void game.hud.waitForStart().then(() => game.start());
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
