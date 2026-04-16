import { queryRows, queryOne, sql, nowIso, toBit } from '@/lib/db/pool';
import type { DbClient } from '@/lib/db/types';
import type { ClientConfig } from '@/lib/dal';
import { ensureDataLayer } from '@/lib/db/schema';
import { normalizeClientId, toBoolean } from '@/lib/db/pool';

export async function listClientsForAdmin(): Promise<ClientConfig[]> {
  await ensureDataLayer();
  const rows = await queryRows<DbClient>(
    `SELECT id, display_name, is_active
     FROM clients
     ORDER BY display_name ASC`
  );

  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    isActive: toBoolean(row.is_active),
  }));
}

export async function createClientFromAdmin(input: { id: string; displayName: string; isActive?: boolean }): Promise<void> {
  await ensureDataLayer();

  const clientId = normalizeClientId(input.id);
  if (!clientId) throw new Error('Client id is required.');
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error('Client name is required.');

  await queryRows(
    `INSERT INTO clients (id, display_name, is_active, created_at, updated_at)
     VALUES (@id, @display_name, @is_active, @created_at, @updated_at)`,
    (request) => {
      request.input('id', sql.NVarChar(128), clientId);
      request.input('display_name', sql.NVarChar(256), displayName);
      request.input('is_active', sql.Bit, toBit(input.isActive !== false));
      request.input('created_at', sql.DateTime2, nowIso());
      request.input('updated_at', sql.DateTime2, nowIso());
    }
  );
}

export async function updateClientFromAdmin(input: { id: string; displayName: string; isActive?: boolean }): Promise<void> {
  await ensureDataLayer();

  const clientId = normalizeClientId(input.id);
  if (!clientId) throw new Error('Client id is required.');
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error('Client name is required.');

  await queryRows(
    `UPDATE clients
     SET display_name = @display_name,
         is_active = @is_active,
         updated_at = @updated_at
     WHERE id = @id`,
    (request) => {
      request.input('id', sql.NVarChar(128), clientId);
      request.input('display_name', sql.NVarChar(256), displayName);
      request.input('is_active', sql.Bit, toBit(input.isActive !== false));
      request.input('updated_at', sql.DateTime2, nowIso());
    }
  );
}

export async function ensureClientExists(clientIdRaw: string): Promise<string> {
  const clientId = normalizeClientId(clientIdRaw);
  if (!clientId) throw new Error('Client is required.');

  const exists = await queryOne<{ id: string }>(
    'SELECT TOP (1) id FROM clients WHERE id = @id AND is_active = 1',
    (request) => request.input('id', sql.NVarChar(128), clientId)
  );
  if (!exists) throw new Error(`Client not found or inactive: ${clientId}`);
  return clientId;
}
