// Direct server-side calls to the real Anthropic API using your own API key.
// This bypasses the Claude-artifact API bridge entirely, so the web_search
// tool works as documented (no "Invalid response format" issues).

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const SOURCES_ISRAEL = "Ynet, Calcalist, Globes, TheMarker, Haaretz, Times of Israel";
const SOURCES_WORLD = "Reuters, Wall Street Journal, Bloomberg, Financial Times, Axios, Associated Press";

function stripFences(t) {
  return t.replace(/```json/gi, "").replace(/```/g, "").trim();
}
function lenientRepair(s) {
  return s.replace(/[\u201C\u201D]/g, '"').replace(/,\s*([}\]])/g, "$1");
}
function extractJson(text) {
  const m = text.match(/<<<JSON_START>>>([\s\S]*?)<<<JSON_END>>>/);
  const candidate = m ? m[1] : text;
  const cleaned = stripFences(candidate);
  for (const attempt of [cleaned, lenientRepair(cleaned)]) {
    try {
      return JSON.parse(attempt);
    } catch (e) {}
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const sliced = cleaned.slice(start, end + 1);
    for (const attempt of [sliced, lenientRepair(sliced)]) {
      try {
        return JSON.parse(attempt);
      } catch (e) {}
    }
  }
  throw new Error("malformed JSON from model: " + text.slice(0, 500));
}

function wrapInstruction(schema) {
  return `Search the web now, then output your final answer as a single valid JSON object wrapped EXACTLY like this with nothing after the closing marker and no markdown fences:

<<<JSON_START>>>
{ ...json... }
<<<JSON_END>>>

Schema:
${schema}

Only use real URLs from your searches. Keep text concise. Escape any double-quotes inside string values, no smart quotes, no trailing commas.`;
}

const PROMPTS = {
  headlines: () =>
    `You are a news wire researcher producing a daily briefing that is explicitly NOT Israel-only — it must give equal weight to major world geopolitics and major global business/deals, alongside Israeli politics and economics. Sources, exclusively: ${SOURCES_ISRAEL} and ${SOURCES_WORLD}.

Find three things:
1. The single most important CURRENT story right now, worldwide (this can be an Israel story only if it is genuinely the single biggest story globally today — don't default to Israel).
2. Exactly 3 "World Desk" stories: major world geopolitics (elections, conflicts, diplomacy, sanctions — non-Israel-specific) and/or major global corporate deals, M&A, or business shifts (e.g. a huge merger, a major company's strategic pivot, a landmark trade deal). These must NOT be Israel-focused and must NOT overlap with the main headline.
3. Exactly 5 "Dispatches": a broader current mix — Israeli politics, Israeli economy, and additional world/markets stories not already covered above. Distinct from both the main headline and the World Desk stories.
` +
    wrapInstruction(
      `{"main_headline":{"title":"string","dek":"2-sentence summary","source":"outlet","url":"real URL","category":"Israel Politics | Israel Economy | World Geopolitics | World Economy"},"world_stories":[{"title":"string","one_liner":"1 sentence","source":"outlet","url":"real URL","category":"short label"}],"stories":[{"title":"string","one_liner":"1 sentence","source":"outlet","url":"real URL","category":"short label"}]}
"world_stories" must have exactly 3 items (world geopolitics or major global company deals, not Israel-specific). "stories" must have exactly 5 items. All three groups must be distinct stories from each other.`
    ),
  stock: () =>
    `Find one interesting stock currently featured with analysis in a major financial publication (Bloomberg, WSJ, Barron's, Fortune, FT).
` +
    wrapInstruction(
      `{"ticker":"e.g. NVDA","company":"name","magazine_source":"publication","headline":"article's angle","summary":"3-4 sentence analysis: why it's news, bull/bear case","url":"real URL"}`
    ),
  podcast: () =>
    `Recommend one current news/politics/markets podcast episode from a major outlet (Israeli or international).
` +
    wrapInstruction(
      `{"name":"podcast name","network":"publisher","episode_title":"episode title","summary":"2-sentence pitch","url":"real URL"}`
    ),
  trends: () =>
    `Find 1-2 genuinely current internet/cultural trends or memes circulating right now (Israeli or global) — actual internet culture, not news stories.
` +
    wrapInstruction(
      `{"trends":[{"title":"short trend name","description":"1-2 sentences"}]}`
    ),
};

async function callClaudeOnce(prompt, maxTokens) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });

  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    throw new Error(`non-JSON HTTP response (${response.status}): ${rawText.slice(0, 300)}`);
  }
  if (!response.ok) {
    throw new Error((data && data.error && data.error.message) || `HTTP ${response.status}`);
  }
  const textBlocks = (data.content || []).filter((b) => b.type === "text").map((b) => b.text);
  if (textBlocks.length === 0) throw new Error("no text block returned from API");
  return extractJson(textBlocks.join("\n"));
}

async function callClaude(promptKey, maxTokens, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await callClaudeOnce(PROMPTS[promptKey](), maxTokens);
    } catch (err) {
      lastErr = err;
      if (i < retries) await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw lastErr;
}

export async function fetchHeadlines() {
  return callClaude("headlines", 4000);
}
export async function fetchStock() {
  return callClaude("stock", 1500);
}
export async function fetchPodcast() {
  return callClaude("podcast", 1200);
}
export async function fetchTrends() {
  return callClaude("trends", 1200);
}