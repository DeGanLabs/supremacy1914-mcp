import type { SessionConfig } from "../types/auth.js";
import type { SignedActionEnvelope, WireArticle } from "../types/actions.js";
import { ActionClass } from "../types/actions.js";
import type { RequestId } from "../types/common.js";
import { createLocalRequestId } from "../utils/ids.js";
import { signUpdateGameStateAction } from "./army-action-builder.js";

export interface WriteNewspaperArticleParams {
  readonly session: SessionConfig;
  readonly title: string;
  readonly body: string;
  /** Optional premium image payload (client upload). */
  readonly imageData?: string | null;
  readonly imageName?: string | null;
  readonly authorName?: string;
  readonly anonymous?: boolean;
  readonly innerRequestId?: string;
  readonly outerRequestId?: number;
}

export interface WireNewArticleAction {
  requestID: RequestId;
  "@c": typeof ActionClass.NewArticleAction;
  rawArticle: WireArticle;
  imageData: string | null;
  imageName: string | null;
}

export function buildNewspaperArticle(input: {
  readonly playerId: number;
  readonly title: string;
  readonly body: string;
  readonly authorName?: string;
  readonly anonymous?: boolean;
}): WireArticle {
  if (input.anonymous) {
    return {
      "@c": ActionClass.Article,
      senderID: -1,
      receiverID: null,
      authorID: -1,
      author: "",
      messageBody: input.body,
      title: input.title,
      allianceID: 0,
      imageID: -1,
      address: "",
      day: 0,
      timeStamp: null,
      extended: 0,
    };
  }
  return {
    "@c": ActionClass.Article,
    senderID: input.playerId,
    receiverID: null,
    authorID: input.playerId,
    author: input.authorName ?? "",
    messageBody: input.body,
    title: input.title,
    allianceID: 0,
    imageID: -1,
    address: "",
    day: 0,
    timeStamp: null,
    extended: 0,
  };
}

export function buildNewArticleAction(
  article: WireArticle,
  options?: {
    readonly imageData?: string | null;
    readonly imageName?: string | null;
    readonly requestId?: string;
  },
): WireNewArticleAction {
  return {
    requestID: options?.requestId ?? createLocalRequestId(),
    "@c": ActionClass.NewArticleAction,
    rawArticle: article,
    imageData: options?.imageData ?? null,
    imageName: options?.imageName ?? null,
  };
}

export function buildSignedWriteNewspaperArticleAction(
  input: WriteNewspaperArticleParams,
): SignedActionEnvelope {
  const article = buildNewspaperArticle({
    playerId: input.session.playerID,
    title: input.title,
    body: input.body,
    authorName: input.authorName,
    anonymous: input.anonymous,
  });
  const action = buildNewArticleAction(article, {
    imageData: input.imageData,
    imageName: input.imageName,
    requestId: input.innerRequestId,
  });
  return signUpdateGameStateAction(input.session, [action], {
    requestId: input.outerRequestId,
  });
}
