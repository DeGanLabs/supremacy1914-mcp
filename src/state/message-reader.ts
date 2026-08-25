import type { PlayerId } from "../types/common.js";
import type {
  CoalitionMessageEvent,
  CommunicationsSnapshot,
  DiplomacyMessage,
  MessagePlayerRef,
  MessageThread,
  TradeOfferItem,
  TradeOfferSnapshot,
  UnreadCommunications,
} from "../types/messages.js";
import { decodeHtmlEntities } from "../utils/text.js";

export interface RawArticle {
  ["@c"]?: string;
  allianceID?: number;
  intercepted?: boolean;
  getMessageUID(): number;
  getTitle(): string;
  getMessageBody(): string;
  getSenderID(): number;
  getReceiverID(): number;
  getAuthorID(): number;
  getDay(): number;
  getTime?: () => string;
  getTimeStamp(): number;
  getAllianceID?: () => number;
  getExtended?: () => number;
  isSystemMessage?: () => boolean;
  hasShareMapOption?: () => boolean;
  getSenderNationName?: () => string;
  getSender?: () => { getName?: () => string; getNationName?: () => string } | null;
  getReceiver?: () => { getName?: () => string; getNationName?: () => string } | null;
  getReceiverName?: () => string;
}

export interface RawTradeOffer {
  message?: string;
  getTradeID(): number;
  getSenderID(): number;
  getReceiverID(): number;
  getPartyA(): number;
  getPartyB(): number;
  getOfferAType(): string;
  getOfferBType(): string;
  getOfferAObjectsWithType(): RawTradeItem[] | null | undefined;
  getOfferBObjectsWithType(): RawTradeItem[] | null | undefined;
  getOffersAAsString(): string[] | string | null | undefined;
  getOffersBAsString(): string[] | string | null | undefined;
  getTimeStamp?: () => number;
  timeStamp?: number;
  getDate?: () => string;
  getTime?: () => string;
  isProcessed(): boolean;
  isSuccessful(): boolean;
  isReadByReceiver(): boolean;
  getTradeOfferTypeName?: () => string;
}

export interface RawTradeItem {
  offerType?: string;
  stringValue?: string;
  rawValue?: number | string;
  value?: string | number;
  isRelation?: boolean;
  isProvince?: boolean;
  isResource?: boolean;
  innerID?: number;
  tradeItemID?: string;
}

export interface RawTradingState {
  tradingOffers: RawTradeOffer[] | Record<string, RawTradeOffer>;
  pastTrades: RawTradeOffer[] | Record<string, RawTradeOffer>;
  getTradeOffersForPlayers(a: number, b: number): RawTradeOffer[];
  getPastTradeOffersForPlayers(a: number, b: number): RawTradeOffer[];
  getNewOfferCount(playerId: number, includeAlliance?: boolean): number;
}

export interface RawForeignAffairsMessages {
  getMessages(): RawArticle[];
  getAllianceMessages(): RawArticle[];
  getMessage(uid: number | string): RawArticle | null;
  getArticlesForPlayers(
    selfPlayerId: number,
    otherPlayerId: number,
    onlyToSelf?: boolean,
    includeDeleted?: boolean,
  ): RawArticle[];
  getUnreadArticleNum(playerId?: number, includeAlliance?: boolean): number;
  getUnreadCoalitionMessagesCount(playerId?: number): number;
  getUnreadCommunications(playerId?: number, includeAlliance?: boolean): number;
  getCoalitionMessagesInEventQueue(): RawCoalitionEvent[] | null | undefined;
}

export interface RawCoalitionEvent {
  messageID: number;
  eventID: number;
  name: string;
  description: string;
  filterID?: number;
  filterName?: string;
  time: number;
  status: number;
  senders?: { senderID: number; nationName?: string }[];
}

export interface RawPlayerLookup {
  getPlayersArray(): {
    getPlayerID(): number;
    getName?: () => string;
    getNationName?: () => string;
  }[];
}

function asArray<T>(value: T[] | Record<string, T> | null | undefined): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return Object.values(value);
}

