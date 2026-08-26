import type { FinanceMode, FinancePicture } from "./types";

export type WhatIfShape = {
  hours?: number;
  disableBarracksProvinceIds?: number[];
  buyResource?: { resourceId: number; amount: number }[];
  build?: { provinceId: number; upgradeName: string }[];
};

const API = "";

export async function fetchPicture(): Promise<FinancePicture | null> {
  try {
    const r = await fetch(`${API}/api/finance-picture`);
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    if (j) return j as FinancePicture;
  } catch {
    /* fall through */
  }
  const f = await fetch(`${API}/api/fixture`);
  if (!f.ok) return null;
  return (await f.json()) as FinancePicture;
}

export async function refreshPicture(): Promise<FinancePicture | null> {
  try {
    const r = await fetch(`${API}/api/finance-refresh`, { method: "POST" });
    if (r.ok) return (await r.json()) as FinancePicture;
  } catch {
    /* ignore */
  }
  return fetchPicture();
}

export async function setMode(mode: FinanceMode): Promise<FinancePicture | null> {
  const r = await fetch(`${API}/api/finance-mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!r.ok) return null;
  return (await r.json()) as FinancePicture;
}

export async function approveBuild(
  provinceIdOrName: string,
  upgradeId: number,
): Promise<{ ok: boolean; error?: string; picture?: FinancePicture }> {
  try {
    const r = await fetch(`${API}/api/approve-build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provinceIdOrName, upgradeId }),
    });
    const j = (await r.json()) as {
      ok?: boolean;
      error?: string;
      picture?: FinancePicture;
    };
    if (!r.ok) return { ok: false, error: j.error || r.statusText };
    return { ok: true, picture: j.picture };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function runWhatIf(input: WhatIfShape): Promise<unknown> {
  const r = await fetch(`${API}/api/what-if`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return r.json();
}
