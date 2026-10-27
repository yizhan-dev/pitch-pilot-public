// The player response model in the browser: the same computation as private/response/respond.py (model v2, follow
// coupling, physical limits), so a dragged player or a redirected pass can be answered live, with no server.
// Coordinates are metres in the attacking frame (the team in possession attacks +x), attackers 0-10, defenders 11-21.
// The weights come from models/response/ (trained on real tracking: local use only).
// No static imports, and type annotations only, so node can run it directly for the parity test.

export const PAST = 4, FUT = 20, DT = 0.1;
const SX = 52.5, SY = 34, NEAR = 15, D_MODEL = 128, HEADS = 4, TOK_F = 178, BALL_F = 66;

export type XY = [number, number];
export interface Manifest {
  tensors: { name: string; shape: number[]; offset: number }[];
  coupling: { edges: number[]; K: number[][] };
  limits: { vmax: number; amax: number; minGap: number };
}
export interface Model { w: Record<string, Float32Array>; man: Manifest }
/** the state at the pause: players at frames PAST-4..PAST ([5][22] positions), the ball [25] (x, y, z): 0.4 s before
 *  the pause to 2 s after it, the keepers */
export interface Scene { P: XY[][]; B: [number, number, number][]; gk: boolean[] }

export function makeModel(man: Manifest, buf: ArrayBuffer): Model {
  const all = new Float32Array(buf), w: Record<string, Float32Array> = {};
  for (const t of man.tensors) { const n = t.shape.reduce((a, b) => a * b, 1); w[t.name] = all.subarray(t.offset, t.offset + n); }
  return { w, man };
}

export async function loadModel(base?: string): Promise<Model> {
  base ??= (await import('../data/paths')).modelFile('response');
  const [man, buf] = await Promise.all([fetch(`${base}/model.json`).then((r) => r.json()), fetch(`${base}/model.bin`).then((r) => r.arrayBuffer())]);
  return makeModel(man, buf);
}

// ---- small dense helpers: rows of a row-major matrix [n][d]
function linear(x: Float64Array, n: number, din: number, W: Float32Array, b: Float32Array, dout: number): Float64Array {
  const y = new Float64Array(n * dout);
  for (let r = 0; r < n; r++) for (let o = 0; o < dout; o++) {
    let s = b[o]; const xo = r * din, wo = o * din;
    for (let k = 0; k < din; k++) s += x[xo + k] * W[wo + k];
    y[r * dout + o] = s;
  }
  return y;
}
function erf(x: number) {                     // Abramowitz and Stegun 7.1.26, |error| < 1.5e-7
  const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a));
}
const gelu = (x: Float64Array) => { for (let i = 0; i < x.length; i++) x[i] = 0.5 * x[i] * (1 + erf(x[i] / Math.SQRT2)); return x; };
const relu = (x: Float64Array) => { for (let i = 0; i < x.length; i++) if (x[i] < 0) x[i] = 0; return x; };
function layerNorm(x: Float64Array, n: number, d: number, g: Float32Array, b: Float32Array): Float64Array {
  const y = new Float64Array(n * d);
  for (let r = 0; r < n; r++) {
    let m = 0, v = 0; for (let k = 0; k < d; k++) m += x[r * d + k]; m /= d;
    for (let k = 0; k < d; k++) { const e = x[r * d + k] - m; v += e * e; } v /= d;
    const inv = 1 / Math.sqrt(v + 1e-5);
    for (let k = 0; k < d; k++) y[r * d + k] = (x[r * d + k] - m) * inv * g[k] + b[k];
  }
  return y;
}

