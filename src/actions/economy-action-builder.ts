import type { SessionConfig } from "../types/auth.js";
import type {
  SignedActionEnvelope,
  WireBuildQueueAction,
  WireBuildQueueEntry,
  WireMapUpgrade,
  WireOrder,
  WireOrderAction,
  WireSpecialUnit,
  WireUpdateProvinceAction,
} from "../types/actions.js";
import {
  ActionClass,
  BuildQueueOperation,
  ProvinceActionMode,
} from "../types/actions.js";
import type { ProvinceId, UnitTypeId } from "../types/common.js";
import { createLocalRequestId } from "../utils/ids.js";
import { signUpdateGameStateAction } from "./army-action-builder.js";

export interface WireMapUpgradeInput {
  readonly id: number;
  readonly condition?: number;
  readonly enabled?: boolean;
  readonly premiumLevel?: number;
  readonly relativePosition?: { x: number; y: number } | null;
}

export interface ConstructBuildingParams {
  readonly session: SessionConfig;
  readonly provinceIds: readonly ProvinceId[];
  readonly upgrade: WireMapUpgradeInput;
  readonly slot?: number;
  readonly innerRequestId?: string;
  readonly outerRequestId?: number;
}

export interface ProduceUnitParams {
  readonly session: SessionConfig;
  readonly provinceIds: readonly ProvinceId[];
  readonly unitTypeId: UnitTypeId;
  readonly size?: number;
  readonly slot?: number;
  readonly condition?: number;
  readonly enabled?: boolean;
  readonly innerRequestId?: string;
  readonly outerRequestId?: number;
}

export interface CancelProvinceProductionParams {
  readonly session: SessionConfig;
  readonly provinceIds: readonly ProvinceId[];
  readonly slot?: number;
  readonly kind: "building" | "unit";
  readonly innerRequestId?: string;
  readonly outerRequestId?: number;
}

export interface BuildQueueEntryParams {
  readonly provinceId: ProvinceId;
  readonly upgrade: WireMapUpgradeInput | WireSpecialUnit;
}

export interface BuildQueueParams {
  readonly session: SessionConfig;
  readonly entries: readonly BuildQueueEntryParams[];
  readonly innerRequestId?: string;
  readonly outerRequestId?: number;
}

export interface RemoveBuildQueueParams {
  readonly session: SessionConfig;
  /** Indices into the player's build queue */
  readonly sourceIndices: readonly number[];
  readonly innerRequestId?: string;
  readonly outerRequestId?: number;
}

export interface MarketOrderParams {
  readonly session: SessionConfig;
  readonly side: "buy" | "sell";
  readonly resourceId: number;
  readonly amount: number;
  /** Limit price per unit */
  readonly limit: number;
  /** 0 for a new resting order; set when accepting/matching an existing book order */
  readonly orderId?: number;
  readonly innerRequestId?: string;
  readonly outerRequestId?: number;
}

export interface CancelMarketOrderParams {
  readonly session: SessionConfig;
  readonly order: WireOrder;
  readonly innerRequestId?: string;
  readonly outerRequestId?: number;
}

export interface AcceptMarketOrderParams {
  readonly session: SessionConfig;
  /** Existing book order being taken */
  readonly bookOrder: WireOrder;
  /** Amount to fill */
  readonly amount: number;
  readonly innerRequestId?: string;
  readonly outerRequestId?: number;
}

export function buildWireMapUpgrade(input: WireMapUpgradeInput): WireMapUpgrade {
  return {
    "@c": ActionClass.MapUpgrade,
    c: input.condition ?? 0,
    e: input.enabled ?? true,
    id: input.id,
    pl: input.premiumLevel ?? 0,
    rp: input.relativePosition ?? null,
  };
}

export function buildWireSpecialUnit(
  unitTypeId: UnitTypeId,
  size = 1,
  options?: { condition?: number; enabled?: boolean },
): WireSpecialUnit {
  return {
    "@c": ActionClass.SpecialUnit,
    c: options?.condition ?? 0,
    e: options?.enabled ?? true,
    unit: {
      "@c": ActionClass.Unit,
      t: unitTypeId,
      s: size,
    },
  };
}

