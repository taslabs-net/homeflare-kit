/**
 * Generated Paperless-ngx REST API (OpenAPI 3.0.3) request/response types for `/api/tags/` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/paperless.ts
 * Manifest entry: `paperless-openapi` — Paperless-ngx REST API (OpenAPI 3.0.3) 3.1.1, sha256 d0fe550d2135e37b
 *
 * 8 of Paperless-ngx REST API (OpenAPI 3.0.3)'s 100 write endpoints are used by this family; this file covers only /api/tags/.
 *
 * ⛔ `set_permissions` (writeOnly) is not modelled in this slice — no property here writes it.
 */
export interface PaperlessTagRequest {
  name: string;
  color?: string;
  match?: string;
  matching_algorithm?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  is_insensitive?: boolean;
  is_inbox_tag?: boolean;
  owner?: number | null;
  parent?: number | null;
}

export interface PaperlessTag {
  readonly id: number;
  readonly slug: string;
  name: string;
  color?: string;
  readonly text_color: string;
  match?: string;
  matching_algorithm?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  is_insensitive?: boolean;
  is_inbox_tag?: boolean;
  readonly document_count: number;
  owner?: number | null;
  readonly user_can_change: boolean;
  parent?: number | null;
  readonly children: number[];
}
