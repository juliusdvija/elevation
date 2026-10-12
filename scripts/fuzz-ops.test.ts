import { it } from 'vitest';
import { fuzz } from '../src/kernel/fuzz';
it('by op', () => {
  const counts = new Map<string, number>();
  const examples = new Map<string, string>();
  for (let seed = 1; seed <= 300; seed++) {
    const f = fuzz(seed, Number(process.env.STEPS ?? 30), { solids: process.env.SOLIDS === '1' });
    if (!f) continue;
    const op = (f.log.at(-1) ?? '').replace(/[-\d.,x°]+/g, '#').replace(/#( #)+/g, '#');
    const key = `${f.problems[0].kind} after "${op}"`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!examples.has(key)) examples.set(key, `seed ${seed} step ${f.step}`);
  }
  for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(n, k, examples.get(k));
}, 600000);