export function buildUpdateProvinceAction(
  mode: (typeof ProvinceActionMode)[keyof typeof ProvinceActionMode],
  provinceIds: readonly ProvinceId[],
  options?: {
    readonly upgrade?: WireMapUpgrade | WireSpecialUnit;
    readonly slot?: number;
    readonly requestId?: string;
  },
): WireUpdateProvinceAction {
  if (provinceIds.length === 0) {
    throw new Error("provinceIds must not be empty");
  }
  const action: WireUpdateProvinceAction = {
    requestID: options?.requestId ?? createLocalRequestId(),
    "@c": ActionClass.UpdateProvinceAction,
    mode,
    provinceIDs: [...provinceIds],
    slot: options?.slot ?? 0,
  };
  if (options?.upgrade) {
    action.upgrade = options.upgrade;
  }
  return action;
}

export function buildConstructBuildingAction(
  provinceIds: readonly ProvinceId[],
  upgrade: WireMapUpgradeInput,
  options?: { readonly slot?: number; readonly requestId?: string },
): WireUpdateProvinceAction {
  return buildUpdateProvinceAction(ProvinceActionMode.Upgrade, provinceIds, {
    upgrade: buildWireMapUpgrade(upgrade),
    slot: options?.slot,
    requestId: options?.requestId,
  });
}

/**
 * Enable/disable a finished building (UI AKTIVIEREN / DEAKTIVIEREN).
 * HAR: UltUpdateProvinceAction mode=0 (Province) with mu.e flipped.
 */
export function buildSetBuildingEnabledAction(
  provinceIds: readonly ProvinceId[],
  upgrade: WireMapUpgradeInput,
  options?: { readonly slot?: number; readonly requestId?: string },
): WireUpdateProvinceAction {
  return buildUpdateProvinceAction(ProvinceActionMode.Province, provinceIds, {
    upgrade: buildWireMapUpgrade(upgrade),
    slot: options?.slot,
    requestId: options?.requestId,
  });
}

export function buildProduceUnitAction(
  provinceIds: readonly ProvinceId[],
  unitTypeId: UnitTypeId,
  options?: {
    readonly size?: number;
    readonly slot?: number;
    readonly condition?: number;
    readonly enabled?: boolean;
    readonly requestId?: string;
  },
): WireUpdateProvinceAction {
  return buildUpdateProvinceAction(ProvinceActionMode.SpecialUnit, provinceIds, {
    upgrade: buildWireSpecialUnit(unitTypeId, options?.size ?? 1, {
      condition: options?.condition,
      enabled: options?.enabled,
    }),
    slot: options?.slot,
    requestId: options?.requestId,
  });
}

export function buildCancelBuildingAction(
  provinceIds: readonly ProvinceId[],
  slot = 0,
  requestId?: string,
): WireUpdateProvinceAction {
  return buildUpdateProvinceAction(ProvinceActionMode.CancelBuilding, provinceIds, {
    slot,
    requestId,
  });
}

export function buildCancelProducingAction(
  provinceIds: readonly ProvinceId[],
  slot = 0,
  requestId?: string,
): WireUpdateProvinceAction {
  return buildUpdateProvinceAction(ProvinceActionMode.CancelProducing, provinceIds, {
    slot,
    requestId,
  });
}

function toWireQueueUpgrade(
  upgrade: WireMapUpgradeInput | WireSpecialUnit,
): WireMapUpgrade | WireSpecialUnit {
  if ("@c" in upgrade && upgrade["@c"] === ActionClass.SpecialUnit) {
    return upgrade;
  }
  return buildWireMapUpgrade(upgrade as WireMapUpgradeInput);
}

export function buildBuildQueueEntry(
  provinceId: ProvinceId,
  upgrade: WireMapUpgradeInput | WireSpecialUnit,
): WireBuildQueueEntry {
  return {
    "@c": ActionClass.BuildQueueEntry,
    provinceID: provinceId,
    upgrade: toWireQueueUpgrade(upgrade),
    processingColor: "",
  };
}

