import type { PlayerId } from "./common.js";

export type MessageUid = number;
export type TradeId = number;
export type AllianceId = number;

export interface MessagePlayerRef {
  readonly playerId: PlayerId;
  readonly name?: string;
  readonly nationName?: string;
}

export interface DiplomacyMessage {
  readonly uid: MessageUid;
  readonly className: string;
  readonly title: string;
  readonly body: string;
  /** HTML-decoded plain text body */
  readonly bodyText: string;
  readonly senderId: PlayerId;
  readonly receiverId: PlayerId;
  readonly authorId: PlayerId;
  readonly sender?: MessagePlayerRef;
  readonly receiver?: MessagePlayerRef;
  readonly day: number;
  readonly timeLabel?: string;
  readonly timestamp: number;
  readonly allianceId: AllianceId;
  readonly isAllianceMessage: boolean;
  readonly isSystemMessage: boolean;
  readonly extended: number;
  readonly hasShareMapOption: boolean;
  readonly intercepted?: boolean;
}

export interface MessageThread {
  readonly selfPlayerId: PlayerId;
  readonly otherPlayerId: PlayerId;
  readonly other?: MessagePlayerRef;
  readonly messages: readonly DiplomacyMessage[];
}

export interface TradeOfferItem {
  readonly offerType: string;
  readonly stringValue: string;
  readonly rawValue: number | string;
  readonly isRelation: boolean;
  readonly isProvince: boolean;
  readonly isResource: boolean;
  readonly innerId?: number;
  readonly tradeItemId?: string;
}

export interface TradeOfferSnapshot {
  readonly tradeId: TradeId;
  readonly senderId: PlayerId;
  readonly receiverId: PlayerId;
  readonly partyA: PlayerId;
  readonly partyB: PlayerId;
  readonly offerAType: string;
  readonly offerBType: string;
  readonly offersA: readonly TradeOfferItem[];
  readonly offersB: readonly TradeOfferItem[];
  readonly offersALabels: readonly string[];
  readonly offersBLabels: readonly string[];
  readonly message: string;
  readonly timestamp: number;
  readonly dateLabel?: string;
  readonly timeLabel?: string;
  readonly processed: boolean;
  readonly successful: boolean;
  readonly readByReceiver: boolean;
  readonly typeName?: string;
}

export interface CoalitionMessageEvent {
  readonly messageId: MessageUid;
  readonly eventId: number;
  readonly name: string;
  readonly description: string;
  readonly filterId?: PlayerId;
  readonly filterName?: string;
  readonly time: number;
  readonly status: number;
  readonly senders: readonly { senderID: number; nationName?: string }[];
}

export interface UnreadCommunications {
  readonly total: number;
  readonly unreadArticles: number;
  readonly unreadCoalition: number;
  readonly newTradeOffers: number;
}

export interface CommunicationsSnapshot {
  readonly selfPlayerId: PlayerId;
  readonly messages: readonly DiplomacyMessage[];
  readonly allianceMessages: readonly DiplomacyMessage[];
  readonly threads: readonly MessageThread[];
  readonly openTrades: readonly TradeOfferSnapshot[];
  readonly pastTrades: readonly TradeOfferSnapshot[];
  readonly coalitionEvents: readonly CoalitionMessageEvent[];
  readonly unread: UnreadCommunications;
}
