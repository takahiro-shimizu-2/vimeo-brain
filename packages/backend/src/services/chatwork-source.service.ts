import type { ContentSourceService, ContentFetchResult } from './content-source.js';

export class ChatworkSourceService implements ContentSourceService {
  constructor(private readonly apiToken: string) {}

  async fetchContent(_roomId: string): Promise<ContentFetchResult> {
    // Phase 1: Stub implementation
    throw new Error(
      'Chatwork integration is not yet implemented. ' +
      'This will be available in a future release.'
    );
  }
}
