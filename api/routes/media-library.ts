import { authorizeRequest } from '../middleware/auth';
import { auditLogger } from '../utils/audit-logger';
import { SupabaseStateManager } from '../utils/state-manager';
import { MediaLibraryQuerySchema } from '../../schemas/validation';

export const config = { runtime: 'edge' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  const auth = await authorizeRequest(request, ['media:read']);
  if (!auth.authorized) {
    return json({ error: auth.message }, auth.status);
  }

  const url = new URL(request.url);
  const query = MediaLibraryQuerySchema.safeParse({
    projectId: url.searchParams.get('projectId') ?? undefined,
    mediaType: url.searchParams.get('mediaType') ?? undefined,
    modelUsed: url.searchParams.get('modelUsed') ?? undefined,
    fromDate: url.searchParams.get('fromDate') ?? undefined,
    toDate: url.searchParams.get('toDate') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });

  if (!query.success) {
    return json({ error: query.error.flatten() }, 400);
  }

  try {
    const stateManager = SupabaseStateManager.fromEnv();
    const media = await stateManager.listMedia(query.data);

    auditLogger.log({
      action: 'media-library',
      actor: auth.subject,
      system: 'Higgsfield-Integration-Layer',
      status: 'success',
      metadata: { filters: query.data, resultCount: media.length },
    });

    return json({ data: media, count: media.length });
  } catch (error) {
    auditLogger.log({
      action: 'media-library',
      actor: auth.subject,
      system: 'Higgsfield-Integration-Layer',
      status: 'failure',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });

    return json({ error: error instanceof Error ? error.message : 'Failed to retrieve media library records.' }, 500);
  }
}
