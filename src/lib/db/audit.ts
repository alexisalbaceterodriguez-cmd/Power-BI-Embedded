import { queryRows, sql, nowIso } from '@/lib/db/pool';
import { ensureDataLayer } from '@/lib/db/schema';

export async function recordAuditEvent(params: {
  eventType: string;
  userId?: string;
  ip?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await ensureDataLayer();

  await queryRows(
    `INSERT INTO audit_log (event_type, user_id, ip, detail_json, created_at)
     VALUES (@event_type, @user_id, @ip, @detail_json, @created_at)`,
    (request) => {
      request.input('event_type', sql.NVarChar(128), params.eventType);
      request.input('user_id', sql.NVarChar(64), params.userId ?? null);
      request.input('ip', sql.NVarChar(128), params.ip ?? null);
      request.input('detail_json', sql.NVarChar(sql.MAX), params.detail ? JSON.stringify(params.detail) : null);
      request.input('created_at', sql.DateTime2, nowIso());
    }
  );
}