export function buildAddBuildQueueAction(
  entries: readonly BuildQueueEntryParams[],
  requestId?: string,
): WireBuildQueueAction {
  if (entries.length === 0) {
    throw new Error("build queue entries must not be empty");
  }
  return {
    requestID: requestId ?? createLocalRequestId(),
    "@c": ActionClass.BuildQueueAction,
    operation: BuildQueueOperation.AddEntry,
    entries: entries.map((e) => buildBuildQueueEntry(e.provinceId, e.upgrade)),
    sourceIndices: null,
    targetOffset: 0,
  };
}

export function buildRemoveBuildQueueAction(
  sourceIndices: readonly number[],
  requestId?: string,
): WireBuildQueueAction {
  return {
    requestID: requestId ?? createLocalRequestId(),
    "@c": ActionClass.BuildQueueAction,
    operation: BuildQueueOperation.RemoveEntry,
    entries: null,
    sourceIndices: [...sourceIndices],
    targetOffset: 0,
  };
}

export function buildSignedConstructBuildingAction(
  input: ConstructBuildingParams,
): SignedActionEnvelope {
  const action = buildConstructBuildingAction(
    input.provinceIds,
    input.upgrade,
    { slot: input.slot, requestId: input.innerRequestId },
  );
  return signUpdateGameStateAction(input.session, [action], {
    requestId: input.outerRequestId,
  });
}

export function buildSignedProduceUnitAction(
  input: ProduceUnitParams,
): SignedActionEnvelope {
  const action = buildProduceUnitAction(input.provinceIds, input.unitTypeId, {
    size: input.size,
    slot: input.slot,
    condition: input.condition,
    enabled: input.enabled,
    requestId: input.innerRequestId,
  });
  return signUpdateGameStateAction(input.session, [action], {
    requestId: input.outerRequestId,
  });
}

export function buildSignedCancelProvinceAction(
  input: CancelProvinceProductionParams,
): SignedActionEnvelope {
  const action =
    input.kind === "building"
      ? buildCancelBuildingAction(input.provinceIds, input.slot ?? 0, input.innerRequestId)
      : buildCancelProducingAction(input.provinceIds, input.slot ?? 0, input.innerRequestId);
  return signUpdateGameStateAction(input.session, [action], {
    requestId: input.outerRequestId,
  });
}

export function buildSignedAddBuildQueueAction(
  input: BuildQueueParams,
): SignedActionEnvelope {
  const action = buildAddBuildQueueAction(input.entries, input.innerRequestId);
  return signUpdateGameStateAction(input.session, [action], {
    requestId: input.outerRequestId,
  });
}

export function buildSignedRemoveBuildQueueAction(
  input: RemoveBuildQueueParams,
): SignedActionEnvelope {
  const action = buildRemoveBuildQueueAction(input.sourceIndices, input.innerRequestId);
  return signUpdateGameStateAction(input.session, [action], {
    requestId: input.outerRequestId,
  });
}

export function buildWireOrder(input: {
  readonly orderId?: number;
  readonly buy: boolean;
  readonly amount: number;
  readonly limit: number;
  readonly resourceId: number;
  readonly playerId: number;
}): WireOrder {
  return {
    "@c": ActionClass.Order,
    orderID: input.orderId ?? 0,
    buy: input.buy,
    amount: Math.max(0, input.amount),
    limit: Math.round(10 * Math.max(0, input.limit)) / 10,
    resourceType: input.resourceId,
    playerID: input.playerId,
    totalPrice: 0,
    embargo: false,
    isOwner: false,
    buyable: false,
  };
}

export function buildOrderAction(
  order: WireOrder,
  cancel: boolean,
  requestId?: string,
): WireOrderAction {
  return {
    requestID: requestId ?? createLocalRequestId(),
    "@c": ActionClass.OrderAction,
    order,
    cancel,
  };
}

