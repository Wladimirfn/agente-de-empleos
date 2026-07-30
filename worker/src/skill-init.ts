import { registry } from '@employment-agent/skill-runtime';
import { examplePlatformSkill } from '../../skills/example-platform/index.js';

export function initializeSkills(): void {
  registry.register(examplePlatformSkill);
  for (const skill of registry.list()) {
    console.log(`[skills] registered ${skill.slug} v${skill.version} — ${skill.displayName}`);
  }
}
