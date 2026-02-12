/**
 * Webhook event store backed by SQLite for durable idempotency.
 */

import { getDb } from './db.js';

export interface WebhookEvent {
  id: string;
  deliveryId: string;
  type: string;
  action?: string;
  payloadHash: string;
  createdAt: Date;
}

export function isDeliveryProcessed(deliveryId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM events WHERE deliveryId = ?').get(deliveryId);
  return !!row;
}

export function recordDelivery(event: WebhookEvent): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO events (id, deliveryId, type, action, payloadHash, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    event.id, event.deliveryId, event.type,
    event.action ?? null, event.payloadHash,
    event.createdAt.toISOString(),
  );
}

export function getAllEvents(): WebhookEvent[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM events ORDER BY createdAt DESC').all() as Record<string, unknown>[];
  return rows.map(r => ({
    ...r,
    createdAt: new Date(r.createdAt as string),
  })) as WebhookEvent[];
}
