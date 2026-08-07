/**
 * Browser agent — LLM-driven browser that navigates job portals,
 * handles challenges, searches for jobs, and saves results.
 *
 * The agent loop:
 *   1. Extract page state (URL, text, interactive elements)
 *   2. Send to LLM with conversation history
 *   3. LLM responds with a JSON action
 *   4. Execute the action via browser tools
 *   5. Repeat until "done" or max steps reached
 */

import type { LLMProvider, ChatMessage } from '@employment-agent/llm';
import type { CandidateProfile } from '@employment-agent/domain';
import type { BrowserAgentTools, PageState } from './browser-tools.js';
import { createBrowserTools, hasUrlCredentials, sanitizeOutbound, sanitizeUrlsInText } from './browser-tools.js';
import { detectChallenge, type ChallengeKind } from './challenge-detector.js';

export interface BrowserAgentResult {
  jobsFound: number;
  jobsNew: number;
  jobsDuplicate: number;
  errors: number;
  steps: number;
  summary: string;
}

export interface BrowserAgentJob {
  externalId: string;
  title: string;
  company?: string;
  location?: string;
  url?: string;
  description?: string;
  postedAt?: string;
}

const MAX_STEPS = 25;
const MAX_WAIT_HUMAN = 2;
const ACTIONS = new Set(['navigate', 'click', 'type', 'press_enter', 'scroll', 'go_back', 'wait_human', 'save_jobs', 'done']);
export function safeActionName(value: unknown): string {
  const action = String(value ?? '');
  return ACTIONS.has(action) ? action : 'unknown';
}
export function sanitizeBrowserJobs(jobs: unknown[]): BrowserAgentJob[] {
  return sanitizeOutbound(jobs.filter((value) => {
    const job = value as Record<string, unknown>;
    return typeof job.externalId === 'string' && typeof job.title === 'string'
      && !hasUrlCredentials(job.externalId)
      && (typeof job.url !== 'string' || !hasUrlCredentials(job.url));
  })) as BrowserAgentJob[];
}

const SYSTEM_PROMPT = `You are a browser agent controlling a web browser to search for jobs on a specific platform.

You will receive the current page state (URL, title, visible text, and numbered interactive elements).
You must respond with EXACTLY ONE JSON object (no markdown, no code fences) describing your next action.

Available actions:
- {"action":"navigate","url":"https://..."} — go to a URL
- {"action":"click","index":N} — click element N from the elements list
- {"action":"type","index":N,"text":"..."} — type text into input N
- {"action":"press_enter"} — press Enter key
- {"action":"scroll","direction":"up"|"down"} — scroll the page
- {"action":"go_back"} — go back to previous page
- {"action":"wait_human","message":"..."} — ask the human to solve a challenge (CAPTCHA, login). Use when you see a challenge you cannot solve.
- {"action":"save_jobs","jobs":[...]} — save job listings you found. Each job: {"externalId":"...","title":"...","company":"...","location":"...","url":"...","description":"..."}. Use the job's URL or ID as externalId.
- {"action":"done","summary":"..."} — you are finished. Summarize what you found.

Rules:
1. Always respond with exactly one JSON object, nothing else.
2. Use the element index numbers from the current page state.
3. FIRST analyze the page: look for search inputs, location/region filters, and category filters. Use them.
4. ALWAYS apply the candidate's location filter when the page offers one (dropdown, input, checkbox, URL parameter).
5. When searching, use SHORT queries (1-3 words), not long phrases.
6. When you find job listings, extract them and use save_jobs. Include the job's location as shown on the page.
7. If you see a CAPTCHA or Cloudflare challenge, use wait_human.
8. If the page requires login, use wait_human with instructions.
9. After saving jobs from ALL queries, use done.
10. If the page shows no results after searching, try the next query. After all queries, use done.
11. Be efficient — don't repeat actions that already worked.
12. When extracting jobs, scroll down to load more results if the page uses lazy loading or pagination.
13. If the page has pagination, navigate through at least 2 pages of results per query.
14. NEVER guess search-result URLs. Navigate ONLY to the platform homepage or to hrefs you actually see in the elements list. To search, use the page's own search input (type + press_enter) — guessing URLs wastes steps and usually fails.
15. Your ONLY goal is to call save_jobs with real listings. Every step that doesn't move you toward visible job listings is wasted.`;

