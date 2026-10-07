export class AgentError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'AgentError'; }
}
export function errorCode(error: unknown): string {
  return error instanceof AgentError ? error.code : 'AGENT_OPERATION_FAILED';
}
