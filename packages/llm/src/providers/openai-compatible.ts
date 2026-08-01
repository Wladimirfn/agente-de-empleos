import OpenAI from 'openai';
import { ChatBackedProvider } from '../chat-backed.js';
import type { ChatMessage } from '../types.js';

export interface OpenAICompatibleOptions {
  name: string;
  model: string;
  apiKey: string;
  baseURL?: string;
}

/**
 * Strip <think>...</think> blocks that reasoning models (MiniMax, DeepSeek, etc.)
 * emit. The user should never see raw model reasoning.
 */
export function stripThink(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim();
}

export class OpenAICompatibleProvider extends ChatBackedProvider {
  readonly name: string;
  readonly model: string;
  private readonly client: OpenAI;
  private systemPrompt: string | null;

  constructor(options: OpenAICompatibleOptions) {
    super();
    this.name = options.name;
    this.model = options.model;
    this.client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL });
    this.systemPrompt = null;
  }

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  private buildMessages(input: string | ChatMessage[]): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    if (typeof input === 'string') {
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
      if (this.systemPrompt) messages.push({ role: 'system', content: this.systemPrompt });
      messages.push({ role: 'user', content: input });
      return messages;
    }
    const hasSystem = input.some((m) => m.role === 'system');
    const messages = (hasSystem ? input : (this.systemPrompt ? [{ role: 'system' as const, content: this.systemPrompt }, ...input] : input))
      .map((m) => ({ role: m.role, content: m.content }));
    return messages;
  }

  async chat(input: string | ChatMessage[]): Promise<string> {
    const messages = this.buildMessages(input);
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages,
    });
    return stripThink(res.choices[0]?.message?.content ?? '');
  }

  async *chatStream(
    input: string | ChatMessage[],
    options: { signal?: AbortSignal } = {},
  ): AsyncIterable<string> {
    const messages = this.buildMessages(input);
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      stream: true,
    });
    let pendingThink: string | null = null;
    let thinkDepth = 0;
    for await (const part of stream) {
      if (options.signal?.aborted) return;
      const delta = part.choices?.[0]?.delta?.content;
      if (!delta) continue;
      // Strip <think> incrementally so reasoning models don't leak.
      let chunk = delta;
      if (thinkDepth > 0 || pendingThink !== null || chunk.includes('<think>')) {
        pendingThink = (pendingThink ?? '') + chunk;
        // Count opening/closing tags incrementally.
        const opens = (pendingThink.match(/<think>/g) ?? []).length;
        const closes = (pendingThink.match(/<\/think>/g) ?? []).length;
        if (opens === 0 && closes === 0) {
          // No think markers yet, just buffer.
          continue;
        }
        if (opens === closes) {
          // Complete think block in the buffer; strip and emit remainder.
          const after = pendingThink.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '');
          pendingThink = null;
          thinkDepth = 0;
          if (after) yield after;
          continue;
        }
        // Partial think block — keep buffering.
        thinkDepth = opens - closes;
        continue;
      }
      yield chunk;
    }
  }
}
