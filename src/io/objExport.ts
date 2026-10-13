import type { Model } from '../kernel/Model';
import { triangulateFace } from '../kernel/faces';

export interface ObjExportOptions {
  /** Millimetres per unit written to the file (1000 = metres). */
  unitMm: number;
  /** Write Y up (the OBJ convention) instead of Z up. */
  yUp: boolean;
  /** Write a material per colour and opacity (colours the importer reads back). */
  colors: boolean;
}

export const DEFAULT_EXPORT: ObjExportOptions = { unitMm: 1000, yUp: true, colors: true };

/**
 * Writes a model as Wavefront OBJ (faces triangulated, one flat normal per face) and, when the model
 * has paint, a matching .mtl. Hatch patterns are drawing-only and are not exported.
 */
export function exportObj(model: Model, name: string, options: ObjExportOptions = DEFAULT_EXPORT): { obj: string; mtl?: string } {
  const { unitMm, yUp } = options;
  const lines: string[] = ['# Elevation', `# units: ${unitMm === 1000 ? 'metres' : unitMm === 10 ? 'centimetres' : unitMm === 1 ? 'millimetres' : `${unitMm} mm`}`];
  const fmt = (n: number) => (Math.round((n / unitMm) * 1e6) / 1e6).toString();
  const pos = (x: number, y: number, z: number) => (yUp ? `${fmt(x)} ${fmt(z)} ${fmt(-y)}` : `${fmt(x)} ${fmt(y)} ${fmt(z)}`);
  const dir = (x: number, y: number, z: number) => (yUp ? `${+x.toFixed(6)} ${+z.toFixed(6)} ${+(-y).toFixed(6)}` : `${+x.toFixed(6)} ${+y.toFixed(6)} ${+z.toFixed(6)}`);

  // Materials by colour and opacity.
  const materials = new Map<string, { color: string; opacity: number }>();
  const materialOf = (color: string | undefined, opacity: number | undefined): string | null => {
    if (!options.colors || (!color && opacity === undefined)) return null;
    const c = color ?? '#fbfaf7';
    const o = opacity ?? 1;
    const key = `${c.slice(1)}_${Math.round(o * 100)}`;
    if (!materials.has(key)) materials.set(key, { color: c, opacity: o });
    return key;
  };

  // Vertices of the faces actually written, numbered from 1 and welded by position.
  const positions = new Map<string, number>();
  const body: string[] = [];
  const vertexLines: string[] = [];
  const normalLines: string[] = [];
  let current: string | null | undefined;
  for (const face of model.allFaces()) {
    const triangles = triangulateFace(model, face);
    if (triangles.length === 0) continue;
    const material = materialOf(face.color, face.opacity);
    if (material !== current) {
      body.push(material ? `usemtl ${material}` : 'usemtl default');
      current = material;
    }
    normalLines.push(`vn ${dir(face.normal.x, face.normal.y, face.normal.z)}`);
    const normal = normalLines.length;
    // Triangles come back as positions; welding them keeps the mesh connected.
    for (let i = 0; i < triangles.length; i += 3) {
      const ids = [0, 1, 2].map((k) => {
        const p = triangles[i + k];
        const key = `${fmt(p.x)},${fmt(p.y)},${fmt(p.z)}`;
        let id = positions.get(key);
        if (id === undefined) {
          id = positions.size + 1;
          positions.set(key, id);
          vertexLines.push(`v ${pos(p.x, p.y, p.z)}`);
        }
        return id;
      });
      body.push(`f ${ids.map((id) => `${id}//${normal}`).join(' ')}`);
    }
  }

  if (materials.size > 0) lines.push(`mtllib ${name}.mtl`);
  lines.push(...vertexLines, ...normalLines, ...body);
  const obj = lines.join('\n') + '\n';
  if (materials.size === 0) return { obj };

  const mtl = ['# Elevation', 'newmtl default', 'Kd 0.9804 0.9804 0.9804', 'd 1'];
  for (const [key, m] of materials) {
    const [r, g, b] = [1, 3, 5].map((i) => (parseInt(m.color.slice(i, i + 2), 16) / 255).toFixed(4));
    mtl.push(`newmtl ${key}`, `Kd ${r} ${g} ${b}`, `d ${m.opacity}`);
  }
  return { obj, mtl: mtl.join('\n') + '\n' };
}
