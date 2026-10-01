/**
 * A fake of LiteLLM's `/credentials/*` routes for tests — TEST ONLY, never imported by `index.ts`.
 * Like `fake-model-litellm.ts` it is a `fetch` function handed to Effect's real `FetchHttpClient`
 * through its `Fetch` reference, so a test exercises distilled's REAL path assembly, JSON encoding
 * and status-to-error matching; only the wire responses a scenario needs are written here.
 *
 * ★ THE MASKING RULE IS THE VENDOR'S, READ FROM THE LIVE 1.103.0 CONTAINER
 *   (`litellm_logging.py::_get_masked_values`): a key whose lowercased form contains `token`,
 *   `key`, `secret`, `password`, `passwd`, `credentials`, `vertex_credentials` or
 *   `authorization` answers `v[:2] + "****" + v[-2:]` for a string longer than four characters,
 *   `*****` for a shorter one, the value untouched for a non-string, and a non-sensitive key
 *   answers its full value. Both the list and the by-name read apply it (the by-name read with
 *   `unmasked_length=4, number_of_asterisks=4` — the same rule).
 * ★ THE READ AND THE DELETE ASK DIFFERENT STORES, AS THE VENDOR DOES (measured): the by-name read
 *   answers only rows loaded in memory, while the delete consults the table. `memoryOmits` models
 *   a row committed to the table but not loaded in memory, so the read answers 404 while the
 *   create for the same name answers 409 — the asymmetry credential-operations.ts documents.
 * ★ A CREATE ON AN EXISTING NAME ANSWERS 409 (the vendor's unique-violation handling,
 *   `_credential_exists_detail`), decoded by the real SDK path as core `Conflict`. The PATCH route
 *   merges values in both stores; nonempty info normally replaces DB info but merges in memory
 *   (`credential_endpoints/endpoints.py:312-319,384-387`, 1.103.0). Empty info leaves DB unchanged. With
 *   the body's `credential_name` (the `credential_name_body` member) applied as the new name only
 *   when it differs from the path's (the kit never renames in place, so it never does).
 * ★ `FAKE-*` VALUES ONLY. Nothing here is, or looks like, a real credential.
 */
/** One request that reached the fake. Its own type, so this file depends on no other fake. */
export interface FakeCredentialRequest {
  readonly method: string;
  readonly path: string;
}

type Row = Record<string, unknown>;

export interface FakeCredentialLitellm {
  readonly fetch: typeof globalThis.fetch;
  /**
   * Every stored row as the fake's table holds it — values in CLEAR, the fake's own choice: the
   * real table encrypts them, but nothing reads the table directly, only the masked reads, so the
   * encryption seam is invisible here and a test can assert what a write SENT.
   */
  readonly rows: () => readonly Row[];
  readonly requests: () => readonly FakeCredentialRequest[];
  /** The JSON bodies of every `POST` and `PATCH`, in order (including rejected PATCH requests). */
  readonly bodies: () => readonly Row[];
}

export interface FakeCredentialOptions {
  readonly masterKey?: string;
  readonly seed?: readonly Row[];
  /** Names committed to the table that the in-memory read omits (a row not loaded). */
  readonly memoryOmits?: readonly string[];
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status });

/** A minimal 1.103.0-shaped row, as the table holds it. */
export const credentialRow = (fields: Row): Row => ({
  credential_info: {},
  credential_name: '',
  credential_values: {},
  ...fields,
});

const SENSITIVE_FRAGMENTS: readonly string[] = [
  'authorization',
  'token',
  'key',
  'secret',
  'vertex_credentials',
  'credentials',
  'password',
  'passwd',
];

/** The vendor's own masking rule, applied to one keyed map (see the header). */
const masked = (values: unknown): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  if (typeof values !== 'object' || values === null) return out;
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    const sensitive = SENSITIVE_FRAGMENTS.some((fragment) => key.toLowerCase().includes(fragment));
    if (!sensitive) {
      out[key] = value;
      continue;
    }
    if (typeof value !== 'string') {
      out[key] = value;
      continue;
    }
    out[key] = value.length <= 4 ? '*****' : `${value.slice(0, 2)}****${value.slice(-2)}`;
  }
  return out;
};

