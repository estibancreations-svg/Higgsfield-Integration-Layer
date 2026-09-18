import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  CreditTransactionRecord,
  GenerationRecord,
  GenerationStatus,
  JobStateRecord,
  MediaLibraryRecord,
  MediaMetadata,
} from '../../schemas/types';

export class SupabaseStateManager {
  constructor(private readonly client: SupabaseClient) {}

  static fromEnv(): SupabaseStateManager {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    }

    return new SupabaseStateManager(createClient(url, serviceRoleKey));
  }

  async createGeneration(input: Omit<GenerationRecord, 'id' | 'createdAt' | 'completedAt'>): Promise<{ id: string }> {
    const { data, error } = await this.client
      .from('generations')
      .insert({
        project_id: input.projectId,
        workflow_type: input.workflowType,
        request_params: input.requestParams,
        job_id: input.jobId,
        model_used: input.modelUsed,
        credits_used: input.creditsUsed,
        status: input.status,
        media_url: input.mediaUrl,
        error_message: input.errorMessage,
        retry_count: input.retryCount,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create generation record: ${error?.message ?? 'unknown error'}`);
    }

    return { id: String(data.id) };
  }

  async updateGenerationStatus(jobId: string, status: GenerationStatus, updates: Partial<GenerationRecord> = {}): Promise<void> {
    const payload: Record<string, unknown> = { status };

    if (updates.creditsUsed !== undefined) {
      payload.credits_used = updates.creditsUsed;
    }
    if (updates.mediaUrl !== undefined) {
      payload.media_url = updates.mediaUrl;
    }
    if (updates.errorMessage !== undefined) {
      payload.error_message = updates.errorMessage;
    }
    if (updates.retryCount !== undefined) {
      payload.retry_count = updates.retryCount;
    }
    if (status === 'complete' || status === 'failed') {
      payload.completed_at = new Date().toISOString();
    }

    const { error } = await this.client.from('generations').update(payload).eq('job_id', jobId);
    if (error) {
      throw new Error(`Failed to update generation status: ${error.message}`);
    }
  }

  async findGenerationById(generationId: string): Promise<{ id: string; jobId: string; retryCount: number } | null> {
    const { data, error } = await this.client
      .from('generations')
      .select('id, job_id, retry_count')
      .eq('id', generationId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to resolve generation: ${error.message}`);
    }

    if (!data) {
      return null;
    }

    return {
      id: String(data.id),
      jobId: String(data.job_id),
      retryCount: Number(data.retry_count ?? 0),
    };
  }

  async upsertJobState(job: JobStateRecord): Promise<void> {
    const { error } = await this.client.from('job_state').upsert({
      job_id: job.jobId,
      higgsfield_job_id: job.higgsfieldJobId,
      status: job.status,
      progress_percent: job.progressPercent,
      started_at: job.startedAt,
      estimated_completion: job.estimatedCompletion,
      error_state: job.errorState,
      triggered_by: job.triggeredBy,
      generation_parameters: job.generationParameters,
    });

    if (error) {
      throw new Error(`Failed to upsert job state: ${error.message}`);
    }
  }

  async saveMediaRecords(generationId: string, projectId: string, media: MediaMetadata[]): Promise<void> {
    if (!media.length) {
      return;
    }

    const rows = media.map((item) => ({
      generation_id: generationId,
      media_type: item.mediaType,
      media_url: item.mediaUrl,
      storage_path: null,
      metadata: {
        dimensions: item.width && item.height ? { width: item.width, height: item.height } : undefined,
        durationSeconds: item.durationSeconds,
        format: item.format,
        sizeBytes: item.sizeBytes,
        thumbnails: item.thumbnails,
      },
      project_association: projectId,
      provenance_chain: ['Higgsfield', 'Higgsfield-Integration-Layer'],
    }));

    const { error } = await this.client.from('media_library').insert(rows);
    if (error) {
      throw new Error(`Failed to save media records: ${error.message}`);
    }
  }

  async listMedia(filters: {
    projectId?: string;
    mediaType?: MediaLibraryRecord['mediaType'];
    fromDate?: string;
    toDate?: string;
    search?: string;
    limit?: number;
  }): Promise<MediaLibraryRecord[]> {
    let query = this.client.from('media_library').select('*').order('created_at', { ascending: false }).limit(filters.limit ?? 25);

    if (filters.projectId) {
      query = query.eq('project_association', filters.projectId);
    }
    if (filters.mediaType) {
      query = query.eq('media_type', filters.mediaType);
    }
    if (filters.fromDate) {
      query = query.gte('created_at', filters.fromDate);
    }
    if (filters.toDate) {
      query = query.lte('created_at', filters.toDate);
    }
    if (filters.search) {
      query = query.ilike('media_url', `%${filters.search}%`);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to list media: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      id: String(row.id),
      generationId: String(row.generation_id),
      mediaType: row.media_type as MediaLibraryRecord['mediaType'],
      mediaUrl: String(row.media_url),
      storagePath: row.storage_path ? String(row.storage_path) : null,
      metadata: (row.metadata ?? {}) as MediaLibraryRecord['metadata'],
      projectAssociation: String(row.project_association),
      provenanceChain: Array.isArray(row.provenance_chain) ? (row.provenance_chain as string[]) : [],
      createdAt: String(row.created_at),
    }));
  }

  async recordCreditTransaction(transaction: CreditTransactionRecord): Promise<void> {
    const { error } = await this.client.from('credit_transactions').insert({
      id: transaction.id,
      account_id: transaction.accountId,
      amount: transaction.amount,
      job_id: transaction.jobId,
      status: transaction.status,
      transaction_date: transaction.transactionDate,
      balance_after: transaction.balanceAfter,
      description: transaction.description,
    });

    if (error) {
      throw new Error(`Failed to record credit transaction: ${error.message}`);
    }
  }
}
