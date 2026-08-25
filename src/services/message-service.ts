import type { PlayerId } from "../types/common.js";
import type {
  CommunicationsSnapshot,
  DiplomacyMessage,
  MessageThread,
  TradeOfferSnapshot,
} from "../types/messages.js";

export interface RelatedCommunications {
  readonly thread: MessageThread;
  readonly openTrades: readonly TradeOfferSnapshot[];
  readonly pastTrades: readonly TradeOfferSnapshot[];
  readonly allianceMentions: readonly DiplomacyMessage[];
}

export class MessageService {
  constructor(
    private readonly load: () =>
      | Promise<CommunicationsSnapshot>
      | CommunicationsSnapshot,
    private readonly loadThread?: (
      otherPlayerId: PlayerId,
    ) => Promise<RelatedCommunications> | RelatedCommunications,
  ) {}

  async snapshot(): Promise<CommunicationsSnapshot> {
    return this.load();
  }

  async allMessages(): Promise<readonly DiplomacyMessage[]> {
    const snap = await this.snapshot();
    return snap.messages;
  }

  async allianceMessages(): Promise<readonly DiplomacyMessage[]> {
    const snap = await this.snapshot();
    return snap.allianceMessages;
  }

  async threads(): Promise<readonly MessageThread[]> {
    const snap = await this.snapshot();
    return snap.threads;
  }

  async threadWith(otherPlayerId: PlayerId): Promise<MessageThread | undefined> {
    if (this.loadThread) {
      const related = await this.loadThread(otherPlayerId);
      return related.thread;
    }
    const snap = await this.snapshot();
    return snap.threads.find((t) => t.otherPlayerId === otherPlayerId);
  }

  async relatedWith(otherPlayerId: PlayerId): Promise<RelatedCommunications> {
    if (this.loadThread) {
      return this.loadThread(otherPlayerId);
    }

    const snap = await this.snapshot();
    const thread = snap.threads.find((t) => t.otherPlayerId === otherPlayerId) ?? {
      selfPlayerId: snap.selfPlayerId,
      otherPlayerId,
      messages: [],
    };

    const involves = (trade: TradeOfferSnapshot) =>
      (trade.senderId === snap.selfPlayerId && trade.receiverId === otherPlayerId) ||
      (trade.senderId === otherPlayerId && trade.receiverId === snap.selfPlayerId) ||
      (trade.partyA === snap.selfPlayerId && trade.partyB === otherPlayerId) ||
      (trade.partyA === otherPlayerId && trade.partyB === snap.selfPlayerId);

    return {
      thread,
      openTrades: snap.openTrades.filter(involves),
      pastTrades: snap.pastTrades.filter(involves),
      allianceMentions: snap.allianceMessages.filter(
        (m) => m.senderId === otherPlayerId || m.authorId === otherPlayerId,
      ),
    };
  }

  async findByPlayerName(name: string): Promise<MessageThread | undefined> {
    const snap = await this.snapshot();
    const needle = name.toLowerCase();
    return snap.threads.find(
      (t) =>
        t.other?.name?.toLowerCase() === needle ||
        t.other?.nationName?.toLowerCase() === needle,
    );
  }

  async search(text: string): Promise<DiplomacyMessage[]> {
    const snap = await this.snapshot();
    const needle = text.toLowerCase();
    return snap.messages.filter(
      (m) =>
        m.bodyText.toLowerCase().includes(needle) ||
        m.title.toLowerCase().includes(needle),
    );
  }
}
