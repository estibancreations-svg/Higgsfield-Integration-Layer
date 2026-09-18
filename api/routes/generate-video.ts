import { authorizeRequest } from '../middleware/auth';
import { enforceRateLimit, releaseConcurrency } from '../middleware/rate-limit';
import { auditLogger } from '../utils/audit-logger';
import { estimateCredits, HiggsfieldClient } from '../utils/higgsfield-client';
import { SupabaseStateManager } from '../utils/state-manager';
import { GenerationRequestSchema } from '../../schemas/validation';
import type { GeneratedMediaResponse } from '../../schemas/types';

export const config = { runtime: 'edge' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  const auth = await authorizeRequest(request, ['generate:video']);
  if (!auth.authorized) {
    return json({ error: auth.message }, auth.status);
  }

  const payload = GenerationRequestSchema.safeParse(await request.json());
  if (!payload.success || payload.data.mediaType !== 'video') {
    return json({ error: 'Invalid video generation payload.', details: payload.success ? undefined : payload.error.flatten() }, 400);
  }

  const rateLimitKey = `${auth.subject}:${payload.data.projectId}:video`;
  const rateLimit = await enforceRateLimit({ key: rateLimitKey, concurrentLimit: 2 });
  if (!rateLimit.allowed) {
    return json({ error: 'Rate limit exceeded or video queue full.', retryAfterSeconds: rateLimit.retryAfterSeconds }, 429);
  }

  let remoteJobStarted = false;

  try {
    const client = HiggsfieldClient.fromEnv();
    const stateManager = SupabaseStateManager.fromEnv();
    const job = await client.generateVideo(payload.data);
    remoteJobStarted = true;
    const generationRecord = await stateManager.createGeneration({
      projectId: payload.data.projectId,
      workflowType: payload.data.workflowType,
      requestParams: payload.data,
      jobId: job.jobId,
      modelUsed: payload.data.model,
      creditsUsed: null,
      status: job.status,
      mediaUrl: job.media[0]?.mediaUrl ?? null,
      errorMessage: null,
      retryCount: 0,
    });

    await stateManager.upsertJobState({
      jobId: job.jobId,
      higgsfieldJobId: job.jobId,
      status: job.status,
      progressPercent: job.progressPercent,
      startedAt: new Date().toISOString(),
      estimatedCompletion: job.estimatedCompletion,
      errorState: null,
      triggeredBy: payload.data.triggeredBy,
      generationParameters: {
        ...payload.data,
        renderDurationHint: payload.data.options?.renderDurationSeconds ?? payload.data.shotPlan?.reduce((sum, shot) => sum + (shot.durationSeconds ?? 0), 0) ?? null,
      },
      concurrencyLeaseToken: rateLimit.leaseToken ?? null,
    });

    if (job.media.length) {
      await stateManager.saveMediaRecords(generationRecord.id, payload.data.projectId, job.media);
    }

    const response: GeneratedMediaResponse = {
      generationId: generationRecord.id,
      jobId: job.jobId,
      status: job.status,
      projectId: payload.data.projectId,
      workflowType: payload.data.workflowType,
      modelUsed: payload.data.model,
      creditsReserved: estimateCredits(payload.data.model, 1, payload.data.shotPlan?.length ?? 0),
      media: job.media,
      provenance: {
        sourceSystem: payload.data.triggeredBy,
        projectId: payload.data.projectId,
        workflowType: payload.data.workflowType,
        requestId: generationRecord.id,
        tags: payload.data.tags ?? [],
      },
    };

    auditLogger.log({
      action: 'generate-video',
      actor: auth.subject,
      system: payload.data.triggeredBy,
      status: 'success',
      resourceId: job.jobId,
      metadata: {
        projectId: payload.data.projectId,
        model: payload.data.model,
        shotCount: payload.data.shotPlan?.length ?? 0,
      },
    });

    return json(response, 202);
  } catch (error) {
    if (!remoteJobStarted) {
      await releaseConcurrency(rateLimitKey, rateLimit.leaseToken);
    }

    auditLogger.log({
      action: 'generate-video',
      actor: auth.subject,
      system: payload.data.triggeredBy,
      status: 'failure',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });

    return json({ error: error instanceof Error ? error.message : 'Video generation failed.' }, 500);
  }
}
