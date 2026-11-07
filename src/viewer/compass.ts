import {
  type Camera,
  DirectionalLight,
  HemisphereLight,
  type Mesh,
  PerspectiveCamera,
  Scene,
  Vector3,
  type WebGLRenderer,
} from "three";

/**
 * In-game compass directions, read from the game's HUD compass (Compass_SM + "compass" texture):
 * North = UE +Y, East = UE −X. In three space (x, z, y): North = +Z, East = −X.
 */
export const NORTH = new Vector3(0, 0, 1);
export const EAST = new Vector3(-1, 0, 0);

const fwd = new Vector3();

/** Heading in radians, clockwise from north. */
export function headingOf(camera: Camera): number {
  camera.getWorldDirection(fwd);
  return Math.atan2(fwd.dot(EAST), fwd.dot(NORTH));
}

/** Damped spring toward a target angle (like the game's YawSpringState / PitchSpringState). */
class Spring {
  value = 0;
  velocity = 0;
  constructor(private readonly stiffness = 20, private readonly damping = 0.9) {}
  update(target: number, dt: number, wrap: boolean): number {
    let diff = target - this.value;
    if (wrap) diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const crit = 2 * Math.sqrt(this.stiffness) * this.damping;
    this.velocity += (diff * this.stiffness - this.velocity * crit) * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
}

/**
 * The game's 3D compass: the Compass_SM sphere with its "S E N W" band, rendered in the
 * top-right corner. It turns so the letter you face is toward you.
 */
export class Compass3D {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(10, 1, 1, 100);
  private mesh: Mesh | null = null;
  private readonly yaw = new Spring();
  private readonly pitch = new Spring();
  /** On-screen size in CSS px. */
  size = 92;
  margin = 14;

  constructor() {
    // Narrow FOV from a distance, as the game's capture camera (FOVAngle 10).
    this.camera.position.set(0, 0, 13);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new HemisphereLight(0xffffff, 0x444444, 1.6));
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(-1, 1.5, 2);
    this.scene.add(key);
  }

  setMesh(mesh: Mesh): void {
    // Mesh is in metres (UE units × 0.01); scale back to its unit size.
    mesh.geometry.computeBoundingSphere();
    const r = mesh.geometry.boundingSphere?.radius ?? 1;
    mesh.scale.setScalar(1 / r);
    this.mesh = mesh;
    this.scene.add(mesh);
  }

  render(renderer: WebGLRenderer, viewCamera: Camera, dt: number): void {
    if (!this.mesh) return;
    // Heading h: rotating by h about Y brings the direction you face (mesh-space) toward the viewer (+Z).
    const h = headingOf(viewCamera);
    viewCamera.getWorldDirection(fwd);
    const p = Math.asin(Math.max(-1, Math.min(1, fwd.y)));
    this.mesh.rotation.order = "XYZ";
    this.mesh.rotation.y = this.yaw.update(h, dt, true);
    this.mesh.rotation.x = this.pitch.update(-p * 0.5, dt, false);

    const w = renderer.domElement.clientWidth, ht = renderer.domElement.clientHeight;
    const x = w - this.size - this.margin, y = ht - this.size - this.margin; // viewport y is from bottom
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, this.size, this.size);
    renderer.setViewport(x, y, this.size, this.size);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false; // keep the world image behind the compass
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, ht);
  }
}
