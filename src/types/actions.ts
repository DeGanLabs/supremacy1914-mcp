import type { ArmyId, PlayerId, RequestId, Vec2 } from "./common.js";

/**
 * Wire-format class names (`@c`) used by the Ultimate client.
 * Keep these as constants — never hardcode string literals at call sites.
 */
export const ActionClass = {
  UpdateGameState: "ultshared.action.UltUpdateGameStateAction",
  ArmyAction: "ultshared.action.UltArmyAction",
  UpdateProvinceAction: "ultshared.action.UltUpdateProvinceAction",
  BuildQueueAction: "ultshared.action.UltBuildQueueAction",
  OrderAction: "ultshared.action.UltOrderAction",
  TradeOfferAction: "ultshared.action.UltTradeOfferAction",
  MessageAction: "ultshared.action.UltMessageAction",
  ChangeRelationAction: "ultshared.action.UltChangeRelationAction",
  NewArticleAction: "ultshared.action.UltNewArticleAction",
  /** Inventory consume / hero deploy */
  UsePremiumAction: "UsePremiumAction",
  Order: "ultshared.UltOrder",
  TradeOffer: "ultshared.UltTradeOffer",
  Article: "ultshared.UltArticle",
  Army: "a",
  Unit: "u",
  /** Map upgrade / building instance */
  MapUpgrade: "mu",
  /** Special unit (recruit / produce) instance */
  SpecialUnit: "su",
  /** Build-queue entry */
  BuildQueueEntry: "be",
  GotoCommand: "gc",
  WaitCommand: "wc",
  /** Player-scheduled delay wait (UI "Delay"). */
  DelayWaitCommand: "dwc",
  AttackCommand: "ac",
  PatrolCommand: "pc",
} as const;

/**
 * `armyController` command modes (`w.Y0`).
 * ATTACK=2 confirmed live; MOVE=1; NONE=0. Other values currently fall through to move.
 */
export const ArmyCommandMode = {
  None: 0,
  Move: 1,
  Attack: 2,
} as const;

export type ArmyCommandModeValue =
  (typeof ArmyCommandMode)[keyof typeof ArmyCommandMode];

/**
 * Army aggressiveness (`ag` on UltArmy). `0` = use unit default.
 * Live selectable set is typically 1–5 (infantry often 2–5; solo heroes 1–5).
 * Low end is RETURN_FIRE in client consts (`y.iB.RETURN_FIRE`).
 */
export const ArmyAggressiveness = {
  Default: 0,
  ReturnFire: 1,
  Defensive: 2,
  Normal: 3,
  Aggressive: 4,
  FullyAggressive: 5,
} as const;

export type ArmyAggressivenessValue =
  (typeof ArmyAggressiveness)[keyof typeof ArmyAggressiveness];

/** Wait / delay direction flags seen on `wc` / `dwc`. */
export const WaitDirection = {
  Embark: 1,
  Disembark: 2,
  Special: 4,
  Delay: 8,
} as const;

/** Non-resource keys inside trade `offersA` / `offersB` maps. */
export const TradeItemType = {
  Provinces: 15,
  Relations: 17,
} as const;

/** `UltTradeOfferAction.flag` values. */
export const TradeOfferFlag = {
  Create: 0,
  Accept: 1,
  Refuse: 2,
  Delete: 3,
  Read: 4,
} as const;

export type TradeOfferFlagValue =
  (typeof TradeOfferFlag)[keyof typeof TradeOfferFlag];

/** `UltUpdateProvinceAction.mode` values from the Ultimate client. */
export const ProvinceActionMode = {
  Province: 0,
  Upgrade: 1,
  SpecialUnit: 2,
  CancelProducing: 3,
  CancelBuilding: 4,
  DeploymentTarget: 5,
} as const;

export type ProvinceActionModeValue =
  (typeof ProvinceActionMode)[keyof typeof ProvinceActionMode];

/** `UltBuildQueueAction.operation` values. */
export const BuildQueueOperation = {
  AddEntry: 0,
  RemoveEntry: 1,
  MoveEntry: 2,
  RemoveAllEntries: 3,
} as const;

export type BuildQueueOperationValue =
  (typeof BuildQueueOperation)[keyof typeof BuildQueueOperation];

export type ActionClassName = (typeof ActionClass)[keyof typeof ActionClass];

export interface WirePoint {
  x: number;
  y: number;
}

export interface WireUnit {
  "@c": typeof ActionClass.Unit;
  /** Unit type id */
  t: number;
  /** Stack size */
  s: number;
}

export interface WireGotoCommand {
  "@c": typeof ActionClass.GotoCommand;
  sp: WirePoint;
  tp: WirePoint;
}

export interface WireWaitCommand {
  "@c": typeof ActionClass.WaitCommand;
  waitSeconds: number;
  cancelable: boolean;
  direction: number;
  locationID: number;
  execTime: number;
}

/** UI Delay — cancelable wait, usually `direction: 8`. */
export interface WireDelayWaitCommand {
  "@c": typeof ActionClass.DelayWaitCommand;
  waitSeconds: number;
  cancelable: boolean;
  direction: number;
  locationID: number;
  execTime: number;
  targetPos?: WirePoint;
}

/** Attack / bombard target. Bombard is the same `@c:"ac"` when out of melee range. */
export interface WireAttackCommand {
  "@c": typeof ActionClass.AttackCommand;
  targetUnitID: number;
  targetPos: WirePoint;
}

export interface WirePatrolCommand {
  "@c": typeof ActionClass.PatrolCommand;
  targetPos: WirePoint;
  approaching?: boolean;
  relocation?: boolean;
  airField?: string | null;
}

