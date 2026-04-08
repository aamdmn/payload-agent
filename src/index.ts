/**
 * payload-agent - PayloadCMS CLI for AI agents and humans.
 *
 * This is the programmatic API. For CLI usage, run: npx payload-agent --help
 *
 * The CLI is the primary interface. This module exports utilities
 * that can be used programmatically if needed.
 */

export type { OutputOptions } from './output/formatter.js'
export { redact } from './output/redact.js'
export { findPayloadConfig } from './utils/config-finder.js'
export type { PayloadFile } from './utils/file-utils.js'
export {
  formatFileSize,
  getMimeType,
  readFileForUpload,
  resolveFilePaths,
} from './utils/file-utils.js'
export { getPayloadInstance, shutdownPayload } from './utils/payload-init.js'
export type { FieldInfo } from './utils/schema-introspection.js'
export {
  extractFieldsInfo,
  getCollectionSlugs,
  getGlobalSlugs,
  getUploadCollectionSlugs,
  isUploadCollection,
  resolveFieldPath,
  resolveUploadCollection,
} from './utils/schema-introspection.js'
export type { TypesResult } from './utils/types-extractor.js'
export {
  extractInterface,
  extractLocaleType,
  findPayloadTypesFile,
  getTypeInterface,
  resolveTypeName,
} from './utils/types-extractor.js'
