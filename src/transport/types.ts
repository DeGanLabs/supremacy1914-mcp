import type { ActionResult, SignedActionEnvelope } from "../types/actions.js";

export interface ActionTransport {
  send(action: SignedActionEnvelope): Promise<ActionResult>;
}

export interface HttpTransportOptions {
  readonly timeoutMs: number;
  readonly fetchImpl?: typeof fetch;
}
