/**
 * 情報札と同じ中身（顔・兵士数・士気。unitTags.ts の renderStatus を共用する）。部隊・配備のウィンドウで使う。
 * large なら、マップに重ねる詳しい札と同じ大きさ（.is-large）にする。
 */
import { useLayoutEffect, useRef } from 'react';
import { LARGE_FACE_SIZE, renderStatus, STATUS_HTML } from '../unitTags';
import type { UnitStatus } from '../unitStatus';

export default function StatusCard({ status, large = false, className = '' }: { status: UnitStatus; large?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.firstChild) el.innerHTML = STATUS_HTML;
    renderStatus(el, status, large ? LARGE_FACE_SIZE : undefined);
  });
  return <div ref={ref} className={`unit-tag${large ? ' is-large' : ''} ${className}`} />;
}
