// Re-export from new location for backward compatibility
// IngestResult is defined only in content-source.ts (to prevent name collision)
export type { IngestStatus, IngestResult, ContentSource, SourceType } from './content-source.js';
import type { ContentSource, SourceType } from './content-source.js';

/** @deprecated Use ContentSource instead */
export type Video = ContentSource;

/** @deprecated Use SourceType instead */
export type VideoSourceType = Extract<SourceType, 'vimeo' | 'youtube'>;
