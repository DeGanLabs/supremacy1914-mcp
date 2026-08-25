import type { PlayerId, ResourceId } from "../types/common.js";

export interface MarketOrderSnapshot {
  readonly orderId: number;
  readonly buy: boolean;
  /** true = this listing is someone buying (you can sell into it) */
  readonly isBid: boolean;
  /** true = this listing is someone selling (you can buy from it) */
  readonly isAsk: boolean;
  readonly amount: number;
  readonly limit: number;
  readonly resourceType: ResourceId;
  readonly playerId: number;
  readonly isOwner: boolean;
  readonly buyable: boolean;
  readonly premium: boolean;
  readonly embargo: boolean;
}

export interface ResourceMarketBook {
  readonly resourceId: ResourceId;
  readonly name: string;
  readonly price: number | null;
  readonly inventory: number | null;
  readonly bids: MarketOrderSnapshot[];
  readonly asks: MarketOrderSnapshot[];
}

export interface MarketSnapshot {
  readonly resources: ResourceMarketBook[];
  readonly myOrders: MarketOrderSnapshot[];
}

export interface RawMarketOrder {
  ["@c"]?: string;
  orderID?: number;
  buy?: boolean;
  amount?: number;
  limit?: number;
  resourceType?: number;
  playerID?: number;
  isOwner?: boolean;
  buyable?: boolean;
  embargo?: boolean;
  hasSold?: boolean;
  premium?: boolean;
  getOrderID?: () => number;
  isBuy?: () => boolean;
  getAmount?: () => number;
  getLimit?: () => number;
  getResourceType?: () => number;
  getPlayerID?: () => number;
  isPremium?: () => boolean;
}

export interface RawStockmarketModel {
  getBuyOffers(resourceId: number, filter?: boolean, limit?: number): RawMarketOrder[];
  getSellOffers(resourceId: number, filter?: boolean, limit?: number): RawMarketOrder[];
  getResolvedCurrentOrders?: () => RawMarketOrder[];
}

export interface RawResourceStateForMarket {
  getResourceName(id: number): string | null;
  getPriceFor?: (id: number) => number;
  getPlayerResourceEntry?: (id: number) => { getAmount?: () => number } | null;
  getOrder?: (orderId: number) => RawMarketOrder | null;
}

function mapOrder(o: RawMarketOrder): MarketOrderSnapshot | null {
  const orderId = o.getOrderID?.() ?? o.orderID;
  if (orderId == null) return null;
  const buy = o.isBuy?.() ?? !!o.buy;
  // Client naming: getBuyOffers ≈ asks you can buy from (listings with buy=false),
  // getSellOffers ≈ bids you can sell into (listings with buy=true). Prefer flags.
  return {
    orderId,
    buy,
    isBid: buy,
    isAsk: !buy,
    amount: o.getAmount?.() ?? o.amount ?? 0,
    limit: o.getLimit?.() ?? o.limit ?? 0,
    resourceType: o.getResourceType?.() ?? o.resourceType ?? 0,
    playerId: o.getPlayerID?.() ?? o.playerID ?? 0,
    isOwner: !!o.isOwner,
    buyable: !!o.buyable,
    premium: o.isPremium?.() ?? !!o.premium,
    embargo: !!o.embargo,
  };
}

export function readMarketBook(
  resourceId: ResourceId,
  name: string,
  price: number | null,
  inventory: number | null,
  model: RawStockmarketModel,
  depth = 8,
): ResourceMarketBook {
  // Client: getBuyOffers → orders you buy from (asks), getSellOffers → bids
  const rawAsks = model.getBuyOffers(resourceId, false, depth) || [];
  const rawBids = model.getSellOffers(resourceId, false, depth) || [];
  return {
    resourceId,
    name,
    price,
    inventory,
    asks: rawAsks.map(mapOrder).filter((x): x is MarketOrderSnapshot => !!x && !x.premium),
    bids: rawBids.map(mapOrder).filter((x): x is MarketOrderSnapshot => !!x && !x.premium),
  };
}

export function readMarketSnapshotFromHup(hup: {
  ui: { stockmarketController: { model: RawStockmarketModel; getTradeableResources?: () => unknown } };
  gameState: { getResourceState: () => RawResourceStateForMarket };
  config?: { userData?: { playerID?: PlayerId } };
}): MarketSnapshot {
  const sm = hup.ui.stockmarketController;
  const res = hup.gameState.getResourceState();
  try {
    // refresh offer lists when possible
    const ctrl = sm as { updateOfferLists?: () => void };
    ctrl.updateOfferLists?.();
  } catch {
    /* ignore */
  }

  const tradeableRaw = sm.getTradeableResources?.() ?? [0, 1, 2, 3, 4, 5, 6];
  const resourceIds: number[] = Array.isArray(tradeableRaw)
    ? tradeableRaw.map((t) =>
        typeof t === "object" && t && "id" in t
          ? Number((t as { id: string | number }).id)
          : Number(t),
      )
    : [0, 1, 2, 3, 4, 5, 6];

  const resources = resourceIds.map((id) => {
    const entry = res.getPlayerResourceEntry?.(id);
    return readMarketBook(
      id,
      res.getResourceName(id) || `resource_${id}`,
      res.getPriceFor?.(id) ?? null,
      entry?.getAmount?.() ?? null,
      sm.model,
      8,
    );
  });

  const myOrders = (sm.model.getResolvedCurrentOrders?.() || [])
    .map(mapOrder)
    .filter((x): x is MarketOrderSnapshot => !!x);

  return { resources, myOrders };
}
