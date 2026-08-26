import { z } from "zod";

export const RiskLevel = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

/** Phase-1 executable action types only. */
export const ExecutableActionType = z.enum([
  "moveArmy",
  "constructBuilding",
  "attackArmy",
  "delayArmy",
]);
export type ExecutableActionType = z.infer<typeof ExecutableActionType>;

export const ProposeOnlyActionType = z.string().min(1);
export type ProposeOnlyActionType = z.infer<typeof ProposeOnlyActionType>;

export const MoveArmyArgsSchema = z.object({
  armyId: z.number().int().positive(),
  x: z.number(),
  y: z.number(),
});

export const ConstructBuildingArgsSchema = z.object({
  provinceIdOrName: z.union([z.string(), z.number()]),
  upgradeId: z.number().int().positive(),
});

export const AttackArmyArgsSchema = z.object({
  armyId: z.number().int().positive(),
  targetArmyId: z.number().int().positive(),
});

export const DelayArmyArgsSchema = z.object({
  armyId: z.number().int().positive(),
  minutes: z.number().positive(),
  syncArrival: z.boolean().optional(),
});

export const PlanTaskSchema = z
  .object({
    type: z.string().min(1),
    args: z.record(z.string(), z.unknown()).default({}),
    risk: RiskLevel.default("medium"),
    rationale: z.string().optional(),
    proposeOnly: z.boolean().optional(),
    template:
      z
        .enum([
          "reinforce",
          "probe",
          "concentrate",
          "screen",
          "disengage",
          "bombard-then-land",
          "kill-transport",
          "sea-control",
        ])
        .optional(),
  })
  .superRefine((task, ctx) => {
    if (task.type === "moveArmy") {
      const parsed = MoveArmyArgsSchema.safeParse(task.args);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          message: `moveArmy args invalid: ${parsed.error.message}`,
        });
      }
    }
    if (task.type === "constructBuilding") {
      const parsed = ConstructBuildingArgsSchema.safeParse(task.args);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          message: `constructBuilding args invalid: ${parsed.error.message}`,
        });
      }
    }
    if (task.type === "attackArmy") {
      const parsed = AttackArmyArgsSchema.safeParse(task.args);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          message: `attackArmy args invalid: ${parsed.error.message}`,
        });
      }
    }
    if (task.type === "delayArmy") {
      const parsed = DelayArmyArgsSchema.safeParse(task.args);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          message: `delayArmy args invalid: ${parsed.error.message}`,
        });
      }
    }
  });

export type PlanTask = z.infer<typeof PlanTaskSchema>;

export const MinisterOutputSchema = z.object({
  facts: z.array(z.string()).default([]),
  concerns: z.array(z.string()).default([]),
  proposals: z.array(PlanTaskSchema).default([]),
  need_from: z.array(z.string()).default([]),
  draft_message: z.string().nullable().optional(),
  public_line: z.string().default(""),
});

export type MinisterOutput = z.infer<typeof MinisterOutputSchema>;

export const PHASE1_EXECUTABLE = new Set<string>([
  "moveArmy",
  "constructBuilding",
  "attackArmy",
  "delayArmy",
]);

export function isPhase1Executable(type: string): boolean {
  return PHASE1_EXECUTABLE.has(type);
}

export type SeatId =
  | "foreign"
  | "war"
  | "defense"
  | "finance"
  | "intel"
  | string;

export interface SeatDefinition {
  readonly id: SeatId;
  readonly name: string;
  readonly role: string;
  readonly mentionAliases: readonly string[];
  readonly dataScopes: readonly string[];
  readonly systemPromptPath: string;
}

export type PlanStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "executing"
  | "done"
  | "failed";

export interface CabinetPlan {
  readonly id: string;
  readonly createdAt: string;
  readonly goalSummary: string;
  readonly assumptions: string[];
  readonly tasks: PlanTask[];
  readonly payloadHash: string;
  status: PlanStatus;
  telegramMessageId?: number;
  readonly sourceSeatIds: string[];
}

export interface PlayerGoal {
  readonly key: string;
  readonly value: string;
  readonly setAt: string;
}

export interface Hypothesis {
  readonly id: string;
  readonly text: string;
  readonly fromSeat: string;
  readonly createdAt: string;
}
