/** Financial Command Center domain model — views project over this. */

export type FinanceMode = "economy" | "warEconomy" | "emergency";

export type DataSourceStatus = "VERIFIED" | "PARTIAL" | "MISSING";

export type ConfidenceLevel = "verified" | "estimate" | "inference";

export type MarketHint = "BUY" | "WATCH" | "AVOID" | "NONE";

export type MapLayer =
  | "RESOURCE"
  | "MORALE"
  | "FAILURE"
  | "EFFICIENCY"
  | "CAPITAL"
  | "FORECAST"
  | "WAR_ECONOMY"
  | "MARKET";

export type ExplainKey =
  | "DOUBLE_RESOURCE"
  | "FACTORY_MISSING"
  | "WORKSHOP_MISSING"
  | "RAIL_MISSING"
  | "BARRACKS_OVERBURN"
  | "IRON_BOTTLENECK"
  | "GRAIN_BOTTLENECK"
  | "OIL_BOTTLENECK"
  | "MONEY_BOTTLENECK"
  | "SAFE_RESERVE"
  | "LOW_MORALE"
  | "RICH_IDLE"
  | "CAPITAL_WASTED"
  | "WAR_DEMAND"
  | "AFFORDABLE"
  | "MARKET_SPREAD";

export type BlockReason =
  | "money_reserve_floor"
  | "war_reserve"
  | "grain_crisis"
  | "not_affordable"
  | "upgrade_unavailable"
  | "emergency_freeze"
  | "none";

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface BuildingSlot {
  readonly id: number | null;
  readonly name: string | null;
  readonly condition?: number | null;
}

export interface FinanceActionCandidate {
  readonly provinceId: number;
  readonly provinceName: string;
  readonly action: "constructBuilding" | "disable_barracks_suspect" | "market_buy" | "market_sell";
  readonly upgradeId?: number;
  readonly upgradeName?: string;
  readonly cost: number;
  /** Real game costs by resource id (20 = money). */
  readonly resourceCosts?: Readonly<Record<string, number>>;
  readonly missingResources?: readonly {
    resourceId: number;
    name: string;
    need: number;
    have: number;
  }[];
  readonly priority: number;
  readonly explainKeys: readonly ExplainKey[];
  readonly blockedBy: readonly BlockReason[];
  readonly affordable: boolean;
  readonly economicScore?: number;
  readonly militaryScore?: number;
  readonly combinedScore?: number;
  readonly confidence: ConfidenceLevel;
  readonly netBenefitPerHour?: number;
  readonly paybackHours?: number;
  readonly resourceId?: number;
  readonly amount?: number;
}

export interface ProvinceForecastFlags {
  readonly at6h?: "ok" | "warning" | "critical";
  readonly at12h?: "ok" | "warning" | "critical";
  readonly at24h?: "ok" | "warning" | "critical";
}

export interface ProvinceEvent {
  readonly t: string;
  readonly line: string;
}

export interface FinanceProvince {
  readonly id: number;
  readonly name: string;
  readonly capital: Vec2 | null;
  readonly coastal: boolean;
  readonly resourceType: string | null;
  readonly isDouble: boolean;
  readonly mainProduction: number | null;
  readonly taxProduction: number | null;
  readonly efficiencyScore: number;
  readonly buildings: readonly BuildingSlot[];
  readonly queue: readonly unknown[];
  readonly infraScore: number;
  readonly investedEstimate: number;
  readonly morale: number | null;
  readonly revoltChance: number | null;
  readonly bestAction: FinanceActionCandidate | null;
  readonly capitalWasted: boolean;
  readonly utilizationPct: number | null;
  readonly failureCodes: readonly string[];
  readonly threatCodes: readonly string[];
  readonly forecasts: ProvinceForecastFlags;
  readonly warPressure: number;
  readonly events: readonly ProvinceEvent[];
  readonly marketHint: MarketHint;
  readonly role: string;
  readonly assetScore: number;
  readonly problemScore: number;
  /** Flat rings [x0,y0,x1,y1,...] from game border geometry */
  readonly borders: readonly (readonly number[])[];
  readonly bounds: { x: number; y: number; w: number; h: number } | null;
  readonly terrainType: number | null;
}

export interface ResourceRow {
  readonly id: number;
  readonly name: string;
  readonly amount: number;
  readonly production: number;
  readonly consumption: number;
  readonly rate: number;
  readonly isCritical: boolean;
  readonly daysToZero: number | null;
  readonly hoursToZero: number | null;
}

export interface HealthBreakdown {
  readonly production: number;
  readonly liquidity: number;
  readonly reserves: number;
  readonly infrastructure: number;
  readonly trade: number;
  readonly risk: number;
  readonly total: number;
}

export interface IssueItem {
  readonly code: string;
  readonly severity: "high" | "medium" | "low";
  readonly line: string;
  readonly provinceIds?: readonly number[];
  readonly resourceId?: number;
  readonly confidence: ConfidenceLevel;
}

export interface RankingRow {
  readonly provinceId: number;
  readonly provinceName: string;
  readonly score: number;
  readonly note?: string;
}

export interface BottleneckInfo {
  readonly resourceId: number;
  readonly name: string;
  readonly production: number;
  readonly consumption: number;
  readonly deficit: number;
  readonly hoursToZero: number | null;
  readonly line: string;
}