/** Place a new resting buy/sell order (orderID=0). */
export function buildPlaceMarketOrderAction(
  input: {
    readonly playerId: number;
    readonly side: "buy" | "sell";
    readonly resourceId: number;
    readonly amount: number;
    readonly limit: number;
  },
  requestId?: string,
): WireOrderAction {
  return buildOrderAction(
    buildWireOrder({
      orderId: 0,
      buy: input.side === "buy",
      amount: input.amount,
      limit: input.limit,
      resourceId: input.resourceId,
      playerId: input.playerId,
    }),
    false,
    requestId,
  );
}

/**
 * Accept / take an existing book order.
 * Client flips buy flag: taking a sell listing → your order is buy=true.
 */
export function buildAcceptMarketOrderAction(
  input: {
    readonly playerId: number;
    readonly bookOrder: WireOrder;
    readonly amount: number;
  },
  requestId?: string,
): WireOrderAction {
  const counterpartyId = input.bookOrder.playerID === -1 ? -1 : input.playerId;
  return buildOrderAction(
    buildWireOrder({
      orderId: input.bookOrder.orderID,
      buy: !input.bookOrder.buy,
      amount: input.amount,
      limit: input.bookOrder.limit,
      resourceId: input.bookOrder.resourceType,
      playerId: counterpartyId,
    }),
    false,
    requestId,
  );
}

export function buildCancelMarketOrderAction(
  order: WireOrder,
  requestId?: string,
): WireOrderAction {
  return buildOrderAction(order, true, requestId);
}

export function buildSignedPlaceMarketOrderAction(
  input: MarketOrderParams,
): SignedActionEnvelope {
  const action = buildPlaceMarketOrderAction(
    {
      playerId: input.session.playerID,
      side: input.side,
      resourceId: input.resourceId,
      amount: input.amount,
      limit: input.limit,
    },
    input.innerRequestId,
  );
  return signUpdateGameStateAction(input.session, [action], {
    requestId: input.outerRequestId,
  });
}

export function buildSignedAcceptMarketOrderAction(
  input: AcceptMarketOrderParams,
): SignedActionEnvelope {
  const action = buildAcceptMarketOrderAction(
    {
      playerId: input.session.playerID,
      bookOrder: input.bookOrder,
      amount: input.amount,
    },
    input.innerRequestId,
  );
  return signUpdateGameStateAction(input.session, [action], {
    requestId: input.outerRequestId,
  });
}

export function buildSignedCancelMarketOrderAction(
  input: CancelMarketOrderParams,
): SignedActionEnvelope {
  const action = buildCancelMarketOrderAction(input.order, input.innerRequestId);
  return signUpdateGameStateAction(input.session, [action], {
    requestId: input.outerRequestId,
  });
}

/**
 * Convenience class mirroring other action builders.
 * Prefer the named `buildSigned*` functions for tree-shaking.
 */
export class EconomyActionBuilder {
  constructBuilding(params: ConstructBuildingParams): SignedActionEnvelope {
    return buildSignedConstructBuildingAction(params);
  }

  produceUnit(params: ProduceUnitParams): SignedActionEnvelope {
    return buildSignedProduceUnitAction(params);
  }

  cancel(params: CancelProvinceProductionParams): SignedActionEnvelope {
    return buildSignedCancelProvinceAction(params);
  }

  enqueue(params: BuildQueueParams): SignedActionEnvelope {
    return buildSignedAddBuildQueueAction(params);
  }

  dequeue(params: RemoveBuildQueueParams): SignedActionEnvelope {
    return buildSignedRemoveBuildQueueAction(params);
  }

  placeMarketOrder(params: MarketOrderParams): SignedActionEnvelope {
    return buildSignedPlaceMarketOrderAction(params);
  }

  acceptMarketOrder(params: AcceptMarketOrderParams): SignedActionEnvelope {
    return buildSignedAcceptMarketOrderAction(params);
  }

  cancelMarketOrder(params: CancelMarketOrderParams): SignedActionEnvelope {
    return buildSignedCancelMarketOrderAction(params);
  }
}
