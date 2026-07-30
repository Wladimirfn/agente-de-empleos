import { describe, it, expect } from 'vitest';
import { examplePlatformSkill } from '../index.js';
import { HumanInterventionRequired } from '@employment-agent/skill-runtime';
import type { EventPayload } from '@employment-agent/skill-runtime';

function createMockContext() {
  const events: EventPayload[] = [];
  return {
    events: {
      async emit(event: EventPayload) {
        events.push(event);
      },
    },
    emittedEvents: events,
  };
}

describe('examplePlatformSkill', () => {
  it('has correct metadata', () => {
    expect(examplePlatformSkill.slug).toBe('example-platform');
    expect(examplePlatformSkill.version).toBe('0.1.0');
    expect(examplePlatformSkill.capabilities.canScan).toBe(true);
    expect(examplePlatformSkill.capabilities.canApply).toBe(false);
  });

  it('scan emits started, found, completed events', async () => {
    const ctx = createMockContext();
    const result = await examplePlatformSkill.scan({}, ctx);
    expect(result.jobsFound).toBe(5);
    expect(result.jobsNew).toBe(5);
    expect(result.errors).toBe(0);
    const kinds = ctx.emittedEvents.map((e) => e.kind);
    expect(kinds).toContain('scan_started');
    expect(kinds).toContain('scan_completed');
    expect(kinds.filter((k) => k === 'job_found')).toHaveLength(5);
  });

  it('apply throws HumanInterventionRequired', async () => {
    await expect(
      examplePlatformSkill.apply?.(
        { platformId: 1, externalId: 'x', title: 'T' },
        {},
        createMockContext() as never
      )
    ).rejects.toBeInstanceOf(HumanInterventionRequired);
  });

  it('selfCheck returns healthy', async () => {
    const health = await examplePlatformSkill.selfCheck();
    expect(health.status).toBe('healthy');
    expect(health.schemaVersion).toBe('0.1.0');
  });
});
