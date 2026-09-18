export interface AuthContext {
  authorized: boolean;
  status: number;
  subject: string;
  source: 'api-key' | 'jwt' | 'unknown';
  permissions: string[];
  message?: string;
}

interface JwtPayload {
  sub?: string;
  permissions?: string[];
  exp?: number;
  project_ids?: string[];
  [key: string]: unknown;
}

const textEncoder = new TextEncoder();

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

async function verifyHs256Jwt(token: string, secret: string): Promise<JwtPayload | null> {
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  if (!headerPart || !payloadPart || !signaturePart) {
    return null;
  }

  const header = JSON.parse(base64UrlDecode(headerPart)) as { alg?: string };
  if (header.alg !== 'HS256') {
    return null;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const signature = Buffer.from(signaturePart.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const verified = await crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    textEncoder.encode(`${headerPart}.${payloadPart}`),
  );

  if (!verified) {
    return null;
  }

  const payload = JSON.parse(base64UrlDecode(payloadPart)) as JwtPayload;
  if (payload.exp && payload.exp * 1000 < Date.now()) {
    return null;
  }

  return payload;
}

export async function authorizeRequest(request: Request, requiredPermissions: string[] = []): Promise<AuthContext> {
  const apiKey = request.headers.get('x-api-key');
  const configuredApiKey = process.env.INTEGRATION_API_KEY;
  if (apiKey && configuredApiKey && apiKey === configuredApiKey) {
    return {
      authorized: true,
      status: 200,
      subject: 'integration-api-key',
      source: 'api-key',
      permissions: requiredPermissions.length ? requiredPermissions : ['*'],
    };
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;
  const jwtSecret = process.env.CEO_DASHBOARD_JWT_SECRET;

  if (token && jwtSecret) {
    const payload = await verifyHs256Jwt(token, jwtSecret);
    if (payload) {
      const permissions = Array.isArray(payload.permissions)
        ? payload.permissions.filter((value): value is string => typeof value === 'string')
        : [];
      const hasPermission = requiredPermissions.every((permission) => permissions.includes(permission) || permissions.includes('*'));

      if (hasPermission) {
        return {
          authorized: true,
          status: 200,
          subject: typeof payload.sub === 'string' ? payload.sub : 'ceo-dashboard-user',
          source: 'jwt',
          permissions,
        };
      }

      return {
        authorized: false,
        status: 403,
        subject: typeof payload.sub === 'string' ? payload.sub : 'ceo-dashboard-user',
        source: 'jwt',
        permissions,
        message: 'Insufficient permissions for this route.',
      };
    }
  }

  return {
    authorized: false,
    status: 401,
    subject: 'anonymous',
    source: 'unknown',
    permissions: [],
    message: 'Provide a valid x-api-key or CEO Dashboard bearer token.',
  };
}
