/**
 * 検索できるコンボボックス。入力欄に打った文字で候補を絞り、クリック・↑↓・Enter で選ぶ。
 * 選んでも何もしない（onChange で知らせるだけ）。決定の操作は呼び出し側のボタンで行う。
 * 候補を閉じた状態で Enter を押すと onSubmit を呼ぶ。
 */
export interface ComboItem {
  value: string;
  label: string;
  /** 2 行目に出す補足（検索の対象にもなる） */
  detail?: string;
  disabled?: boolean;
  /** 印を付ける（今開いているマップなど） */
  current?: boolean;
}

export class ComboBox {
  readonly root: HTMLDivElement;
  readonly input: HTMLInputElement;
  /** 選んだ値（未選択は null） */
  value: string | null = null;
  onChange: (value: string | null) => void = () => {};
  onSubmit: () => void = () => {};

  private readonly list: HTMLUListElement;
  private items: ComboItem[] = [];
  /** 候補に出ている項目 */
  private shown: ComboItem[] = [];
  private active = -1;

  constructor(root: HTMLDivElement, placeholder = '') {
    this.root = root;
    root.classList.add('combo');
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.placeholder = placeholder;
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-expanded', 'false');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'combo-toggle';
    toggle.tabIndex = -1;
    toggle.textContent = '▾';
    this.list = document.createElement('ul');
    this.list.className = 'combo-list';
    this.list.setAttribute('role', 'listbox');
    this.list.hidden = true;
    root.append(this.input, toggle, this.list);

    this.input.addEventListener('focus', () => {
      this.input.select();
      this.open(true);
    });
    this.input.addEventListener('input', () => this.open(false));
    this.input.addEventListener('blur', () => {
      this.close();
      this.syncText();
    });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    // 候補のクリックで入力欄のフォーカスが外れないようにする
    this.list.addEventListener('mousedown', (e) => e.preventDefault());
    toggle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (this.list.hidden) {
        this.input.focus();
        this.open(true);
      } else {
        this.close();
      }
    });
  }

  setItems(items: ComboItem[]): void {
    this.items = items;
    if (this.value !== null && !items.some((i) => i.value === this.value)) this.value = null;
    this.syncText();
    if (!this.list.hidden) this.open(document.activeElement !== this.input || this.input.value === this.selectedLabel());
  }

  /** 値を選ぶ（onChange は呼ばない） */
  setValue(value: string | null): void {
    this.value = value !== null && this.items.some((i) => i.value === value) ? value : null;
    this.syncText();
  }

  private selectedLabel(): string {
    return this.items.find((i) => i.value === this.value)?.label ?? '';
  }

  private syncText(): void {
    this.input.value = this.selectedLabel();
  }

  /** 候補を開く。all = true なら入力欄の文字で絞らない */
  private open(all: boolean): void {
    const words = all ? [] : this.input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    this.shown = this.items.filter((i) => {
      const text = `${i.label} ${i.value} ${i.detail ?? ''}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
    const sel = this.shown.findIndex((i) => i.value === this.value);
    this.active = sel >= 0 ? sel : this.shown.findIndex((i) => !i.disabled);
    this.render();
    this.list.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
    this.scrollToActive();
  }

  private close(): void {
    this.list.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
  }

  private render(): void {
    if (this.shown.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '該当なし';
      this.list.replaceChildren(li);
      return;
    }
    this.list.replaceChildren(
      ...this.shown.map((item, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.classList.toggle('active', i === this.active);
        li.classList.toggle('disabled', !!item.disabled);
        li.classList.toggle('current', !!item.current);
        li.setAttribute('aria-selected', String(item.value === this.value));
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = item.label;
        li.append(label);
        if (item.detail) {
          const detail = document.createElement('div');
          detail.className = 'detail';
          detail.textContent = item.detail;
          li.append(detail);
        }
        li.addEventListener('click', () => this.choose(item));
        li.addEventListener('mousemove', () => {
          if (this.active === i) return;
          this.active = i;
          this.render();
        });
        return li;
      }),
    );
  }

  private choose(item: ComboItem): void {
    if (item.disabled) return;
    const changed = item.value !== this.value;
    this.value = item.value;
    this.syncText();
    this.close();
    if (changed) this.onChange(this.value);
  }

  private move(step: number): void {
    const n = this.shown.length;
    if (n === 0) return;
    for (let i = 1; i <= n; i++) {
      const k = (((this.active + step * i) % n) + n) % n;
      if (!this.shown[k].disabled) {
        this.active = k;
        break;
      }
    }
    this.render();
    this.scrollToActive();
  }

  private scrollToActive(): void {
    (this.list.children[this.active] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }

  private onKey(e: KeyboardEvent): void {
    if (e.isComposing) return;
    const opened = !this.list.hidden;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!opened) this.open(true);
      else this.move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = this.shown[this.active];
      if (opened && item) this.choose(item);
      else if (!opened && this.value !== null) this.onSubmit();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      if (opened) this.close();
      this.syncText();
    }
  }
}
