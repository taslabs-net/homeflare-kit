/**
 * Paperless-ngx taxonomy providers for Alchemy: Tag, DocumentType, StoragePath, CustomField.
 *
 * ⛔ THIS BARREL IS SMALLER THAN THE DIRECTORY ON PURPOSE — see `../netbox/index.ts`'s own
 *   header. `matching.ts`'s internals and the raw generated modules are not re-exported; a
 *   consumer wanting the same guard a Resource uses gets it through `constraintsFor`/
 *   `bodyViolations`, not by importing `generated/` directly.
 */
export {
  PaperlessCredentials,
  type PaperlessCredentialValue,
  PaperlessCredentialsError,
  environmentLayer as paperlessEnvironmentLayer,
} from './credentials.ts';
export {
  PaperlessNotFound,
  PaperlessUnauthorized,
  PaperlessValidation,
  PaperlessUnavailable,
  type PaperlessError,
} from './errors.ts';
export {
  PAPERLESS_CONSTRAINTS,
  bodyViolations,
  constraintsFor,
  guardBody,
} from './constraint-guard.ts';
export {
  type EndpointConstraints,
  type EndpointKey,
  type ParamConstraint,
  type PaperlessBody,
  refusal,
  violations,
} from './constraints.ts';
export { PAPERLESS_CONSTRAINTS_DIGEST } from './generated/constraints/index.ts';
export { Tag, TagProvider, type TagAttributes, type TagProps } from './tag.ts';
export {
  DocumentType,
  DocumentTypeProvider,
  type DocumentTypeAttributes,
  type DocumentTypeProps,
} from './document-type.ts';
export {
  StoragePath,
  StoragePathProvider,
  type StoragePathAttributes,
  type StoragePathProps,
} from './storage-path.ts';
export {
  CustomField,
  CustomFieldProvider,
  type CustomFieldAttributes,
  type CustomFieldProps,
} from './custom-field.ts';
export { paperlessProviders } from './providers.ts';
