/**
 * 右パネルを組み立てる小さな DOM ヘルパ。
 */

export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Omit<HTMLElementTagNameMap[K], 'style'>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.assign(el, props);
  for (const c of children) if (c) el.append(c);
  return el;
}

export const present = (children: Child[]) => children.filter((c): c is Node | string => !!c);

export const row = (label: string, control: Node) => h('label', { className: 'row' }, h('span', { textContent: label }), control);

export const fmt = (v: number, digits = 3) => String(Number(v.toFixed(digits)) + 0);

/** 状態と同期する入力欄（パネルを作り直すたびに新しいものを使う） */
export interface PanelKit {
  textInput(get: () => string, set: (v: string) => void, placeholder?: string): HTMLInputElement;
  numberInput(get: () => number, set: (v: number) => void, step: number, digits?: number): HTMLInputElement;
  rangeInput(get: () => number, set: (v: number) => void, min: number, max: number, step: number): HTMLElement;
  colorInput(get: () => number, set: (v: number) => void): HTMLInputElement;
  selectInput<T extends string>(options: readonly (readonly [T, string])[], get: () => T, set: (v: T) => void): HTMLSelectElement;
  checkbox(label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement;
  button(label: string, onClick: () => void, className?: string): HTMLButtonElement;
  /** 状態が変わるたびに作り直す部分 */
  dynamic(render: () => Child[]): HTMLElement;
  /** 状態が変わるたびに呼ぶ */
  onSync(fn: () => void): void;
}
