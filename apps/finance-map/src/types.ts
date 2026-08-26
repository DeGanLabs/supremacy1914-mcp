export type MapLayer =
  | "RESOURCE"
  | "MORALE"
  | "FAILURE"
  | "EFFICIENCY"
  | "CAPITAL"
  | "FORECAST"
  | "WAR_ECONOMY"
  | "MARKET";

export type FinanceMode = "economy" | "warEconomy" | "emergency";

export interface FinanceActionCandidate {
  provinceId: number;
  provinceName: string;
  action: string;
  upgradeId?: number;
  upgradeName?: string;
  cost: number;
  resourceCosts?: Record<string, number>;
  missingResources?: {
    resourceId: number;
    name: string;
    need: number;
    have: number;
  }[];
  priority: number;
  explainKeys: string[];
  blockedBy: string[];
  affordable: boolean;
  economicScore?: number;
  militaryScore?: number;
  combinedScore?: number;
  confidence: string;
  netBenefitPerHour?: number;
  paybackHours?: number;
}

export interface FinanceProvince {
  id: number;
  name: string;
  capital: { x: number; y: number } | null;
  coastal: boolean;
  resourceType: string | null;
  isDouble: boolean;
  mainProduction: number | null;
  taxProduction: number | null;
  efficiencyScore: number;
  buildings: { id: number | null; name: string | null }[];
  infraScore: number;
  investedEstimate: number;
  morale: number | null;
  bestAction: FinanceActionCandidate | null;
  capitalWasted: boolean;
  utilizationPct: number | null;
  failureCodes: string[];
  threatCodes: string[];
  forecasts: { at6h?: string; at12h?: string; at24h?: string };
  warPressure: number;
  events: { t: string; line: string }[];
  marketHint: string;
  role: string;
  assetScore: number;
  problemScore: number;
  borders?: number[][];
  bounds?: { x: number; y: number; w: number; h: number } | null;
  terrainType?: number | null;
}

export interface FinancePicture {
  generatedAt: string;
  selfPlayerId: number | null;
  mapSize: { width: number; height: number } | null;
  national: {
    resources: {
      id: number;
      name: string;
      amount: number;
      production: number;
      consumption: number;
      rate: number;
      isCritical: boolean;
      hoursToZero: number | null;
      daysToZero: number | null;
    }[];
    money: number;
    moneyRate: number | null;
    health: {
      production: number;
      liquidity: number;
      reserves: number;
      infrastructure: number;
      trade: number;
      risk: number;
      total: number;
    };
    bottleneck: { name: string; line: string; hoursToZero: number | null } | null;
    failures: { code: string; severity: string; line: string; provinceIds?: number[] }[];
    threats: { code: string; severity: string; line: string }[];
    rankings: {
      topAssets: { provinceId: number; provinceName: string; score: number; note?: string }[];
      topProblems: { provinceId: number; provinceName: string; score: number; note?: string }[];
      bestInvestments: { provinceId: number; provinceName: string; score: number; note?: string }[];
    };
    forecasts: {
      statusNow: string;
      status6h: string;
      status12h: string;
      status24h: string;
    };
    market: {
      resourceId: number;
      name: string;
      buy: number | null;
      sell: number | null;
      feePct: number;
      netMarginPct: number | null;
      hint: string;
    }[];
    embargoes: { t: string; line: string; nation: string | null }[];
    warDemand: {
      operationId: string;
      name: string;
      needed: Record<string, number>;
      priority: number;
      status: string;
    }[];
    dataQuality: {
      percent: number;
      sources: Record<string, string>;
    };
    mode: FinanceMode;
    financeBrief: {
      economyLine: string;
      bottleneckLine: string;
      doNextLine: string;
      capitalLine: string;
      marketLine: string;
      warLine: string;
      riskLine: string;
    };
    doNext: FinanceActionCandidate[];
    minHoursToZero: number | null;
  };
  provinces: FinanceProvince[];
}

export const FCC1_LAYERS: MapLayer[] = [
  "RESOURCE",
  "MORALE",
  "FAILURE",
  "EFFICIENCY",
  "CAPITAL",
];

export const ALL_LAYERS: MapLayer[] = [
  ...FCC1_LAYERS,
  "FORECAST",
  "WAR_ECONOMY",
  "MARKET",
];
