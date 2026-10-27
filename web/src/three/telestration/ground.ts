// The ground layer: every mark that lies on the pitch, as one instanced quad per mark exactly on the grass plane (y = 0),
// drawn in one call. Each quad's fragment shader computes the mark's signed distance in metres and antialiases it over
// the pixel's footprint ACROSS that edge (the screen derivatives of the pitch position projected on the edge's normal),
// the fix the grass markings got for the assistant referee's view (Pitch.tsx, gAA), generalised to any shape.
// Design: docs/research/telestration.md, sections 4.1 to 4.5.
//  - width: metres, so marks foreshorten like paint; light marks never thinner than uMinPx pixels across their edge
//  - halo: the digital layer's glow, analytic, in metres with a pixel floor; added as light (premultiplied, alpha 0)
//  - depth: coplanar with the grass, polygon offset instead of a lift (a lift slides marks up to a metre away from the
//    players' feet in the low views), depth test on so players occlude the marks, no depth writes
import * as THREE from 'three';

export const KIND = { ring: 1, band: 2, edge: 3, zebra: 4, zone: 5, poly: 6, capsule: 7, cone: 8, hull: 9, chevrons: 10, arrow: 11, press: 12, pair: 13, disc: 14, arc: 15 } as const;

const VERT = /* glsl */ `
attribute vec4 iFrame;   // centre x, z (scene metres), unit axis x, z
attribute vec4 iBox;     // half extents along the axis and across it, kind, alpha
attribute vec4 iA; attribute vec4 iB; attribute vec4 iC1; attribute vec4 iC2;
attribute vec4 iD; attribute vec4 iE; attribute vec4 iF; attribute vec4 iG;   // a polygon zone's further corners and stripes
varying vec2 vP;
flat varying vec4 vBox; flat varying vec4 vA; flat varying vec4 vB; flat varying vec4 vC1; flat varying vec4 vC2;
flat varying vec4 vD; flat varying vec4 vE; flat varying vec4 vF; flat varying vec4 vG;
void main() {
  vec2 u = iFrame.zw, v = vec2(-u.y, u.x);
  vec2 l = position.xy * 2.0 * iBox.xy;
  vec2 w = iFrame.xy + u * l.x + v * l.y;
  vP = l; vBox = iBox; vA = iA; vB = iB; vC1 = iC1; vC2 = iC2; vD = iD; vE = iE; vF = iF; vG = iG;
  gl_Position = projectionMatrix * viewMatrix * vec4(w.x, 0.0, w.y, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vP;
flat varying vec4 vBox; flat varying vec4 vA; flat varying vec4 vB; flat varying vec4 vC1; flat varying vec4 vC2;
flat varying vec4 vD; flat varying vec4 vE; flat varying vec4 vF; flat varying vec4 vG;
uniform float uMinPx, uGlowPx, uGlowSigma, uGlow, uDebug;
// a triangle's signed distance, negative inside (Inigo Quilez)
float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2, v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 q0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0), q1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 q2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(q0, q0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(q1, q1), s * (v1.x * e1.y - v1.y * e1.x))),
               vec2(dot(q2, q2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
float sdSegG(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0)); }
// the unit direction away from that segment (sdSegG's gradient), for its pixel size (aaOf): differencing the distance
// itself across the screen spikes where it jumps, at a repeated pattern's cell edges
vec2 gSegG(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a, q = pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0); float l = length(q); return l > 1e-6 ? q / l : vec2(0.0, 1.0); }
// a convex polygon's signed distance, negative inside, for up to ten corners (Inigo Quilez's sdPolygon)
float sdPoly10(vec2 p, vec2 V[10], int nv) {
  float d2 = 1e20, sg = 1.0;
  for (int i = 0; i < 10; i++) {
    if (i >= nv) break;
    int j = i == 0 ? nv - 1 : i - 1;
    vec2 e = V[j] - V[i], w = p - V[i];
    vec2 b = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-9), 0.0, 1.0);
    d2 = min(d2, dot(b, b));
    bvec3 c = bvec3(p.y >= V[i].y, p.y < V[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) sg = -sg;
  }
  return sg * sqrt(d2);
}
// a capsule along the axis from x = a to x = b, radius r: its signed distance
float sdCap(vec2 p, float a, float b, float r) { float x = clamp(p.x, min(a, b), max(a, b)); return length(vec2(p.x - x, p.y)) - r; }
// polynomial smooth minimum (Inigo Quilez): a fillet of size k where two shapes meet
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
// a blend between two sRGB colours for a gradient: mode 1 straight through OKLab (perceptually even, greys between
// complementary colours), mode 2 round the hue circle the short way in OKLCh (blue to orange runs through violet and pink)
vec3 sLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 linS(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 toLab(vec3 c) {
  vec3 l = sLin(c), q = vec3(dot(l, vec3(0.4122214708, 0.5363325363, 0.0514459929)), dot(l, vec3(0.2119034982, 0.6806995451, 0.1073969566)), dot(l, vec3(0.0883024619, 0.2817188376, 0.6299787005)));
  q = pow(max(q, 0.0), vec3(1.0 / 3.0));
  return vec3(dot(q, vec3(0.2104542553, 0.7936177850, -0.0040720468)), dot(q, vec3(1.9779984951, -2.4285922050, 0.4505937099)), dot(q, vec3(0.0259040371, 0.7827717662, -0.8086757660)));
}
vec3 fromLab(vec3 c) {
  vec3 q = vec3(c.x + 0.3963377774 * c.y + 0.2158037573 * c.z, c.x - 0.1055613458 * c.y - 0.0638541728 * c.z, c.x - 0.0894841775 * c.y - 1.2914855480 * c.z);
  q = q * q * q;
  return linS(vec3(dot(q, vec3(4.0767416621, -3.3077115913, 0.2309699292)), dot(q, vec3(-1.2684380046, 2.6097574011, -0.3413193965)), dot(q, vec3(-0.0041960863, -0.7034186147, 1.7076147010))));
}
vec3 gradMix(vec3 a, vec3 b, float w, float mode) {
  if (mode < 0.5) return a;
  vec3 A = toLab(a), B = toLab(b);
  if (mode < 1.5) return fromLab(mix(A, B, w));
  float ha = atan(A.z, A.y), dh = atan(B.z, B.y) - ha;
  dh -= 6.2831853 * floor((dh + 3.1415927) / 6.2831853);
  float h = ha + dh * w, c = mix(length(A.yz), length(B.yz), w);
  return fromLab(vec3(mix(A.x, B.x, w), c * cos(h), c * sin(h)));
}
// the arc length along a capsule (from a to b, radius r) from its back point (a - r, 0), either way round
float sHalfC(vec2 p, float hL, float r) {
  float ay = abs(p.y);
  if (p.x < -hL) return r * atan(ay, -(p.x + hL));
  if (p.x > hL) return r * 1.5707963 + 2.0 * hL + r * (1.5707963 - atan(ay, p.x - hL));
  return r * 1.5707963 + (p.x + hL);
}
// the same, once round (0 at the back point, the upper side first), for a capsule from a to b
float sAround(vec2 p, float a, float b, float r) {
  float c = 0.5 * (a + b), h = 0.5 * abs(b - a), sh = sHalfC(vec2(p.x - c, p.y), h, r);
  return p.y >= 0.0 ? sh : 6.2831853 * r + 4.0 * h - sh;
}
// the pixel's footprint in metres across an edge whose unit normal is g
float aaOf(vec2 g, vec2 dx, vec2 dy) { return max(length(vec2(dot(g, dx), dot(g, dy))), 1e-6); }
float cov(float d, float aa) { return clamp(0.5 - d / aa, 0.0, 1.0); }
float halo(float d, float s) { float x = max(d, 0.0) / s; return exp(-x * x); }
void main() {
  vec2 p = vP, dx = dFdx(p), dy = dFdy(p);
  int kind = int(vBox.z + 0.5);
  vec3 rgb = vec3(0.0); float a = 0.0; vec3 glow = vec3(0.0), lightAdd = vec3(0.0);
  if (kind == 1) {
    // the marker ring: a dashed outer band (vC1) round a solid inner band (vC2). vA: outer radius, outer width, inner
    // radius, inner width (scaled); vB: arcs, painted fraction, phase, the scale (entrance times the view's gain)
    float R = vA.x, wO = vA.y, Ri = vA.z, wI = vA.w;
    float r = length(p);
    vec2 gr = r > 1e-5 ? p / r : vec2(1.0, 0.0), gt = vec2(-gr.y, gr.x);
    float aR = aaOf(gr, dx, dy), aT = aaOf(gt, dx, dy);
    // the pixel floor widens a band along its own normal; on a curve that is only exact while the widening is small
    // against the radius (at grazing angles the radial footprint is metres and the ring would swell sideways), so the
    // widening is capped at 0.15 R and a still thinner band renders as a fainter hairline instead
    float cap = 0.15 * R;
    float hwO = max(0.5 * wO, min(0.5 * uMinPx * aR, 0.5 * wO + cap)), dO = abs(r - R) - hwO;
    // ten arcs with square ends: the angular distance to the nearest arc end, as metres along the circle
    float per = 6.2831853 / vB.x;
    float ang = mod(atan(p.y, p.x) - vB.z, per) - 0.5 * per;
    float dA = (abs(ang) - 0.5 * vB.y * per) * max(r, 1e-4);
    // when one arc period spans only a few pixels along the circle, the pattern becomes its average (as paint does)
    float perPx = per * R / aT;
    float cA = mix(vB.y, cov(dA, aT), smoothstep(2.0, 5.0, perPx));
    float cO = cov(dO, aR) * cA;
    float hwI = max(0.5 * wI, min(0.5 * uMinPx * aR, 0.5 * wI + cap)), dI = abs(r - Ri) - hwI;
    float cI = cov(dI, aR);
    rgb = vC1.rgb * cO + vC2.rgb * cI * (1.0 - cO);
    a = cO + cI * (1.0 - cO);
    float sg = uGlowSigma * vB.w, s = max(sg, min(uGlowPx * aR, 2.0 * sg));   // the halo's pixel floor, capped likewise
    glow = vC1.rgb * halo(max(dO, mix(0.0, dA, step(5.0, perPx))), s) + vC2.rgb * halo(dI, s);
  }
  else if (kind == 2) {
    // a single solid ring (tier 2: unit members, network nodes). vA: radius, band width; vB.w: the scale
    float r = length(p);
    vec2 gr = r > 1e-5 ? p / r : vec2(1.0, 0.0);
    float aR = aaOf(gr, dx, dy), R = vA.x, w = vA.y, cap = 0.15 * R;
    float hw = max(0.5 * w, min(0.5 * uMinPx * aR, 0.5 * w + cap)), d = abs(r - R) - hw;
    float c = cov(d, aR);
    rgb = vC1.rgb * c; a = c;
    float sg = uGlowSigma * vB.w, s = max(sg, min(uGlowPx * aR, 2.0 * sg));
    glow = vC1.rgb * halo(d, s);
  }
  else if (kind == 3) {
    // a connecting line, welded: it runs from ring A (at -L/2 along the axis) to ring B (+L/2) and is cut by each ring's
    // own circle at the band's centreline, so the band painted over it buries the seam (pitch_prism's rule). It draws
    // from both rings towards the middle (the cascade's "meeting in the middle"). vA: half-length, half-width, the
    // radius cut at A, at B; vB.x: drawn 0..1; vB.y: 0 draws from both rings to the middle, 1 from A to B (a pass);
    // vB.z: the dash period in metres (0: solid), with vC2.x the painted share and vC2.y the dashes' phase, the first
    // dash starting at ring A's cut (a marking link)
    float hL = vA.x, hwIn = vA.y, rA = vA.z, rB = vA.w, f = vB.x;
    vec2 gu = vec2(1.0, 0.0), gv = vec2(0.0, 1.0);
    float aU = aaOf(gu, dx, dy), aV = aaOf(gv, dx, dy);
    float hw = max(hwIn, 0.5 * uMinPx * aV), dl = abs(p.y) - hw;
    vec2 pa = p - vec2(-hL, 0.0), pb = p - vec2(hL, 0.0);
    float la = length(pa), lb = length(pb);
    float aA = aaOf(la > 1e-5 ? pa / la : gu, dx, dy), aB = aaOf(lb > 1e-5 ? pb / lb : gu, dx, dy);
    float s0 = p.x + hL, L = 2.0 * hL, Lv = max(L - rA - rB, 0.0);
    float dDraw = vB.y < 0.5 ? min(s0 - (rA + 0.5 * f * Lv), (L - rB - 0.5 * f * Lv) - s0) : s0 - (rA + f * Lv);
    // between the two centres only: beyond an end ring, outside its circle, the line would show as a stub
    float dEnds = max(-s0, s0 - L);
    float c = cov(dl, aV) * cov(rA - la, aA) * cov(rB - lb, aB) * cov(dDraw, aU) * cov(dEnds, aU) * step(0.001, f);
    float dDash = -1.0;
    if (vB.z > 0.0) {
      // square-ended dashes along the line; a period only a few pixels long becomes its average, as paint does
      float per = vB.z, h = 0.5 * vC2.x * per, w = mod(s0 - rA - vC2.y - h + 0.5 * per, per) - 0.5 * per;
      float perPx = per / aU;
      dDash = abs(w) - h;
      c *= mix(vC2.x, cov(dDash, aU), smoothstep(2.0, 5.0, perPx));
      dDash = mix(-1.0, dDash, step(5.0, perPx));
    }
    rgb = vC1.rgb * c; a = c;
    float sg = uGlowSigma * vB.w, s = max(sg, min(uGlowPx * aV, 2.0 * sg));
    glow = vC1.rgb * halo(max(max(max(dl, dDraw), max(max(rA - la, rB - lb), dEnds)), dDash), s) * step(0.001, f);
  }
  else if (kind == 4) {
    // a painted area: pitch_prism's matte zebra, 45 degrees, 50/50, in a rectangle along the axis. vA: half length,
    // half width, stripe width, paint alpha; vB.x: how far the paint has spread along the axis (0..1, from -x), with a
    // soft front. Paint: no halo. The stripes' period is measured across them, so the "x_step = W·2·√2" rule holds by
    // construction (stepping the start by 2W gave a gap of W/√2 in pitch_prism, twice)
    float hx = vA.x, hy = vA.y, Wd = vA.z;
    vec2 gx = vec2(1.0, 0.0), gy = vec2(0.0, 1.0), n = vec2(0.70710678, 0.70710678);
    float ax = aaOf(gx, dx, dy), ay = aaOf(gy, dx, dy), aS = aaOf(n, dx, dy);
    float c = cov(abs(p.x) - hx, ax) * cov(abs(p.y) - hy, ay);
    float per = 2.0 * Wd, q = dot(p, n), dS = abs(mod(q + 0.5 * per, per) - 0.5 * per) - 0.5 * Wd;
    float cS = mix(0.5, cov(dS, aS), smoothstep(2.0, 5.0, per / aS));   // far away the stripes become their average
    float front = -hx + 2.0 * hx * vB.x;
    float reveal = clamp((front - p.x) / 1.5 + 0.5, 0.0, 1.0);
    a = c * cS * reveal * vA.w;
    rgb = vC1.rgb * a;
  }
  else if (kind == 5) {
    // a zone (pitch_prism's Zone tool, as a rectangle): the matte zebra inside, a glowing outline all round with square
    // corners. vA: half length, half width, stripe width, paint alpha; vB: progress, paint progress (style 0), outline
    // half-width, scale; vC1: the outline's colour and, in .w, the entrance style (Yi, 2026-10-22: the zone's entrance
    // must differ from the lines', or the eye tires): 0 corners (each side from its corners to its middle, stripes
    // staggered), 1 scan (a band of light sweeps along, leaving the zone behind it), 2 unfold (a line along the middle
    // stretches out, then opens into the box), 3 trace (a bright pen runs once round the outline, then the stripes
    // fill from its start), 4 glint (fades in while a glint crosses it); vC2: the paint's colour
    float hx = vA.x, hy = vA.y, Wd = vA.z, hw0 = vB.z, t = vB.x;
    int sty = int(vC1.w + 0.5);
    vec2 gx = vec2(1.0, 0.0), gy = vec2(0.0, 1.0), n = vec2(0.70710678, 0.70710678), m = vec2(-0.70710678, 0.70710678);
    float ax = aaOf(gx, dx, dy), ay = aaOf(gy, dx, dy), aS = aaOf(n, dx, dy);
    // the box shown: the whole zone, except while it unfolds
    float bx = hx, by = hy;
    if (sty == 2) {
      float ta = clamp(t / 0.45, 0.0, 1.0), tb = clamp((t - 0.45) / 0.55, 0.0, 1.0);
      ta = 1.0 - pow(1.0 - ta, 3.0); tb = 1.0 - pow(1.0 - tb, 3.0);
      bx = max(hx * ta, 1e-3); by = max(mix(hw0 * 1.2, hy, tb), 1e-3);
    }
    // which side a point belongs to: the nearer one; the outline as a band round the box's own distance
    vec2 dq = abs(p) - vec2(bx, by);
    bool onX = dq.y > dq.x;                                    // nearer a side running along x (top or bottom)
    float aE = onX ? ay : ax, aL = onX ? ax : ay, hw = max(hw0, 0.5 * uMinPx * aE);
    float dBox = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0);
    float dOut = abs(dBox) - hw;
    float cO = cov(dOut, aE);
    float inside = cov(dBox + hw, min(ax, ay));
    float per = 2.0 * Wd, q = dot(p, n), dS = abs(mod(q + 0.5 * per, per) - 0.5 * per) - 0.5 * Wd;
    float cS = mix(0.5, cov(dS, aS), smoothstep(2.0, 5.0, per / aS));
    float qmax = (hx + hy) * 0.70710678, kq = clamp((q + qmax) / (2.0 * qmax), 0.0, 1.0);
    float r = (dot(p, m) + qmax) / (2.0 * qmax);               // along a stripe, 0 at its far end
    float mO = 1.0, mP = 1.0, mG = 1.0, lite = 0.0;
    if (sty == 0) {
      float drawn = onX ? abs(p.x) - hx * (1.0 - t) : abs(p.y) - hy * (1.0 - t);
      mO = cov(-drawn, aL) * step(0.001, t);
      float g = clamp(vB.y * 1.6 - kq * 0.6, 0.0, 1.0);        // this stripe's share drawn (the first ones lead)
      mP = cov(r - g, aS / (2.0 * qmax)) * step(0.001, vB.y);
      mG = mO;
    } else if (sty == 1) {
      float w = 1.4, xf = -hx - w + (2.0 * hx + 2.0 * w) * t;
      mO = mP = mG = cov(p.x - xf, ax);
      lite = exp(-pow((p.x - xf) / 0.8, 2.0)) * step(abs(p.y), hy + hw) * (1.0 - smoothstep(0.85, 1.0, t));
    } else if (sty == 2) {
      lite = 0.6 * (1.0 - smoothstep(0.6, 1.0, t)) * cO;
    } else if (sty == 3) {
      // the position along the outline, clockwise from the corner at (-x, -y), and the pen's
      float P4 = 4.0 * (hx + hy), sp;
      if (onX) sp = p.y < 0.0 ? (p.x + hx) : (2.0 * hx + 2.0 * hy + (hx - p.x));
      else sp = p.x > 0.0 ? (2.0 * hx + (p.y + hy)) : (4.0 * hx + 2.0 * hy + (hy - p.y));
      float to = clamp(t / 0.6, 0.0, 1.0), so = to * P4;
      mO = mG = cov(sp - so, aL) * step(0.001, t);
      lite = exp(-pow((sp - so) / 1.1, 2.0)) * cO * step(0.001, to) * (1.0 - step(0.999, to)) * 2.0;
      float g = clamp((t - 0.55) / 0.45, 0.0, 1.0);
      mP = cov(kq - g, aS / (2.0 * qmax));
    } else {
      mO = mG = smoothstep(0.0, 0.5, t); mP = smoothstep(0.15, 0.7, t);
      float gp = -0.2 + 1.4 * t;                               // the glint's place along the diagonal
      lite = exp(-pow((kq - gp) / 0.05, 2.0)) * (1.0 - smoothstep(0.8, 1.0, t)) * (inside + cO) * 0.9;
    }
    float cOm = cO * mO, cP = inside * cS * mP * vA.w;
    rgb = vC1.rgb * cOm + vC2.rgb * cP * (1.0 - cOm);
    a = cOm + cP * (1.0 - cOm);
    float sg = uGlowSigma * vB.w, s = max(sg, min(uGlowPx * aE, 2.0 * sg));
    glow = vC1.rgb * halo(max(dOut, 0.0), s) * mG;
    lightAdd = mix(vC1.rgb, vec3(1.0), 0.45) * lite;           // the entrance's own light, at full strength
  }
  else if (kind == 6) {
    // a zone of any shape (Yi, 2026-10-22: two sides need not be parallel): a polygon of 3 to 8 corners, the matte zebra
    // inside a glowing outline. The quad's frame stands on the zone's centroid and runs along its axis (local x along it,
    // y across). It unfolds from its spine, the axis through the centroid: a straight line stretches out along it, then
    // opens across towards both sides at once, each moving edge a fixed share of the way from the spine to the polygon's
    // own side at every point, so the edges swing from the spine's direction onto the sides' (the rectangle's unfold,
    // Yi's C, is the special case). vA, vD, vE, vF: the corners in local metres, two to a vector; vC1: the outline's colour, the corner count in
    // .w; vC2: the paint's colour and alpha; vB: progress, stripe width, outline half-width, scale; vG.xy: the stripes'
    // normal in local axes, vG.z their phase at the centre (so they line up with every other zone's on the pitch)
    vec2 V[8];
    V[0] = vA.xy; V[1] = vA.zw; V[2] = vD.xy; V[3] = vD.zw; V[4] = vE.xy; V[5] = vE.zw; V[6] = vF.xy; V[7] = vF.zw;
    int nv = int(vC1.w + 0.5);
    float t = vB.x, Wd = vB.y, hw0 = vB.z;
    // the polygon's signed distance, negative inside (Inigo Quilez's sdPolygon), and its extent along x
    float d2 = 1e20, sg = 1.0, u0 = 1e9, u1 = -1e9;
    for (int i = 0; i < 8; i++) {
      if (i >= nv) break;
      int j = i == 0 ? nv - 1 : i - 1;
      vec2 e = V[j] - V[i], w = p - V[i];
      vec2 b = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-9), 0.0, 1.0);
      d2 = min(d2, dot(b, b));
      bvec3 c = bvec3(p.y >= V[i].y, p.y < V[j].y, e.x * w.y > e.y * w.x);
      if (all(c) || all(not(c))) sg = -sg;
      u0 = min(u0, V[i].x); u1 = max(u1, V[i].x);
    }
    float dVis = sg * sqrt(d2);
    if (t < 0.999) {
      float ta = clamp(t / 0.45, 0.0, 1.0), tb = clamp((t - 0.45) / 0.55, 0.0, 1.0);
      ta = 1.0 - pow(1.0 - ta, 3.0); tb = 1.0 - pow(1.0 - tb, 3.0);
      // the cross-section here (held at the ends beyond them): its lowest and highest y, and the slopes of those sides
      float uq = clamp(p.x, u0 + 1e-3, u1 - 1e-3), lo = 1e9, hi = -1e9, slo = 0.0, shi = 0.0;
      for (int i = 0; i < 8; i++) {
        if (i >= nv) break;
        int j = i == 0 ? nv - 1 : i - 1;
        vec2 A = V[i], B = V[j];
        if ((A.x - uq) * (B.x - uq) > 0.0 || abs(B.x - A.x) < 1e-6) continue;
        float sl = (B.y - A.y) / (B.x - A.x), y = A.y + sl * (uq - A.x);
        if (y < lo) { lo = y; slo = sl; }
        if (y > hi) { hi = y; shi = sl; }
      }
      float thin = hw0 * 1.2, du = p.x - uq;
      // the two moving edges, tb of the way from the spine (y = 0) to the sides, as lines through this cross-section,
      // and the distance across them
      float sU = tb * shi, sD = tb * slo, yU = tb * hi + thin + sU * du, yD = tb * lo - thin + sD * du;
      float dV = max((p.y - yU) / sqrt(1.0 + sU * sU), (yD - p.y) / sqrt(1.0 + sD * sD));
      float dU = max(p.x - ta * u1, ta * u0 - p.x) - 1e-3;
      dVis = max(dVis, max(dU, dV));
    }
    // the footprint across the edge, from the distance's own screen derivatives (its gradient is a unit vector)
    float aE = max(length(vec2(dFdx(dVis), dFdy(dVis))), 1e-6);
    float hw = max(hw0, 0.5 * uMinPx * aE), dOut = abs(dVis) - hw, on = step(0.001, t);
    float cO = cov(dOut, aE) * on, inside = cov(dVis + hw, aE) * on;
    float aS = aaOf(vG.xy, dx, dy), per = 2.0 * Wd, q = vG.z + dot(p, vG.xy), dS = abs(mod(q + 0.5 * per, per) - 0.5 * per) - 0.5 * Wd;
    float cS = mix(0.5, cov(dS, aS), smoothstep(2.0, 5.0, per / aS));
    float cP = inside * cS * vC2.w;
    rgb = vC1.rgb * cO + vC2.rgb * cP * (1.0 - cO);
    a = cO + cP * (1.0 - cO);
    float sgm = uGlowSigma * vB.w, s = max(sgm, min(uGlowPx * aE, 2.0 * sgm));
    glow = vC1.rgb * halo(max(dOut, 0.0), s) * on;
    lightAdd = mix(vC1.rgb, vec3(1.0), 0.45) * 0.6 * (1.0 - smoothstep(0.6, 1.0, t)) * cO;
  }
  else if (kind == 7) {
    // a marking pair's capsule (Yi, 2026-10-22): an outline round two players, from A (at -hL along the axis, the
    // marker) to B (+hL, his man), radius r, a faint wash inside. vA: half-length, radius, outline half-width, wash
    // alpha; vB: the entrance's progress 0..1, its style, the idle pulse's progress (negative: none), the scale. Styles
    // (Yi asked for a cooler entrance; six to choose from): 0 stretch (opens round the marker, stretches to his man;
    // the caller pops the radius), 1 snap (shoots past his man and springs back, flashing as it locks), 2 merge (a
    // circle under each, liquid tendrils reaching from both meet and fuse into the capsule), 3 lasso (a wide spinning
    // dashed loop round the marker swings over his man and pulls tight, the dashes closing), 4 embrace (two arms from
    // behind the marker wrap round and close in front of his man, then the wash fills), 5 sonar (the caller's ripples
    // reach his man, the capsule flashes in), 6 fade (round two, Yi: simpler; the whole capsule fades in)
    float hL = vA.x, r = vA.y, hw0 = vA.z, t = clamp(vB.x, 0.0, 1.0);
    int sty = int(vB.y + 0.5);
    vec2 pa = p - vec2(-hL, 0.0), pb = p - vec2(hL, 0.0);
    float d, mO = 1.0, mW = 1.0, lite = 0.0, liteO = 0.0, dashF = 1.0, per = 1.0, ph = 0.0, sAl = 0.0, sHead = 0.0;
    bool dashed = false;
    if (sty == 0) {
      d = sdCap(p, -hL, -hL + 2.0 * hL * t, r);
    } else if (sty == 1) {
      float e = 1.0 - exp(-7.0 * t) * cos(11.0 * t), rr = r * (1.0 - pow(1.0 - clamp(t / 0.15, 0.0, 1.0), 3.0));
      d = sdCap(p, -hL, -hL + 2.0 * hL * e, rr);
      lite = 0.9 * exp(-pow((t - 0.143) / 0.07, 2.0)) * exp(-length(pb) / (1.6 * r));
    } else if (sty == 2) {
      float pop = 1.0 - pow(1.0 - clamp(t / 0.25, 0.0, 1.0), 3.0), popB = 1.0 - pow(1.0 - clamp((t - 0.08) / 0.25, 0.0, 1.0), 3.0);
      float e = smoothstep(0.15, 0.75, t), rn = r * mix(0.35, 1.0, smoothstep(0.55, 1.0, t)), k = max(0.7 * r * (1.0 - smoothstep(0.82, 1.0, t)), 1e-4);
      float dA = smin(length(pa) - r * pop, sdCap(p, -hL, -hL + hL * e, rn * pop), k);
      float dB = smin(length(pb) - r * popB, sdCap(p, hL - hL * e, hL, rn * popB), k);
      d = smin(dA, dB, k);
      lite = 0.5 * exp(-pow((t - 0.75) / 0.08, 2.0)) * exp(-abs(p.x) / (1.2 * r));   // the tendrils meet
    } else if (sty == 3) {
      float R1 = r * 2.2, ea = 1.0 - pow(1.0 - clamp(t / 0.25, 0.0, 1.0), 3.0), eb = smoothstep(0.25, 0.75, t);
      float rr = mix(R1 * ea, r * 1.15, eb);
      rr = mix(rr, r, smoothstep(0.7, 1.0, t));
      float xb = -hL + 2.0 * hL * eb;
      d = sdCap(p, -hL, xb, rr);
      // dashes along the loop's own outline, as many as the final outline holds, spinning and closing up
      float P = 6.2831853 * rr + 2.0 * (xb + hL), n = max(6.0, floor((6.2831853 * r + 4.0 * hL) / 0.9 + 0.5));
      per = P / n; ph = 0.8 * P * (1.0 - (1.0 - t) * (1.0 - t));   // a fast spin, slowing
      dashF = mix(0.5, 1.0, smoothstep(0.6, 0.95, t)); dashed = true;
      sAl = sAround(p, -hL, xb, rr);
      mW = smoothstep(0.75, 1.0, t);
    } else if (sty == 4) {
      d = sdCap(p, -hL, hL, r);
      float Ph = 3.1415927 * r + 2.0 * hL, S = Ph * (1.0 - pow(1.0 - clamp(t / 0.7, 0.0, 1.0), 2.2)), sh = sHalfC(p, hL, r);
      sHead = sh - S;
      liteO = exp(-pow(sHead / 0.45, 2.0)) * step(t, 0.7) * 1.4;   // the arms' bright heads
      float xf = -hL - r + (2.0 * hL + 2.0 * r) * smoothstep(0.45, 1.0, t);
      mW = clamp((xf - p.x) / 1.2 + 0.5, 0.0, 1.0);
    } else if (sty == 6) {
      d = sdCap(p, -hL, hL, r);
      mO = mW = t * t * (3.0 - 2.0 * t);
    } else {
      d = sdCap(p, -hL, hL, r);
      mO = mW = smoothstep(0.42, 0.7, t);
      lite = 0.9 * exp(-pow((t - 0.5) / 0.08, 2.0));
    }
    // the footprint across the edge, from the distance's own screen derivatives
    float aE = max(length(vec2(dFdx(d), dFdy(d))), 1e-6);
    float hw = max(hw0, 0.5 * uMinPx * aE), dO = abs(d) - hw;
    float cO = cov(dO, aE), inside = cov(d + hw, aE);
    if (dashed) {
      float aD = max(length(vec2(dFdx(sAl), dFdy(sAl))), 1e-5), w = mod(sAl - ph + 0.5 * per, per) - 0.5 * per;
      cO *= dashF > 0.999 ? 1.0 : cov(abs(w) - 0.5 * dashF * per, aD);
    }
    if (sty == 4) {
      float aS = max(length(vec2(dFdx(sHead), dFdy(sHead))), 1e-5);
      mO = cov(sHead, aS) * step(0.0001, t);
    }
    // the idle pulse: a soft wave of light running through the capsule from the marker to his man
    if (vB.z >= 0.0 && vB.z <= 1.0) {
      float xw = mix(-hL - r - 0.8, hL + r + 0.8, vB.z);
      float wv = exp(-pow((p.x - xw) / 0.8, 2.0));
      liteO += 0.55 * wv; lite += 0.6 * wv;
    }
    // the colour: the marker's team (vC1), or a gradient from it at his end to his man's team (vC2) at the other
    // (Yi, 2026-10-23), across the span between the two men; vD.x the blend (0 none, 1 OKLab, 2 round the hue)
    vec3 cc = gradMix(vC1.rgb, vC2.rgb, smoothstep(-hL, hL, p.x), vD.x);
    // light on the outline; inside, a flash thickens the paint (light added over the grass would turn it yellow-green)
    float cOm = cO * mO, cW = inside * min(0.6, vA.w * mW + 0.35 * lite);
    rgb = cc * (cOm + cW * (1.0 - cOm)); a = cOm + cW * (1.0 - cOm);
    float sg = uGlowSigma * vB.w, s = max(sg, min(uGlowPx * aE, 2.0 * sg));
    glow = cc * halo(max(dO, 0.0), s) * mO;
    lightAdd = mix(cc, vec3(1.0), 0.45) * (lite + liteO) * cOm * step(0.0001, t);
  }
  else if (kind == 8) {
    // the shot cone (Yi, 2026-10-22: a must, top priority): light from the shooter (at the origin, the axis towards the
    // goal) to the two posts; each defender and the keeper casts a shadow over the directions his body hides (the xG
    // model's own: 0.5 m half-width, cut to the goal mouth), beginning where he stands; thin edges to the posts. It
    // enters as a beam
    // sweeping out from the shooter, the shadows appearing as it passes each man (Yi: the shadows yes; a lit strip
    // on the goal line, no). vA: the posts (local metres); vB:
    // progress, the wash's alpha, the edges' half-width, the scale; vC1: the light's colour, the shadows' count in .w;
    // vC2: the shadows' tint and alpha; vD..vG: up to five shadows as (from angle, to angle, from distance); vG.w: the
    // radius it starts at, the shooter's inner ring (Yi: the cone must not step into the inner ring; cut at the band's
    // centreline, so the ring drawn over it buries the seam, the units' rule)
    vec2 P1 = vA.xy, P2 = vA.zw;
    float t = vB.x, wash = vB.y, hw0 = vB.z;
    int ns = int(vC1.w + 0.5);
    float S[15];
    S[0] = vD.x; S[1] = vD.y; S[2] = vD.z; S[3] = vD.w; S[4] = vE.x; S[5] = vE.y; S[6] = vE.z; S[7] = vE.w;
    S[8] = vF.x; S[9] = vF.y; S[10] = vF.z; S[11] = vF.w; S[12] = vG.x; S[13] = vG.y; S[14] = vG.z;
    float rho = length(p), th = atan(p.y, p.x), L = max(length(P1), length(P2));
    float t1 = atan(P1.y, P1.x), t2 = atan(P2.y, P2.x), tlo = min(t1, t2), thi = max(t1, t2);
    // the beam's front, soft, sweeping out to just past the goal line
    float R = (L + 1.5) * (1.0 - pow(1.0 - clamp(t / 0.7, 0.0, 1.0), 2.2)), reveal = clamp((R - rho) / 1.6 + 0.5, 0.0, 1.0);
    float dT = sdTri(p, vec2(0.0), P1, P2), aT = max(length(vec2(dFdx(dT), dFdy(dT))), 1e-6), cT = cov(dT, aT);
    // the shadows: the union over the men, each antialiased over its own distance's footprint
    float sh = 0.0;
    for (int i = 0; i < 5; i++) {
      if (i >= ns) break;
      float lo = S[i * 3], hi = S[i * 3 + 1], r0 = S[i * 3 + 2];
      float dAng = max(lo - th, th - hi) * max(rho, 0.3), dS = max(dAng, r0 - rho);
      float aS = max(length(vec2(dFdx(dS), dFdy(dS))), 1e-6);
      sh = max(sh, cov(dS, aS));
    }
    // the light: faint near the shooter, fuller towards the goal; the shadows a dark tint
    float lit = wash * mix(0.35, 1.0, clamp(rho / L, 0.0, 1.0)) * cT * (1.0 - sh) * reveal, dark = vC2.w * cT * sh * reveal;
    rgb = vC2.rgb * dark; a = dark;
    rgb = vC1.rgb * lit + rgb * (1.0 - lit); a = lit + a * (1.0 - lit);
    // the edges to the posts, drawn with the front (no arc at the apex: Yi, 2026-10-22, it looked odd; the angle's number
    // lies there alone)
    float aD = max(length(dx) + length(dy), 1e-6) * 0.7071;
    float hw = max(hw0, 0.5 * uMinPx * aD), dE = min(sdSegG(p, vec2(0.0), P1), sdSegG(p, vec2(0.0), P2)) - hw;
    float cE = cov(dE, aD) * 0.75 * reveal;
    rgb = vC1.rgb * cE + rgb * (1.0 - cE); a = cE + a * (1.0 - cE);
    float cut = cov(vG.w - rho, max(length(vec2(dFdx(rho), dFdy(rho))), 1e-6));
    rgb *= cut; a *= cut;
    float sg = uGlowSigma * vB.w, s = max(sg, min(uGlowPx * aD, 2.0 * sg));
    glow = vC1.rgb * halo(max(dE, 0.0), s) * reveal * 0.6 * cut;
    lightAdd = mix(vC1.rgb, vec3(1.0), 0.5) * exp(-pow((rho - R) / 0.9, 2.0)) * cT * (1.0 - sh) * 0.35 * (1.0 - smoothstep(0.6, 0.8, t)) * cut;
  }
  else if (kind == 9) {
    // a side's block (Yi, 2026-10-22: every player in it with the rotating ring, the ones on its edge joined by lines,
    // the diagonal stripes inside): pitch_prism's matte zebra clipped to the hull through the players, minus a disc at
    // every player's ring (the rings and the lines are drawn as their own marks). The stripes arrive in pitch_prism's
    // cascade, one after another across the block, each drawn along its length. vA, vD, vE, vF, vG: up to ten players
    // about the centroid (local metres), the hull's corners first, in order; vC1.w: the corners' count; vB: the stripes'
    // progress, the players' count, the discs' radius, the scale; vC2: the zebra's colour, its alpha in .w
    vec2 V[10];
    V[0] = vA.xy; V[1] = vA.zw; V[2] = vD.xy; V[3] = vD.zw; V[4] = vE.xy; V[5] = vE.zw; V[6] = vF.xy; V[7] = vF.zw; V[8] = vG.xy; V[9] = vG.zw;
    int nv = int(vC1.w + 0.5), np = int(vB.y + 0.5);
    float t = vB.x, rh = vB.z, Rm = 0.0, dHole = 1e9;
    for (int i = 0; i < 10; i++) {
      if (i >= np) break;
      Rm = max(Rm, length(V[i]));
      dHole = min(dHole, length(p - V[i]) - rh);
    }
    float d = max(sdPoly10(p, V, nv), -dHole);
    float aE = max(length(vec2(dFdx(d), dFdy(d))), 1e-6), inside = cov(d, aE) * step(0.0001, t);
    vec2 n = vec2(0.70710678, 0.70710678), m = vec2(-0.70710678, 0.70710678);
    float Wd = 0.68 * vB.w, aS = aaOf(n, dx, dy), per = 2.0 * Wd, q = dot(p, n), dS = abs(mod(q + 0.5 * per, per) - 0.5 * per) - 0.5 * Wd;
    float cS = mix(0.5, cov(dS, aS), smoothstep(2.0, 5.0, per / aS));
    // the cascade: the stripe's place across the block (0..1) and the point's place along it (0..1)
    float kq = clamp((q / max(Rm, 1e-3)) * 0.5 + 0.5, 0.0, 1.0), r = clamp((dot(p, m) / max(Rm, 1e-3)) * 0.5 + 0.5, 0.0, 1.0);
    float g = clamp(t * 1.6 - kq * 0.6, 0.0, 1.0);
    float mP = cov(r - g, aS / (2.0 * max(Rm, 1e-3)));
    float cP = inside * cS * mP * vC2.w;
    rgb = vC2.rgb * cP; a = cP;
  }
  else if (kind == 10) {
    // a line of chevrons (pressure: from the 5 m circle, A at -hL along the axis, in to a presser, B at +hL, pointing
    // on at the carrier), flowing towards B at the phase, cut at rA and rB from the ends and faded in near both. vA: half-length, the chevron's
    // half-width across, its stroke's half-width, the spacing; vB: drawn 0..1 from A, the phase (m), unused, the scale;
    // vC1: the colour; vC2.xy: rA, rB; vC2.z 1: one more chevron held still with its tip on B (a run to a chosen point)
    float hL = vA.x, cw = vA.y, sw0 = vA.z, per = vA.w, f = vB.x, ph = vB.y, rA = vC2.x, rB = vC2.y;
    float s0 = p.x + hL, L = 2.0 * hL, Lv = max(L - rA - rB, 0.0);
    float u = mod(s0 - rA - ph, per) - 0.5 * per;
    // one chevron per spacing: its apex ahead (towards B), its arms back at 45 degrees
    float dC = sdSegG(vec2(u, abs(p.y)), vec2(0.5 * cw, 0.0), vec2(-0.5 * cw, cw));
    // its pixel size from the direction away from the arm (chat 4, Yi 2026-10-26: dFdx(dC) spiked on the cell edges,
    // where u wraps from one chevron to the next, and the stroke's pixel floor drew faint lines there like guide lines)
    vec2 gC = gSegG(vec2(u, abs(p.y)), vec2(0.5 * cw, 0.0), vec2(-0.5 * cw, cw));
    float aE = aaOf(vec2(gC.x, p.y < 0.0 ? -gC.y : gC.y), dx, dy);
    float sw = max(sw0, 0.5 * uMinPx * aE), dS = dC - sw;
    // each chevron fades as a whole, by its own centre's place (Yi, 2026-10-23: tick by tick, not cut by a line across):
    // in near A, out over the last spacing and a half towards B, and drawn on one by one as the reveal passes it
    float sc = s0 - u, fe = min(1.5 * per, 0.4 * Lv);
    float ends = smoothstep(rA, rA + 0.5 * per, sc) * (1.0 - smoothstep(L - rB - fe, L - rB, sc));
    float shown = clamp((rA + f * Lv - sc) / (0.5 * per) + 0.5, 0.0, 1.0);
    ends *= shown;
    float dDraw = -1.0;
    // the end held (the pen's drag, Yi 2026-10-25): the flowing chevrons gone a spacing short of the still one
    float scF = L - rB - 0.5 * cw;
    if (vC2.z > 0.5) ends *= 1.0 - smoothstep(scF - 1.3 * per, scF - 0.55 * per, sc);
    float c = cov(dS, aE) * ends * step(0.001, f);
    float sg = uGlowSigma * vB.w, s = max(sg, min(uGlowPx * aE, 2.0 * sg));
    glow = vC1.rgb * halo(max(max(dS, dDraw), 0.0), s) * ends * step(0.001, f);
    if (vC2.z > 0.5) {
      // a still chevron with its tip on B, at full strength, arriving as the draw-on reaches it
      float dF = sdSegG(vec2(s0 - scF, abs(p.y)), vec2(0.5 * cw, 0.0), vec2(-0.5 * cw, cw)) - sw;
      float aF = max(length(vec2(dFdx(dF), dFdy(dF))), 1e-6), inF = clamp((rA + f * Lv - scF) / (0.5 * per) + 0.5, 0.0, 1.0) * step(0.001, f);
      c = max(c, cov(dF, aF) * inF);
      glow = max(glow, vC1.rgb * halo(max(dF, 0.0), s) * inF);
    }
    rgb = vC1.rgb * c; a = c;
  }
  else if (kind == 11) {
    // an arrow on the pitch (pitch_prism's locked arrows, freeze/arrows.py): a barbed head (tip, two barbs at the
    // spread, a notched rear edge) on a shaft of width w, the arrow drawn on from the tail (the head arriving at full
    // size as the reveal reaches it). Style 0 pass: a solid ribbon to the notch, merged with the head, its tail
    // dissolving over a share of the shaft; style 1 run: octagon dashes laid from the notch backwards (the first one
    // always butting onto the head), each chamfer parallel to the head's rear edges, marching towards the head.
    // vA: half-length, width, head size, notch share; vB: drawn 0..1, style, the dashes' phase (m), the scale; vC1: the
    // colour; vC2: spread (rad), dash period, dash length, tail fade share (the head alone: 1 drops its glow, the pen's
    // strokes)
    float hL = vA.x, w = vA.y, S = vA.z, nf = vA.w, t = vB.x, ph = vB.z, sp = vC2.x, Pd = vC2.y, Dd = vC2.z, tf = vC2.w;
    int sty = int(vB.y + 0.5);
    float xTip = -hL + 2.0 * hL * t;
    vec2 tip = vec2(xTip, 0.0);
    vec2 H[10];
    H[0] = tip; H[1] = tip + S * vec2(-cos(sp), sin(sp)); H[2] = tip - vec2(S * nf, 0.0); H[3] = tip + S * vec2(-cos(sp), -sin(sp));
    H[4] = H[5] = H[6] = H[7] = H[8] = H[9] = vec2(0.0);
    float dHead = sdPoly10(p, H, 4), xN = H[2].x, shaft = max(xN + hL, 1e-3), d, fade = 1.0;
    if (sty == 2) {
      // one run dash on its own (a curved run places each dash along the path): an octagon of half-length hL
      float f = 0.3 * w, ratio = abs(cos(sp) - nf) / max(sin(sp), 1e-4), dc = min(ratio * (0.5 * w - f), hL);
      vec2 q = vec2(abs(p.x), abs(p.y));
      d = max(max(q.x - hL, q.y - 0.5 * w), dot(q - vec2(hL, f), normalize(vec2(0.5 * w - f, dc))));
    } else if (sty == 3) {
      // the head alone, its tip at +hL
      H[0] = vec2(hL, 0.0); H[1] = H[0] + S * vec2(-cos(sp), sin(sp)); H[2] = H[0] - vec2(S * nf, 0.0); H[3] = H[0] + S * vec2(-cos(sp), -sin(sp));
      d = sdPoly10(p, H, 4);
    } else if (sty == 0) {
      float dS = max(max(-hL - p.x, p.x - (xN + 0.05 * S)), abs(p.y) - 0.5 * w);
      d = min(dHead, dS);
      fade = max(smoothstep(0.0, tf * shaft, p.x + hL), step(xN, p.x));
    } else {
      float dO = 1e3;
      if (p.x < xN) {
        float s = xN - p.x, kk = floor((s + ph) / Pd);
        float fs = max(0.0, kk * Pd - ph), rs = kk * Pd - ph + Dd;
        float xf = xN - fs, xr = max(xN - rs, -hL);
        if (xf - xr > 0.005) {
          float c = 0.5 * (xf + xr), hd = 0.5 * (xf - xr), f = 0.3 * w;
          float ratio = abs(cos(sp) - nf) / max(sin(sp), 1e-4), dc = min(ratio * (0.5 * w - f), hd);
          vec2 q = vec2(abs(p.x - c), abs(p.y));
          float box = max(q.x - hd, q.y - 0.5 * w);
          vec2 nrm = normalize(vec2(0.5 * w - f, dc));
          dO = max(box, dot(q - vec2(hd, f), nrm));
        }
      }
      d = min(dHead, dO);
    }
    if (t <= 0.001) d = 1e3;
    float aE = max(length(vec2(dFdx(d), dFdy(d))), 1e-6);
    float cv = cov(d, aE) * fade;
    rgb = vC1.rgb * cv; a = cv;
    float s = max(0.55 * w, min(uGlowPx * aE, 1.1 * w));
    glow = vC1.rgb * halo(max(d, 0.0), s) * 0.3 / max(uGlow, 1e-3) * fade * (sty == 3 ? 1.0 - vC2.w : 1.0);
  }
  else if (kind == 12) {
    // a presser's mark (Yi, 2026-10-22: the carrier keeps the light column; the defenders need their own look). Mode 0,
    // the wedge: from the presser (A at -hL) a beam of his team colour narrowing to a point at the carrier (B at +hL,
    // cut rB short), strongest near the carrier, growing out from the presser as it draws. Mode 1, the threat arc: on a
    // ring of radius R round the carrier (the frame's origin), an arc facing the presser (the axis), its half-angle
    // opening as it draws. vA: half-length or ring radius, the wedge's half-width at A or the arc's half-angle, the band's
    // half-width, intensity 0..1; vB: drawn 0..1, mode, rB, the scale; vC1: the colour
    float t = vB.x, I = vA.w, d, fill = 1.0, edge = 1.0;
    int md = int(vB.y + 0.5);
    if (md == 0) {
      float hL = vA.x, wA = vA.y, rB = vB.z, xEnd = -hL + (2.0 * hL - rB) * t;
      float u = clamp((p.x + hL) / max(2.0 * hL - rB, 1e-3), 0.0, 1.0), hw = wA * (1.0 - u);
      d = max(abs(p.y) - hw, max(-hL - p.x, p.x - xEnd));
      fill = mix(0.35, 1.0, u);
    } else {
      float R = vA.x, ha = vA.y * t, bw = vA.z, r = length(p), ang = abs(atan(p.y, p.x));
      d = max(abs(r - R) - bw, (ang - ha) * R);
      edge = 1.0 - 0.5 * smoothstep(0.0, ha * R, ang * R);
    }
    float aE = max(length(vec2(dFdx(d), dFdy(d))), 1e-5);
    float cv = cov(d, aE) * step(0.001, t) * (0.35 + 0.65 * I) * fill * edge;
    rgb = vC1.rgb * cv * (md == 0 ? 0.55 : 1.0); a = cv * (md == 0 ? 0.55 : 1.0);
    float s = max(uGlowSigma * vB.w, min(uGlowPx * aE, 2.0 * uGlowSigma * vB.w));
    glow = vC1.rgb * halo(max(d, 0.0), s * 1.5) * step(0.001, t) * (0.35 + 0.65 * I) * fill * edge;
  }
  else if (kind == 14) {
    // a round zone (the Tactics pen's circle, Yi 2026-10-25): the zones' look (kind 6, shown whole) on a disc: the solid
    // edge and the matte zebra inside, its stripes in phase with every other zone's. vA: radius, edge half-width, stripe
    // width, paint alpha; vB.w: the scale; vC1: the edge's colour; vC2: the paint's; vD.xy: the stripes' normal, vD.z
    // their phase at the centre
    float R = vA.x, hw0 = vA.y, Wd = vA.z, dVis = length(p) - R;
    float aE = max(length(vec2(dFdx(dVis), dFdy(dVis))), 1e-6);
    float hw = max(hw0, 0.5 * uMinPx * aE), dOut = abs(dVis) - hw;
    float cO = cov(dOut, aE), inside = cov(dVis + hw, aE);
    float aS = aaOf(vD.xy, dx, dy), per = 2.0 * Wd, q = vD.z + dot(p, vD.xy), dS = abs(mod(q + 0.5 * per, per) - 0.5 * per) - 0.5 * Wd;
    float cS = mix(0.5, cov(dS, aS), smoothstep(2.0, 5.0, per / aS));
    float cP = inside * cS * vA.w;
    rgb = vC1.rgb * cO + vC2.rgb * cP * (1.0 - cO);
    a = cO + cP * (1.0 - cO);
    float sgm = uGlowSigma * vB.w, s = max(sgm, min(uGlowPx * aE, 2.0 * sgm));
    glow = vC1.rgb * halo(max(dOut, 0.0), s);
  }
  else if (kind == 15) {
    // a gauge on the pitch (a number for the Explain chat, Yi 2026-10-26): a band (mode 0) or a filled sector (mode 1)
    // round the centre, from the local +x axis (the screen's up, the caller sets the frame) turning clockwise on screen
    // (vB.y the sign) over the share vB.x, over a faint track (vC2, its alpha in .w) for the rest. vA: radius, band
    // half-width, the sector's inner radius; vB.z mode; vB.w the scale; vC1 the fill's colour, its alpha in .w
    float r = length(p), share = clamp(vB.x, 0.0, 1.0), mode = vB.z;
    float ang = atan(p.y * vB.y, p.x); if (ang < 0.0) ang += 6.2831853;
    float aR = aaOf(r > 1e-5 ? p / r : vec2(1.0, 0.0), dx, dy), hw = max(vA.y, 0.5 * uMinPx * aR);
    float dShape = mode < 0.5 ? abs(r - vA.x) - hw : r - vA.x;
    float inShape = cov(dShape, aR);
    // the angular edge, as arc length at this radius, antialiased over the pixel's footprint along it
    float sEnd = (share * 6.2831853 - ang) * max(r, 1e-3), aT = aaOf(r > 1e-5 ? vec2(-p.y, p.x) / r : vec2(0.0, 1.0), dx, dy);
    float on = share >= 0.9999 ? 1.0 : cov(-sEnd, aT) * cov(-ang * max(r, 1e-3), aT) * step(0.0001, share);
    float cF = inShape * on * vC1.w, cT = inShape * (1.0 - on) * vC2.w;
    rgb = vC1.rgb * cF + vC2.rgb * cT; a = cF + cT;
  }
  else if (kind == 13) {
    // a marking pair, round three (Yi, 2026-10-24: more options than the capsule), from A (the marker, at -hL along the
    // axis) to B (his man, +hL); no glow. vA: half-length, the pool's radius, the line's half-width, the pool's core
    // alpha; vB: the fade 0..1, the look (0 dumbbell, 1 guard, 2 pool, 3 line, 4 hoops); vC1, vC2: the marker's and
    // his man's team colours; vD: the gradient's mode, the dots' radius, the cut round the feet, the arc's radius; vE:
    // the arc's half-width, its half-angle (radians), the hoops' radius
    float hL = vA.x, t = clamp(vB.x, 0.0, 1.0), f = t * t * (3.0 - 2.0 * t);
    int look = int(vB.y + 0.5);
    vec2 pa = p - vec2(-hL, 0.0), pb = p - vec2(hL, 0.0);
    // the gradient from the marker's team at his end to his man's at the other; the guard all in the marker's colour
    vec3 cc = look == 1 ? vC1.rgb : gradMix(vC1.rgb, vC2.rgb, smoothstep(-hL, hL, p.x), vD.x);
    float c;
    if (look == 2) {
      // a soft pool round the pair: clear at the edge, vA.w from 55% of the radius in
      float d = sdCap(p, -hL, hL, vA.y);
      c = vA.w * smoothstep(0.0, 0.55 * vA.y, -d);
    } else {
      // the slim line, round-ended: from the marker's cut (none for the dumbbell, its dots cover the ends; the hoops'
      // radius) to his man's cut, or to the arc (guard), where it has faded to 40%
      float cut = look == 0 ? 0.0 : look == 4 ? vE.z : vD.z, x0 = -hL + cut, x1 = look == 1 ? hL - vD.w : hL - cut;
      float sx = clamp(p.x, x0, max(x0, x1)), dl = length(vec2(p.x - sx, p.y));
      float aL = max(length(vec2(dFdx(dl), dFdy(dl))), 1e-6), lw = max(vA.z, 0.5 * uMinPx * aL);
      c = cov(dl - lw, aL) * step(x0, x1);
      if (look == 1) c *= mix(0.95, 0.4, clamp((p.x - x0) / max(x1 - x0, 1e-3), 0.0, 1.0));
      // the dumbbell's dots under both men
      float dD = min(length(pa), length(pb)) - vD.y, aD = max(length(vec2(dFdx(dD), dFdy(dD))), 1e-6);
      if (look == 0) c = max(c, 0.9 * cov(dD, aD));
      // the guard's arc round his man, centred on the marker's side, its ends tapering
      float dr = abs(length(pb) - vD.w), aR = max(length(vec2(dFdx(dr), dFdy(dr))), 1e-6), aw = max(vE.x, 0.5 * uMinPx * aR);
      float ang = abs(atan(pb.y, -pb.x));
      if (look == 1) c = max(c, cov(dr - aw, aR) * (1.0 - smoothstep(0.55 * vE.y, vE.y, ang)));
      // the hoops: a thin plain ring under each man, as wide as the line
      float dH = min(abs(length(pa) - vE.z), abs(length(pb) - vE.z)), aH = max(length(vec2(dFdx(dH), dFdy(dH))), 1e-6), hh = max(vA.z, 0.5 * uMinPx * aH);
      if (look == 4) c = max(c, cov(dH - hh, aH));
    }
    c *= f;
    rgb = cc * c; a = c;
  }
  float k = vBox.w;
  vec3 col = (rgb + glow * uGlow * (1.0 - a) + lightAdd * (1.0 - a)) * k;
  float al = a * k;
  if (uDebug > 0.5) { col = mix(vec3(0.5, 0.0, 0.0), col, al); al = max(al, 0.5); }   // ?dbg=1: the quads show
  if (al < 0.002 && max(col.r, max(col.g, col.b)) < 0.002) discard;
  gl_FragColor = vec4(col, al);
}`;

