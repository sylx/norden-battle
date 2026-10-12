/**
 * 殲滅（兵数が 0 になった）ときの指揮官の捕縛。隣接している敵ユニットの数で決まる確率で捕縛され、捕虜になる。
 * 捕縛されなければ指揮官は落ち延びる（どちらでもユニットは戦場から消える）。
 * 結果は WipeoutReport で知らせる（BattleApp の wipeout のイベント・wipedOut）。捕虜をどう扱うかは使う側が決める。
 */
import type { UnitData } from '@norden/map-runtime/core/units';
import type { UnitStatus } from './unitStatus';

/** 殲滅の結果 */
export interface WipeoutReport {
  /** 殲滅されたユニット（もうマップにはいない） */
  unit: UnitData;
  /** 配備した部隊の ID（Troop.id。マップに最初から置いてあったユニットは null） */
  troopId: string | null;
  /** 殲滅されたときの戦闘中の状態 */
  status: UnitStatus;
  /** 何ターン目に殲滅されたか */
  turn: number;
  /** 殲滅したユニット（攻撃・反撃・迎撃したユニット） */
  by: UnitData;
  /** 殲滅されたときに隣接していた敵ユニットの数（同時に殲滅されたユニットは数えない） */
  enemies: number;
  /** 捕縛される確率（0〜1） */
  captureChance: number;
  /** 指揮官が捕縛されて捕虜になったか（なっていなければ落ち延びた） */
  captured: boolean;
}

/** 隣接している敵ユニットの数ごとの、殲滅されたときに捕縛される確率（これより多ければ最後の値） */
export const WIPEOUT_CAPTURE_CHANCE: readonly number[] = [0.1, 0.3, 0.5, 0.75];

/** 隣接している敵ユニットが enemies 部隊いるときに、殲滅されて捕縛される確率 */
export function wipeoutCaptureChance(enemies: number): number {
  return WIPEOUT_CAPTURE_CHANCE[Math.min(enemies, WIPEOUT_CAPTURE_CHANCE.length - 1)];
}
