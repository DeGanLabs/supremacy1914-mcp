import type { SessionConfig } from "../types/auth.js";
import type {
  SignedActionEnvelope,
  WireArticle,
  WireChangeRelationAction,
  WireMessageAction,
  WireTradeOffer,
  WireTradeOfferAction,
} from "../types/actions.js";
import {
  ActionClass,
  TradeItemType,
  TradeOfferFlag,
} from "../types/actions.js";
import type { PlayerId } from "../types/common.js";
import { createLocalRequestId } from "../utils/ids.js";
import { signUpdateGameStateAction } from "./army-action-builder.js";

export interface DiplomacyMessageParams {
  readonly session: SessionConfig;
  readonly targetPlayerId: PlayerId;
  readonly text: string;
  /** Display name of the receiver (optional but matches client). */
  readonly targetPlayerName?: string;
  readonly authorName?: string;
  /** Alliance channel: pass alliance thread id like -1005 (client sets allianceID from this). */
  readonly allianceThreadId?: number;
  readonly innerRequestId?: string;
  readonly outerRequestId?: number;
}

export interface DiplomacyRelationParams {
  readonly session: SessionConfig;
  readonly targetPlayerId: PlayerId;
  /** Relation int: WAR=-2 … MILITARY_AUTHORITY=7 */
  readonly relation: number;
  readonly innerRequestId?: string;
  readonly outerRequestId?: number;
}

export type TradeOfferBag = Record<string | number, number>;

export interface TradeOfferParams {
  readonly session: SessionConfig;
  readonly targetPlayerId: PlayerId;
  /** What you give (party A). */
  readonly offer: TradeOfferBag;
  /** What you ask (party B). */
  readonly ask: TradeOfferBag;
  readonly message?: string;
  readonly innerRequestId?: string;
  readonly outerRequestId?: number;
}

export interface TradeOfferResponseParams {
  readonly session: SessionConfig;
  readonly tradeOfferId: number;
  readonly flag:
    | typeof TradeOfferFlag.Accept
    | typeof TradeOfferFlag.Refuse
    | typeof TradeOfferFlag.Delete
    | typeof TradeOfferFlag.Read;
  readonly innerRequestId?: string;
  readonly outerRequestId?: number;
}

/** Encode relation int the same way `UltChangeRelationAction` does. */
export function encodeRelationType(relation: number): string {
  const byte = relation & 0xff;
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(String.fromCharCode(byte));
  }
  return Buffer.from([byte]).toString("base64");
}

export function buildResourceTradeBag(
  resourceId: number,
  amount: number,
): TradeOfferBag {
  return { [resourceId]: amount };
}

export function buildRelationTradeBag(relation: number): TradeOfferBag {
  return { [TradeItemType.Relations]: relation };
}

export function buildProvinceTradeBag(provinceId: number): TradeOfferBag {
  return { [TradeItemType.Provinces]: provinceId };
}

function normalizeOfferBag(bag: TradeOfferBag): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(bag)) {
    out[String(k)] = v;
  }
  return out;
}

export function buildWireArticle(input: {
  readonly senderId: PlayerId;
  readonly receiverId: number;
  readonly text: string;
  readonly authorName: string;
  readonly receiverName?: string;
  readonly allianceId?: number;
}): WireArticle {
  return {
    "@c": ActionClass.Article,
    senderID: input.senderId,
    receiverID: input.receiverId,
    receiver: input.receiverName ?? "",
    authorID: input.senderId,
    author: input.authorName,
    messageBody: input.text,
    title: "",
    allianceID: input.allianceId ?? 0,
    imageID: -1,
    address: "",
    day: 0,
    timeStamp: null,
    extended: 0,
  };
}

export function buildSendMessageAction(
  input: {
    readonly senderId: PlayerId;
    readonly targetPlayerId: number;
    readonly text: string;
    readonly authorName: string;
    readonly targetPlayerName?: string;
    readonly allianceThreadId?: number;
  },
  requestId?: string,
): WireMessageAction {
  let receiverId = input.targetPlayerId;
  let allianceId = 0;
  if (input.allianceThreadId != null) {
    receiverId = input.allianceThreadId;
    // Client: allianceID = -1 * (parseInt(threadId) + 1000)
    allianceId = -1 * (input.allianceThreadId + 1000);
  }
  const article = buildWireArticle({
    senderId: input.senderId,
    receiverId,
    text: input.text,
    authorName: input.authorName,
    receiverName: input.allianceThreadId != null ? "" : input.targetPlayerName,
    allianceId,
  });
  return {
    requestID: requestId ?? createLocalRequestId(),
    "@c": ActionClass.MessageAction,
    newArticles: [article],
    updateArticles: null,
    deleteArticles: null,
  };
}

