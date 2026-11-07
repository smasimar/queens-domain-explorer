import { Euler, type PerspectiveCamera, Vector3 } from "three";

/**
 * Spectator / noclip flight.
 * Click to capture mouse. WASD move, Space/E up, C/Q/Ctrl down, Shift boost, wheel = speed.
 */
export class NoclipControls {
  speed = 12; // m/s
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private readonly euler = new Euler(0, 0, 0, "YXZ");
  private readonly v = new Vector3();
  onSpeedChange: (speed: number) => void = () => {};

  constructor(private readonly camera: PerspectiveCamera, private readonly dom: HTMLElement) {
    dom.addEventListener("click", () => {
      if (document.pointerLockElement !== dom) dom.requestPointerLock();
    });
    document.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement !== dom) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.pitch));
      this.apply();
    });
    window.addEventListener("keydown", (e) => {
      if (document.pointerLockElement === dom && e.code === "Space") e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    dom.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.speed = Math.min(500, Math.max(0.5, this.speed * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
        this.onSpeedChange(this.speed);
      },
      { passive: false },
    );
  }

  get locked(): boolean {
    return document.pointerLockElement === this.dom;
  }

  /** Face a direction given by yaw (radians, three convention). */
  setYawPitch(yaw: number, pitch = 0): void {
    this.yaw = yaw;
    this.pitch = pitch;
    this.apply();
  }

  private apply(): void {
    this.euler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(this.euler);
  }

  update(dt: number): void {
    const k = this.keys;
    const f = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
    const s = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
    const u =
      (k.has("Space") || k.has("KeyE") ? 1 : 0) -
      (k.has("KeyC") || k.has("KeyQ") || k.has("ControlLeft") ? 1 : 0);
    if (!f && !s && !u) return;
    const boost = k.has("ShiftLeft") || k.has("ShiftRight") ? 4 : 1;
    const step = this.speed * boost * dt;
    this.v.set(s, 0, -f).applyQuaternion(this.camera.quaternion);
    this.v.y += u;
    if (this.v.lengthSq() > 0) this.v.normalize();
    this.camera.position.addScaledVector(this.v, step);
  }
}
