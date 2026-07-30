import type { PlatformSkill } from './types.js';

class SkillRegistry {
  private skills = new Map<string, PlatformSkill>();

  register(skill: PlatformSkill): void {
    if (this.skills.has(skill.slug)) {
      throw new Error(`Skill already registered: ${skill.slug}`);
    }
    this.skills.set(skill.slug, skill);
  }

  unregister(slug: string): boolean {
    return this.skills.delete(slug);
  }

  get(slug: string): PlatformSkill | undefined {
    return this.skills.get(slug);
  }

  list(): PlatformSkill[] {
    return Array.from(this.skills.values());
  }

  clear(): void {
    this.skills.clear();
  }

  has(slug: string): boolean {
    return this.skills.has(slug);
  }
}

export const registry = new SkillRegistry();
