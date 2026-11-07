/**
 * UE FTransform in UE space: rotation (row-major 3x3, column-vector form), per-axis scale, translation.
 * p' = R·(s ⊙ p) + t
 */
export interface Xform {
  r: number[]; // 9
  s: [number, number, number];
  t: [number, number, number];
}

export const IDENTITY: Xform = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], s: [1, 1, 1], t: [0, 0, 0] };

/** From location, rotator (pitch,yaw,roll in degrees), scale — as UE FRotator / FRotationMatrix. */
export function fromLocRotScale(
  loc: [number, number, number] = [0, 0, 0],
  rot: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): Xform {
  const d = Math.PI / 180;
  const [p, y, r] = rot;
  const SP = Math.sin(p * d), CP = Math.cos(p * d);
  const SY = Math.sin(y * d), CY = Math.cos(y * d);
  const SR = Math.sin(r * d), CR = Math.cos(r * d);
  // UE rows (row-vector convention) = images of local X, Y, Z axes.
  const r0 = [CP * CY, CP * SY, SP];
  const r1 = [SR * SP * CY - CR * SY, SR * SP * SY + CR * CY, -SR * CP];
  const r2 = [-(CR * SP * CY + SR * SY), CY * SR - CR * SP * SY, CR * CP];
  // Column-vector rotation: column i = row i.
  return {
    r: [r0[0], r1[0], r2[0], r0[1], r1[1], r2[1], r0[2], r1[2], r2[2]],
    s: [...scale],
    t: [...loc],
  };
}

/** From FTransform (quat x,y,z,w; translation; scale). */
export function fromQuat(
  q: [number, number, number, number] = [0, 0, 0, 1],
  t: [number, number, number] = [0, 0, 0],
  s: [number, number, number] = [1, 1, 1],
): Xform {
  const [x, y, z, w] = q;
  return {
    r: [
      1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
    ],
    s: [...s],
    t: [...t],
  };
}

function mul3(A: number[], B: number[]): number[] {
  const out = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) out[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return out;
}

/**
 * parent ∘ child, using UE's FTransform rule (no shear):
 * R = Rp·Rc, S = Sp ⊙ Sc, T = Rp·(Sp ⊙ Tc) + Tp.
 */
export function compose(parent: Xform, child: Xform): Xform {
  const R = parent.r;
  const st = [parent.s[0] * child.t[0], parent.s[1] * child.t[1], parent.s[2] * child.t[2]];
  return {
    r: mul3(parent.r, child.r),
    s: [parent.s[0] * child.s[0], parent.s[1] * child.s[1], parent.s[2] * child.s[2]],
    t: [
      R[0] * st[0] + R[1] * st[1] + R[2] * st[2] + parent.t[0],
      R[3] * st[0] + R[4] * st[1] + R[5] * st[2] + parent.t[1],
      R[6] * st[0] + R[7] * st[1] + R[8] * st[2] + parent.t[2],
    ],
  };
}

/** Linear part A = R·diag(s), row-major. */
export function linear(x: Xform): number[] {
  const { r, s } = x;
  return [r[0] * s[0], r[1] * s[1], r[2] * s[2], r[3] * s[0], r[4] * s[1], r[5] * s[2], r[6] * s[0], r[7] * s[1], r[8] * s[2]];
}

/** UE cm → metres. */
export const UNIT = 0.01;

/**
 * Convert to a three.js column-major Matrix4 array.
 * three space = S·ue·UNIT, where S swaps Y and Z (Z-up left-handed → Y-up right-handed).
 * Geometry must be converted with the same S.
 */
export function toThreeMatrix(x: Xform): number[] {
  const A = linear(x);
  // B = S A S  (swap rows 1,2 and columns 1,2)
  const idx = [0, 2, 1];
  const B = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) B[i * 3 + j] = A[idx[i] * 3 + idx[j]];
  const t = [x.t[0] * UNIT, x.t[2] * UNIT, x.t[1] * UNIT];
  // column-major 4x4
  return [B[0], B[3], B[6], 0, B[1], B[4], B[7], 0, B[2], B[5], B[8], 0, t[0], t[1], t[2], 1];
}

/** UE point → three point. */
export function ueToThreePoint(p: [number, number, number]): [number, number, number] {
  return [p[0] * UNIT, p[2] * UNIT, p[1] * UNIT];
}
