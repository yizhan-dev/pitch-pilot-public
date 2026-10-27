import * as THREE from 'three';

/** where the ball is drawn this frame, in Three.js world coordinates, shared with the goals so their nets can take it.
 *  ok is false when no ball is shown. */
export const liveBall = { p: new THREE.Vector3(), ok: false, t: 0 };
