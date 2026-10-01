import './style.css';
import { BattleApp } from './battle/app';
import { setupUI } from './battle/ui';
import { setupToolbar } from './toolbar';

setupToolbar();
const app = new BattleApp(document.getElementById('viewport')!);
const ui = setupUI(app);
void ui.loadInitial();

// デバッグ用
(window as unknown as { battle: BattleApp }).battle = app;
