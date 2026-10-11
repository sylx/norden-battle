/**
 * 情報札と同じ中身（顔・兵士数・士気。unitTags.ts の renderStatus を共用する）。行動メニュー・配備のウィンドウで使う。
 */
import { useLayoutEffect, useRef } from 'react';
import { renderStatus, STATUS_HTML } from '../unitTags';
import type { UnitStatus } from '../unitStatus';

export default function StatusCard({ status, className = '' }: { status: UnitStatus; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.firstChild) el.innerHTML = STATUS_HTML;
    renderStatus(el, status);
  });
  return <div ref={ref} className={`unit-tag ${className}`} />;
}