export interface WarDemand {
  readonly operationId: string;
  readonly name: string;
  readonly needed: Readonly<Record<string, number>>;
  readonly byHour?: number;
  readonly priority: number;
  readonly status: "active" | "planned" | "paused";
}

export interface MarketOpp {
  readonly resourceId: number;
  readonly name: string;
  readonly buy: number | null;
  readonly sell: number | null;
  readonly feePct: number;
  readonly netMarginPct: number | null;
  readonly hint: MarketHint;
}

export interface EmbargoEvent {
  readonly t: string;
  readonly playerId: number;
  readonly name: string | null;
  readonly nation: string | null;
  readonly line: string;
}

export interface DataQuality {
  readonly percent: number;
  readonly sources: Readonly<
    Record<
      | "nationalEconomy"
      | "provinceBuildings"
      | "market"
      | "provinceAttribution"
      | "relations"
      | "warDemand",
      DataSourceStatus
    >
  >;
}

export interface FinanceBriefStruct {
  readonly economyLine: string;
  readonly bottleneckLine: string;
  readonly doNextLine: string;
  readonly capitalLine: string;
  readonly marketLine: string;
  readonly warLine: string;
  readonly riskLine: string;
}

export interface NationalForecast {
  readonly statusNow: "HEALTHY" | "WARNING" | "CRITICAL";
  readonly status6h: "HEALTHY" | "WARNING" | "CRITICAL";
  readonly status12h: "HEALTHY" | "WARNING" | "CRITICAL";
  readonly status24h: "HEALTHY" | "WARNING" | "CRITICAL";
}

export interface FinanceNational {
  readonly resources: readonly ResourceRow[];
  readonly money: number;
  readonly moneyRate: number | null;
  readonly health: HealthBreakdown;
  readonly bottleneck: BottleneckInfo | null;
  readonly failures: readonly IssueItem[];
  readonly threats: readonly IssueItem[];
  readonly rankings: {
    readonly topAssets: readonly RankingRow[];
    readonly topProblems: readonly RankingRow[];
    readonly bestInvestments: readonly RankingRow[];
  };
  readonly forecasts: NationalForecast;
  readonly market: readonly MarketOpp[];
  readonly embargoes: readonly EmbargoEvent[];
  readonly warDemand: readonly WarDemand[];
  readonly dataQuality: DataQuality;
  readonly mode: FinanceMode;
  readonly financeBrief: FinanceBriefStruct;
  readonly doNext: readonly FinanceActionCandidate[];
  readonly minHoursToZero: number | null;
}

export interface MapSize {
  readonly width: number;
  readonly height: number;
}

export interface FinancePicture {
  readonly generatedAt: string;
  readonly selfPlayerId: number | null;
  readonly mapSize: MapSize | null;
  readonly national: FinanceNational;
  readonly provinces: readonly FinanceProvince[];
  readonly whatIf?: WhatIfResult | null;
}

export interface WhatIfInput {
  readonly disableBarracksProvinceIds?: readonly number[];
  readonly build?: { provinceId: number; upgradeName: string }[];
  readonly buyResource?: { resourceId: number; amount: number }[];
  readonly hours?: number;
}

export interface WhatIfResult {
  readonly hours: number;
  readonly projected: readonly {
    readonly id: number;
    readonly name: string;
    readonly amount: number;
    readonly rate: number;
  }[];
  readonly moneyDelta: number;
  readonly notes: readonly string[];
}

/** Raw dump shapes from bridge (before scoring). */
export interface RawFinanceProvinceDump {
  readonly id: number;
  readonly name: string;
  readonly capital: Vec2 | null;
  readonly coastal: boolean;
  readonly morale: number | null;
  readonly resourceType?: string | null;
  readonly isDouble?: boolean;
  readonly mainProduction?: number | null;
  readonly taxProduction?: number | null;
  readonly revoltChance?: number | null;
  readonly buildings?: BuildingSlot[];
  readonly constructions?: unknown[];
  readonly productions?: unknown[];
  readonly upgrades?: {
    upgradeId: number;
    name: string;
    group?: string | null;
    costs?: Record<string | number, number>;
    moneyCost?: number;
    affordable?: boolean;
  }[];
  readonly borders?: readonly (readonly number[])[];
  readonly bounds?: { x: number; y: number; w: number; h: number } | null;
  readonly terrainType?: number | null;
}

export interface RawFinanceInput {
  readonly selfPlayerId: number | null;
  readonly mapSize: MapSize | null;
  readonly money: number;
  readonly resources: readonly {
    id: number;
    name: string;
    amount: number;
    production: number;
    consumption: number;
    rate: number;
    isCritical?: boolean;
  }[];
  readonly provinces: readonly RawFinanceProvinceDump[];
  readonly market?: readonly {
    resourceId: number;
    name: string;
    price: number | null;
    asks?: { limit: number }[];
    bids?: { limit: number }[];
  }[];
  readonly embargoes?: readonly EmbargoEvent[];
  readonly warDemand?: readonly WarDemand[];
  readonly mode?: FinanceMode;
  readonly events?: readonly ProvinceEvent[];
}