const ZERO16 = new Float32Array(16);

export class GroundLayer {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private attrs: Record<'iFrame' | 'iBox' | 'iA' | 'iB' | 'iC1' | 'iC2' | 'iD' | 'iE' | 'iF' | 'iG', THREE.InstancedBufferAttribute>;
  private n = 0;
  constructor(private max = 512) {
    const plane = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = plane.index; this.geo.setAttribute('position', plane.getAttribute('position'));
    const mk = () => new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.attrs = { iFrame: mk(), iBox: mk(), iA: mk(), iB: mk(), iC1: mk(), iC2: mk(), iD: mk(), iE: mk(), iF: mk(), iG: mk() };
    for (const [k, v] of Object.entries(this.attrs)) this.geo.setAttribute(k, v);
    this.geo.instanceCount = 0;
    // double-sided: the quad's local y runs along the scene's z, which mirrors its winding seen from above
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, transparent: true, depthWrite: false, depthTest: true, premultipliedAlpha: true,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4, toneMapped: false, fog: false,
      uniforms: { uMinPx: { value: 1.5 }, uGlowPx: { value: 2 }, uGlowSigma: { value: 0.17 }, uGlow: { value: 0.1 }, uDebug: { value: new URLSearchParams(location.search).get('dbg') === '1' ? 1 : 0 } },
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 8;
  }
  get count() { return this.n; }
  begin() { this.n = 0; }
  /** add one mark; returns false when the layer is full. X: a polygon zone's 16 further values (iD, iE, iF, iG) */
  push(frame: [number, number, number, number], box: [number, number, number, number], A: ArrayLike<number>, B: ArrayLike<number>, C1: ArrayLike<number>, C2: ArrayLike<number>, X: ArrayLike<number> = ZERO16) {
    if (this.n >= this.max) return false;
    const o = this.n * 4, at = this.attrs;
    (at.iFrame.array as Float32Array).set(frame, o); (at.iBox.array as Float32Array).set(box, o);
    (at.iA.array as Float32Array).set(A, o); (at.iB.array as Float32Array).set(B, o);
    (at.iC1.array as Float32Array).set(C1, o); (at.iC2.array as Float32Array).set(C2, o);
    for (let j = 0; j < 4; j++) for (let c = 0; c < 4; c++) (at[(['iD', 'iE', 'iF', 'iG'] as const)[j]].array as Float32Array)[o + c] = X[j * 4 + c] ?? 0;
    this.n++;
    return true;
  }
  end() {
    for (const a of Object.values(this.attrs)) { a.clearUpdateRanges(); a.addUpdateRange(0, this.n * 4); a.needsUpdate = true; }
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
  }
  dispose() { this.geo.dispose(); this.material.dispose(); }
}
