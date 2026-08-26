import type { PlanTask } from "./types.js";
import type { WarPictureRaw } from "./war-types.js";
import { isTrustedPlayer } from "./war-trust.js";

/** Drop moveArmy tasks that would strip garrisons from trusted non-war borders. */
export function filterTrustedBorderMoves(
  tasks: readonly PlanTask[],
  picture: WarPictureRaw | null | undefined,
  goals: ReadonlyArray<{ key: string; value: string }>,
): PlanTask[] {
  if (!picture) return [...tasks];
  return tasks.filter((task) => {
    if (task.type !== "moveArmy") return true;
    const args = (task.args ?? {}) as { armyId?: number };
    const armyId = Number(args.armyId);
    if (!Number.isFinite(armyId)) return true;
    const army = picture.ownArmies?.find((a) => a.id === armyId);
    if (!army?.province) return true;
    const border = picture.borders?.find((b) => b.province === army.province);
    if (!border || border.atWar) return true;
    const pid = border.facingPlayerId;
    if (pid == null) return true;
    if (isTrustedPlayer(picture, pid, goals)) {
      console.log(
        `[plan-filter] dropped moveArmy ${armyId} — would strip trusted border at ${army.province} vs ${border.facingNation ?? pid}`,
      );
      return false;
    }
    return true;
  });
}
