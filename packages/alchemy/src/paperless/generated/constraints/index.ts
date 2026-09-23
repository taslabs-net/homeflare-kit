/**
 * Every generated Paperless constraint table, merged — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/paperless.ts
 *
 * ⚠️ EVERY KEY IS PREFIXED `paperless:`, so one estate running several vendors' readers cannot
 *   collide on an unprefixed `POST /api/…`.
 */
import type { EndpointConstraints } from '../../constraints.ts';
import { PAPERLESS_CUSTOM_FIELDS_CONSTRAINTS } from './paperless-custom_fields.ts';
import { PAPERLESS_DOCUMENT_TYPES_CONSTRAINTS } from './paperless-document_types.ts';
import { PAPERLESS_STORAGE_PATHS_CONSTRAINTS } from './paperless-storage_paths.ts';
import { PAPERLESS_TAGS_CONSTRAINTS } from './paperless-tags.ts';

export const PAPERLESS_CONSTRAINTS: Readonly<Record<string, EndpointConstraints>> = {
  ...PAPERLESS_CUSTOM_FIELDS_CONSTRAINTS,
  ...PAPERLESS_DOCUMENT_TYPES_CONSTRAINTS,
  ...PAPERLESS_STORAGE_PATHS_CONSTRAINTS,
  ...PAPERLESS_TAGS_CONSTRAINTS,
};

/** sha256 of the merged table, truncated — a digest of the DATA, not the file text. */
export const PAPERLESS_CONSTRAINTS_DIGEST = '66e61dce8c099d7d';
