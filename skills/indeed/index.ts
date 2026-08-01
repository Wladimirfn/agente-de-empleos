/**
 * @employment-agent/skill-indeed
 *
 * Indeed.cl browser skill — Units 1 + 2 + 3.
 *
 * Unit 1 surface:
 *   types, constants, URL helpers, page classifier, dual mosaic/DOM parser.
 *
 * Unit 2 surface:
 *   persistent-context launcher, bounded challenge retry, blocked-throw,
 *   dedupe-by-externalId scan orchestration.
 *
 * Unit 3 surface (this batch):
 *   `selfCheck` (read-only health probe) and the `indeedSkill: PlatformSkill`
 *   constant. The skill is wired into the registry from
 *   `worker/src/skill-init.ts` alongside computrabajo / laborum /
 *   example-platform.
 *
 * Usage from tests:
 *   import { classifyPage, parseSearchPage, scanIndeed, selfCheck, indeedSkill } from '@employment-agent/skill-indeed';
 */

// Constants + types
export {
  BASE_URL,
  PROFILE_DIR,
  PAGE_SIZE,
  MAX_PAGES_PER_QUERY,
  MAX_QUERIES,
  MAX_CHALLENGE_RETRIES,
  DEFAULT_QUERIES,
  DEFAULT_USER_AGENT,
} from './src/types.js';

export type {
  NormalizedJob,
  PageClass,
  PersistentPage,
  MosaicJobCard,
  MosaicJobCardsModel,
  MosaicData,
  RawDomCard,
  ParseResult,
} from './src/types.js';

// Backoff
export { backoffMs, backoffBounds } from './src/backoff.js';

// URL + query helpers
export { buildQueries, buildSearchUrl, buildCanonicalUrl, extractJkFromUrl } from './src/url.js';

// Classifier
export {
  classifyPage,
  hasJobsMarker,
  isChallengeMarker,
  isBlockedMarker,
} from './src/classify.js';

// Dual parser
export {
  extractMosaicJson,
  parseDomCards,
  parseSearchPage,
  mapMosaicJobCard,
  mapDomCard,
  mapIndeedJob,
} from './src/parser.js';

// Unit 2 — persistent context + scan orchestration
export {
  openPersistentContext,
  resolveHeadless,
  resolveProfileDir,
  type PersistentContextHandle,
  type OpenContextOptions,
} from './src/context.js';

export {
  scanIndeed,
  scanWithPersistentContext,
  type ScanHooks,
  type ScanOptions,
} from './src/scan.js';

// Unit 3 — read-only health probe
export {
  selfCheck,
  SELF_CHECK_URL,
  type SelfCheckHooks,
  type SelfCheckOptions,
} from './src/selfCheck.js';

// Unit 3 — PlatformSkill constant (wired in worker/src/skill-init.ts)
export { indeedSkill, INDEED_SKILL_VERSION } from './src/skill.js';