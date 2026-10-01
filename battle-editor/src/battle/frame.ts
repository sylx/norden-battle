/**
 * 飾り罫の枠。パネルに .framed を付けて四隅に .corner を置く（行動メニュー・戦闘ログで共通）。
 * いまは CSS の仮の線で、画像にするときは style.css の --frame-corner-image に左上向きの 1 枚を入れる
 * （ほかの隅は反転して使う）。大きさ・余白も --frame-* で変える。
 */
export function addFrame(panel: HTMLElement): void {
  panel.classList.add('framed');
  for (const c of ['tl', 'tr', 'bl', 'br']) {
    const corner = document.createElement('span');
    corner.className = `corner ${c}`;
    panel.append(corner);
  }
}
