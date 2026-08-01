/**
 * Public shape of a job listing returned by any job source.
 *
 * This is the minimal subset the application needs to save a job to the
 * database, match it against the candidate profile and render it in the
 * UI. Source-specific extras stay in `rawPayload` for future use.
 */
export interface JobSourceResult {
  /** Stable external id, e.g. the slug GetOnboard returns. */
  externalId: string;
  /** The source platform slug, e.g. "getonboard". */
  platformSlug: string;
  title: string;
  company?: string;
  location?: string;
  url?: string;
  description?: string;
  /** Raw JSON from the source for forensic/debug purposes. */
  rawPayload?: unknown;
}

/**
 * A job source knows how to fetch listings for a search query.
 *
 * Sources are stateless and synchronous-only over HTTP — no auth, no
 * cookies, no long-lived connections. If a source needs authentication
 * later, it becomes a separate interface (the browser-skill flow).
 */
export interface JobSource {
  readonly name: string;
  /**
   * Run a text search and return the raw results. `query` is free-form
   * text (e.g. "jefe de mantención"), `location` is a free-form city or
   * region (e.g. "Puerto Montt"). Implementations should be defensive:
   * if the upstream returns garbage, they should return an empty array
   * rather than throw.
   */
  searchJobs(query: string, location?: string): Promise<JobSourceResult[]>;
}
