type EventOptionBrief = { id: string; text: string };

type AdjudicateRequest = {
  eventId?: string;
  eventTitle?: string;
  eventText?: string;
  eventOptions?: EventOptionBrief[];
  playerStats?: Record<string, number>;
  npcRelations?: Record<string, number>;
  inventory?: Record<string, number>;
  world?: Record<string, number>;
  input?: string;
};

type AdjudicateResponse = {
  result_text: string;
  stat_changes?: Record<string, number>;
  trigger_ending?: string | null;
};

declare const process: {
  env: Record<string, string | undefined>;
};

const DEFAULT_MODEL = "deepseek-chat";

function buildPrompt(body: AdjudicateRequest): string {
  const options = (body.eventOptions ?? [])
    .map((opt) => `- ${opt.id}: ${opt.text}`)
    .join("\n");

  return `# Role
你是一个高难度古风生存游戏《通房丫头模拟器》的后台判定系统（GM）。
风格：写实、压抑、等级森严、逻辑严密，拒绝爽文。

# Context
当前事件：${body.eventTitle ?? ""}
事件内容：${body.eventText ?? ""}
可选项：\n${options || "(无)"}
玩家属性：${JSON.stringify(body.playerStats ?? {})}
NPC关系：${JSON.stringify(body.npcRelations ?? {})}
背包：${JSON.stringify(body.inventory ?? {})}
回合信息：${JSON.stringify(body.world ?? {})}

# User Input
${body.input ?? ""}

# Rules
1) 不可无中生有，不可机械降神。
2) 反抗/欺骗/暴力要结合心机与地位判定。
3) 行为越出格，惩罚越重；合理且巧妙可小幅奖励。
4) 用第二人称叙事，30-50字，古风白话。

# Output (Strict JSON)
只输出 JSON：
{
  "result_text": "...",
  "stat_changes": { "health": -10, "scheming": 1 },
  "trigger_ending": null | "be_dead_poison" | "be_sold"
}`;
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("No JSON found in model output");
  }
  return match[0];
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return new Response("Missing DEEPSEEK_API_KEY", { status: 500 });
  }

  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;

  let body: AdjudicateRequest;
  try {
    body = (await req.json()) as AdjudicateRequest;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  if (!body.input || !body.input.trim()) {
    return new Response("Missing input", { status: 400 });
  }

  const prompt = buildPrompt(body);

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: "请进行判定并输出严格 JSON。" },
      ],
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return new Response(errorText, { status: 502 });
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    return new Response("Empty model response", { status: 502 });
  }

  let parsed: AdjudicateResponse;
  try {
    parsed = JSON.parse(extractJson(content)) as AdjudicateResponse;
  } catch {
    return new Response("Bad JSON from model", { status: 502 });
  }

  if (!parsed.result_text) {
    return new Response("Missing result_text", { status: 502 });
  }

  return new Response(JSON.stringify(parsed), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
