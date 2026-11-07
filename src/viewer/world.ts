import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CompressedTexture,
  DataTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  RGBA_BPTC_Format,
  RGBA_S3TC_DXT1_Format,
  RGBA_S3TC_DXT5_Format,
  RGBAFormat,
  RED_GREEN_RGTC2_Format,
  RED_RGTC1_Format,
  SRGBColorSpace,
  type Texture,
  type WebGLRenderer,
} from "three";
import type { GeometryData, SceneData, TextureData, WorkerApi } from "../protocol.ts";
import { familyColor, zoneFamily } from "./zones.ts";

const WHITE = new Color(1, 1, 1);
const TINT_AMOUNT = 0.55;

export interface LoadProgress {
  done: number;
  total: number;
  label: string;
}

/** Builds and owns the three.js objects for a loaded scene. */
export class World {
  readonly root = new Group();
  private readonly geometries = new Map<string, Promise<BufferGeometry | null>>();
  private readonly textures = new Map<string, Promise<{ tex: Texture; uv: number } | null>>();
  private readonly materials = new Map<string, Promise<MeshStandardMaterial>>();
  private readonly tinted: { mat: MeshStandardMaterial; tint: Color }[] = [];
  private tintOn = true;
  errors = 0;

  constructor(private readonly api: WorkerApi, private readonly renderer: WebGLRenderer) {
    this.root.matrixAutoUpdate = false;
  }

