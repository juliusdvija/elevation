const MARK_PATH =
  'M599.993,1000L0,1000L0,0L599.993,0L599.993,200L200,200L200,400L599.993,400L599.993,600L200,600L200,800L599.993,800L599.993,1000Z';

/** The Elevation mark: a block E whose bars climb to the right. Takes its colour from the text. */
export function createLogo(size: number): SVGSVGElement {
  const svg = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="${size}" height="${size}" role="img" aria-label="Elevation" fill="currentColor">
<g transform="matrix(0.716332,-0.405239,0,0.716332,285.102623,263.404327)"><path d="${MARK_PATH}"/></g></svg>`,
    'image/svg+xml',
  ).documentElement as unknown as SVGSVGElement;
  return document.importNode(svg, true);
}
