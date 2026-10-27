import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Loaded } from '../../data';
import type { Clock } from '../../clock';
import { getWhatIf } from '../../game/whatif';
import { Badge } from '../layers/GameLayers';
import { jointAt } from '../camera/Director';

// 换队友来射 on the pitch (the pause window's tool, src/pause/PauseWindow.tsx): over each attacker's head, his xG if he
// shot from where he stands. The real shooter's tag is outlined, the picked teammate's filled white. The same size on screen at any distance.

const W = 112, H = 44, SIZE = 0.036;   // canvas pixels; height on screen as a share of the view's height

function draw(b: Badge, x: number, kind: 'plain' | 'shooter' | 'pick') {
  const g = b.ctx(`${x.toFixed(2)}|${kind}`);
  if (!g) return;
  g.fillStyle = kind === 'pick' ? '#f2f4f7' : 'rgba(6,9,14,0.86)'; g.fillRect(0, 0, W, H);
  if (kind === 'shooter') { g.strokeStyle = '#f2f4f7'; g.lineWidth = 4; g.strokeRect(2, 2, W - 4, H - 4); }
  g.fillStyle = kind === 'pick' ? '#0b0f15' : '#f2f4f7';
  g.font = '700 32px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(x.toFixed(2), W / 2, H / 2 + 2);
}

export function MateShotLayer({ data, clock }: { data: Loaded; clock: Clock }) {
  const J = data.joints, n = J?.players ?? 22;
  const neck = useMemo(() => J?.names.indexOf('neck') ?? -1, [J]);
  const tags = useMemo(() => Array.from({ length: n }, () => new Badge(W, H, 0)), [n]);
  const group = useMemo(() => { const g = new THREE.Group(); tags.forEach((b) => g.add(b.sprite)); return g; }, [tags]);
  useEffect(() => () => tags.forEach((b) => { b.tex.dispose(); (b.sprite.material as THREE.Material).dispose(); }), [tags]);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    const wi = getWhatIf(), on = wi.tool === 'mate-shot' && !!wi.xg && !!J;
    group.visible = on;
    if (!on || !J) return;
    const h = SIZE * 2 * Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2));
    tags.forEach((b, p) => {
      const x = wi.xg![p];
      b.sprite.visible = x != null && jointAt(J, p, neck, clock.t, v);
      if (!b.sprite.visible || x == null) return;
      draw(b, x, p === wi.pick ? 'pick' : p === wi.shooter ? 'shooter' : 'plain');
      b.sprite.position.set(v.x, v.y + 0.55, v.z);
      b.sprite.scale.set(h * W / H, h, 1);
    });
  });
  return <primitive object={group} />;
}
