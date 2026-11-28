export type ChatMessage = {role: 'system' | 'user' | 'assistant'; content: string};
type Complete = (messages: readonly ChatMessage[]) => Promise<string>;

export class AnswerError extends Error {
  constructor(readonly reason: 'http_error' | 'empty_answer', readonly status?: number) {
    super(reason);
  }
}

type AnswerResult =
  | {ok: true; text: string}
  | {ok: false; reason: string; status?: number};

export function createGroupConversation(complete: Complete, systemPrompt?: string) {
  return async (question: string): Promise<AnswerResult> => {
    try {
      const messages: ChatMessage[] = [{role: 'user', content: question}];
      if (systemPrompt) messages.unshift({role: 'system', content: systemPrompt});
      const text = await complete(messages);
      return {ok: true, text};
    } catch (error) {
      if (error instanceof AnswerError) return {ok: false, reason: error.reason, status: error.status};
      if (error instanceof SyntaxError) return {ok: false, reason: 'invalid_json'};
      if (error instanceof Error && error.name === 'TimeoutError') return {ok: false, reason: 'timeout'};
      return {ok: false, reason: 'request_failed'};
    }
  };
}
export type GroupConversation = ReturnType<typeof createGroupConversation>;
