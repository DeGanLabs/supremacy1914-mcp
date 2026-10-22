import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { createRequestId } from "../cabinet/ids.js";
import {
  BridgeHeartbeatSchema,
  BridgeHelloSchema,
  BridgeResponseSchema,
  type BridgeOutbound,
} from "./bridge-protocol.js";

export interface BridgeStatus {
  connected: boolean;
  gameId: number | null;
  playerId: number | null;
  siteUserId: number | null;
  lastHeartbeatAt: number | null;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  gameId: number;
}

function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === "::ffff:127.0.0.1" ||
    addr.endsWith("127.0.0.1")
  );
}

export type BridgeHelloHandler = (info: {
  readonly gameId: number;
  readonly playerId: number;
  readonly siteUserId: number | null;
}) => void | Promise<void>;

export class BrowserBridgeServer {
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private status: BridgeStatus = {
    connected: false,
    gameId: null,
    playerId: null,
    siteUserId: null,
    lastHeartbeatAt: null,
  };
  private readonly pending = new Map<string, Pending>();
  private readonly doneIds = new Set<string>();
  private helloHandler: BridgeHelloHandler | null = null;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly requestTimeoutMs = 20000,
    private readonly token = "",
    private readonly requireLoopback = true,
  ) {}

  /** Fired after a successful authenticated hello (match bind). */
  onHello(handler: BridgeHelloHandler): void {
    this.helloHandler = handler;
  }

  start(): void {
    this.wss = new WebSocketServer({ host: this.host, port: this.port });
    this.wss.on("connection", (ws, req: IncomingMessage) => {
      const ip = req.socket.remoteAddress;
      if (this.requireLoopback && !isLoopback(ip)) {
        ws.close(4003, "loopback only");
        return;
      }
      ws.on("message", (raw) => this.onMessage(String(raw), ws));
      ws.on("close", () => {
        if (this.socket === ws) {
          this.socket = null;
          this.status.connected = false;
          this.rejectAll(new Error("bridge disconnected"));
        }
      });
    });
  }

  stop(): void {
    this.rejectAll(new Error("bridge stopped"));
    this.socket?.close();
    this.wss?.close();
    this.wss = null;
  }

  getStatus(): BridgeStatus {
    return { ...this.status };
  }

  isHealthy(maxHeartbeatAgeMs = 45000): boolean {
    if (!this.status.connected || this.status.gameId == null) return false;
    if (this.status.lastHeartbeatAt == null) return false;
    return Date.now() - this.status.lastHeartbeatAt <= maxHeartbeatAgeMs;
  }

  /** Mark an idempotency key as consumed (approve path). */
  markDone(idempotencyKey: string): void {
    this.doneIds.add(idempotencyKey);
    if (this.doneIds.size > 2000) {
      const first = this.doneIds.values().next().value;
      if (first) this.doneIds.delete(first);
    }
  }

  wasDone(idempotencyKey: string): boolean {
    return this.doneIds.has(idempotencyKey);
  }

  async call(
    method: string,
    args: Record<string, unknown> = {},
    options?: { readonly gameId?: number; readonly id?: string },
  ): Promise<unknown> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("game not connected");
    }
    const gameId = options?.gameId ?? this.status.gameId;
    if (gameId == null) throw new Error("game not connected (no gameId)");
    if (this.status.gameId != null && gameId !== this.status.gameId) {
      throw new Error(
        `gameId lock mismatch: request=${gameId} open=${this.status.gameId}`,
      );
    }

    const id = options?.id ?? createRequestId();
    const payload: BridgeOutbound = {
      type: "request",
      id,
      gameId,
      method,
      args,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`bridge timeout: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer, gameId });
      this.socket!.send(JSON.stringify(payload));
    });
  }

  private onMessage(raw: string, ws: WebSocket): void {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const hello = BridgeHelloSchema.safeParse(data);
    if (
      data &&
      typeof data === "object" &&
      (data as { type?: string }).type === "hello"
    ) {
      if (!hello.success) {
        ws.close(4001, "bad bridge hello");
        return;
      }
      if (!this.token || hello.data.token !== this.token) {
        ws.close(4001, "bad bridge token");
        return;
      }
      if (this.socket && this.socket !== ws) {
        try {
          this.socket.close(4000, "replaced");
        } catch {
          /* ignore */
        }
      }
      this.socket = ws;
      this.status = {
        connected: true,
        gameId: hello.data.gameId,
        playerId: hello.data.playerId,
        siteUserId: hello.data.siteUserId ?? null,
        lastHeartbeatAt: Date.now(),
      };
      console.log(
        `bridge hello ok gameId=${hello.data.gameId} playerId=${hello.data.playerId}`,
      );
      const handler = this.helloHandler;
      if (handler) {
        void Promise.resolve(
          handler({
            gameId: hello.data.gameId,
            playerId: hello.data.playerId,
            siteUserId: hello.data.siteUserId ?? null,
          }),
        ).catch((err) =>
          console.warn(
            "[bridge] onHello failed:",
            err instanceof Error ? err.message : String(err),
          ),
        );
      }
      return;
    }
    if (ws !== this.socket) return;

    const hb = BridgeHeartbeatSchema.safeParse(data);
    if (hb.success) {
      if (
        this.status.gameId != null &&
        hb.data.gameId !== this.status.gameId
      ) {
        this.rejectAll(
          new Error(
            "tab switched games — reconnect s1914.connectCabinetBridge()",
          ),
        );
        this.status.connected = false;
        this.status.gameId = null;
        this.status.lastHeartbeatAt = null;
        return;
      }
      this.status.lastHeartbeatAt = Date.now();
      this.status.connected = true;
      return;
    }
    const res = BridgeResponseSchema.safeParse(data);
    if (!res.success) return;
    const pending = this.pending.get(res.data.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(res.data.id);
    if (!res.data.ok) {
      pending.reject(new Error(res.data.error || "bridge error"));
      return;
    }
    pending.resolve(res.data.result);
  }

  private rejectAll(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}
