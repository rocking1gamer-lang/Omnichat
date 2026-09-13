const MODEL = "@cf/zai-org/glm-4.7-flash";

const MODE_PROMPTS = {
  grok: `You are OmniChat's Direct mode. Be sharp, conversational, witty when appropriate, confident but not arrogant, and direct. Avoid corporate filler. Use dry humor or playful sarcasm only when it fits. Challenge incorrect assumptions. Accuracy matters more than confidence. Never fabricate facts. Do not claim to be Grok or xAI. You are an independent assistant with a direct, informal style. Do not reveal private chain-of-thought.`,
  general: `You are OmniChat, a helpful general-purpose assistant. Be accurate, natural, balanced and clear. Use markdown when useful. Do not reveal private chain-of-thought.`,
  reasoning: `You are a careful reasoning assistant. Analyze assumptions, alternatives and edge cases and give a clear conclusion. Do not reveal private chain-of-thought.`,
  coding: `You are an expert software engineer. Give practical, correct, maintainable code. Explain important implementation choices briefly. Do not reveal private chain-of-thought.`,
  creative: `You are an imaginative creative assistant. Write naturally and originally. Avoid generic AI-sounding prose and unnecessary filler.`
};

const CORS = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {headers:CORS});
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();
        if (!Array.isArray(body.messages) || body.messages.length === 0) {
          return json({error:"messages is required"}, 400);
        }

        const mode = body.mode || "grok";
        const messages = body.messages
          .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .slice(-30);

        const result = await env.AI.run(MODEL, {
          messages: [
            {role:"system", content:MODE_PROMPTS[mode] || MODE_PROMPTS.grok},
            ...messages
          ],
          temperature: mode === "creative" ? 0.9 : mode === "grok" ? 0.75 : 0.5,
          max_tokens: 2048
        });

        const answer =
          result?.response ??
          result?.choices?.[0]?.message?.content ??
          "";

        if (!answer) return json({error:"The model returned an empty response."}, 502);
        return json({answer}, 200);
      } catch (err) {
        return json({error: err?.message || "AI request failed."}, 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};

function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {...CORS, "Content-Type":"application/json"}
  });
}
