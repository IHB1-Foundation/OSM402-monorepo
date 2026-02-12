/**
 * In-memory event store for webhook idempotency (MVP)
 */

export interface WebhookEvent {
  id: string;
  deliveryId: string;
  type: string;
  action?: string;
  payloadHash: string;
  createdAt: Date;
}

const deliveries = new Set<string>();
const events: WebhookEvent[] = [];

/**
 * Check if a delivery ID has already been processed
 */
export function isDeliveryProcessed(deliveryId: string): boolean {
  return deliveries.has(deliveryId);
}

/**
 * Record a webhook delivery as processed
 */
export function recordDelivery(event: WebhookEvent): void {
  deliveries.add(event.deliveryId);
  events.push(event);
}

/**
 * Get all recorded events (for debugging)
 */
export function getAllEvents(): WebhookEvent[] {
  return [...events];
}
