import './ui/styles.css';
import { Game } from './game';

async function main(): Promise<void> {
  const app = document.getElementById('app')!;
  const canvas = document.createElement('canvas');
  canvas.id = 'game';
  canvas.tabIndex = 0;
  app.appendChild(canvas);
  const ui = document.createElement('div');
  ui.id = 'ui';
  app.appendChild(ui);
  const game = new Game(canvas, ui);
  (window as unknown as { mournlight: Game }).mournlight = game;
  await game.init();
}

main().catch((err) => {
  console.error(err);
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;inset:20px;color:#e88;font:13px monospace;white-space:pre-wrap;z-index:99';
  pre.textContent = `MOURNLIGHT failed to start:\n${err?.stack ?? err}`;
  document.body.appendChild(pre);
});
