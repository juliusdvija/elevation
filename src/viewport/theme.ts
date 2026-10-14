/** Colours for the 3D viewport. Kept in one place so styles stay consistent. */
export const theme = {
  background: 0xf4f3ef,
  ground: 0xd8d5cc,
  /** The sky straight up; it blends down to `background` at the horizon. */
  zenith: 0xdce6f0,
  gridMinor: 0xe4e2dc,
  gridMajor: 0xd5d2ca,
  axisX: 0xd2564c,
  axisY: 0x4f9a5a,
  axisZ: 0x3f72c9,
  face: 0xfbfaf7,
  faceBack: 0xb9c3cf,
  edge: 0x1d1d1b,
  selection: 0x2f6fde,
  hover: 0x6f9be8,
  preview: 0x1d1d1b,
  guide: 0x8a8780,
} as const;