/** the 178 features of each player token and the 66 of the ball token, exactly as model.py features() */
function features(s: Scene, cmask: boolean[], cpath: XY[][], ballKnown: boolean) {
  const { P, B, gk } = s, bk = ballKnown ? 1 : 0;
  const cur = P[PAST], v1 = cur.map((c, i) => [(c[0] - P[PAST - 1][i][0]) / DT, (c[1] - P[PAST - 1][i][1]) / DT]);
  const v4 = cur.map((c, i) => [(c[0] - P[0][i][0]) / (PAST * DT), (c[1] - P[0][i][1]) / (PAST * DT)]);
  const vp = P[PAST - 1].map((c, i) => [(c[0] - P[PAST - 2][i][0]) / DT, (c[1] - P[PAST - 2][i][1]) / DT]);
  const b0 = B[PAST];
  const tok = new Float64Array(22 * TOK_F);
  for (let i = 0; i < 22; i++) {
    const f: number[] = [];
    const c = cur[i], rb = [(c[0] - b0[0]) / 20, (c[1] - b0[1]) / 20];
    f.push(c[0] / SX, c[1] / SY, v1[i][0] / 8, v1[i][1] / 8, v4[i][0] / 8, v4[i][1] / 8,
      (v1[i][0] - vp[i][0]) / DT / 10, (v1[i][1] - vp[i][1]) / DT / 10, i < 11 ? 1 : 0, gk[i] ? 1 : 0, rb[0], rb[1], Math.hypot(rb[0], rb[1]));
    for (let t = 0; t < FUT; t++) { const q = B[PAST + 1 + t]; f.push((q[0] - c[0]) / 30 * bk, (q[1] - c[1]) / 30 * bk); }
    f.push(bk, cmask[i] ? 1 : 0);
    for (let t = 0; t < FUT; t++) f.push(cmask[i] ? (cpath[i][t][0] - c[0]) / 10 : 0, cmask[i] ? (cpath[i][t][1] - c[1]) / 10 : 0);
    // the nearest other controlled player within NEAR m
    let best = -1, dmin = Infinity;
    for (let j = 0; j < 22; j++) { const dd = Math.hypot(cur[j][0] - c[0], cur[j][1] - c[1]) + (j === i ? 1e6 : 0) + (cmask[j] ? 0 : 1e6); if (dd < dmin) { dmin = dd; best = j; } }
    const has = dmin < NEAR ? 1 : 0, n = cur[best], nv = v1[best];
    f.push(has, (n[0] - c[0]) / 10 * has, (n[1] - c[1]) / 10 * has);
    for (let t = 0; t < FUT; t++) { const q = has ? cpath[best][t] : [0, 0]; f.push(has ? (q[0] - c[0]) / 10 : 0, has ? (q[1] - c[1]) / 10 : 0); }
    for (let t = 0; t < FUT; t++) { const q = has ? cpath[best][t] : [0, 0], tt = (t + 1) * DT; f.push(has ? (q[0] - (n[0] + nv[0] * tt)) / 5 : 0, has ? (q[1] - (n[1] + nv[1] * tt)) / 5 : 0); }
    tok.set(f, i * TOK_F);
  }
  const bt = [b0[0] / SX, b0[1] / SY, b0[2] / 3, (b0[0] - B[PAST - 1][0]) / DT / 30, (b0[1] - B[PAST - 1][1]) / DT / 30];
  for (let t = 0; t < FUT; t++) { const q = B[PAST + 1 + t]; bt.push((q[0] - b0[0]) / 20 * bk, (q[1] - b0[1]) / 20 * bk, (q[2] - b0[2]) / 3 * bk); }
  bt.push(bk);
  return { tok, ball: Float64Array.from(bt), cur, v1 };
}

