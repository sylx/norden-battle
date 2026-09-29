import './style.css';
import { ObjectEditorApp } from './editor/app';
import { setupUI } from './editor/ui';

const app = new ObjectEditorApp(document.getElementById('viewport')!);
setupUI(app);

// デバッグ用
(window as unknown as { editor: ObjectEditorApp }).editor = app;
