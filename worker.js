const CHAT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const MAX_FILE_BYTES = 8 * 1024 * 1024;

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
    if (request.method === "OPTIONS") return new Response(null, {headers:CORS});

    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();
        if (!Array.isArray(body.messages) || !body.messages.length) return json({error:"messages is required"},400);
        const mode = body.mode || "grok";
        const messages = body.messages
          .filter(m => m && (m.role === "user" || m.role === "assistant") &&
            (typeof m.content === "string" || Array.isArray(m.content)))
          .slice(-30);

        const result = await env.AI.run(CHAT_MODEL, {
          messages: [
            {role:"system", content:MODE_PROMPTS[mode] || MODE_PROMPTS.grok},
            ...messages
          ],
          temperature: mode === "creative" ? 0.9 : mode === "grok" ? 0.75 : 0.5,
          max_tokens: 4096
        });
        const answer = result?.response ?? result?.choices?.[0]?.message?.content ?? "";
        if (!answer) return json({error:"The model returned an empty response."},502);
        return json({answer});
      } catch (err) {
        return json({error:err?.message || "AI request failed."},500);
      }
    }

    if (url.pathname === "/api/image" && request.method === "POST") {
      try {
        const body = await request.json();
        const prompt = String(body.prompt || "").trim();
        if (!prompt) return json({error:"Image prompt is required."},400);
        if (prompt.length > 2048) return json({error:"Image prompt is too long."},400);
        const result = await env.AI.run(IMAGE_MODEL, {
          prompt,
          steps: Math.min(Math.max(Number(body.steps)||4,1),8)
        });
        if (!result?.image) return json({error:"Image generation returned no image."},502);
        return json({image:`data:image/jpeg;base64,${result.image}`,prompt});
      } catch (err) {
        return json({error:err?.message || "Image generation failed."},500);
      }
    }

    if (url.pathname === "/api/file" && request.method === "POST") {
      try {
        const form = await request.formData();
        const files = form.getAll("files").filter(x => x instanceof File);
        if (!files.length) return json({error:"No files received."},400);
        if (files.length > 5) return json({error:"You can attach up to 5 files at once."},400);

        const results = [];
        for (const file of files) {
          if (file.size > MAX_FILE_BYTES) {
            results.push({name:file.name,type:"error",error:"File is larger than 8 MB."});
            continue;
          }
          const lower = file.name.toLowerCase();
          const isImage = /^image\/(jpeg|png|webp|gif|bmp)$/.test(file.type) ||
            /\.(jpe?g|png|webp|gif|bmp)$/.test(lower);

          if (isImage) {
            const bytes = new Uint8Array(await file.arrayBuffer());
            results.push({
              name:file.name,
              type:"image",
              mime:file.type || mimeFromName(lower),
              data:`data:${file.type || mimeFromName(lower)};base64,${uint8ToBase64(bytes)}`
            });
            continue;
          }

          const bytes = await file.arrayBuffer();
          const converted = await env.AI.toMarkdown({
            name:file.name,
            blob:new Blob([bytes],{type:file.type || "application/octet-stream"})
          }, {conversionOptions:{output:{format:"markdown"}}});

          const item = Array.isArray(converted) ? converted[0] : converted;
          if (!item || item.format === "error") {
            results.push({name:file.name,type:"error",error:item?.error || "Could not read this file."});
          } else {
            results.push({name:file.name,type:"text",data:item.data || ""});
          }
        }
        return json({files:results});
      } catch (err) {
        return json({error:err?.message || "File processing failed."},500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};

function uint8ToBase64(bytes) {
  let binary="";
  const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk) binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));
  return btoa(binary);
}
function mimeFromName(name) {
  const map={".jpg":"image/jpeg",".jpeg":"image/jpeg",".png":"image/png",".webp":"image/webp",".gif":"image/gif",".bmp":"image/bmp"};
  return map[name.slice(name.lastIndexOf("."))] || "application/octet-stream";
}
function json(data,status=200) {
  return new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json"}});
}
