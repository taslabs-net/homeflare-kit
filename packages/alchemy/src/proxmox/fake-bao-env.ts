/**
 * The shell's OpenBao variables, replaced for the life of one test run and put back afterwards.
 *
 * ⛔ WHY A TEST CANNOT LEAVE THEM ALONE. `leased` mints through credentials.ts `mint`, which reads
 *   `BAO_AGENT_ADDR` before `BAO_ADDR` (and the `VAULT_*` spellings), and sends `BAO_TOKEN` as a
 *   header. A developer shell with any of them set would send its real token to a fake, or a mint
 *   to a real agent. credentials.test.ts avoids it by passing an explicit environment; a test that
 *   drives a provider cannot, because the lease cache reads `process.env`.
 * ★ ONE HELPER FOR EVERY FAKE. lxc-harness.ts and fake-pve.ts each carried their own copy; the
 *   first covered three names and the second every `BAO_*` / `VAULT_*`, so they now share the
 *   wider one. ⛔ TEST-ONLY. No provider imports this file.
 */
const BAO_VARIABLES = /^(BAO|VAULT)_/;

/** Run `body` with every BAO_* / VAULT_* unset except `BAO_ADDR=address`, then restore them. */
export const withFakeBao = async <A>(address: string, body: () => Promise<A>): Promise<A> => {
  const saved = Object.entries(process.env).filter(([name]) => BAO_VARIABLES.test(name));
  for (const [name] of saved) delete process.env[name];
  process.env['BAO_ADDR'] = address;
  try {
    return await body();
  } finally {
    for (const name of Object.keys(process.env)) {
      if (BAO_VARIABLES.test(name)) delete process.env[name];
    }
    for (const [name, value] of saved) process.env[name] = value;
  }
};