/** the transformer alone: every player's next 2 s ([22][20] positions), controlled players kept on their paths */
export function forward(m: Model, s: Scene, cmask: boolean[], cpath: XY[][], ballKnown = true): XY[][] {
  const { w } = m, d = D_MODEL, N = 23, hd = d / HEADS;
  const { tok, ball, cur, v1 } = features(s, cmask, cpath, ballKnown);
  const e = linear(gelu(linear(tok, 22, TOK_F, w['emb.0.weight'], w['emb.0.bias'], d)), 22, d, w['emb.2.weight'], w['emb.2.bias'], d);
  const be = linear(gelu(linear(ball, 1, BALL_F, w['bemb.0.weight'], w['bemb.0.bias'], d)), 1, d, w['bemb.2.weight'], w['bemb.2.bias'], d);
  let x = new Float64Array(N * d); x.set(e, 0); x.set(be, 22 * d);
  for (let L = 0; L < 4; L++) {
    const p = `tr.layers.${L}.`;
    const h = layerNorm(x, N, d, w[p + 'norm1.weight'], w[p + 'norm1.bias']);
    const qkv = linear(h, N, d, w[p + 'self_attn.in_proj_weight'], w[p + 'self_attn.in_proj_bias'], 3 * d);
    const att = new Float64Array(N * d), sc = new Float64Array(N), scale = 1 / Math.sqrt(hd);
    for (let hh = 0; hh < HEADS; hh++) for (let i = 0; i < N; i++) {
      let mx = -Infinity;
      for (let j = 0; j < N; j++) { let s2 = 0; for (let k = 0; k < hd; k++) s2 += qkv[i * 3 * d + hh * hd + k] * qkv[j * 3 * d + d + hh * hd + k]; sc[j] = s2 * scale; if (sc[j] > mx) mx = sc[j]; }
      let z = 0; for (let j = 0; j < N; j++) { sc[j] = Math.exp(sc[j] - mx); z += sc[j]; }
      for (let k = 0; k < hd; k++) { let s2 = 0; for (let j = 0; j < N; j++) s2 += sc[j] * qkv[j * 3 * d + 2 * d + hh * hd + k]; att[i * d + hh * hd + k] = s2 / z; }
    }
    const o = linear(att, N, d, w[p + 'self_attn.out_proj.weight'], w[p + 'self_attn.out_proj.bias'], d);
    for (let i = 0; i < x.length; i++) x[i] += o[i];
    const h2 = layerNorm(x, N, d, w[p + 'norm2.weight'], w[p + 'norm2.bias']);
    const f = linear(relu(linear(h2, N, d, w[p + 'linear1.weight'], w[p + 'linear1.bias'], 2 * d)), N, 2 * d, w[p + 'linear2.weight'], w[p + 'linear2.bias'], d);
    for (let i = 0; i < x.length; i++) x[i] += f[i];
  }
  x = x.subarray(0, 22 * d) as Float64Array;
  const hn = layerNorm(x, 22, d, w['head.0.weight'], w['head.0.bias']);
  const delta = linear(gelu(linear(hn, 22, d, w['head.1.weight'], w['head.1.bias'], d)), 22, d, w['head.3.weight'], w['head.3.bias'], FUT * 2);
  return cur.map((c, i) => cmask[i] ? cpath[i].map((q) => [q[0], q[1]] as XY)
    : Array.from({ length: FUT }, (_, t) => [c[0] + v1[i][0] * (t + 1) * DT + delta[i * 40 + t * 2] * 3, c[1] + v1[i][1] * (t + 1) * DT + delta[i * 40 + t * 2 + 1] * 3] as XY));
}

/** the follow coupling (coupling.py): each outfield defender gains sum_c k_t[bin] (cpath_c - base_c) over the controlled attackers */
function coupling(m: Model, s: Scene, base: XY[][], cmask: boolean[], cpath: XY[][]) {
  const { edges, K } = m.man.coupling, cur = s.P[PAST], gk = s.gk;
  const D = Array.from({ length: 11 }, (_, a) => Array.from({ length: 11 }, (_, j) => gk[11 + a] || gk[j] ? Infinity : Math.hypot(cur[11 + a][0] - cur[j][0], cur[11 + a][1] - cur[j][1])));
  const argmin = (a: number[]) => a.reduce((bi, v, i) => (v < a[bi] ? i : bi), 0);
  const nearAtt = D.map((row) => argmin(row)), nearDef = Array.from({ length: 11 }, (_, j) => argmin(D.map((row) => row[j])));
  const Y: XY[][] = Array.from({ length: 11 }, () => Array.from({ length: FUT }, () => [0, 0] as XY));
  for (let a = 0; a < 11; a++) {
    if (gk[11 + a]) continue;
    for (let j = 0; j < 11; j++) {
      if (!cmask[j]) continue;
      const dd = D[a][j]; let db = -1;
      for (let e = 0; e < edges.length - 1; e++) if (dd >= edges[e] && dd < edges[e + 1]) db = e;
      if (db < 0) continue;
      const b = db * 2 + (nearDef[j] === a && nearAtt[a] === j ? 1 : 0);
      for (let t = 0; t < FUT; t++) { const k = K[t][b]; Y[a][t][0] += k * (cpath[j][t][0] - base[j][t][0]); Y[a][t][1] += k * (cpath[j][t][1] - base[j][t][1]); }
    }
  }
  return Y;
}

