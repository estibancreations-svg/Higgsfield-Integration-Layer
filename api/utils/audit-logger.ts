export interface AuditLogEntry {
  action: string;
  actor: string;
  system: string;
  status: 'success' | 'failure';
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

export class AuditLogger {
  constructor(private readonly governanceSystem = process.env.GOVERNANCE_SYSTEM_NAME ?? 'Master-System-Buildout') {}

  log(entry: AuditLogEntry): void {
    const payload = {
      timestamp: new Date().toISOString(),
      governanceSystem: this.governanceSystem,
      ...entry,
    };

    const message = JSON.stringify(payload);
    if (entry.status === 'failure') {
      console.error(message);
      return;
    }

    console.info(message);
  }
}

export const auditLogger = new AuditLogger();
