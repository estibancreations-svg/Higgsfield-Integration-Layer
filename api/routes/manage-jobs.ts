import { authorizeRequest } from '../middleware/auth';
import { auditLogger } from '../utils/audit-logger';
import { HiggsfieldClient } from '../utils/higgsfield-client';
import { SupabaseStateManager } from '../utils/state-manager';
import { JobQuerySchema } from '../../schemas/validation';
import type { JobStatusResponse } from '../../schemas/types';

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

  const auth = await authorizeRequest(request, ['jobs:read']);
  if (!auth.authorized) {
    return json({ error: auth.message }, auth.status);
  }

  const url = new URL(request.url);
  const query = JobQuerySchema.safeParse({
    generationId: url.searchParams.get('generationId') ?? undefined,
    jobId: url.searchParams.get('jobId') ?? undefined,
  });

  if (!query.success) {
    return json({ error: query.error.flatten() }, 400);
  }

  try {
    const client = HiggsfieldClient.fromEnv();
    const stateManager = SupabaseStateManager.fromEnv();
    const generation = query.data.generationId
      ? await stateManager.findGenerationById(query.data.generationId)
      : null;
    const jobId = query.data.jobId ?? generation?.jobId;
    if (!jobId) {
      return json({ error: 'Unable to resolve a job from the provided generationId or jobId.' }, 404);
    }
    const job = await client.getJob(jobId);

    await stateManager.upsertJobState({
      jobId,
      higgsfieldJobId: job.jobId,
      status: job.status,
      progressPercent: job.progressPercent,
      startedAt: new Date().toISOString(),
      estimatedCompletion: job.estimatedCompletion,
      errorState: job.status === 'failed' ? 'remote-job-failed' : null,
      triggeredBy: 'unknown',
      generationParameters: job.raw,
    });

    await stateManager.updateGenerationStatus(jobId, job.status, {
      creditsUsed: job.creditsReserved,
      mediaUrl: job.media[0]?.mediaUrl ?? null,
      errorMessage: job.status === 'failed' ? 'Higgsfield job failed.' : null,
    });

    const response: JobStatusResponse = {
      generationId: generation?.id ?? query.data.generationId ?? jobId,
      jobId,
      higgsfieldJobId: job.jobId,
      status: job.status,
      progressPercent: job.progressPercent,
      estimatedCompletion: job.estimatedCompletion,
      media: job.media,
      errorMessage: job.status === 'failed' ? 'Higgsfield job failed.' : null,
      retryCount: generation?.retryCount ?? 0,
    };

    auditLogger.log({
      action: 'manage-jobs',
      actor: auth.subject,
      system: 'Higgsfield-Integration-Layer',
      status: 'success',
      resourceId: jobId,
      metadata: { status: job.status, progressPercent: job.progressPercent },
    });

    return json(response);
  } catch (error) {
    auditLogger.log({
      action: 'manage-jobs',
      actor: auth.subject,
      system: 'Higgsfield-Integration-Layer',
      status: 'failure',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });

    return json({ error: error instanceof Error ? error.message : 'Failed to retrieve job.' }, 500);
  }
}
