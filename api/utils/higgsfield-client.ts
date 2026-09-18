import type { GenerationRequest, GenerationStatus, HiggsfieldModel, MediaMetadata } from '../../schemas/types';

export interface HiggsfieldJobResponse {
  jobId: string;
  status: GenerationStatus;
  progressPercent: number;
  estimatedCompletion: string | null;
  creditsReserved: number;
  media: MediaMetadata[];
  raw: Record<string, unknown>;
}

export class HiggsfieldClient {
  constructor(
    private readonly apiBaseUrl: string,
    private apiKey: string,
    private readonly accountId?: string,
    private readonly refreshToken?: string,
    private readonly tokenUrl?: string,
  ) {}

  static fromEnv(): HiggsfieldClient {
    const apiBaseUrl = process.env.HIGGSFIELD_API_BASE_URL;
    const apiKey = process.env.HIGGSFIELD_API_KEY;
    if (!apiBaseUrl || !apiKey) {
      throw new Error('Missing HIGGSFIELD_API_BASE_URL or HIGGSFIELD_API_KEY.');
    }

    return new HiggsfieldClient(
      apiBaseUrl,
      apiKey,
      process.env.HIGGSFIELD_ACCOUNT_ID,
      process.env.HIGGSFIELD_REFRESH_TOKEN,
      process.env.HIGGSFIELD_TOKEN_URL,
    );
  }

  async getAccountBalance(): Promise<number> {
    const response = await this.request<{ balance: number }>('/v1/account/balance', { method: 'GET' });
    return response.balance;
  }

  async ensureMinimumBalance(): Promise<void> {
    const minimum = Number(process.env.HIGGSFIELD_MINIMUM_CREDIT_BALANCE ?? 0);
    if (minimum <= 0) {
      return;
    }

    const balance = await this.getAccountBalance();
    if (balance < minimum) {
      throw new Error(`Insufficient Higgsfield credits. Current balance ${balance}, minimum required ${minimum}.`);
    }
  }

  async generateImage(request: GenerationRequest): Promise<HiggsfieldJobResponse> {
    await this.ensureMinimumBalance();
    return this.request<HiggsfieldJobResponse>('/v1/images/generations', {
      method: 'POST',
      body: JSON.stringify({
        projectId: request.projectId,
        prompt: request.prompt,
        model: request.model,
        batchCount: request.batchCount ?? 1,
        options: request.options ?? {},
        tags: request.tags ?? [],
      }),
    });
  }

  async generateVideo(request: GenerationRequest): Promise<HiggsfieldJobResponse> {
    await this.ensureMinimumBalance();
    return this.request<HiggsfieldJobResponse>('/v1/videos/generations', {
      method: 'POST',
      body: JSON.stringify({
        projectId: request.projectId,
        prompt: request.prompt,
        model: request.model,
        sourceImageUrl: request.sourceImageUrl,
        shotPlan: request.shotPlan ?? [],
        options: request.options ?? {},
        tags: request.tags ?? [],
      }),
    });
  }

  async getJob(jobId: string): Promise<HiggsfieldJobResponse> {
    return this.request<HiggsfieldJobResponse>(`/v1/jobs/${encodeURIComponent(jobId)}`, {
      method: 'GET',
    });
  }

  private async request<T>(path: string, init: RequestInit, attempt = 0): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        ...(this.accountId ? { 'x-account-id': this.accountId } : {}),
        ...(init.headers ?? {}),
      },
    });

    if (response.status === 401 && this.refreshToken && this.tokenUrl && attempt === 0) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        return this.request<T>(path, init, attempt + 1);
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Higgsfield request failed (${response.status}): ${errorText}`);
    }

    return (await response.json()) as T;
  }

  private async refreshAccessToken(): Promise<boolean> {
    if (!this.refreshToken || !this.tokenUrl) {
      return false;
    }

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.refreshToken }),
    });

    if (!response.ok) {
      return false;
    }

    const payload = (await response.json()) as { api_key?: string };
    if (!payload.api_key) {
      return false;
    }

    this.apiKey = payload.api_key;
    return true;
  }
}

export function estimateCredits(model: HiggsfieldModel, batchCount = 1, shotCount = 0): number {
  const baseCost: Record<HiggsfieldModel, number> = {
    'gpt-image-2': 4,
    'nano-banana': 2,
    flux: 3,
    seedance: 8,
    kling: 10,
    'cinema-studio': 14,
  };

  return baseCost[model] * Math.max(batchCount, shotCount || 1);
}
