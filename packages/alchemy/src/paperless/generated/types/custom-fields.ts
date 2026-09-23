/**
 * Generated Paperless-ngx REST API (OpenAPI 3.0.3) request/response types for `/api/custom_fields/` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/paperless.ts
 * Manifest entry: `paperless-openapi` — Paperless-ngx REST API (OpenAPI 3.0.3) 3.1.1, sha256 d0fe550d2135e37b
 *
 * 8 of Paperless-ngx REST API (OpenAPI 3.0.3)'s 100 write endpoints are used by this family; this file covers only /api/custom_fields/.
 *
 * ⛔ `set_permissions` (writeOnly) is not modelled in this slice — no property here writes it.
 */
export interface PaperlessCustomFieldRequest {
  name: string;
  data_type: "string" | "url" | "date" | "boolean" | "integer" | "float" | "monetary" | "documentlink" | "select" | "longtext";
  extra_data?: unknown | null;
}

export interface PaperlessCustomField {
  readonly id: number;
  name: string;
  data_type: "string" | "url" | "date" | "boolean" | "integer" | "float" | "monetary" | "documentlink" | "select" | "longtext";
  extra_data?: unknown | null;
  readonly document_count: number;
}