export function buildAgentPrompt(
  platform: string,
  profile: CandidateProfile,
  queries: string[],
  loginCredentials?: { email: string; password: string },
): string {
  const roles = profile.summary?.match(/Roles objetivo activos:\s*(.+)/)?.[1] ?? 'no definidos';
  const location = profile.location ?? 'no definida';
  const skills = (profile.skills ?? [])
    .filter((s) => (s.name?.length ?? 0) <= 30)
    .map((s) => s.name)
    .slice(0, 10)
    .join(', ');

  const loginBlock = loginCredentials
    ? `\n\nLogin credentials on file (already consented to by the user):
- Email: ${loginCredentials.email}
- Password: ${loginCredentials.password}
If the page shows a login form on the approved origin, fill these fields and submit. If a 2FA / verification code prompt appears, use wait_human and stop — the user will provide the code. Never type the password on any other domain.`
    : '';

  return sanitizeOutbound(`Goal: Search for jobs on ${platform}.

Candidate profile:
- Location: ${location} — YOU MUST filter by this location when the page offers a location/region filter
- Target roles: ${roles}
- Key skills: ${skills || 'none listed'}

Search queries to try (in order): ${queries.join(', ')}${loginBlock}

Instructions:
1. Navigate to the platform's homepage.
2. Look for a search input AND a location/region filter. Fill BOTH before searching.
3. If the location filter is a dropdown, select the option closest to "${location}".
4. Search for each query. For each query, scroll through results and extract job listings.
5. For each job: extract title, company, location (as shown), URL, and brief description.
6. When done with all queries, save ALL jobs found and finish.`);
}

function formatPageState(state: PageState): string {
  const elements = state.elements
    .map((el) => {
      const parts = [`[${el.index}] <${el.tag}>`];
      if (el.text) parts.push(`"${el.text}"`);
      if (el.href) parts.push(`href=${el.href}`);
      if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
      if (el.type && el.type !== 'text') parts.push(`type=${el.type}`);
      if (el.ariaLabel) parts.push(`aria-label="${el.ariaLabel}"`);
      return parts.join(' ');
    })
    .join('\n');

  return `URL: ${state.url}
Title: ${state.title}

Visible text (truncated):
${state.text}

Interactive elements (${state.elements.length}):
${elements || '(none found)'}`;
}

