export interface NewspaperArticle {
  readonly uid: number;
  readonly title: string;
  readonly body: string;
  readonly author: string;
  readonly authorId: number;
  readonly senderId: number;
  readonly day: number;
  readonly timeStamp: number | null;
  readonly imageId: number;
  readonly kind: "player" | "system_battle" | "system_stats" | "anonymous" | "other";
}

export interface NewspaperDaySnapshot {
  readonly day: number;
  readonly articles: NewspaperArticle[];
  readonly playerArticles: NewspaperArticle[];
  readonly systemArticles: NewspaperArticle[];
}

export interface NewspaperSnapshot {
  readonly currentDay: number;
  readonly loadedDays: number[];
  readonly unreadCount: number;
  readonly day: NewspaperDaySnapshot;
}
