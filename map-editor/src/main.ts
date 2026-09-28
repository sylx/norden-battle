import './style.css';
import { EditorApp } from './editor/app';
import { setupUI } from './editor/ui';

const app = new EditorApp(document.getElementById('viewport')!);
const ui = setupUI(app);
void ui.loadInitial();

// デバッグ用
(window as unknown as { editor: EditorApp }).editor = app;
