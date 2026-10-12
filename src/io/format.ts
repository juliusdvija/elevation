import type { ModelData } from '../kernel/Model';
import type { DefinitionData } from '../document';

/** Version of the .elev file format written by this build. */
export const FORMAT_VERSION = 2;

export interface CameraData {
  position: [number, number, number];
  target: [number, number, number];
  ortho: boolean;
  orthoHeight: number;
}

/** A saved Elevation document. Lengths are millimetres. */
export interface ElevationFile {
  format: 'elevation';
  version: number;
  units: 'mm';
  model: ModelData;
  /** Groups and components (format 2). */
  definitions?: DefinitionData[];
  camera?: CameraData;
}

export function toFile(model: ModelData, camera?: CameraData, definitions: DefinitionData[] = []): ElevationFile {
  return { format: 'elevation', version: FORMAT_VERSION, units: 'mm', model, definitions, camera };
}

export function serialize(file: ElevationFile): string {
  return JSON.stringify(file);
}

/** Parses and checks a file's contents. Throws a readable error when it is not an Elevation file. */
export function parse(text: string): ElevationFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This is not an Elevation file (not valid JSON).');
  }
  const file = data as Partial<ElevationFile>;
  if (file?.format !== 'elevation' || typeof file.version !== 'number' || !file.model) {
    throw new Error('This is not an Elevation file.');
  }
  if (file.version > FORMAT_VERSION) {
    throw new Error(`This file was made by a newer version of Elevation (format ${file.version}).`);
  }
  const m = file.model;
  if (!Array.isArray(m.vertices) || !Array.isArray(m.edges) || !Array.isArray(m.faces) || typeof m.nextId !== 'number') {
    throw new Error('This Elevation file is damaged: its model is incomplete.');
  }
  return file as ElevationFile;
}
