import type { SignedActionEnvelope, ActionResult } from "../types/actions.js";
import type { SessionConfig } from "../types/auth.js";
import type { ActionTransport, HttpTransportOptions } from "./types.js";

/**
 * Posts a signed UltUpdateGameStateAction JSON body to the game server URI.
 * Mirrors client `server.sendMessage` → `POST serverUri` with JSON string body.
 *
 * Auth is in the JSON (`userAuth`, `tstamp`, ids) — optional Cookie header supported.
 */
export class HttpGameTransport implements ActionTransport {
  constructor(
    private readonly getSession: () => Promise<SessionConfig> | SessionConfig,
    private readonly options: HttpTransportOptions,
  ) {}

  async send(action: SignedActionEnvelope): Promise<ActionResult> {
    const session = await this.getSession();
    const body = JSON.stringify(action);
    const headers: Record<string, string> = {
      "Content-Type": "application/json;charset=UTF-8",
      Accept: "text/plain, */*",
    };
    if (session.cookieHeader) {
      headers.Cookie = session.cookieHeader;
    }

    const fetchImpl = this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await fetchImpl(session.gameServerUri, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      const text = await response.text();
      if (!response.ok) {
        return {
          ok: false,
          requestId: action.requestID,
          error: `HTTP ${response.status}: ${text.slice(0, 500)}`,
          raw: text,
        };
      }

      let raw: unknown = text;
      try {
        raw = JSON.parse(text);
      } catch {
        // server sometimes returns plain text
      }

      return {
        ok: true,
        requestId: action.requestID,
        raw,
      };
    } catch (error) {
      return {
        ok: false,
        requestId: action.requestID,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
