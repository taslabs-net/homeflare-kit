/**
 * ⛔ THE CHILD GETS A MINIMAL ENV, NOT `process.env`: `PATH` to find `bao`, the vault address and
 *   token, and the optional namespace / CA. `undefined` when BAO_ADDR or BAO_TOKEN is missing —
 *   `bao` would then read a cached `~/.vault-token` login and act as whoever last logged in.
 */
export const baoEnv = (): Record<string, string> | undefined => {
  const addr = process.env['BAO_ADDR'];
  const token = process.env['BAO_TOKEN'];
  if (addr === undefined || addr === '' || token === undefined || token === '') return undefined;
  const env: Record<string, string> = { BAO_ADDR: addr, BAO_TOKEN: token };
  for (const name of ['PATH', 'BAO_NAMESPACE', 'BAO_CACERT']) {
    const value = process.env[name];
    if (value !== undefined && value !== '') env[name] = value;
  }
  return env;
};
