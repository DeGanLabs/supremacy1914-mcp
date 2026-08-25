import type {
  NewspaperArticle,
  NewspaperDaySnapshot,
  NewspaperSnapshot,
} from "../types/newspaper.js";
import type { PlayerId } from "../types/common.js";

/** Matches UltArticle authorID conventions. */
export const NewspaperAuthorId = {
  Anonymous: -1,
  SystemBattle: -2,
  SystemStats: -3,
} as const;

export interface RawNewspaperArticle {
  ["@c"]?: string;
  getMessageUID(): number;
  getTitle(): string;
  getMessageBody(raw?: boolean): string;
  getAuthor(): string;
  getAuthorID(): number;
  getSenderID(): number;
  getDay(): number;
  getTimeStamp(): number;
  getImageID?: () => number;
}

export interface RawNewspaperState {
  days?: Record<string, unknown>;
  getArticles(day: number): RawNewspaperArticle[] | false | null;
  getArticlesSorted?(day: number): RawNewspaperArticle[] | false | null;
  getDay(day: number): unknown;
  hasDay(day: number): boolean;
  requestDay(day: number): void;
  getNewArticlesCount(playerId: number, sinceUnixSeconds: number): number;
  getArticle?(uid: number): RawNewspaperArticle | null;
}

function classifyAuthor(authorId: number): NewspaperArticle["kind"] {
  if (authorId > 0) return "player";
  if (authorId === NewspaperAuthorId.SystemBattle) return "system_battle";
  if (authorId === NewspaperAuthorId.SystemStats) return "system_stats";
  if (authorId === NewspaperAuthorId.Anonymous) return "anonymous";
  return "other";
}

export function mapNewspaperArticle(a: RawNewspaperArticle): NewspaperArticle {
  const authorId = a.getAuthorID();
  return {
    uid: a.getMessageUID(),
    title: a.getTitle() || "",
    body: a.getMessageBody?.() || "",
    author: a.getAuthor() || "",
    authorId,
    senderId: a.getSenderID(),
    day: a.getDay(),
    timeStamp: a.getTimeStamp?.() ?? null,
    imageId: a.getImageID?.() ?? -1,
    kind: classifyAuthor(authorId),
  };
}

export function readNewspaperDay(
  ns: RawNewspaperState,
  day: number,
  options?: { readonly requestIfMissing?: boolean },
): NewspaperDaySnapshot | null {
  if (!ns.hasDay(day)) {
    if (options?.requestIfMissing !== false) {
      try {
        ns.requestDay(day);
      } catch {
        /* ignore */
      }
    }
    if (!ns.hasDay(day)) return null;
  }
  const raw =
    ns.getArticlesSorted?.(day) ||
    ns.getArticles(day) ||
    [];
  const articles = (Array.isArray(raw) ? raw : []).map(mapNewspaperArticle);
  return {
    day,
    articles,
    playerArticles: articles.filter((a) => a.kind === "player"),
    systemArticles: articles.filter((a) => a.kind !== "player"),
  };
}

export function readNewspaperSnapshotFromHup(
  hup: {
    config: { userData: { playerID: PlayerId } };
    gameState: {
      getNewspaperState: () => RawNewspaperState;
      getGameInfoState: () => { getDayOfGame: () => number };
    };
  },
  day?: number,
): NewspaperSnapshot {
  const ns = hup.gameState.getNewspaperState();
  const currentDay = hup.gameState.getGameInfoState().getDayOfGame();
  const target = day ?? currentDay;
  const daySnap = readNewspaperDay(ns, target) ?? {
    day: target,
    articles: [],
    playerArticles: [],
    systemArticles: [],
  };
  return {
    currentDay,
    loadedDays: Object.keys(ns.days || {})
      .map(Number)
      .sort((a, b) => a - b),
    unreadCount: ns.getNewArticlesCount(hup.config.userData.playerID, 0),
    day: daySnap,
  };
}
