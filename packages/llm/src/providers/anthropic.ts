import Anthropic from '@anthropic-ai/sdk';
import { ChatBackedProvider } from '../chat-backed.js';
import type { ChatMessage } from '../types.js';

export class AnthropicProvider extends ChatBackedProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly client: Anthropic;
  private systemPrompt: string | null = null;

  constructor(apiKey: string, model: string) {
    super();
    this.model = model;
    this.client = new Anthropic({ apiKey });
  }

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  async chat(input: string | ChatMessage[]): Promise<string> {
    const messages: ChatMessage[] = typeof input === 'string'
      ? (this.systemPrompt ? [{ role: 'system', content: this.systemPrompt }, { role: 'user', content: input }] : [{ role: 'user', content: input }])
      : input;

    const systemText = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n') || this.systemPrompt || undefined;

    const turns = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: systemText,
      messages: turns,
    });
    return res.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }

  async *chatStream(
    input: string | ChatMessage[],
    options: { signal?: AbortSignal } = {},
  ): AsyncIterable<string> {
    const messages: ChatMessage[] = typeof input === 'string'
      ? (this.systemPrompt ? [{ role: 'system', content: this.systemPrompt }, { role: 'user', content: input }] : [{ role: 'user', content: input }])
      : input;

    const systemText = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n') || this.systemPrompt || undefined;

    const turns = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 1024,
      system: systemText,
      messages: turns,
    });
    for await (const event of stream) {
      if (options.signal?.aborted) return;
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }
}
