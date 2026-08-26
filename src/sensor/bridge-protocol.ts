import { z } from "zod";

export const BridgeHelloSchema = z.object({
  type: z.literal("hello"),
  gameId: z.number(),
  playerId: z.number(),
  siteUserId: z.number(),
  token: z.string().min(8),
});

export const BridgeHeartbeatSchema = z.object({
  type: z.literal("heartbeat"),
  gameId: z.number(),
  t: z.number(),
});

export const BridgeRequestSchema = z.object({
  type: z.literal("request"),
  id: z.string(),
  gameId: z.number(),
  method: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
});

export const BridgeResponseSchema = z.object({
  type: z.literal("response"),
  id: z.string(),
  ok: z.boolean(),
  gameId: z.number().optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

export type BridgeInbound =
  | z.infer<typeof BridgeHelloSchema>
  | z.infer<typeof BridgeHeartbeatSchema>
  | z.infer<typeof BridgeResponseSchema>;

export type BridgeOutbound = z.infer<typeof BridgeRequestSchema>;