export const startFakeCredentialLitellm = (
  options: FakeCredentialOptions = {},
): FakeCredentialLitellm => {
  const masterKey = options.masterKey ?? 'sk-test-master';
  let rows: Row[] = (options.seed ?? []).map((row) => ({ ...row }));
  let memory = rows.map((row) => ({ ...row }));
  const requests: FakeCredentialRequest[] = [];
  const bodies: Row[] = [];
  const memoryOmits = new Set<string>(options.memoryOmits ?? []);

  const inMemory = (name: string): Row | undefined =>
    memory.find((row) => String(row['credential_name']) === name && !memoryOmits.has(name));

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    requests.push({ method: request.method, path: `${url.pathname}${url.search}` });
    if (request.headers.get('authorization') !== `Bearer ${masterKey}`) {
      return json(401, { detail: 'invalid api key' });
    }
    const path = url.pathname;

    // GET /credentials/by_name/{name} — the read, in-memory only (see the header).
    if (path.startsWith('/credentials/by_name/') && request.method === 'GET') {
      const name = decodeURIComponent(path.slice('/credentials/by_name/'.length));
      const found = inMemory(name);
      return found === undefined
        ? json(404, { error: { message: `Credential not found. Got credential name: ${name}` } })
        : json(200, {
            ...found,
            credential_values: masked(found['credential_values']),
          });
    }

    // POST /credentials — the create; 409 on a name the TABLE already has.
    if (path === '/credentials' && request.method === 'POST') {
      const body = (await request.json()) as Row;
      bodies.push(body);
      const name = String(body['credential_name']);
      if (rows.some((row) => String(row['credential_name']) === name)) {
        return json(409, { detail: `Credential '${name}' already exists.` });
      }
      rows = [...rows, credentialRow(body)];
      memory = [...memory, credentialRow(body)];
      memoryOmits.delete(name); // a create loads the row into memory; an omission is seeded-only
      return json(200, { success: true, message: 'Credential created successfully' });
    }

    // PATCH /credentials/{name} — DB info replacement, memory merge (see the header); the body's
    // `credential_name` (the `credential_name_body` member) renames only when it differs.
    if (path.startsWith('/credentials/') && request.method === 'PATCH') {
      const name = decodeURIComponent(path.slice('/credentials/'.length));
      const body = (await request.json()) as Row;
      bodies.push(body);
      if (typeof body['credential_name'] !== 'string') {
        return json(422, {
          detail: [{ loc: ['body', 'credential_name'], msg: 'Field required', type: 'missing' }],
        });
      }
      if (!rows.some((row) => String(row['credential_name']) === name)) {
        return json(404, { error: { message: 'Credential not found in DB.' } });
      }
      const bodyName = body['credential_name'];
      const target =
        typeof bodyName === 'string' && bodyName !== '' && bodyName !== name ? bodyName : name;
      const info = (body['credential_info'] ?? {}) as Row;
      const values = (body['credential_values'] ?? {}) as Row;
      rows = rows.map((row) =>
        String(row['credential_name']) === name
          ? {
              ...row,
              credential_name: target,
              credential_info:
                Object.keys(info).length === 0
                  ? row['credential_info']
                  : {
                      ...('credential_info' in ((row['credential_info'] ?? {}) as Row)
                        ? (row['credential_info'] as Row)
                        : {}),
                      ...info,
                    },
              credential_values: { ...((row['credential_values'] ?? {}) as Row), ...values },
            }
          : row,
      );
      memory = memory.map((row) =>
        String(row['credential_name']) === name
          ? {
              ...row,
              credential_name: target,
              credential_info: { ...((row['credential_info'] ?? {}) as Row), ...info },
              credential_values: { ...((row['credential_values'] ?? {}) as Row), ...values },
            }
          : row,
      );
      return json(200, { success: true, message: 'Credential updated successfully' });
    }

    // DELETE /credentials/{name} — DB-authoritative; 404 when the TABLE lacks the name.
    if (path.startsWith('/credentials/') && request.method === 'DELETE') {
      const name = decodeURIComponent(path.slice('/credentials/'.length));
      if (!rows.some((row) => String(row['credential_name']) === name)) {
        return json(404, {
          error: { message: `Credential not found. Got credential name: ${name}` },
        });
      }
      rows = rows.filter((row) => String(row['credential_name']) !== name);
      memory = memory.filter((row) => String(row['credential_name']) !== name);
      return json(200, { success: true, message: 'Credential deleted successfully' });
    }

    return json(404, { error: { message: 'not found' } });
  }) as typeof globalThis.fetch;

  return {
    bodies: () => [...bodies],
    fetch,
    requests: () => [...requests],
    rows: () => rows.map((row) => ({ ...row })),
  };
};
