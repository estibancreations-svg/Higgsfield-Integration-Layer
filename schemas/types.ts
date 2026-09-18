export type GenerationStatus = 'queued' | 'rendering' | 'complete' | 'failed';
export type MediaType = 'image' | 'video';
export type WorkflowType = 'book-creation' | 'film-production' | 'social-campaigns' | 'commerce-integration' | 'ad-hoc';
export type HiggsfieldModel = 'gpt-image-2' | 'nano-banana' | 'flux' | 'seedance' | 'kling' | 'cinema-studio';
export type JobTriggerSystem = 'VisionWeaver' | 'CEO Dashboard' | 'Master-System-Buildout' | 'n8n' | 'internal-scheduler' | 'unknown';

export interface GenerationRecord {
  id: string;
  projectId: string;
  workflowType: WorkflowType;
  requestParams: Record<string, unknown>;
  jobId: string;
  modelUsed: HiggsfieldModel;
  creditsUsed: number | null;
  status: GenerationStatus;
  createdAt: string;
  completedAt: string | null;
  mediaUrl: string | null;
  errorMessage: string | null;
  retryCount: number;
}

export interface MediaLibraryRecord {
  id: string;
  generationId: string;
  mediaType: MediaType;
  mediaUrl: string;
  storagePath: string | null;
  metadata: {
    dimensions?: { width: number; height: number };
    durationSeconds?: number;
    sizeBytes?: number;
    format?: string;
    thumbnails?: string[];
    [key: string]: unknown;
  };
  projectAssociation: string;
  provenanceChain: string[];
  createdAt: string;
}

export interface CreditTransactionRecord {
  id: string;
  accountId: string;
  amount: number;
  jobId: string | null;
  status: 'pending' | 'posted' | 'reversed' | 'failed';
  transactionDate: string;
  balanceAfter: number;
  description: string;
}

export interface JobStateRecord {
  jobId: string;
  higgsfieldJobId: string;
  status: GenerationStatus;
  progressPercent: number;
  startedAt: string;
  estimatedCompletion: string | null;
  errorState: string | null;
  triggeredBy: JobTriggerSystem;
  generationParameters: Record<string, unknown>;
}

export interface MediaMetadata {
  mediaUrl: string;
  mediaType: MediaType;
  width?: number;
  height?: number;
  durationSeconds?: number;
  format?: string;
  sizeBytes?: number;
  thumbnails?: string[];
}

export interface ProvenanceMetadata {
  sourceSystem: JobTriggerSystem;
  projectId: string;
  workflowType: WorkflowType;
  requestId: string;
  tags: string[];
}

export interface GenerationRequest {
  projectId: string;
  workflowType: WorkflowType;
  prompt: string;
  model: HiggsfieldModel;
  mediaType: MediaType;
  triggeredBy: JobTriggerSystem;
  batchCount?: number;
  sourceImageUrl?: string;
  shotPlan?: Array<{
    id: string;
    prompt: string;
    transition?: string;
    motionEffect?: string;
    durationSeconds?: number;
  }>;
  options?: Record<string, unknown>;
  tags?: string[];
}

export interface GeneratedMediaResponse {
  generationId: string;
  jobId: string;
  status: GenerationStatus;
  projectId: string;
  workflowType: WorkflowType;
  modelUsed: HiggsfieldModel;
  creditsReserved?: number;
  media?: MediaMetadata[];
  provenance: ProvenanceMetadata;
}

export interface JobStatusResponse {
  generationId: string;
  jobId: string;
  higgsfieldJobId: string;
  status: GenerationStatus;
  progressPercent: number;
  estimatedCompletion: string | null;
  media: MediaMetadata[];
  errorMessage: string | null;
  retryCount: number;
}
