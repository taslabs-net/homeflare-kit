/**
 * Generated Paperless-ngx REST API (OpenAPI 3.0.3) request/response types for `/api/storage_paths/` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/paperless.ts
 * Manifest entry: `paperless-openapi` — Paperless-ngx REST API (OpenAPI 3.0.3) 3.1.1, sha256 d0fe550d2135e37b
 *
 * 8 of Paperless-ngx REST API (OpenAPI 3.0.3)'s 100 write endpoints are used by this family; this file covers only /api/storage_paths/.
 *
 * ⛔ `set_permissions` (writeOnly) is not modelled in this slice — no property here writes it.
 */
export interface PaperlessStoragePathRequest {
  name: string;
  path: string;
  match?: string;
  matching_algorithm?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  is_insensitive?: boolean;
  owner?: number | null;
}

export interface PaperlessStoragePath {
  readonly id: number;
  readonly slug: string;
  name: string;
  path: string;
  match?: string;
  matching_algorithm?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  is_insensitive?: boolean;
  readonly document_count: number;
  owner?: number | null;
  readonly user_can_change: boolean;
}
