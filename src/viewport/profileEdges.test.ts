import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { profileSegments, type ProfileCandidate } from './profileEdges';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// The top edge of a wall's roof: one face looks up, the other looks along +x.
const ridge: ProfileCandidate = { a: v(0, 0, 0), b: v(0, 10, 0), n1: v(0, 0, 1), n2: v(1, 0, 0) };
const rim: ProfileCandidate = { a: v(0, 0, 0), b: v(1, 0, 0), n1: v(0, 0, 1), n2: null };

describe('profileSegments', () => {
  it('draws the rim of a single face from every side', () => {
    expect(profileSegments([rim], null, v(0, 0, 1))).toHaveLength(6);
    expect(profileSegments([rim], null, v(0, 0, -1))).toHaveLength(6);
  });

  it('draws an edge between a face towards the camera and one away from it, in a parallel view', () => {
    // From above and the +x side both faces are visible: not an outline.
    expect(profileSegments([ridge], null, v(1, 0, 1))).toHaveLength(0);
    // From above and the -x side the roof faces us but the wall faces away: outline.
    expect(profileSegments([ridge], null, v(-1, 0, 1))).toHaveLength(6);
    // From below and the -x side neither faces us.
    expect(profileSegments([ridge], null, v(-1, 0, -1))).toHaveLength(0);
  });

  it('works out the direction to the eye per edge in a perspective view', () => {
    expect(profileSegments([ridge], v(-5, 5, 5), v(0, 0, 0))).toHaveLength(6);
    expect(profileSegments([ridge], v(5, 5, 5), v(0, 0, 0))).toHaveLength(0);
  });
});
