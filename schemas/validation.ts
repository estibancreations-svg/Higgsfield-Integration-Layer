import { z } from 'zod';

export const WorkflowTypeSchema = z.enum([
  'book-creation',
  'film-production',
  'social-campaigns',
  'commerce-integration',
  'ad-hoc',
]);

export const HiggsfieldModelSchema = z.enum([
  'gpt-image-2',
  'nano-banana',
  'flux',
  'seedance',
  'kling',
  'cinema-studio',
]);

export const MediaTypeSchema = z.enum(['image', 'video']);
export const JobTriggerSystemSchema = z.enum([
  'VisionWeaver',
  'CEO Dashboard',
  'Master-System-Buildout',
  'n8n',
  'internal-scheduler',
  'unknown',
]);

export const ShotPlanSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  transition: z.string().min(1).optional(),
  motionEffect: z.string().min(1).optional(),
  durationSeconds: z.number().positive().optional(),
});

export const GenerationRequestSchema = z.object({
  projectId: z.string().min(1),
  workflowType: WorkflowTypeSchema,
  prompt: z.string().min(1),
  model: HiggsfieldModelSchema,
  mediaType: MediaTypeSchema,
  triggeredBy: JobTriggerSystemSchema,
  batchCount: z.number().int().min(1).max(50).optional(),
  sourceImageUrl: z.string().url().optional(),
  shotPlan: z.array(ShotPlanSchema).max(50).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string().min(1)).max(20).optional(),
}).superRefine((value, ctx) => {
  if (value.mediaType === 'video' && value.model === 'gpt-image-2') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['model'],
      message: 'gpt-image-2 only supports image generation.',
    });
  }

  if (value.mediaType === 'image' && ['seedance', 'kling', 'cinema-studio'].includes(value.model)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['model'],
      message: 'Selected model is reserved for video generation workflows.',
    });
  }

  if (value.mediaType === 'video' && !value.sourceImageUrl && value.model !== 'cinema-studio' && !value.shotPlan?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sourceImageUrl'],
      message: 'Provide a source image or shot plan for image-to-video generation.',
    });
  }
});

export const JobQuerySchema = z.object({
  generationId: z.string().min(1).optional(),
  jobId: z.string().min(1).optional(),
}).refine((value) => Boolean(value.generationId || value.jobId), {
  message: 'generationId or jobId is required.',
});

export const CreditBudgetSchema = z.object({
  projectId: z.string().min(1),
  workflowType: WorkflowTypeSchema.optional(),
  maxCredits: z.number().positive(),
});

export const MediaLibraryQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  mediaType: MediaTypeSchema.optional(),
  modelUsed: HiggsfieldModelSchema.optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  search: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
