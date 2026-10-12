import { it } from 'vitest';
import { fuzz } from '../src/kernel/fuzz';

// Exploratory run: many seeds, prints a summary of failures by kind.
it('fuzz summary', () => {
  const seeds = Number(process.env.SEEDS ?? 200);
  const steps = Number(process.env.STEPS ?? 25);
  const byKind = new Map<string, { count: number; example: string }>();
  let failed = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const f = fuzz(seed, steps, { solids: process.env.SOLIDS === '1' });
    if (!f) continue;
    failed++;
    const kind = f.problems[0].kind;
    const entry = byKind.get(kind) ?? { count: 0, example: '' };
    entry.count++;
    if (!entry.example) entry.example = `seed ${seed} step ${f.step}: ${f.problems[0].detail.split('\n')[0]}\n    ${f.log.slice(-4).join('\n    ')}`;
    byKind.set(kind, entry);
  }
  console.log(`${failed}/${seeds} seeds failed`);
  for (const [kind, { count, example }] of [...byKind].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`\n[${kind}] x${count}\n  ${example}`);
  }
}, 600_000);
