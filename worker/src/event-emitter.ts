import { db } from '@employment-agent/database';
import { applicationEvents } from '@employment-agent/database/schema';
import type { EventPayload, EventEmitter } from '@employment-agent/skill-runtime';

/**
 * Database-backed event emitter. Writes events to application_events.
 */
export class DatabaseEventEmitter implements EventEmitter {
  async emit(event: EventPayload): Promise<void> {
    await db.insert(applicationEvents).values({
      applicationId: null,
      kind: event.kind,
      message: event.message,
      payloadJson: event.payload !== undefined ? JSON.stringify(event.payload) : null,
    });
  }
}
