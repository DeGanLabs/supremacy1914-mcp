import type { BrowserBridgeServer } from "./bridge-client.js";
import type { SensorToolName } from "../cabinet/cost-caps.js";
import { COST_CAPS } from "../cabinet/cost-caps.js";
import { isSensorTool } from "./tools.js";

export class ScopeToolGateway {
  private toolCounts = new Map<string, number>();

  constructor(private readonly bridge: BrowserBridgeServer) {}

  isBridgeHealthy(): boolean {
    return this.bridge.isHealthy();
  }

  resetTurn(seatId: string): void {
    this.toolCounts.set(seatId, 0);
  }

  async call(
    seatId: string,
    allowedScopes: readonly string[],
    tool: SensorToolName,
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    if (!isSensorTool(tool)) {
      throw new Error(`unknown sensor tool: ${tool}`);
    }
    if (!allowedScopes.includes(tool)) {
      throw new Error(`tool out of scope for ${seatId}: ${tool}`);
    }
    const used = this.toolCounts.get(seatId) ?? 0;
    if (used >= COST_CAPS.maxToolCallsPerMinister) {
      throw new Error(
        `tool call cap (${COST_CAPS.maxToolCallsPerMinister}) reached for ${seatId}`,
      );
    }
    this.toolCounts.set(seatId, used + 1);

    if (!this.bridge.isHealthy()) {
      throw new Error("game not connected");
    }
    return this.bridge.call(tool, args);
  }
}
