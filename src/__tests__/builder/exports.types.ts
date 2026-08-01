// Type-only compile guard: proves the builder's supporting types are still
// exported from the package root. Types are erased at runtime, so no test
// runner assertion can catch a deleted `export type`; `tsc --noEmit`
// (`check-types`, part of `npm test`) is the only thing that can fail here.
// Imported from '../../index.ts' (the package root), not a deep relative
// path: a deep import keeps resolving after the root export is deleted, so it
// would leave this guard passing while the public surface is broken.
import type {
  Annotation,
  BuildError,
  BuildErrorCode,
  InternalRecord,
  ParseError,
  Peak,
  RecordDraft,
} from '../../index.ts';

/**
 * Reference each imported type in a signature so TypeScript must resolve it —
 * an unused type-only import can otherwise be elided without error. Never
 * called; its only job is to fail `tsc --noEmit` if a type stops being
 * exported from the package root.
 * @param annotation - forces `Annotation` to resolve
 * @param record - forces `InternalRecord` to resolve
 * @param peak - forces `Peak` to resolve
 * @param draft - forces `RecordDraft` to resolve
 * @param parseError - forces `ParseError` to resolve
 * @param buildError - forces `BuildError` to resolve
 * @param buildErrorCode - forces `BuildErrorCode` to resolve
 * @returns the same tuple, unused
 */
export function assertExported(
  annotation: Annotation,
  record: InternalRecord,
  peak: Peak,
  draft: RecordDraft,
  parseError: ParseError,
  buildError: BuildError,
  buildErrorCode: BuildErrorCode,
): [
  Annotation,
  InternalRecord,
  Peak,
  RecordDraft,
  ParseError,
  BuildError,
  BuildErrorCode,
] {
  return [
    annotation,
    record,
    peak,
    draft,
    parseError,
    buildError,
    buildErrorCode,
  ];
}
