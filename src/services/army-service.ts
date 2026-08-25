import type { ArmySnapshot, MoveArmyParams, StopArmyParams, AttackArmyParams, ActionResult } from "../types/index.js";
import type { ArmyActionExecutor } from "../transport/executor.js";

export class ArmyService {
  constructor(
    private readonly executor: ArmyActionExecutor,
    private readonly listArmies: () => Promise<readonly ArmySnapshot[]> | readonly ArmySnapshot[],
  ) {}

  async list(): Promise<readonly ArmySnapshot[]> {
    return this.listArmies();
  }

  async findByProvince(provinceName: string): Promise<ArmySnapshot[]> {
    const all = await this.list();
    const needle = provinceName.toLowerCase();
    return all.filter((a) => a.provinceName?.toLowerCase() === needle);
  }

  async move(params: MoveArmyParams): Promise<ActionResult> {
    return this.executor.move(params);
  }

  async stop(params: StopArmyParams): Promise<ActionResult> {
    return this.executor.stop(params);
  }

  async attack(params: AttackArmyParams): Promise<ActionResult> {
    return this.executor.attack(params);
  }

  /** Convenience: move every owned army currently in a province to a target. */
  async retreatProvinceTo(
    provinceName: string,
    target: { x: number; y: number },
  ): Promise<ActionResult[]> {
    const stacks = await this.findByProvince(provinceName);
    const results: ActionResult[] = [];
    for (const army of stacks) {
      results.push(await this.move({ armyId: army.id, target }));
    }
    return results;
  }
}
