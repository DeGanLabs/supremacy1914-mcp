import type { SessionConfig } from "../types/auth.js";
import type { SignedActionEnvelope, WireUsePremiumAction } from "../types/actions.js";
import { ActionClass } from "../types/actions.js";
import type { ProvinceId } from "../types/common.js";
import { createLocalRequestId } from "../utils/ids.js";
import { signUpdateGameStateAction } from "./army-action-builder.js";

export interface DeployHeroParams {
  readonly session: SessionConfig;
  /** Hero inventory item id (not unit type id). */
  readonly heroItemId: number;
  readonly provinceId: ProvinceId;
  readonly amount?: number;
  readonly innerRequestId?: string;
  readonly outerRequestId?: number;
}

export interface UsePremiumItemParams {
  readonly session: SessionConfig;
  readonly premiumId: number;
  readonly amount?: number;
  readonly provinceIds?: readonly ProvinceId[];
  readonly armyIds?: readonly number[];
  readonly researchIds?: readonly number[];
  readonly innerRequestId?: string;
  readonly outerRequestId?: number;
}

export function buildUsePremiumAction(input: {
  readonly premiumId: number;
  readonly amount?: number;
  readonly provinceIds?: readonly number[];
  readonly armyIds?: readonly number[];
  readonly researchIds?: readonly number[];
  readonly requestId?: string;
}): WireUsePremiumAction {
  return {
    requestID: input.requestId ?? createLocalRequestId(),
    "@c": ActionClass.UsePremiumAction,
    premiumID: input.premiumId,
    amount: input.amount ?? 1,
    provinces: [...(input.provinceIds ?? [])],
    armies: [...(input.armyIds ?? [])],
    researches: [...(input.researchIds ?? [])],
  };
}

export function buildDeployHeroAction(
  heroItemId: number,
  provinceId: ProvinceId,
  options?: { readonly amount?: number; readonly requestId?: string },
): WireUsePremiumAction {
  return buildUsePremiumAction({
    premiumId: heroItemId,
    amount: options?.amount ?? 1,
    provinceIds: [provinceId],
    requestId: options?.requestId,
  });
}

export function buildSignedDeployHeroAction(
  input: DeployHeroParams,
): SignedActionEnvelope {
  const action = buildDeployHeroAction(input.heroItemId, input.provinceId, {
    amount: input.amount,
    requestId: input.innerRequestId,
  });
  return signUpdateGameStateAction(input.session, [action], {
    requestId: input.outerRequestId,
  });
}

export function buildSignedUsePremiumAction(
  input: UsePremiumItemParams,
): SignedActionEnvelope {
  const action = buildUsePremiumAction({
    premiumId: input.premiumId,
    amount: input.amount,
    provinceIds: input.provinceIds,
    armyIds: input.armyIds,
    researchIds: input.researchIds,
    requestId: input.innerRequestId,
  });
  return signUpdateGameStateAction(input.session, [action], {
    requestId: input.outerRequestId,
  });
}
