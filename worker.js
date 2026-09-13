const CHAT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const SYSTEM_PROMPT = `You are OmniChat, an independent multimodal AI assistant. Be accurate, useful, direct and natural. Write correct code in fenced markdown blocks. Analyze supplied file text when present. Never claim to have created or uploaded a file unless the application actually did so. Do not reveal private chain-of-thought.`;
const CORS = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type"};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null,{headers:CORS});
    try {
      if (url.pathname === "/api/health") return json({ok:true});
      if (url.pathname === "/api/chat" && request.method === "POST") {
        const body=await request.json();
        const messages=Array.isArray(body.messages)?body.messages:[];
        if(!messages.length) return json({error:"messages is required"},400);
        const clean=messages.filter(m=>m&&(m.role==="user"||m.role==="assistant")&&typeof m.content==="string").slice(-40);
        const result=await env.AI.run(CHAT_MODEL,{messages:[{role:"system",content:SYSTEM_PROMPT},...clean],temperature:0.55,max_tokens:4096});
        const answer=result?.response||result?.choices?.[0]?.message?.content||result?.result?.response||"";
        if(!answer) return json({error:"The model returned an empty response."},502);
        return json({answer});
      }
      if(url.pathname==="/api/image"&&request.method==="POST"){
        const body=await request.json(), prompt=String(body.prompt||"").trim();
        if(!prompt)return json({error:"Image prompt is required."},400);
        const result=await env.AI.run(IMAGE_MODEL,{prompt,steps:4});
        if(!result?.image)return json({error:"The image model returned no image."},502);
        return json({dataUrl:"data:image/jpeg;base64,"+result.image});
      }
      if(url.pathname==="/api/read-file"&&request.method==="POST"){
        const form=await request.formData(), file=form.get("file");
        if(!(file instanceof File))return json({error:"No file uploaded."},400);
        if(file.size>MAX_FILE_BYTES)return json({error:"File is larger than 8 MB."},413);
        const result=await env.AI.toMarkdown({name:file.name,blob:new Blob([await file.arrayBuffer()],{type:file.type||"application/octet-stream"})},{output:{format:"markdown"}});
        const item=Array.isArray(result)?result[0]:result;
        if(!item||item.format==="error")return json({error:item?.error||"Could not read this file."},422);
        return json({name:item.name||file.name,markdown:item.data||""});
      }
      if(url.pathname==="/api/web-search"&&request.method==="POST"){
        const body=await request.json(), q=String(body.query||"").trim();
        if(!q)return json({error:"Search query is required."},400);
        const endpoints=[
          "https://html.duckduckgo.com/html/?q="+encodeURIComponent(q),
          "https://lite.duckduckgo.com/lite/?q="+encodeURIComponent(q)
        ];
        let html="", lastStatus=0;
        for(const endpoint of endpoints){
          try{const r=await fetch(endpoint,{headers:{"User-Agent":"Mozilla/5.0 (compatible; OmniChat/12.0)"}});lastStatus=r.status;if(r.ok){html=await r.text();break}}catch{}
        }
        if(!html)return json({error:"Search provider unavailable ("+(lastStatus||"network error")+")."},502);
        const results=[];
        // DuckDuckGo HTML result links. Accept both current result pages and lite pages.
        const patterns=[
          /<a[^>]+class=["']result__a["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
          /<a[^>]+class=["'][^"']*result-link[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
          /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]{5,180}?)<\/a>/gi
        ];
        const seen=new Set();
        for(const re of patterns){
          let m;
          while((m=re.exec(html))&&results.length<8){
            const title=strip(m[2]), href=decodeRedirect(m[1]);
            if(!title||!href||seen.has(href)||/^javascript:/i.test(href)||href.includes("duckduckgo.com/y.js"))continue;
            if(/DuckDuckGo|Privacy|Settings|Feedback/i.test(title)&&!href.includes("wikipedia.org"))continue;
            seen.add(href);
            const nearby=html.slice(Math.max(0,m.index-500),Math.min(html.length,m.index+5000));
            const sm=nearby.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)||nearby.match(/class=["'][^"']*snippet[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
            results.push({title,url:href,snippet:strip(sm?.[1]||"")});
          }
          if(results.length>=8)break;
        }
        return json({query:q,results});
      }
      return env.ASSETS.fetch(request);
    }catch(e){console.error(e);return json({error:e?.message||"Request failed."},500);}
  }
};
function strip(s){return String(s||"").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/\s+/g," ").trim();}
function decodeRedirect(u){try{const x=new URL(u,"https://html.duckduckgo.com");const v=x.searchParams.get("uddg");return v?decodeURIComponent(v):u.startsWith("/")?"https://html.duckduckgo.com"+u:u}catch{return u}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json"}})}
