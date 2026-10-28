/**
 * Offline verify + write sample-picture.json fixture for the UI.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildFinancePicture } from "./build-picture.js";
import { formatFinanceBrief, simulateWhatIf } from "./format.js";
import type { RawFinanceInput } from "./types.js";
import { hoursToZero } from "./health.js";
import { computeEfficiency } from "./efficiency.js";
import { detectBottleneck } from "./bottleneck.js";

const fixture: RawFinanceInput = {
  selfPlayerId: 1,
  mapSize: { width: 2000, height: 1200 },
  money: 12400,
  resources: [
    {
      id: 0,
      name: "Grain",
      amount: 800,
      production: 200,
      consumption: 420,
      rate: -220,
      isCritical: true,
    },
    {
      id: 1,
      name: "Iron",
      amount: 5000,
      production: 800,
      consumption: 400,
      rate: 400,
    },
    {
      id: 2,
      name: "Oil",
      amount: 200,
      production: 100,
      consumption: 120,
      rate: -20,
    },
    {
      id: 20,
      name: "Money",
      amount: 12400,
      production: 200,
      consumption: 80,
      rate: 120,
    },
  ],
  provinces: [
    {
      id: 10,
      name: "Whitehorse",
      capital: { x: 400, y: 300 },
      coastal: false,
      morale: 91,
      resourceType: "Iron",
      mainProduction: 820,
      taxProduction: 40,
      buildings: [{ id: 1, name: "Workshop 2" }],
      upgrades: [
        { upgradeId: 101, name: "Factory 1", group: "Industry" },
        { upgradeId: 102, name: "Railway 1", group: "Infra" },
      ],
      borders: [[360, 260, 440, 250, 470, 300, 440, 350, 360, 340, 340, 300]],
      bounds: { x: 340, y: 250, w: 130, h: 100 },
    },
    {
      id: 11,
      name: "Prince George",
      capital: { x: 500, y: 400 },
      coastal: false,
      morale: 42,
      resourceType: "Grain",
      mainProduction: 100,
      buildings: [
        { id: 2, name: "Barracks 2" },
        { id: 3, name: "Factory 1" },
        { id: 4, name: "Railway 1" },
      ],
      upgrades: [{ upgradeId: 201, name: "Barracks 3", group: "Military" }],
      borders: [[460, 360, 540, 350, 570, 400, 540, 450, 460, 440, 440, 400]],
      bounds: { x: 440, y: 350, w: 130, h: 100 },
    },
    {
      id: 12,
      name: "Anchorage",
      capital: { x: 200, y: 500 },
      coastal: true,
      morale: 78,
      resourceType: "Oil",
      mainProduction: 200,
      buildings: [],
      upgrades: [{ upgradeId: 301, name: "Workshop 1", group: "Industry" }],
      borders: [[160, 460, 240, 450, 270, 500, 240, 550, 160, 540, 140, 500]],
      bounds: { x: 140, y: 450, w: 130, h: 100 },
    },
  ],
  market: [
    {
      resourceId: 1,
      name: "Iron",
      price: 110,
      asks: [{ limit: 108 }],
      bids: [{ limit: 116 }],
    },
  ],
  warDemand: [
    {
      operationId: "alaska-1",
      name: "Alaska Operation",
      needed: { Oil: 2400, Iron: 1900, Grain: 4300 },
      priority: 0.8,
      status: "active",
    },
  ],
  mode: "economy",
  events: [{ t: new Date().toISOString(), line: "Whitehorse: Factory queued" }],
};

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export function runFinanceVerify(): void {
  const pic = buildFinancePicture(fixture);
  assert(pic.national.health.total > 0, "health > 0");
  assert(
    pic.national.failures.some((f) => f.code === "CRITICAL_RATE"),
    "grain failure",
  );
  assert(pic.national.threats.length >= 1, "oil threat");
  assert(pic.national.bottleneck != null, "bottleneck");
  assert(pic.provinces.length === 3, "3 provinces");
  const wh = pic.provinces.find((p) => p.name === "Whitehorse")!;
  assert(wh.efficiencyScore >= 0, "efficiency");
  assert(wh.bestAction != null, "best action");
  assert(wh.bestAction!.explainKeys.length > 0, "explainKeys");
  assert(pic.national.rankings.topAssets.length >= 1, "rankings");
  assert(pic.national.doNext.length >= 1, "doNext");
  assert(pic.national.dataQuality.percent > 0, "data quality");

  const brief = formatFinanceBrief(pic);
  assert(brief.includes("BOTTLENECK"), "brief");

  const whatIf = simulateWhatIf(pic, {
    hours: 24,
    disableBarracksProvinceIds: [11],
    buyResource: [{ resourceId: 1, amount: 1000 }],
  });
  assert(whatIf.projected.length === pic.national.resources.length, "whatif");

  const h = hoursToZero(800, -220);
  assert(h != null && h > 0 && h < 5, "hoursToZero grain");

  const eff = computeEfficiency({
    resourceType: "Iron",
    isDouble: true,
    morale: 90,
    mainProduction: 800,
    buildings: [{ id: 1, name: "Factory 2" }],
  });
  assert(eff >= 40, "eff factory");

  const bn = detectBottleneck(pic.national.resources, pic.national.warDemand);
  assert(bn != null, "detectBottleneck");

  console.log("finance verify OK");
  console.log(
    `health=${pic.national.health.total} bottleneck=${pic.national.bottleneck?.name} doNext=${pic.national.doNext[0]?.upgradeName}`,
  );
}

async function main(): Promise<void> {
  runFinanceVerify();
  const pic = buildFinancePicture(fixture);
  const dir = path.join(process.cwd(), "src/finance/fixtures");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "sample-picture.json"),
    JSON.stringify(pic, null, 2),
    "utf8",
  );
  console.log("wrote src/finance/fixtures/sample-picture.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
