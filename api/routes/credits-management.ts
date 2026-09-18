import { authorizeRequest } from '../middleware/auth';
import { auditLogger } from '../utils/audit-logger';
import { estimateCredits, HiggsfieldClient } from '../utils/higgsfield-client';
import { SupabaseStateManager } from '../utils/state-manager';
import { CreditBudgetSchema } from '../../schemas/validation';

export const config = { runtime: 'edge' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default async function handler(request: Request): Promise<Response> {
  const auth = await authorizeRequest(request, request.method === 'POST' ? ['credits:manage'] : ['credits:read']);
  if (!auth.authorized) {
    return json({ error: auth.message }, auth.status);
  }

  try {
    const client = HiggsfieldClient.fromEnv();
    const stateManager = SupabaseStateManager.fromEnv();

    if (request.method === 'GET') {
      const balance = await client.getAccountBalance();
      const lowCreditThreshold = Number(process.env.HIGGSFIELD_LOW_CREDIT_THRESHOLD ?? 25);
      const alert = balance <= lowCreditThreshold;

      auditLogger.log({
        action: 'credits-balance',
        actor: auth.subject,
        system: 'Higgsfield-Integration-Layer',
        status: 'success',
        metadata: { balance, alert },
      });

      return json({ balance, currency: 'credits', lowCreditThreshold, alert });
    }

    if (request.method === 'POST') {
      const payload = CreditBudgetSchema.safeParse(await request.json());
      if (!payload.success) {
        return json({ error: payload.error.flatten() }, 400);
      }

      const balance = await client.getAccountBalance();
      const projectedReserve = estimateCredits(
        payload.data.model,
        payload.data.batchCount,
        payload.data.shotCount,
      );
      const withinBudget = projectedReserve <= payload.data.maxCredits && projectedReserve <= balance;

      await stateManager.recordCreditTransaction({
        id: crypto.randomUUID(),
        accountId: process.env.HIGGSFIELD_ACCOUNT_ID ?? 'default-account',
        amount: projectedReserve,
        jobId: null,
        status: withinBudget ? 'pending' : 'failed',
        transactionDate: new Date().toISOString(),
        balanceAfter: Math.max(0, balance - projectedReserve),
        description: `Budget check for ${payload.data.projectId}${payload.data.workflowType ? ` (${payload.data.workflowType})` : ''}`,
      });

      auditLogger.log({
        action: 'credits-budget-check',
        actor: auth.subject,
        system: 'Higgsfield-Integration-Layer',
        status: withinBudget ? 'success' : 'failure',
        metadata: { balance, projectedReserve, payload: payload.data },
      });

      return json({
        balance,
        projectedReserve,
        withinBudget,
        alert: balance <= Number(process.env.HIGGSFIELD_LOW_CREDIT_THRESHOLD ?? 25),
      });
    }

    return json({ error: 'Method not allowed.' }, 405);
  } catch (error) {
    auditLogger.log({
      action: 'credits-management',
      actor: auth.subject,
      system: 'Higgsfield-Integration-Layer',
      status: 'failure',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });

    return json({ error: error instanceof Error ? error.message : 'Credit management failed.' }, 500);
  }
}
