import type { EventEmitter, BrowserPool } from './types.js';

export function createSkillContext(events: EventEmitter, browserPool?: BrowserPool) {
  return {
    events,
    browserPool,
  };
}
