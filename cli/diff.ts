import path from 'node:path';
import { UsageError } from './args';
import { freeName, type Req, type Result } from './ops';
import { describeDiff, diffImages, readPng, writePng } from './png';

export interface DiffOpts {
  a?: string;
  t?: number;
  req?: Req;
  b: string;
  tol: number;
  threshold: number;
  out?: string;
  project?: string;
  render: (q: Req) => Promise<Result>;
}

export async function runDiff(o: DiffOpts): Promise<Result> {
  const res: Result = { ok: true, errors: [], logs: [], warnings: [] };
  let a = o.a;
  const b = path.resolve(o.b);
  if (o.t !== undefined) {
    if (!o.req) throw new UsageError('diff --t needs a project to render');
    const ref = readPng(b);
    const still = await o.render({ ...o.req, op: 'still', args: { times: [o.t], maxSize: Math.max(ref.width, ref.height) } });
    res.errors.push(...still.errors); res.logs.push(...still.logs); res.warnings.push(...still.warnings);
    if (!still.ok) { res.ok = false; return res; }
    a = (still.files as string[])[0]!;
  }
  if (!a) throw new UsageError('diff compares two images: reel diff <a.png> <b.png> (or --t <seconds> <b.png>)');
  a = path.resolve(a);
  const { stats, image } = diffImages(readPng(a), readPng(b), o.tol);
  const name = `${path.basename(a, '.png')}-vs-${path.basename(b, '.png')}`;
  const out = o.out ? path.resolve(o.out) : o.project ? freeName(path.join(o.project, 'out/diffs'), name) : freeName(path.dirname(a), `${name}.diff`);
  writePng(out, image);
  Object.assign(res, { a, b, file: out, summary: describeDiff(stats), ...stats });
  if (stats.fraction > o.threshold) res.errors.push(`${describeDiff(stats)}: over the threshold of ${o.threshold}`);
  res.ok = !res.errors.length;
  return res;
}