function labelsOf(value: string[] | string | null | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function mapPlayerRef(
  id: number,
  lookup?: Map<number, MessagePlayerRef>,
  fallbackNation?: string,
  fallbackName?: string,
): MessagePlayerRef {
  const known = lookup?.get(id);
  return {
    playerId: id,
    name: known?.name ?? fallbackName,
    nationName: known?.nationName ?? fallbackNation,
  };
}

export function mapArticle(
  article: RawArticle,
  players?: Map<number, MessagePlayerRef>,
): DiplomacyMessage {
  const body = article.getMessageBody() ?? "";
  const allianceId =
    article.getAllianceID?.() ?? article.allianceID ?? 0;
  const senderId = article.getSenderID();
  const receiverId = article.getReceiverID();
  const senderObj = article.getSender?.();
  const receiverObj = article.getReceiver?.();

  return {
    uid: article.getMessageUID(),
    className: article["@c"] ?? "ultshared.UltArticle",
    title: article.getTitle() ?? "",
    body,
    bodyText: decodeHtmlEntities(body),
    senderId,
    receiverId,
    authorId: article.getAuthorID(),
    sender: mapPlayerRef(
      senderId,
      players,
      article.getSenderNationName?.() ?? senderObj?.getNationName?.(),
      senderObj?.getName?.(),
    ),
    receiver: mapPlayerRef(
      receiverId,
      players,
      receiverObj?.getNationName?.(),
      receiverObj?.getName?.() ?? article.getReceiverName?.(),
    ),
    day: article.getDay(),
    timeLabel: article.getTime?.(),
    timestamp: article.getTimeStamp(),
    allianceId,
    isAllianceMessage: allianceId > 0,
    isSystemMessage: article.isSystemMessage?.() ?? false,
    extended: article.getExtended?.() ?? 0,
    hasShareMapOption: article.hasShareMapOption?.() ?? false,
    intercepted: article.intercepted,
  };
}

export function mapTradeItem(item: RawTradeItem): TradeOfferItem {
  return {
    offerType: item.offerType ?? "Unknown",
    stringValue: item.stringValue ?? String(item.value ?? ""),
    rawValue: item.rawValue ?? item.value ?? "",
    isRelation: Boolean(item.isRelation),
    isProvince: Boolean(item.isProvince),
    isResource: Boolean(item.isResource),
    innerId: item.innerID,
    tradeItemId: item.tradeItemID,
  };
}

export function mapTradeOffer(offer: RawTradeOffer): TradeOfferSnapshot {
  return {
    tradeId: offer.getTradeID(),
    senderId: offer.getSenderID(),
    receiverId: offer.getReceiverID(),
    partyA: offer.getPartyA(),
    partyB: offer.getPartyB(),
    offerAType: offer.getOfferAType(),
    offerBType: offer.getOfferBType(),
    offersA: (offer.getOfferAObjectsWithType() ?? []).map(mapTradeItem),
    offersB: (offer.getOfferBObjectsWithType() ?? []).map(mapTradeItem),
    offersALabels: labelsOf(offer.getOffersAAsString()),
    offersBLabels: labelsOf(offer.getOffersBAsString()),
    message: offer.message ?? "",
    timestamp: offer.getTimeStamp?.() ?? offer.timeStamp ?? 0,
    dateLabel: offer.getDate?.(),
    timeLabel: offer.getTime?.(),
    processed: offer.isProcessed(),
    successful: offer.isSuccessful(),
    readByReceiver: offer.isReadByReceiver(),
    typeName: offer.getTradeOfferTypeName?.(),
  };
}

export function mapCoalitionEvent(event: RawCoalitionEvent): CoalitionMessageEvent {
  return {
    messageId: event.messageID,
    eventId: event.eventID,
    name: event.name,
    description: event.description,
    filterId: event.filterID,
    filterName: event.filterName,
    time: event.time,
    status: event.status,
    senders: event.senders ?? [],
  };
}

export function buildPlayerLookup(playerState: RawPlayerLookup): Map<number, MessagePlayerRef> {
  const map = new Map<number, MessagePlayerRef>();
  for (const p of playerState.getPlayersArray()) {
    map.set(p.getPlayerID(), {
      playerId: p.getPlayerID(),
      name: p.getName?.(),
      nationName: p.getNationName?.(),
    });
  }
  return map;
}

export function groupMessageThreads(
  selfPlayerId: PlayerId,
  messages: readonly DiplomacyMessage[],
  players?: Map<number, MessagePlayerRef>,
): MessageThread[] {
  const byOther = new Map<number, DiplomacyMessage[]>();

  for (const msg of messages) {
    // Alliance channel uses negative receiver IDs like -1005 — keep under alliance bucket
    if (msg.isAllianceMessage && msg.receiverId < 0) {
      const key = msg.receiverId;
      const list = byOther.get(key) ?? [];
      list.push(msg);
      byOther.set(key, list);
      continue;
    }

    const other =
      msg.senderId === selfPlayerId ? msg.receiverId : msg.senderId;
    const list = byOther.get(other) ?? [];
    list.push(msg);
    byOther.set(other, list);
  }

  return [...byOther.entries()]
    .map(([otherPlayerId, list]) => ({
      selfPlayerId,
      otherPlayerId,
      other: players?.get(otherPlayerId) ?? { playerId: otherPlayerId },
      messages: list.slice().sort((a, b) => a.timestamp - b.timestamp),
    }))
    .sort((a, b) => b.messages.length - a.messages.length);
}

export function readUnreadCommunications(
  fa: RawForeignAffairsMessages,
  trading: RawTradingState,
  selfPlayerId: PlayerId,
): UnreadCommunications {
  const unreadArticles = fa.getUnreadArticleNum(selfPlayerId) ?? 0;
  const unreadCoalition = fa.getUnreadCoalitionMessagesCount(selfPlayerId) ?? 0;
  const newTradeOffers = trading.getNewOfferCount(selfPlayerId) ?? 0;
  const total =
    fa.getUnreadCommunications(selfPlayerId) ??
    unreadArticles + unreadCoalition + newTradeOffers;

  return {
    total,
    unreadArticles,
    unreadCoalition,
    newTradeOffers,
  };
}

export function readThreadWithPlayer(
  fa: RawForeignAffairsMessages,
  selfPlayerId: PlayerId,
  otherPlayerId: PlayerId,
  players?: Map<number, MessagePlayerRef>,
): MessageThread {
  const articles = fa.getArticlesForPlayers(selfPlayerId, otherPlayerId);
  const messages = articles.map((a) => mapArticle(a, players));
  return {
    selfPlayerId,
    otherPlayerId,
    other: players?.get(otherPlayerId) ?? { playerId: otherPlayerId },
    messages: messages.sort((a, b) => a.timestamp - b.timestamp),
  };
}

export function readTradesWithPlayer(
  trading: RawTradingState,
  selfPlayerId: PlayerId,
  otherPlayerId: PlayerId,
): { open: TradeOfferSnapshot[]; past: TradeOfferSnapshot[] } {
  return {
    open: (trading.getTradeOffersForPlayers(selfPlayerId, otherPlayerId) ?? []).map(
      mapTradeOffer,
    ),
    past: (trading.getPastTradeOffersForPlayers(selfPlayerId, otherPlayerId) ?? []).map(
      mapTradeOffer,
    ),
  };
}

export function readCommunicationsSnapshot(input: {
  selfPlayerId: PlayerId;
  foreignAffairs: RawForeignAffairsMessages;
  trading: RawTradingState;
  playerState?: RawPlayerLookup;
}): CommunicationsSnapshot {
  const players = input.playerState
    ? buildPlayerLookup(input.playerState)
    : undefined;

  const messages = (input.foreignAffairs.getMessages() ?? []).map((a) =>
    mapArticle(a, players),
  );
  const allianceMessages = (input.foreignAffairs.getAllianceMessages() ?? []).map((a) =>
    mapArticle(a, players),
  );
  const openTrades = asArray(input.trading.tradingOffers).map(mapTradeOffer);
  const pastTrades = asArray(input.trading.pastTrades).map(mapTradeOffer);
  const coalitionEvents = (
    input.foreignAffairs.getCoalitionMessagesInEventQueue() ?? []
  ).map(mapCoalitionEvent);

  return {
    selfPlayerId: input.selfPlayerId,
    messages,
    allianceMessages,
    threads: groupMessageThreads(input.selfPlayerId, messages, players),
    openTrades,
    pastTrades,
    coalitionEvents,
    unread: readUnreadCommunications(
      input.foreignAffairs,
      input.trading,
      input.selfPlayerId,
    ),
  };
}

export function readCommunicationsFromHup(hup: {
  config: { userData: { playerID: number } };
  gameState: {
    getForeignAffairsState(): RawForeignAffairsMessages;
    getResourceState(): { getTrading(): RawTradingState };
    getPlayerState(): RawPlayerLookup;
  };
}): CommunicationsSnapshot {
  return readCommunicationsSnapshot({
    selfPlayerId: hup.config.userData.playerID,
    foreignAffairs: hup.gameState.getForeignAffairsState(),
    trading: hup.gameState.getResourceState().getTrading(),
    playerState: hup.gameState.getPlayerState(),
  });
}
