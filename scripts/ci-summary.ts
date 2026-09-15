/**
 * Write a job summary to $GITHUB_STEP_SUMMARY.
 *
 * ★ WHY THIS EXISTS. A green check tells a contributor nothing except "it passed". The
 *   summary page is where GitHub renders Markdown per job, so a reviewer sees what the
 *   packages actually weigh and what the tarball contains WITHOUT opening a log. For a
 *   repo other people are expected to contribute to, that is the difference between a
 *   fast review and a spelunking expedition.
 *
 * ⚠️ LIMITS, MEASURED FROM GITHUB'S DOCS: 1 MiB per step, 20 step summaries per job.
 *   Exceeding the size fails the UPLOAD, not the step — so a too-large summary looks
 *   like no summary at all, with only an error annotation to say why.
 *
 * ⛔ NO-OP OUTSIDE ACTIONS. Locally $GITHUB_STEP_SUMMARY is unset and this prints to
 *   stdout instead, so `bun run summary` stays runnable on a laptop.
 */
import { Glob } from 'bun';

const root = new URL('..', import.meta.url);

type Row = {
  readonly name: string;
  readonly version: string;
  readonly bytes: number;
  /** A package with no entry point (config presets) has nothing to weigh. */
  readonly bundles: boolean;
};

async function measure(): Promise<readonly Row[]> {
  const rows: Row[] = [];
  const glob = new Glob('packages/*/package.json');

  // oxlint-disable no-await-in-loop -- a handful of packages, read once at the end of CI.
  for await (const relative of glob.scan({ cwd: root.pathname })) {
    const manifestUrl = new URL(relative, root);
    const manifest = await Bun.file(manifestUrl).json();
    if (manifest.private === true) continue;

    // ⚠️ Distinguish "did not build" from "has nothing to build". @homeflare/config
    //   ships JSON presets and no entry point; flagging it would train readers to
    //   ignore the warning that matters.
    const bundles = await Bun.file(new URL('src/index.ts', new URL('./', manifestUrl))).exists();
    const file = Bun.file(new URL('dist/index.js', new URL('./', manifestUrl)));
    const bytes = (await file.exists()) ? file.size : 0;

    rows.push({ name: manifest.name, version: manifest.version, bytes, bundles });
  }
  // oxlint-enable no-await-in-loop

  return rows.toSorted((a, b) => a.name.localeCompare(b.name));
}

function kib(row: Row): string {
  if (!row.bundles) return '—';
  // ⚠️ A zero for a package that DOES have an entry point means it built nothing — a
  //   real failure mode (see the tree-shaking bug in packages/kit/tests/dist.test.ts).
  //   Say so rather than printing "0.0 KiB", which reads like a very small package.
  return row.bytes === 0 ? '⚠️ not built' : `${(row.bytes / 1024).toFixed(1)} KiB`;
}

const rows = await measure();

const summary = [
  '## Packages',
  '',
  '| package | version | bundled |',
  '| --- | --- | --- |',
  ...rows.map((r) => `| \`${r.name}\` | ${r.version} | ${kib(r)} |`),
  '',
  '> `bundled` is `dist/index.js` — the entry point consumers load, before their own',
  '> bundler tree-shakes it. Dependencies are external and not counted.',
  '',
].join('\n');

const target = process.env['GITHUB_STEP_SUMMARY'];
if (target === undefined) {
  console.log(summary);
} else {
  // Append: a step may add to a summary an earlier step started.
  await Bun.write(
    target,
    (await Bun.file(target)
      .text()
      .catch(() => '')) + summary,
  );
  console.log(`wrote job summary for ${rows.length} packages`);
}
