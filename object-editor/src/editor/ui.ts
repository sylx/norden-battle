import {
  CATEGORY_DEFS,
  CATEGORY_IDS,
  HEIGHT_PRESETS,
  LICENSE_DEFS,
  LICENSE_IDS,
  sourceWarnings,
  type CategoryId,
  type LicenseId,
  type NormalizeTransform,
  type SourceOrigin,
  type Vec3Tuple,
} from '@norden/asset-runtime';
import * as THREE from 'three';
import type { ImportCommon, ObjectEditorApp } from './app';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Omit<HTMLElementTagNameMap[K], 'style'>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.assign(el, props);
  for (const c of children) if (c) el.append(c);
  return el;
}

const present = (children: Child[]) => children.filter((c): c is Node | string => !!c);

const row = (label: string, control: Node) => h('label', { className: 'row' }, h('span', { textContent: label }), control);
const fmt = (v: number, digits = 3) => String(Number(v.toFixed(digits)) + 0);

const IMPORT_COMMON_KEY = 'norden-object-editor.importCommon';

export function setupUI(app: ObjectEditorApp): void {
  const status = $('status');
  const setStatus = (html: string) => (status.innerHTML = html);
  const showError = (e: unknown) => {
    setStatus(`<span class="err">${escapeHtml(e instanceof Error ? e.message : String(e))}</span>`);
    console.error(e);
  };
  const run = (fn: () => Promise<unknown>) => void fn().catch(showError);

  /** 変更を捨ててよいか */
  const confirmDiscard = () => !app.dirty || confirm(`「${app.current?.entry.name}」の変更を保存していません。破棄しますか？`);

  // --- 取り込み ---
  const stage = async (files: File[]) => {
    if (files.length === 0) return;
    setStatus('読み込み中…');
    const warnings = await app.stageImport(files);
    setStatus(warnings.length ? `<span class="err">${escapeHtml(warnings.join(' / '))}</span>` : `${app.pending.length} 件を取り込み待ちにしました`);
  };
  const fileInput = $<HTMLInputElement>('file-input');
  $('btn-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    run(() => stage(files));
  });
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) document.body.classList.remove('dragging');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('dragging');
    run(() => stage([...(e.dataTransfer?.files ?? [])]));
  });

  // --- ライブラリ ---
  const filterCat = $<HTMLSelectElement>('filter-category');
  filterCat.add(new Option('すべて', ''));
  for (const id of CATEGORY_IDS) filterCat.add(new Option(CATEGORY_DEFS[id].name, id));
  const filterText = $<HTMLInputElement>('filter-text');
  const list = $('asset-list');
  const catalogErrors = $('catalog-errors');

  const renderList = () => {
    const cat = filterCat.value;
    const q = filterText.value.trim().toLowerCase();
    const items = app.entries.filter(
      (e) =>
        (!cat || e.category === cat) &&
        (!q || e.id.includes(q) || e.name.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q))),
    );
    list.replaceChildren(
      ...items.map((e) => {
        const warn = sourceWarnings(e).length > 0;
        const li = h(
          'li',
          { className: app.current?.entry.id === e.id ? 'active' : '', title: e.id },
          h('span', { className: 'name', textContent: e.name }),
          warn && h('span', { className: 'warn', textContent: '⚠', title: sourceWarnings(e).join('\n') }),
          h('span', { className: 'cat', textContent: CATEGORY_DEFS[e.category].name }),
        );
        li.addEventListener('click', () => {
          if (app.current?.entry.id === e.id || !confirmDiscard()) return;
          setStatus('読み込み中…');
          run(async () => {
            await app.open(e.id);
            setStatus(`${e.name} を開きました`);
          });
        });
        return li;
      }),
    );
    if (items.length === 0)
      list.append(h('li', { className: 'empty', textContent: app.entries.length ? '該当なし' : 'まだ何も取り込んでいません' }));
    catalogErrors.replaceChildren(...app.catalogErrors.map((m) => h('div', { textContent: m })));
  };
  filterCat.addEventListener('change', renderList);
  filterText.addEventListener('input', renderList);

  // --- 右パネル ---
  const props = $('props');
  let propsKey = '';
  /** 入力欄を状態に合わせる（フォーカス中のものは触らない） */
  let syncers: (() => void)[] = [];
  let autoPivot = true;

  const sync = (el: HTMLInputElement | HTMLSelectElement, get: () => string) => {
    syncers.push(() => {
      if (document.activeElement !== el) el.value = get();
    });
  };
  const textInput = (get: () => string, set: (v: string) => void, placeholder = '') => {
    const el = h('input', { type: 'text', placeholder });
    el.addEventListener('input', () => set(el.value));
    sync(el, get);
    return el;
  };
  const numberInput = (get: () => number, set: (v: number) => void, step: number, digits = 4) => {
    const el = h('input', { type: 'number', step: String(step) });
    el.addEventListener('change', () => {
      const v = Number(el.value);
      if (Number.isFinite(v)) set(v);
    });
    sync(el, () => fmt(get(), digits));
    return el;
  };
  const selectInput = <T extends string>(options: readonly (readonly [T, string])[], get: () => T, set: (v: T) => void) => {
    const el = h('select');
    for (const [v, label] of options) el.add(new Option(label, v));
    el.addEventListener('change', () => set(el.value as T));
    sync(el, get);
    return el;
  };
  const checkbox = (label: string, get: () => boolean, set: (v: boolean) => void) => {
    const el = h('input', { type: 'checkbox', checked: get() });
    el.addEventListener('change', () => set(el.checked));
    syncers.push(() => (el.checked = get()));
    return h('label', { className: 'check' }, el, label);
  };
  const button = (label: string, onClick: () => void, className = '') => {
    const el = h('button', { textContent: label, className });
    el.addEventListener('click', onClick);
    return el;
  };
  const dynamic = (render: () => Child[]) => {
    const el = h('div');
    syncers.push(() => el.replaceChildren(...present(render())));
    return el;
  };

  const licenseOptions = LICENSE_IDS.map((id) => [id, LICENSE_DEFS[id].name] as const);
  const categoryOptions = CATEGORY_IDS.map((id) => [id, CATEGORY_DEFS[id].name] as const);

  const originFields = (get: () => SourceOrigin, set: (k: keyof SourceOrigin, v: string) => void) => [
    row('URL', textInput(() => get().url ?? '', (v) => set('url', v), 'https://…')),
    row('作者', textInput(() => get().author ?? '', (v) => set('author', v))),
    row('パック', textInput(() => get().pack ?? '', (v) => set('pack', v), 'KayKit Adventurers など')),
    row('メモ', textInput(() => get().note ?? '', (v) => set('note', v))),
  ];

  // アセットの編集
  const buildAssetPanel = (): Child[] => {
    const cur = () => app.current!;
    const entry = () => cur().entry;
    const setT = (t: Partial<NormalizeTransform>) => app.setTransform({ ...entry().transform, ...t }, autoPivot);
    const vec3 = (get: () => Vec3Tuple, set: (v: Vec3Tuple) => void, step: number, disabled: () => boolean) => {
      const inputs = [0, 1, 2].map((i) =>
        numberInput(
          () => get()[i],
          (v) => {
            const next = [...get()] as Vec3Tuple;
            next[i] = v;
            set(next);
          },
          step,
        ),
      );
      syncers.push(() => inputs.forEach((el) => (el.disabled = disabled())));
      return h('div', { className: 'vec3' }, ...inputs);
    };
    const rotate = (axis: 0 | 1 | 2) => {
      const r = [...entry().transform.rotation] as Vec3Tuple;
      r[axis] = (((r[axis] + 90 + 180) % 360) + 360) % 360 - 180;
      setT({ rotation: r });
    };
    const heightNow = () => app.rotatedHeight() * entry().transform.scale;

    const presetSel = h('select');
    presetSel.add(new Option('プリセット…', ''));
    for (const p of HEIGHT_PRESETS) presetSel.add(new Option(`${p.label} (${p.height})`, String(p.height)));
    presetSel.addEventListener('change', () => {
      if (presetSel.value) app.fitHeight(Number(presetSel.value), autoPivot);
      presetSel.value = '';
    });

    const clipSel = h('select');
    const clips = cur().loaded.animations;
    clipSel.add(new Option('（停止）', ''));
    for (const c of clips) clipSel.add(new Option(`${c.name} (${fmt(c.duration, 2)}s)`, c.name));
    clipSel.addEventListener('change', () => app.play(clipSel.value || null));
    syncers.push(() => (clipSel.value = cur().action?.getClip().name ?? ''));

    const saveBtn = button('保存', () => run(save), 'primary');
    const revertBtn = button('元に戻す', () => app.revert());
    syncers.push(() => {
      saveBtn.disabled = !app.dirty || app.errors.length > 0;
      revertBtn.disabled = !app.dirty;
    });

    return [
      h('h2', {}, '基本', dynamic(() => [app.dirty && h('span', { className: 'dirty-mark', textContent: '● 未保存' })])),
      row('ID', h('input', { type: 'text', value: entry().id, disabled: true })),
      row('名前', textInput(() => entry().name, (v) => app.edit((e) => (e.name = v)))),
      row('カテゴリ', selectInput(categoryOptions, () => entry().category, (v: CategoryId) => app.edit((e) => (e.category = v)))),
      row(
        'タグ',
        textInput(
          () => entry().tags.join(', '),
          (v) => app.edit((e) => (e.tags = v.split(/[,、\s]+/).filter(Boolean))),
          'カンマ区切り',
        ),
      ),
      dynamic(() => [
        h('p', {
          className: 'hint',
          textContent: `スケルトン: ${{ none: 'なし', mixamo: 'Mixamo 標準', other: 'Mixamo 以外' }[entry().skeleton]}　取り込み: ${entry().importedAt.slice(0, 10)}`,
        }),
      ]),

      h('h2', { textContent: '出典・ライセンス' }),
      row('ライセンス', selectInput(licenseOptions, () => entry().license, (v: LicenseId) => app.edit((e) => (e.license = v)))),
      ...originFields(
        () => entry().origin,
        (k, v) => app.edit((e) => (e.origin[k] = v || undefined)),
      ),

      h('h2', { textContent: '正規化' }),
      row('回転 (度)', vec3(() => entry().transform.rotation, (v) => setT({ rotation: v }), 90, () => false)),
      h(
        'div',
        { className: 'buttons' },
        button('X +90', () => rotate(0)),
        button('Y +90', () => rotate(1)),
        button('Z +90', () => rotate(2)),
        button('0', () => setT({ rotation: [0, 0, 0] })),
      ),
      h(
        'p',
        { className: 'hint' },
        '正面は赤い矢印の方向（+Z）。寝ているモデルは X を、横を向いているモデルは Y を回してください',
      ),
      row(
        '原点',
        vec3(() => entry().transform.pivot, (v) => setT({ pivot: v }), 0.01, () => autoPivot),
      ),
      h(
        'div',
        { className: 'buttons' },
        checkbox('足元に自動で合わせる', () => autoPivot, (v) => {
          autoPivot = v;
          if (v) setT({});
          else refresh();
        }),
      ),
      row('スケール', numberInput(() => entry().transform.scale, (v) => v > 0 && setT({ scale: v }), 0.001, 6)),
      row('高さ', numberInput(heightNow, (v) => app.fitHeight(v, autoPivot), 0.01)),
      row('', presetSel),
      dynamic(() => {
        const box = cur().loaded.object.measureRotated();
        const s = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3()).multiplyScalar(entry().transform.scale);
        return [h('p', { className: 'hint', textContent: `正規化後の大きさ 幅 ${fmt(s.x)} × 高さ ${fmt(s.y)} × 奥行 ${fmt(s.z)}（hexSize = 1）` })];
      }),
      h('div', { className: 'buttons' }, button('カメラを合わせる', () => app.frame())),

      h('h2', { textContent: '統計' }),
      dynamic(() => {
        const st = entry().stats;
        const items: [string, string][] = [
          ['三角形', st.triangles.toLocaleString()],
          ['頂点', st.vertices.toLocaleString()],
          ['メッシュ', String(st.meshes)],
          ['マテリアル', String(st.materials)],
          ['テクスチャ', st.textures ? `${st.textures} 枚（最大 ${st.maxTextureSize}px）` : 'なし'],
          ['骨', String(st.bones)],
          ['元の大きさ', st.rawSize.map((v) => fmt(v)).join(' × ')],
        ];
        return [
          h('dl', { className: 'info' }, ...items.flatMap(([k, v]) => [h('dt', { textContent: k }), h('dd', { textContent: v })])),
          h('ul', { className: 'warnings' }, ...app.warnings.map((w) => h('li', { textContent: w }))),
        ];
      }),

      clips.length > 0 && h('h2', { textContent: `アニメーション（${clips.length}）` }),
      clips.length > 0 && row('再生', clipSel),

      h('h2', { textContent: '表示' }),
      h(
        'div',
        {},
        checkbox('基準の人形', () => app.display.references, (v) => {
          app.display.references = v;
          app.applyDisplay();
        }),
        checkbox('骨', () => app.display.skeleton, (v) => {
          app.display.skeleton = v;
          app.applyDisplay();
        }),
        checkbox('ワイヤーフレーム', () => app.display.wireframe, (v) => {
          app.display.wireframe = v;
          app.applyDisplay();
        }),
      ),
      h('p', { className: 'hint', textContent: '青い人形 = 兵士（デフォルメ）、赤い人形 = 等身大の人。足元の六角形が HEX 1 マス' }),

      h('ul', { className: 'errors' }, dynamic(() => app.errors.map((m) => h('li', { textContent: m })))),
      h('div', { className: 'buttons' }, saveBtn, revertBtn),
      h(
        'div',
        { className: 'buttons' },
        button(
          '削除',
          () => {
            if (confirm(`「${entry().name}」をカタログと assets/sources/${entry().id}/ から削除します。よろしいですか？`))
              run(async () => {
                const name = entry().name;
                await app.remove();
                setStatus(`${name} を削除しました`);
              });
          },
          'danger',
        ),
      ),
    ];
  };

  // 取り込み待ち
  const loadCommon = (): ImportCommon => {
    try {
      const v = JSON.parse(localStorage.getItem(IMPORT_COMMON_KEY) ?? 'null') as ImportCommon | null;
      if (v && (LICENSE_IDS as readonly string[]).includes(v.license)) return { license: v.license, origin: v.origin ?? {}, tags: v.tags ?? [] };
    } catch {
      // 読めなければ既定値
    }
    return { license: 'CC0', origin: {}, tags: [] };
  };
  const common = loadCommon();

  const buildImportPanel = (): Child[] => {
    const importBtn = button('取り込む', () => {
      try {
        localStorage.setItem(IMPORT_COMMON_KEY, JSON.stringify(common));
      } catch {
        // 保存できなくても取り込みは続ける
      }
      importBtn.disabled = true;
      run(async () => {
        try {
          await app.commitImport(common, setStatus);
          setStatus('取り込みました');
        } finally {
          importBtn.disabled = false;
        }
      });
    }, 'primary');

    return [
      h('h2', { textContent: `取り込み（${app.pending.length} 件）` }),
      ...app.pending.map((p) => {
        const st = p.parsed;
        let tris = 0;
        st.root.traverse((o) => {
          const g = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).geometry : null;
          if (g) tris += Math.floor((g.index?.count ?? g.getAttribute('position')?.count ?? 0) / 3);
        });
        const skel = { none: 'スケルトンなし', mixamo: 'Mixamo 骨格', other: 'Mixamo 以外の骨格' }[st.skeleton];
        return h(
          'div',
          { className: 'pending' },
          h('div', { className: 'file', textContent: st.file.name }),
          h('div', {
            className: 'meta',
            textContent: `${tris.toLocaleString()} 三角形・${skel}・アニメ ${st.animations.length} 本${st.originals.length > 1 ? `・付属 ${st.originals.length - 1} ファイル` : ''}`,
          }),
          row('ID', textInput(() => p.id, (v) => (p.id = v.trim()))),
          row('名前', textInput(() => p.name, (v) => (p.name = v))),
          row('カテゴリ', selectInput(categoryOptions, () => p.category, (v: CategoryId) => (p.category = v))),
        );
      }),
      h('h2', { textContent: '出典・ライセンス（共通）' }),
      row('ライセンス', selectInput(licenseOptions, () => common.license, (v: LicenseId) => (common.license = v))),
      ...originFields(
        () => common.origin,
        (k, v) => (common.origin[k] = v || undefined),
      ),
      row(
        'タグ',
        textInput(
          () => common.tags.join(', '),
          (v) => (common.tags = v.split(/[,、\s]+/).filter(Boolean)),
          'カンマ区切り',
        ),
      ),
      h(
        'p',
        { className: 'hint' },
        '出典（URL・作者・パックのどれか）は必須。Mixamo のモーションはライセンス「Mixamo」、パック「Mixamo」にしておくと一覧で分かりやすい',
      ),
      h('div', { className: 'buttons' }, importBtn, button('キャンセル', () => app.cancelImport())),
    ];
  };

  const refresh = () => {
    const key = app.pending.length > 0 ? `import:${app.pending.length}` : app.current ? `asset:${app.current.entry.id}` : '';
    if (key !== propsKey) {
      propsKey = key;
      syncers = [];
      props.replaceChildren(...present(key.startsWith('import') ? buildImportPanel() : key ? buildAssetPanel() : []));
    }
    for (const s of syncers) s();
    renderList();
  };

  async function save(): Promise<void> {
    await app.save();
    setStatus(`${app.current?.entry.name} を保存しました`);
  }

  app.onChange(refresh);
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (app.dirty) run(save);
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (app.dirty || app.pending.length > 0) e.preventDefault();
  });

  run(async () => {
    await app.refreshCatalog();
    setStatus(`${app.entries.length} 件のアセット`);
  });
  refresh();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
