/**
 * Benchmark candidate NVIDIA fast models for War Minister JSON task.
 * Uses cached war-picture.json — no game bridge required.
 *
 *   npx tsx scripts/benchmark-fast-models.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import OpenAI from "openai";
import { config as loadDotenv } from "dotenv";
import { MinisterOutputSchema } from "../src/cabinet/types.js";
import { scoreWarPicture } from "../src/cabinet/war-watch.js";
import { formatWarBriefing, standingOrdersBlock } from "../src/cabinet/war-brief.js";
import { COST_CAPS } from "../src/cabinet/cost-caps.js";
import type { WarPictureRaw } from "../src/cabinet/war-types.js";

loadDotenv({ override: true });

const MODELS: { label: string; slug: string; altSlugs?: string[] }[] = [
  { label: "Llama-3.1-8B (baseline)", slug: "meta/llama-3.1-8b-instruct" },
  { label: "GLM-5.2", slug: "z-ai/glm-5.2" },
  {
    label: "DeepSeek-V4-Flash",
    slug: "deepseek-ai/deepseek-v4-flash",
    altSlugs: ["deepseek-ai/deepseek-v4-flash-0731"],
  },
  { label: "MiniMax M3", slug: "minimaxai/minimax-m3" },
  {
    label: "Nemotron-3.5-Lightning-30B",
    slug: "nvidia/nemotron-3.5-lightning-30b-a3b",
  },
  { label: "Laguna-XS-2.1", slug: "poolside/laguna-xs-2-1" },
  {
    label: "DiffusionGemma-26B-A4B",
    slug: "google/diffusiongemma-26b-a4b-it",
  },
];

const ALASKA_ARMY_IDS = [
  17011799, 17012003, 17012427, 17012595, 17013599, 17013782,
  17013929, 17014153, 17014386, 17014576, 17015165, 17015452,
];
const HOSTILE_IDS = [17015164, 17014754, 17011837, 17011333, 17014392];

function loadFixture(): { system: string; user: string } {
  const root = resolve(import.meta.dirname, "..");
  const warMd = readFileSync(
    resolve(root, "src/cabinet/prompts/war.md"),
    "utf8",
  );
  const raw = JSON.parse(
    readFileSync(resolve(root, "data/cabinet/war-picture.json"), "utf8"),
  ) as WarPictureRaw;
  const snap = scoreWarPicture(raw, null);
  const brief = formatWarBriefing(snap, raw, COST_CAPS.maxWarBriefChars);
  const goals = [
    { key: "focus", value: "Russian Alaska" },
    { key: "no-invade", value: "Russian Alaska" },
    { key: "hold", value: "Alaska-border" },
  ];
  const goalsBlock = goals.map((g) => `- ${g.key}: ${g.value}`).join("\n");
  const standing = standingOrdersBlock(goals);
  const question =
    "@War Russian Alaska ONLY (ignore paper wars). List our troops + Russian stacks. INTENT=hold/disengage — retreat MOST, thin screen on border. moveArmy with real ids. Proposals for /approve.";

  const TOOL_HINT = `Return final MinisterOutput JSON only (no markdown):
{"facts":[],"concerns":[],"proposals":[],"need_from":[],"draft_message":null,"public_line":""}
proposals may include moveArmy with armyId,x,y from war picture.`;

  const system = `${warMd}\n\n${TOOL_HINT}`;
  const user = `Standing goals:\n${goalsBlock}\n\nStanding war orders:\n${standing}\n\nPlayer question:\n${question}\n\nLive war picture (authoritative):\n${brief}\n\nRespond with JSON only.`;
  return { system, user };
}

interface BenchResult {
  label: string;
  slug: string;
  ok: boolean;
  latencyMs: number;
  jsonOk: boolean;
  schemaOk: boolean;
  publicLen: number;
  alaska: boolean;
  intent: boolean;
  armyIds: number;
  proposals: number;
  validMoveProposals: number;
  score: number;
  error?: string;
  publicPreview?: string;
}

function scoreOutput(
  label: string,
  slug: string,
  latencyMs: number,
  raw: string,
  err?: string,
): BenchResult {
  const base: BenchResult = {
    label,
    slug,
    ok: false,
    latencyMs,
    jsonOk: false,
    schemaOk: false,
    publicLen: 0,
    alaska: false,
    intent: false,
    armyIds: 0,
    proposals: 0,
    validMoveProposals: 0,
    score: 0,
    error: err,
  };
  if (err) return base;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    base.jsonOk = true;
  } catch {
    base.error = "invalid JSON";
    base.publicPreview = raw.slice(0, 180).replace(/\s+/g, " ");
    return base;
  }

  const out = MinisterOutputSchema.safeParse(parsed);
  if (!out.success) {
    base.error = `schema: ${out.error.issues[0]?.message ?? "fail"}`;
    const pub = (parsed as { public_line?: string }).public_line ?? "";
    base.publicLen = pub.length;
    base.publicPreview = pub.slice(0, 180) || raw.slice(0, 180);
    return base;
  }

  base.schemaOk = true;
  base.ok = true;
  const pub = out.data.public_line;
  base.publicLen = pub.length;
  base.publicPreview = pub.slice(0, 180);
  base.alaska = /russian alaska|alaska|new arkhangelsk|prince george|iskut/i.test(pub);
  base.intent = /hold|disengage|screen|retreat/i.test(pub);
  for (const id of ALASKA_ARMY_IDS) {
    if (pub.includes(String(id)) || JSON.stringify(out.data).includes(String(id))) {
      base.armyIds++;
    }
  }
  base.proposals = out.data.proposals.length;
  for (const p of out.data.proposals) {
    if (p.type === "moveArmy") {
      const a = p.args as { armyId?: number; x?: number; y?: number };
      if (
        typeof a.armyId === "number" &&
        ALASKA_ARMY_IDS.includes(a.armyId) &&
        typeof a.x === "number" &&
        typeof a.y === "number"
      ) {
        base.validMoveProposals++;
      }
    }
  }

  // Weighted score for our use case
  base.score =
    (base.schemaOk ? 40 : 0) +
    (base.alaska ? 15 : 0) +
    (base.intent ? 10 : 0) +
    Math.min(base.armyIds, 5) * 4 +
    base.validMoveProposals * 8 +
    (base.publicLen >= 120 ? 10 : base.publicLen >= 60 ? 5 : 0) -
    Math.min(latencyMs / 1000, 30); // small speed bonus cap

  return base;
}

async function tryModel(
  client: OpenAI,
  slug: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<{ raw: string; latencyMs: number; error?: string }> {
  const t0 = Date.now();
  try {
    const res = await client.chat.completions.create({
      model: slug,
      max_tokens: maxTokens,
      temperature: 0.4,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });
    return {
      raw: res.choices[0]?.message?.content?.trim() ?? "",
      latencyMs: Date.now() - t0,
    };
  } catch (err) {
    return {
      raw: "",
      latencyMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const apiKey = process.env.NVIDIA_API_KEY?.trim();
  if (!apiKey) throw new Error("NVIDIA_API_KEY missing");
  const maxTokens = Number(process.env.NVIDIA_MAX_TOKENS || 4096);
  const client = new OpenAI({
    apiKey,
    baseURL: "https://integrate.api.nvidia.com/v1",
  });
  const { system, user } = loadFixture();
  console.log(`Fixture user chars: ${user.length}, max_tokens=${maxTokens}\n`);

  const results: BenchResult[] = [];

  for (const m of MODELS) {
    process.stdout.write(`Testing ${m.label} (${m.slug})… `);
    let attempt = await tryModel(client, m.slug, system, user, maxTokens);
    if (attempt.error && m.altSlugs?.length) {
      for (const alt of m.altSlugs) {
        process.stdout.write(`retry ${alt}… `);
        attempt = await tryModel(client, alt, system, user, maxTokens);
        if (!attempt.error) {
          m.slug = alt;
          break;
        }
      }
    }
    const r = scoreOutput(
      m.label,
      m.slug,
      attempt.latencyMs,
      attempt.raw,
      attempt.error,
    );
    results.push(r);
    console.log(
      r.ok
        ? `OK ${(r.latencyMs / 1000).toFixed(1)}s score=${r.score.toFixed(0)} armies=${r.armyIds} moves=${r.validMoveProposals}`
        : `FAIL ${(r.latencyMs / 1000).toFixed(1)}s — ${r.error}`,
    );
    await new Promise((x) => setTimeout(x, 1500));
  }

  results.sort((a, b) => b.score - a.score || a.latencyMs - b.latencyMs);

  console.log("\n" + "=".repeat(72));
  console.log("RANKING (War Minister JSON — Russian Alaska disengage)");
  console.log("=".repeat(72));
  console.log(
    "Rank | Model | Score | Latency | JSON | Schema | Alaska | Intent | ArmyIDs | moveArmy",
  );
  results.forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(4)} | ${r.label.padEnd(28)} | ${String(Math.round(r.score)).padStart(5)} | ${(r.latencyMs / 1000).toFixed(1).padStart(6)}s | ${r.jsonOk ? "Y" : "N"} | ${r.schemaOk ? "Y" : "N"} | ${r.alaska ? "Y" : "N"} | ${r.intent ? "Y" : "N"} | ${String(r.armyIds).padStart(7)} | ${r.validMoveProposals}`,
    );
    if (r.publicPreview && r.schemaOk) {
      console.log(`       preview: ${r.publicPreview.replace(/\n/g, " ")}`);
    } else if (r.error) {
      console.log(`       err: ${r.error.slice(0, 120)}`);
    }
  });

  const best = results.find((r) => r.schemaOk);
  const fastestGood = [...results]
    .filter((r) => r.schemaOk)
    .sort((a, b) => a.latencyMs - b.latencyMs)[0];
  console.log("\n--- Verdict ---");
  if (best) {
    console.log(`Best overall: ${best.label} (${best.slug}) score=${Math.round(best.score)}`);
  }
  if (fastestGood) {
    console.log(
      `Fastest valid: ${fastestGood.label} (${(fastestGood.latencyMs / 1000).toFixed(1)}s)`,
    );
  }
  const rec = results.filter((r) => r.schemaOk).sort((a, b) => {
    const ratioA = a.score / Math.max(a.latencyMs / 1000, 1);
    const ratioB = b.score / Math.max(b.latencyMs / 1000, 1);
    return ratioB - ratioA;
  })[0];
  if (rec) {
    console.log(
      `Best speed/intelligence: ${rec.label} — set NVIDIA_MODEL_FAST=${rec.slug}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
