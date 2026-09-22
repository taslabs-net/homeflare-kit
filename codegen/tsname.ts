/**
 * What a generated type is called, and which file it lands in.
 *
 * ⛔ THE NAMING IS THE OLD GENERATOR'S, REPRODUCED RATHER THAN IMPROVED, AND THAT IS DELIBERATE.
 *   `/cluster/backup/{id}/included_volumes` becomes `ClusterBackupIdIncluded_volumesGetReturn` —
 *   the segments split on `-` and `.` but NOT on `_`, so an underscore survives into the middle of
 *   a type name. It is ugly. Renaming it would also rename ~60 exported types for no behavioural
 *   gain, in the same commit that changes what the types MEAN, and the second change would hide
 *   inside the first. A rename is its own diff, on its own day.
 */
const capitalised = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * `/cluster/sdn/prefix-lists/{id}` -> `ClusterSdnPrefixListsId`.
 *
 * ⚠️ `{id}` LOSES ITS BRACES AND KEEPS ITS SPELLING: `{url_seq}` is `Url_seq`, not `UrlSeq`.
 */
export const pathName = (path: string): string =>
  path
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => segment.replaceAll('{', '').replaceAll('}', ''))
    .flatMap((segment) => segment.split(/[-.]/))
    .map(capitalised)
    .join('');

export const typeName = (method: string, path: string, suffix: 'Params' | 'Return'): string =>
  `${pathName(path)}${capitalised(method.toLowerCase())}${suffix}`;

/**
 * Which generated file an endpoint belongs to, as a list of path segments to try in order.
 *
 * ★ SPLIT BY THE VENDOR'S OWN PATH, DEEPENING ONLY WHERE A FILE WOULD BE TOO BIG. `/nodes` alone
 *   is most of PVE, so it deepens to `nodes-node-qemu`, `nodes-node-lxc` and so on — a reader with
 *   the vendor's API viewer open knows which file to open. `render.ts` does the same for the
 *   constraint tables; this one has to recurse because the type files are an order of magnitude
 *   larger than the tables.
 */
export const segmentsOf = (path: string): readonly string[] =>
  path
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => segment.replaceAll('{', '').replaceAll('}', '').replaceAll('_', '-'));

/** `['nodes', 'node', 'qemu']` -> `nodes-node-qemu`. The empty prefix is the product root. */
export const moduleName = (prefix: readonly string[]): string =>
  prefix.length === 0 ? 'root' : prefix.join('-');