/** speed and acceleration limits along each path, then players pushed apart (respond.py limits) */
function limits(m: Model, s: Scene, out: XY[][], fixed: boolean[]): XY[][] {
  const { vmax, amax, minGap } = m.man.limits, P = s.P;
  const res = out.map((p) => p.map((q) => [q[0], q[1]] as XY));
  let prev = P[PAST].map((q) => [q[0], q[1]] as XY), vprev = P[PAST].map((q, i) => [(q[0] - P[PAST - 1][i][0]) / DT, (q[1] - P[PAST - 1][i][1]) / DT] as XY);
  for (let t = 0; t < FUT; t++) {
    let nxt = res.map((p, i) => {
      if (fixed[i]) return [p[t][0], p[t][1]] as XY;
      let vx = (p[t][0] - prev[i][0]) / DT, vy = (p[t][1] - prev[i][1]) / DT;
      const dx = vx - vprev[i][0], dy = vy - vprev[i][1], a = Math.hypot(dx, dy), ka = Math.min(1, amax * DT / Math.max(a, 1e-9));
      vx = vprev[i][0] + dx * ka; vy = vprev[i][1] + dy * ka;
      const sp = Math.hypot(vx, vy), ks = Math.min(1, vmax / Math.max(sp, 1e-9));
      return [prev[i][0] + vx * ks * DT, prev[i][1] + vy * ks * DT] as XY;
    });
    for (let it = 0; it < 3; it++) {
      nxt = nxt.map((q, i) => {
        if (fixed[i]) return q;
        let px = 0, py = 0;
        for (let j = 0; j < 22; j++) {
          if (j === i) continue;
          const dx = q[0] - nxt[j][0], dy = q[1] - nxt[j][1], dist = Math.hypot(dx, dy), push = Math.max(0, minGap - dist);
          if (push > 0) { px += push * dx / Math.max(dist, 1e-6) * 0.5; py += push * dy / Math.max(dist, 1e-6) * 0.5; }
        }
        return [q[0] + px, q[1] + py] as XY;
      });
    }
    vprev = nxt.map((q, i) => [(q[0] - prev[i][0]) / DT, (q[1] - prev[i][1]) / DT] as XY); prev = nxt;
    nxt.forEach((q, i) => { res[i][t] = q; });
  }
  return res;
}

/** the full response: the model with the given ball path, the follow coupling for controlled attackers, the limits.
 *  Returns every player's next 2 s ([22][20]) and the model's answer before the coupling. */
export function respond(m: Model, s: Scene, cmask?: boolean[], cpath?: XY[][]) {
  const cm = cmask ?? Array(22).fill(false), cp = cpath ?? Array.from({ length: 22 }, () => Array.from({ length: FUT }, () => [0, 0] as XY));
  const base = forward(m, s, Array(22).fill(false), cp, true);
  let out = base.map((p) => p.map((q) => [q[0], q[1]] as XY));
  if (cm.some(Boolean)) {
    const Y = coupling(m, s, base, cm, cp);
    for (let a = 0; a < 11; a++) for (let t = 0; t < FUT; t++) { out[11 + a][t][0] += Y[a][t][0]; out[11 + a][t][1] += Y[a][t][1]; }
    out = out.map((p, i) => (cm[i] ? cp[i].map((q) => [q[0], q[1]] as XY) : p));
  }
  return { out: limits(m, s, out, cm), base };
}
