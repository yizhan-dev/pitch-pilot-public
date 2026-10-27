import * as THREE from 'three';
import { HX, HY, RC, ROOF } from './layout';
import { Envelope, type FacadeParams } from './Facade';
import { Crystal, type CrystalParams } from './Crystal';
import { STADIUM_CURRENT } from './crystalParams';

export type ShellForm = 'crystal' | 'sweep';

/** Everything seen from outside. form 'crystal': the clean octagonal crystal; 'sweep': the swept envelope (candidates A to H).
 *  shadows: let it cast shadows (exterior studio only; inside the bowl the floodlit look has none). */
export function StadiumShell({ clip = [], form = 'sweep', facade, crystal, shadows = false, interior = false }: {
  clip?: THREE.Plane[]; form?: ShellForm; facade?: Partial<FacadeParams>; crystal?: Partial<CrystalParams>; shadows?: boolean; interior?: boolean;
}) {
  // without explicit parameters the shell is the current fixed version (v1)
  if (form === 'crystal') return <Crystal hx={HX} hy={HY} rc={RC} back={ROOF.back} clip={clip} params={crystal ?? STADIUM_CURRENT} shadows={shadows} interior={interior} />;
  return <Envelope hx={HX} hy={HY} rc={RC} back={ROOF.back} front={ROOF.front} top={ROOF.backH} frontTop={ROOF.frontH} clip={clip} params={facade} shadows={shadows} />;
}