export type WireArmyCommand =
  | WireGotoCommand
  | WireWaitCommand
  | WireDelayWaitCommand
  | WireAttackCommand
  | WirePatrolCommand
  | Record<string, unknown>;

export interface WireArmy {
  "@c": typeof ActionClass.Army;
  id: ArmyId;
  /** Size / strength marker used by client */
  s: number;
  /** Owner player id */
  o: PlayerId;
  u: WireUnit[];
  c: WireArmyCommand[];
  au?: number;
  ag?: number;
  fm?: number;
}

export interface WireArmyAction {
  requestID: RequestId;
  "@c": typeof ActionClass.ArmyAction;
  armies: WireArmy[];
}

export interface WireUpdateGameStateAction {
  requestID: RequestId;
  "@c": typeof ActionClass.UpdateGameState;
  actions: unknown[];
  lastCallDuration?: number;
  stateIDs?: Record<string, string | number>;
  tstamps?: Record<string, string>;
  version: string;
  client: string;
  siteUserID: number;
  adminLevel: number;
  gameID: number;
  playerID: number;
  rights: string;
  userAuth: string;
  tstamp: string;
}

export interface SignedActionEnvelope extends WireUpdateGameStateAction {}

export interface ActionResult {
  readonly ok: boolean;
  readonly requestId: RequestId;
  readonly raw?: unknown;
  readonly error?: string;
}

export interface GotoSegment {
  readonly start: Vec2;
  readonly target: Vec2;
}

/** Wire map-upgrade (`mu`) used when constructing / queuing buildings. */
export interface WireMapUpgrade {
  "@c": typeof ActionClass.MapUpgrade;
  /** Condition / progress of the upgrade */
  c: number;
  /** Enabled */
  e: boolean;
  /** Upgrade / building item id */
  id: number;
  /** Premium level */
  pl: number;
  /** Optional relative map position */
  rp: WirePoint | null;
}

/** Wire special-unit (`su`) used when recruiting / producing. */
export interface WireSpecialUnit {
  "@c": typeof ActionClass.SpecialUnit;
  c: number;
  e: boolean;
  unit: WireUnit;
}

export type WireProvinceUpgrade = WireMapUpgrade | WireSpecialUnit;

export interface WireUpdateProvinceAction {
  requestID: RequestId;
  "@c": typeof ActionClass.UpdateProvinceAction;
  mode: ProvinceActionModeValue;
  provinceIDs: number[];
  slot: number;
  upgrade?: WireProvinceUpgrade;
  deploymentTarget?: unknown;
}

export interface WireBuildQueueEntry {
  "@c": typeof ActionClass.BuildQueueEntry;
  provinceID: number;
  upgrade: WireProvinceUpgrade;
  processingColor?: string;
}

export interface WireBuildQueueAction {
  requestID: RequestId;
  "@c": typeof ActionClass.BuildQueueAction;
  operation: BuildQueueOperationValue;
  entries: WireBuildQueueEntry[] | null;
  sourceIndices: number[] | null;
  targetOffset: number;
}

/** Stock-market order (`ultshared.UltOrder`). */
export interface WireOrder {
  "@c": typeof ActionClass.Order;
  orderID: number;
  buy: boolean;
  amount: number;
  limit: number;
  resourceType: number;
  playerID: number;
  totalPrice?: number;
  embargo?: boolean;
  isOwner?: boolean;
  buyable?: boolean;
  hasSold?: boolean;
  premium?: boolean;
}

export interface WireOrderAction {
  requestID: RequestId;
  "@c": typeof ActionClass.OrderAction;
  order: WireOrder;
  cancel: boolean;
}

/** Player-to-player trade offer body. */
export interface WireTradeOffer {
  "@c": typeof ActionClass.TradeOffer;
  partyA: number;
  partyB: number;
  /** Map of trade-item id → amount/value (resource id, or 15=province, 17=relation). */
  offersA: Record<string, number>;
  offersB: Record<string, number>;
  message: string;
  timeStamp: number;
  successful: boolean;
  tradeId: number;
  readByReceiver?: boolean | null;
  delBySender?: boolean;
  delByReceiver?: boolean;
  processed?: boolean;
}

export interface WireTradeOfferAction {
  requestID: RequestId;
  "@c": typeof ActionClass.TradeOfferAction;
  flag: TradeOfferFlagValue;
  tradeOfferID: number;
  tradeOffer: WireTradeOffer | null;
}

/** Diplomacy / alliance message article. */
export interface WireArticle {
  "@c": typeof ActionClass.Article;
  senderID: number;
  receiverID: number | null;
  receiver?: string;
  authorID: number;
  author: string;
  messageBody: string;
  title?: string;
  allianceID?: number;
  imageID?: number;
  address?: string;
  day?: number;
  timeStamp?: number | null;
  extended?: number;
}

export interface WireMessageAction {
  requestID: RequestId;
  "@c": typeof ActionClass.MessageAction;
  newArticles: WireArticle[] | null;
  updateArticles: WireArticle[] | null;
  deleteArticles: unknown[] | null;
}

/**
 * Change diplomatic relation.
 * `relationType` is base64 of a single signed byte (e.g. RoW=3 → `"Aw=="`).
 */
export interface WireChangeRelationAction {
  requestID: RequestId;
  "@c": typeof ActionClass.ChangeRelationAction;
  playerB: number[];
  relationType: string;
}

/** Inventory item use / hero deploy (`UsePremiumAction`). */
export interface WireUsePremiumAction {
  requestID: RequestId;
  "@c": typeof ActionClass.UsePremiumAction;
  premiumID: number;
  amount: number;
  provinces: number[];
  armies: number[];
  researches: number[];
}