  async load(scene: SceneData, onProgress: (p: LoadProgress) => void): Promise<void> {
    const byMesh = new Map<string, SceneData["actors"]>();
    for (const a of scene.actors) {
      const list = byMesh.get(a.mesh) ?? [];
      list.push(a);
      byMesh.set(a.mesh, list);
    }
    const jobs = [...byMesh];
    let done = 0;
    const total = jobs.length;
    const worker = async () => {
      for (;;) {
        const job = jobs.shift();
        if (!job) return;
        const [meshPath, actors] = job;
        onProgress({ done, total, label: meshPath.split(".").pop() ?? meshPath });
        try {
          await this.placeMesh(meshPath, actors);
        } catch (e) {
          this.errors++;
          console.warn("mesh failed", meshPath, e);
        }
        done++;
        onProgress({ done, total, label: "" });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  private async placeMesh(path: string, actors: SceneData["actors"]): Promise<void> {
    const geoData = await this.api.geometry(path);
    const geo = this.buildGeometry(path, geoData);
    for (const a of actors) {
      const family = zoneFamily(a.level);
      const mats = await Promise.all(
        geoData.materials.map((m, i) => this.material(a.overrides[i] ?? m, family)),
      );
      const mesh = new Mesh(geo, mats);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(new Matrix4().fromArray(a.matrix));
      mesh.matrixWorldNeedsUpdate = true;
      mesh.userData = { level: a.level, family, mesh: path.split(".").pop() };
      this.root.add(mesh);
    }
  }

  /** A single game mesh with its own (untinted) materials, for UI use such as the compass. */
  async standaloneMesh(path: string): Promise<Mesh> {
    const d = await this.api.geometry(path);
    const geo = this.buildGeometry(path, d);
    const mats = await Promise.all(d.materials.map((m) => this.material(m, "__ui")));
    const own = mats.map((m) => {
      const c = m.clone();
      c.color.copy((m.userData as { base?: Color }).base ?? WHITE);
      return c;
    });
    return new Mesh(geo, own);
  }

  private buildGeometry(path: string, d: GeometryData): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(d.positions, 3));
    d.uvs.slice(0, 4).forEach((uv, i) => g.setAttribute(i === 0 ? "uv" : `uv${i}`, new BufferAttribute(uv, 2)));
    g.setIndex(new BufferAttribute(d.indices, 1));
    for (const s of d.sections) g.addGroup(s.firstIndex, s.numTriangles * 3, s.materialIndex);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.name = path;
    return g;
  }

  private material(path: string | null, family: string): Promise<MeshStandardMaterial> {
    const key = `${path}|${family}`;
    let p = this.materials.get(key);
    if (!p) {
      p = (async () => {
        const tint = familyColor(family);
        const mat = new MeshStandardMaterial({ roughness: 0.92, metalness: 0, color: 0xb8b0a0 });
        mat.name = path ?? "none";
        if (path) {
          try {
            const info = await this.api.material(path);
            if (info.baseColor) {
              const t = await this.texture(info.baseColor, info.uvChannel);
              if (t) {
                mat.map = t.tex;
                mat.color.set(0xffffff);
              }
            }
          } catch (e) {
            console.warn("material failed", path, e);
          }
        }
        if (path && /water/i.test(path)) {
          // See-through water keeps underwater zones visible.
          mat.transparent = true;
          mat.opacity = 0.55;
          mat.depthWrite = false;
          mat.roughness = 0.3;
        }
        const base = mat.color.clone();
        this.tinted.push({ mat, tint: base.clone().lerp(base.clone().multiply(tint), TINT_AMOUNT) });
        (mat.userData as { base: Color }).base = base;
        this.applyTint(mat);
        return mat;
      })();
      this.materials.set(key, p);
    }
    return p;
  }

  private applyTint(mat: MeshStandardMaterial): void {
    const entry = this.tinted.find((t) => t.mat === mat);
    const base = (mat.userData as { base?: Color }).base ?? WHITE;
    mat.color.copy(this.tintOn && entry ? entry.tint : base);
  }

  get tint(): boolean {
    return this.tintOn;
  }

  set tint(on: boolean) {
    this.tintOn = on;
    for (const { mat } of this.tinted) this.applyTint(mat);
  }

  private texture(path: string, uv: number): Promise<{ tex: Texture; uv: number } | null> {
    const key = `${path}|${uv}`;
    let p = this.textures.get(key);
    if (!p) {
      p = this.api
        .texture(path)
        .then((d) => ({ tex: this.buildTexture(d, uv), uv }))
        .catch((e) => {
          console.warn("texture failed", path, e);
          return null;
        });
      this.textures.set(key, p);
    }
    return p;
  }

  private buildTexture(d: TextureData, uv: number): Texture {
    const ext = this.renderer.extensions;
    const mips = d.mips.map((m) => ({ data: m.data, width: m.width, height: m.height }));
    const w = mips[0].width, h = mips[0].height;
    let tex: Texture;
    const compressed: Record<string, [number, string]> = {
      PF_DXT1: [RGBA_S3TC_DXT1_Format, "WEBGL_compressed_texture_s3tc"],
      PF_DXT5: [RGBA_S3TC_DXT5_Format, "WEBGL_compressed_texture_s3tc"],
      PF_BC4: [RED_RGTC1_Format, "EXT_texture_compression_rgtc"],
      PF_BC5: [RED_GREEN_RGTC2_Format, "EXT_texture_compression_rgtc"],
      PF_BC7: [RGBA_BPTC_Format, "EXT_texture_compression_bptc"],
    };
    const c = compressed[d.format];
    if (c) {
      if (!ext.has(c[1])) throw new Error(`GPU lacks ${c[1]} for ${d.format}`);
      tex = new CompressedTexture(mips as never, w, h, c[0] as never);
    } else if (d.format === "PF_B8G8R8A8") {
      for (const m of mips) {
        const px = m.data;
        for (let i = 0; i < px.length; i += 4) {
          const b = px[i];
          px[i] = px[i + 2];
          px[i + 2] = b;
        }
      }
      tex = new DataTexture(mips[0].data as Uint8Array<ArrayBuffer>, w, h, RGBAFormat);
      tex.mipmaps = mips as never;
    } else {
      throw new Error(`Unsupported pixel format ${d.format}`);
    }
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.magFilter = LinearFilter;
    tex.minFilter = mips.length > 1 ? LinearMipmapLinearFilter : LinearFilter;
    tex.generateMipmaps = false;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.colorSpace = d.srgb && !d.isNormalMap ? SRGBColorSpace : NoColorSpace;
    tex.channel = uv;
    tex.flipY = false;
    tex.needsUpdate = true;
    return tex;
  }
}
