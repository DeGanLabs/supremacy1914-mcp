import { redactSecrets } from "./redact.js";

export interface NvidiaClientOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly fastModel: string;
  readonly maxTokens: number;
  readonly baseURL?: string;
}

export type ModelTier = "fast" | "quality";

interface ChatCompletionResponse {
  readonly choices?: ReadonlyArray<{
    readonly message?: {
      readonly content?: string | null;
      readonly reasoning_content?: string | null;
      readonly reasoning?: string | null;
    };
  }>;
}

export class NvidiaClient {
  readonly model: string;
  readonly fastModel: string;
  readonly maxTokens: number;
  private readonly apiKey: string;
  private readonly baseURL: string;

  constructor(options: NvidiaClientOptions) {
    if (!options.apiKey?.trim()) {
      throw new Error("NVIDIA_API_KEY missing");
    }
    this.apiKey = options.apiKey;
    this.baseURL = options.baseURL ?? "https://integrate.api.nvidia.com/v1";
    this.model = options.model;
    this.fastModel = options.fastModel;
    this.maxTokens = options.maxTokens;
  }

  modelFor(tier: ModelTier): string {
    return tier === "fast" ? this.fastModel : this.model;
  }

  async chat(input: {
    readonly tier: ModelTier;
    readonly system: string;
    readonly user: string;
    readonly json?: boolean;
  }): Promise<string> {
    const primary = this.modelFor(input.tier);
    const fallbacks =
      input.tier === "quality" && primary !== this.fastModel
        ? [primary, this.fastModel]
        : [primary];

    let lastErr = "";
    for (let i = 0; i < fallbacks.length; i++) {
      const model = fallbacks[i]!;
      try {
        return await this.callModel(model, input);
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        const next = fallbacks[i + 1];
        if (next) {
          console.warn(`NVIDIA ${model} failed — retrying with ${next}`);
          continue;
        }
      }
    }
    throw new Error(lastErr);
  }

  private async callModel(
    model: string,
    input: {
      readonly system: string;
      readonly user: string;
      readonly json?: boolean;
    },
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model,
      max_tokens: this.maxTokens,
      temperature: 0.2,
      top_p: 0.95,
      stream: false,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
    };
    if (/nemotron/i.test(model)) {
      body.chat_template_kwargs = { enable_thinking: false };
    }
    if (input.json) {
      body.response_format = { type: "json_object" };
    }

    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `NVIDIA chat failed (${model}): ${redactSecrets(`${res.status} ${text.slice(0, 240)}`)}`,
      );
    }
    const data = JSON.parse(text) as ChatCompletionResponse;
    const msg = data.choices?.[0]?.message;
    // JSON mode must use content only — reasoning_content is prose and breaks parsers.
    const content = (msg?.content ?? "").trim();
    if (content) return content;
    if (input.json) return "";
    return (
      msg?.reasoning_content?.trim() ||
      msg?.reasoning?.trim() ||
      ""
    );
  }

  async smoke(): Promise<{ ok: boolean; model: string; sample: string }> {
    const sample = await this.chat({
      tier: "fast",
      system: "Reply with exactly: pong",
      user: "ping",
    });
    return { ok: /pong/i.test(sample), model: this.fastModel, sample };
  }
}