function parseAction(response: string): Record<string, unknown> | null {
  // Try to extract JSON from the response
  // The LLM might wrap it in markdown code fences or add extra text
  let cleaned = response.trim();

  // Remove markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  // Find the first { and last }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;

  const jsonStr = cleaned.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function runBrowserAgent(args: {
  platform: string;
  platformUrl: string;
  queries: string[];
  profile: CandidateProfile;
  llm: LLMProvider;
  headless?: boolean;
  storageState?: string;
  loginCredentials?: { email: string; password: string };
  existingBrowser?: import('playwright').Browser;
  onJobsFound?: (jobs: BrowserAgentJob[]) => Promise<{ new: number; duplicate: number }>;
  onEvent?: (kind: string, message: string) => Promise<void>;
  onBlocked?: (reason: ChallengeKind | 'transport' | 'unknown', marker: string | null) => Promise<void>;
}): Promise<BrowserAgentResult> {
  const { platform, platformUrl, queries, profile, llm } = args;
  const emit = args.onEvent ?? (async () => {});
  const onBlocked = args.onBlocked ?? (async () => {});

  const loginCredentials = args.loginCredentials;

  let totalNew = 0;
  let totalDup = 0;
  let errors = 0;
  let steps = 0;
  let stepsSinceSave = 0;
  let totalSaves = 0;
  let waitHumanCount = 0;

  const tools = await createBrowserTools({
    headless: args.headless ?? false,
    storageState: args.storageState,
    approvedOrigin: new URL(platformUrl).origin,
    existingBrowser: args.existingBrowser,
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildAgentPrompt(platform, profile, queries, loginCredentials) },
  ];

  try {
    // Navigate to the platform
    await emit('agent_started', `Browser agent iniciado para ${platform}`);
    const navResult = await tools.navigate(platformUrl);
    await emit('agent_navigate', navResult);

    while (steps < MAX_STEPS) {
      steps++;

      // Extract current page state
      const state = await tools.extractPage();
      const stateText = formatPageState(state);

      // Early challenge detection: short-circuit before burning steps on a
      // Cloudflare-style wall or a login form the agent cannot solve.
      const challenge = detectChallenge(state);
      if (challenge) {
        await emit('agent_challenge_detected', `Challenge detected: ${challenge.kind} (marker: ${challenge.marker})`);
        await onBlocked(challenge.kind, challenge.marker);
        const summary = `Blocked by ${challenge.kind} (${sanitizeUrlsInText(challenge.marker)}). Agent cannot solve this from an automated environment.`;
        await emit('agent_done', summary);
        return {
          jobsFound: totalNew + totalDup,
          jobsNew: totalNew,
          jobsDuplicate: totalDup,
          errors,
          steps,
          summary,
        };
      }

      // Send to LLM
      messages.push({ role: 'user', content: `Current page state:\n${stateText}` });

      // Trim conversation if too long (keep system + first user + last 10)
      if (messages.length > 15) {
        messages.splice(2, messages.length - 12);
      }

      let response: string;
      try {
        response = await llm.chat(sanitizeOutbound(messages));
      } catch (err) {
        errors++;
        await emit('agent_error', `LLM error: ${sanitizeUrlsInText(err instanceof Error ? err.message : String(err))}`);
        break;
      }

      messages.push({ role: 'assistant', content: sanitizeUrlsInText(response) });

      // Parse the action
      const action = parseAction(response);
      if (!action) {
        errors++;
        await emit('agent_error', 'Failed to parse LLM action');
        messages.push({ role: 'user', content: 'Invalid response. Respond with exactly one JSON action object.' });
        continue;
      }

      const actionType = safeActionName(action.action);
      await emit('agent_action', `Step ${steps}: ${actionType}`);

      // Execute the action
      let result = '';
      switch (actionType) {
        case 'navigate': {
          const url = String(action.url ?? '');
          if (!url) { result = 'Missing url'; break; }
          result = await tools.navigate(url);
          break;
        }
        case 'click': {
          const idx = Number(action.index);
          if (!Number.isFinite(idx)) { result = 'Missing or invalid index'; break; }
          result = await tools.click(idx);
          break;
        }
        case 'type': {
          const idx = Number(action.index);
          const text = String(action.text ?? '');
          if (!Number.isFinite(idx) || !text) { result = 'Missing index or text'; break; }
          result = await tools.typeText(idx, text);
          break;
        }
        case 'press_enter':
          result = await tools.pressEnter();
          break;
        case 'scroll':
          result = await tools.scroll(action.direction === 'up' ? 'up' : 'down');
          break;
        case 'go_back':
          result = await tools.goBack();
          break;
        case 'wait_human': {
          if (waitHumanCount >= MAX_WAIT_HUMAN) {
            await emit('agent_challenge_detected', `wait_human cap reached (${MAX_WAIT_HUMAN}); forcing done with blocked`);
            await onBlocked('unknown', 'wait_human-cap');
            const summary = `wait_human cap reached (${MAX_WAIT_HUMAN}). Marking platform as blocked.`;
            await emit('agent_done', summary);
            return {
              jobsFound: totalNew + totalDup,
              jobsNew: totalNew,
              jobsDuplicate: totalDup,
              errors,
              steps,
              summary,
            };
          }
          waitHumanCount++;
          const msg = sanitizeUrlsInText(String(action.message ?? 'Human intervention needed'));
          await emit('agent_wait_human', msg);
          result = await tools.waitForHuman(msg);
          break;
        }
        case 'save_jobs': {
          const jobs = Array.isArray(action.jobs) ? action.jobs : [];
          const validJobs = sanitizeBrowserJobs(jobs);

          if (validJobs.length > 0 && args.onJobsFound) {
            const counts = await args.onJobsFound(validJobs);
            totalNew += counts.new;
            totalDup += counts.duplicate;
            result = `Saved ${validJobs.length} jobs (${counts.new} new, ${counts.duplicate} duplicates)`;
          } else {
            result = `No valid jobs to save (got ${jobs.length} items)`;
          }
          await emit('agent_save', result);
          break;
        }
        case 'done': {
          const summary = sanitizeUrlsInText(String(action.summary ?? 'Agent finished'));
          await emit('agent_done', summary);
          return {
            jobsFound: totalNew + totalDup,
            jobsNew: totalNew,
            jobsDuplicate: totalDup,
            errors,
            steps,
            summary,
          };
        }
        default:
          result = `Unknown action: ${actionType}`;
          errors++;
      }

      // Add result to conversation
      messages.push({ role: 'user', content: `Action result: ${result}` });

      // Anti-spin guard: nudge the model when it burns steps without saving.
      // Weak models tend to guess URLs and click around forever — a direct
      // correction brings them back to the actual goal (save_jobs).
      if (actionType === 'save_jobs') {
        stepsSinceSave = 0;
        totalSaves++;
      } else {
        stepsSinceSave++;
      }
      if (stepsSinceSave === 8) {
        await emit('agent_nudge', 'Agent spinning (8 steps without saving) — injecting correction');
        messages.push({ role: 'user', content: 'STOP. You have spent 8 steps navigating and clicking without saving a single job. Do NOT guess URLs. Look at the CURRENT page state in the previous message: if job listings are visible, respond with save_jobs extracting them NOW. If the page has a search input, use type + press_enter on it. If there are genuinely no jobs for this query, move to the next query or respond with done.' });
      } else if (stepsSinceSave === 15 && totalSaves === 0) {
        await emit('agent_nudge', 'Agent still spinning (15 steps, 0 saves) — final warning');
        messages.push({ role: 'user', content: 'FINAL WARNING: you are about to run out of steps and have saved ZERO jobs. On your NEXT response, either emit save_jobs with whatever job listings are visible in the current page (even partial: title + url is enough), or emit done with an honest summary. No more navigating.' });
      }
    }

    // Max steps reached
    const summary = `Reached max steps (${MAX_STEPS})`;
    await emit('agent_done', summary);
    return {
      jobsFound: totalNew + totalDup,
      jobsNew: totalNew,
      jobsDuplicate: totalDup,
      errors,
      steps,
      summary,
    };
  } finally {
    await tools.close();
  }
}
