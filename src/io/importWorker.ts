/// <reference lib="webworker" />
import { buildUnderlay, type DxfDrawing } from './dxf';
import { buildModel, type ImportOptions, type ObjMesh } from './obj';

/** What the page sends: a mesh (or a DXF drawing) and the options to build it with. */
export interface ImportRequest {
  mesh: ObjMesh;
  drawing?: DxfDrawing;
  options: ImportOptions;
}

/** What comes back: progress updates, then the finished model as plain data (or an error). */
export type ImportMessage =
  | { type: 'progress'; fraction: number; stage: string }
  | { type: 'done'; data: ReturnType<ReturnType<typeof buildModel>['toData']>; faces: number; edges: number }
  | { type: 'error'; message: string };

const post = (message: ImportMessage) => (self as unknown as Worker).postMessage(message);

self.onmessage = (event: MessageEvent<ImportRequest>) => {
  const { mesh, drawing, options } = event.data;
  try {
    let last = 0;
    const progress = (fraction: number, stage: string) => {
      // Not more than a few updates a second.
      const now = performance.now();
      if (now - last < 80 && fraction < 1) return;
      last = now;
      post({ type: 'progress', fraction, stage });
    };
    const model = drawing ? buildUnderlay(drawing, options.scale, options.recenter, progress) : buildModel(mesh, options, progress);
    post({ type: 'done', data: model.toData(), faces: model.faceCount, edges: model.edgeCount });
  } catch (error) {
    post({ type: 'error', message: (error as Error).message });
  }
};
