import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { boxFrom, boxMode, edgeInBox, polygonInBox } from './boxSelect';

const v = (x: number, y: number) => new THREE.Vector2(x, y);
const box = boxFrom(v(100, 100), v(200, 200));

describe('box selection', () => {
  it('picks window or crossing from the drag direction', () => {
    expect(boxMode(v(0, 0), v(10, 5))).toBe('window');
    expect(boxMode(v(10, 0), v(0, 5))).toBe('crossing');
  });

  it('window needs the whole edge inside, crossing only a touch', () => {
    const inside = [v(120, 120), v(180, 150)] as const;
    const across = [v(50, 150), v(250, 150)] as const;
    const outside = [v(0, 0), v(50, 300)] as const;
    expect(edgeInBox(...inside, box, 'window')).toBe(true);
    expect(edgeInBox(...across, box, 'window')).toBe(false);
    expect(edgeInBox(...across, box, 'crossing')).toBe(true);
    expect(edgeInBox(...outside, box, 'crossing')).toBe(false);
  });

  it('selects faces fully inside, touched, or containing the box', () => {
    const small = [v(110, 110), v(150, 110), v(150, 150)];
    const big = [v(0, 0), v(400, 0), v(400, 400), v(0, 400)];
    const far = [v(300, 300), v(350, 300), v(350, 350)];
    expect(polygonInBox(small, box, 'window')).toBe(true);
    expect(polygonInBox(big, box, 'window')).toBe(false);
    expect(polygonInBox(big, box, 'crossing')).toBe(true);
    expect(polygonInBox(far, box, 'crossing')).toBe(false);
  });
});
