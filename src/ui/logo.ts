/** The Elevation monogram: an isometric block letter E, as inline SVG for the toolbar. */
export function createLogo(size: number): SVGSVGElement {
  const svg = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="Elevation">
<g stroke-width="0.5" stroke-linejoin="round">
<polygon points="58.81,71.64 44.58,79.86 44.58,66.16 58.81,57.95" fill="#6b6862" stroke="#6b6862"/>
<polygon points="58.81,71.64 87.29,88.08 73.05,96.30 44.58,79.86" fill="#e0502a" stroke="#e0502a"/>
<polygon points="87.29,101.78 73.05,110.00 73.05,96.30 87.29,88.08" fill="#6b6862" stroke="#6b6862"/>
<polygon points="58.81,44.25 44.58,52.47 44.58,38.77 58.81,30.55" fill="#6b6862" stroke="#6b6862"/>
<polygon points="58.81,44.25 80.17,56.58 65.93,64.79 44.58,52.47" fill="#e0502a" stroke="#e0502a"/>
<polygon points="32.71,86.71 73.05,110.00 73.05,96.30 44.58,79.86 44.58,66.16 65.93,78.49 65.93,64.79 44.58,52.47 44.58,38.77 73.05,55.21 73.05,41.51 32.71,18.22" fill="#1d1d1b" stroke="#1d1d1b"/>
<polygon points="80.17,70.27 65.93,78.49 65.93,64.79 80.17,56.58" fill="#6b6862" stroke="#6b6862"/>
<polygon points="46.95,10.00 87.29,33.29 73.05,41.51 32.71,18.22" fill="#e0502a" stroke="#e0502a"/>
<polygon points="87.29,46.99 73.05,55.21 73.05,41.51 87.29,33.29" fill="#6b6862" stroke="#6b6862"/>
</g></svg>`,
    'image/svg+xml',
  ).documentElement as unknown as SVGSVGElement;
  return document.importNode(svg, true);
}
