const CHAT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const SYSTEM_PROMPT = `You are OmniChat, an independent multimodal AI assistant. Be useful, accurate, direct and natural. You can explain, reason, code, analyze attached files, and help create content. You can generate images when the user explicitly asks for an image, but image generation is handled by a separate tool in the app. Never claim that you created, converted, attached, uploaded, or linked a file unless the app actually performed that operation. Never invent download links. If the user asks to convert a file to PDF or DOCX, the app will perform the conversion; simply acknowledge the request if needed. When writing code, use fenced markdown code blocks with a language tag. Do not reveal private chain-of-thought.`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, {headers:CORS});
    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ok:true, chatModel:CHAT_MODEL, imageModel:IMAGE_MODEL});
      }
      if (url.pathname === "/api/chat" && request.method === "POST") {
        const body = await request.json();
        const messages = Array.isArray(body.messages) ? body.messages : [];
        if (!messages.length) return json({error:"messages is required"},400);
        const clean = messages.filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-40);
        const result = await env.AI.run(CHAT_MODEL, {
          messages:[{role:"system",content:SYSTEM_PROMPT},...clean],
          temperature:0.55,
          max_tokens:4096
        });
        const answer = result?.response || result?.choices?.[0]?.message?.content || result?.result?.response || "";
        if (!answer) return json({error:"The model returned an empty response."},502);
        return json({answer});
      }
      if (url.pathname === "/api/image" && request.method === "POST") {
        const body = await request.json();
        const prompt = String(body.prompt || "").trim();
        if (!prompt) return json({error:"Image prompt is required."},400);
        if (prompt.length > 2048) return json({error:"Image prompt is too long."},400);
        const result = await env.AI.run(IMAGE_MODEL,{prompt,steps:4});
        if (!result?.image) return json({error:"The image model returned no image."},502);
        return json({dataUrl:`data:image/jpeg;base64,${result.image}`,mimeType:"image/jpeg"});
      }
      if (url.pathname === "/api/convert" && request.method === "POST") {
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return json({error:"No file uploaded."},400);
        if (file.size > MAX_FILE_BYTES) return json({error:"File is larger than 8 MB."},413);
        const result = await env.AI.toMarkdown({
          name:file.name,
          blob:new Blob([await file.arrayBuffer()],{type:file.type || "application/octet-stream"})
        },{output:{format:"markdown"}});
        const item = Array.isArray(result) ? result[0] : result;
        if (!item || item.format === "error") return json({error:item?.error || "Could not read this file."},422);
        return json({name:item.name || file.name,mimeType:item.mimetype || item.mimeType || file.type,markdown:item.data || ""});
      }
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error(e);
      return json({error:e?.message || "Request failed."},500);
    }
  }
};

function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json; charset=utf-8"}});
}
