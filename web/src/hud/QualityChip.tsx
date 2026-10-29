import { useQuality } from '../three/quality';
import './qchip.css';

// The graphics level on screen, so a viewer knows whether the low or the high quality version runs: the tier and the
// render scale, as three/quality.ts sets them for this device, in
// the top bar's right group and in the line-up show's corner. Quiet: it is information, not a control.
export function QualityChip({ className = '' }: { className?: string }) {
  const { tier, scale } = useQuality();
  const pct = Math.round(scale * 100);
  return (
    <span className={`hud-qchip hud-glass ${tier === 'low' ? 'low' : ''} ${className}`}
      title={`Graphics: ${tier === 'low' ? 'low' : 'high'} quality at ${pct}% render scale, set for this device as it runs`}>
      <b>{tier === 'low' ? 'LQ' : 'HQ'}</b><i>{pct}%</i>
    </span>
  );
}