export function buildChangeRelationAction(
  targetPlayerId: PlayerId,
  relation: number,
  requestId?: string,
): WireChangeRelationAction {
  return {
    requestID: requestId ?? createLocalRequestId(),
    "@c": ActionClass.ChangeRelationAction,
    playerB: [targetPlayerId],
    relationType: encodeRelationType(relation),
  };
}

export function buildWireTradeOffer(input: {
  readonly senderId: PlayerId;
  readonly targetPlayerId: PlayerId;
  readonly offer: TradeOfferBag;
  readonly ask: TradeOfferBag;
  readonly message?: string;
  readonly timeStamp?: number;
}): WireTradeOffer {
  return {
    "@c": ActionClass.TradeOffer,
    partyA: input.senderId,
    partyB: input.targetPlayerId,
    offersA: normalizeOfferBag(input.offer),
    offersB: normalizeOfferBag(input.ask),
    message: input.message ?? "",
    timeStamp: input.timeStamp ?? Date.now(),
    successful: true,
    tradeId: -1,
    readByReceiver: null,
  };
}

export function buildCreateTradeOfferAction(
  offer: WireTradeOffer,
  requestId?: string,
): WireTradeOfferAction {
  return {
    requestID: requestId ?? createLocalRequestId(),
    "@c": ActionClass.TradeOfferAction,
    flag: TradeOfferFlag.Create,
    tradeOfferID: -1,
    tradeOffer: offer,
  };
}

export function buildRespondTradeOfferAction(
  tradeOfferId: number,
  flag: TradeOfferFlagValue,
  requestId?: string,
): WireTradeOfferAction {
  return {
    requestID: requestId ?? createLocalRequestId(),
    "@c": ActionClass.TradeOfferAction,
    flag,
    tradeOfferID: tradeOfferId,
    tradeOffer: null,
  };
}

type TradeOfferFlagValue = (typeof TradeOfferFlag)[keyof typeof TradeOfferFlag];

export function buildSignedSendMessageAction(
  input: DiplomacyMessageParams,
): SignedActionEnvelope {
  const action = buildSendMessageAction(
    {
      senderId: input.session.playerID,
      targetPlayerId: input.targetPlayerId,
      text: input.text,
      authorName: input.authorName ?? `Player ${input.session.playerID}`,
      targetPlayerName: input.targetPlayerName,
      allianceThreadId: input.allianceThreadId,
    },
    input.innerRequestId,
  );
  return signUpdateGameStateAction(input.session, [action], {
    requestId: input.outerRequestId,
  });
}

export function buildSignedChangeRelationAction(
  input: DiplomacyRelationParams,
): SignedActionEnvelope {
  const action = buildChangeRelationAction(
    input.targetPlayerId,
    input.relation,
    input.innerRequestId,
  );
  return signUpdateGameStateAction(input.session, [action], {
    requestId: input.outerRequestId,
  });
}

export function buildSignedCreateTradeOfferAction(
  input: TradeOfferParams,
): SignedActionEnvelope {
  const offer = buildWireTradeOffer({
    senderId: input.session.playerID,
    targetPlayerId: input.targetPlayerId,
    offer: input.offer,
    ask: input.ask,
    message: input.message,
  });
  const action = buildCreateTradeOfferAction(offer, input.innerRequestId);
  return signUpdateGameStateAction(input.session, [action], {
    requestId: input.outerRequestId,
  });
}

export function buildSignedRespondTradeOfferAction(
  input: TradeOfferResponseParams,
): SignedActionEnvelope {
  const action = buildRespondTradeOfferAction(
    input.tradeOfferId,
    input.flag,
    input.innerRequestId,
  );
  return signUpdateGameStateAction(input.session, [action], {
    requestId: input.outerRequestId,
  });
}

export class DiplomacyActionBuilder {
  sendMessage(params: DiplomacyMessageParams): SignedActionEnvelope {
    return buildSignedSendMessageAction(params);
  }

  setRelation(params: DiplomacyRelationParams): SignedActionEnvelope {
    return buildSignedChangeRelationAction(params);
  }

  createTradeOffer(params: TradeOfferParams): SignedActionEnvelope {
    return buildSignedCreateTradeOfferAction(params);
  }

  respondTradeOffer(params: TradeOfferResponseParams): SignedActionEnvelope {
    return buildSignedRespondTradeOfferAction(params);
  }
}
