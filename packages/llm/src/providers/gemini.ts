import { GoogleGenAI } from '@google/genai';
import { ChatBackedProvider } from '../chat-backed.js';
import type { ChatMessage } from '../types.js';

export class GeminiProvider extends ChatBackedProvider {
  readonly name = 'gemini';
  readonly model: string;
  private readonly ai: GoogleGenAI;
  private systemPrompt: string | null = null;

  constructor(apiKey: string, model: string) {
    super();
    this.model = model;
    this.ai = new GoogleGenAI({ apiKey });
  }

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  private toContents(messages: ChatMessage[]) {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const turns = messages.filter((m) => m.role !== 'system');
    const systemInstruction = systemMessages.map((m) => m.content).join('\n\n') || this.systemPrompt || undefined;
    const contents = turns.map((m) => ({
      role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: m.content }],
    }));
    return { systemInstruction, contents };
  }

  async chat(input: string | ChatMessage[]): Promise<string> {
    const messages: ChatMessage[] = typeof input === 'string'
      ? (this.systemPrompt ? [{ role: 'system', content: this.systemPrompt }, { role: 'user', content: input }] : [{ role: 'user', content: input }])
      : input;

    const { systemInstruction, contents } = this.toContents(messages);
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents,
      config: systemInstruction ? { systemInstruction } : undefined,
    });
    return response.text ?? '';
  }

  async *chatStream(
    input: string | ChatMessage[],
    options: { signal?: AbortSignal } = {},
  ): AsyncIterable<string> {
    const messages: ChatMessage[] = typeof input === 'string'
      ? (this.systemPrompt ? [{ role: 'system', content: this.systemPrompt }, { role: 'user', content: input }] : [{ role: 'user', content: input }])
      : input;

    const { systemInstruction, contents } = this.toContents(messages);
    const response = await this.ai.models.generateContentStream({
      model: this.model,
      contents,
      config: systemInstruction ? { systemInstruction } : undefined,
    });
    for await (const chunk of response) {
      if (options.signal?.aborted) return;
      const text = chunk.text;
      if (text) yield text;
    }
  }
}
