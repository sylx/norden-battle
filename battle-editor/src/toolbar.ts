/**
 * 画面の上のツールバー（エディタの道具。ゲームの画面には出さない）。
 * ボタン（data-window にウィンドウの id）で道具のウィンドウを開く。
 *
 * - ウィンドウは一度に 1 つだけ開き、押したボタンの下に出す。
 * - 同じボタンか、ウィンドウの × で閉じる。マップを触っても閉じない（描画負荷を見ながら動かせるように）。
 */
/** 画面の端・ツールバーとの間（CSS ピクセル） */
const MARGIN = 12;
const GAP = 6;

export function setupToolbar(): void {
  const bar = document.getElementById('toolbar')!;
  const tools = [...bar.querySelectorAll<HTMLButtonElement>('[data-window]')].map((button) => ({
    button,
    win: document.getElementById(button.dataset.window!)!,
  }));

  const open = (target: HTMLButtonElement | null) => {
    for (const { button, win } of tools) {
      const on = button === target;
      win.hidden = !on;
      button.classList.toggle('active', on);
      button.setAttribute('aria-expanded', String(on));
      if (!on) continue;
      const left = button.getBoundingClientRect().left;
      win.style.left = `${Math.max(MARGIN, Math.min(left, window.innerWidth - MARGIN - win.offsetWidth))}px`;
      win.style.top = `${bar.getBoundingClientRect().bottom + GAP}px`;
    }
  };

  for (const { button, win } of tools) {
    button.addEventListener('click', () => open(button.classList.contains('active') ? null : button));
    win.querySelector('.close')?.addEventListener('click', () => open(null));
  }
  open(null);
}
