import React, { memo, useEffect, useRef, useState } from 'react';
import { quotaPeriod } from './usage-period.mjs';
import './usage-meter.css';
// Decorative animation never changes the reported quota. Each bar animates
// only while visible; numbers and widths always use the real cached response.
export const UsageMeter = memo(function UsageMeter({ value, label, quota }) {
  const ref = useRef(null), [visible, setVisible] = useState(false);
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  useEffect(() => { const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting)); observer.observe(ref.current); return () => observer.disconnect(); }, []);
  return <div ref={ref} className={'usage-meter' + (visible ? ' visible' : '')} data-period={quotaPeriod(quota)} role="progressbar"
    aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} style={{ '--quota-fill': percent + '%' }}>
    <div className="usage-meter-fill"><span className="usage-meter-light" />{Array.from({ length: 9 }, (_, i) => <i key={i} className="usage-meter-star" style={{ '--star-x': (14 + i * 9) + '%', '--star-y': (25 + (i * 37) % 50) + '%', '--star-delay': (-i * .83) + 's' }} />)}</div>
  </div>;
});
