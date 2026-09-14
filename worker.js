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

      if(url.pathname==="/api/deep-research"&&request.method==="POST"){
        const body=await request.json(), q=String(body.query||"").trim();
        if(!q)return json({error:"Research question is required."},400);
        const plan=await env.AI.run(CHAT_MODEL,{messages:[
          {role:"system",content:"You are a research planner. Return ONLY a JSON array of 6 concise, complementary web-search queries for the user's research question. Cover definitions/background, competing views, evidence/data, history, counterarguments, and recent developments where relevant. No markdown."},
          {role:"user",content:q}
        ],temperature:0.2,max_tokens:600});
        let queries=[];
        try{queries=JSON.parse(plan?.response||plan?.choices?.[0]?.message?.content||"[]")}catch{}
        if(!Array.isArray(queries)||!queries.length)queries=[q,q+" evidence data",q+" history",q+" criticism counterarguments",q+" recent developments",q+" academic research"];
        queries=[...new Set([q,...queries.map(String).map(x=>x.trim()).filter(Boolean)])].slice(0,10);
        const batches=await Promise.all(queries.map(searchDDG));
        const all=[];const seen=new Set();
        for(const b of batches)for(const r of b){const key=normalizeUrl(r.url);if(!key||seen.has(key))continue;seen.add(key);all.push({...r,query:r.query});}
        const discovered=all.slice(0,100);
        const pages=await Promise.all(discovered.slice(0,30).map(async r=>{try{return {...r,text:await fetchPageText(r.url)}}catch{return {...r,text:""}}}));
        const usable=pages.filter(x=>x.text).slice(0,20);
        const sourceBlock=usable.map((r,i)=>`SOURCE ${i+1}\nTITLE: ${r.title}\nURL: ${r.url}\nTEXT:\n${r.text.slice(0,6500)}`).join("\n\n---\n\n");
        const synthesis=await env.AI.run(CHAT_MODEL,{messages:[
          {role:"system",content:`You are OmniChat Deep Research. Produce a rigorous research report answering the user's question. Use only the supplied sources for factual claims. Cite claims inline as [1], [2], etc., matching SOURCE numbers. Compare conflicting evidence instead of pretending sources agree. Clearly distinguish established evidence, reasonable inference, and uncertainty. Include: Executive summary, key findings, evidence and arguments, counterarguments/limitations, and conclusion. Do not invent citations or sources. Do not reveal chain-of-thought.`},
          {role:"user",content:`QUESTION:\n${q}\n\nSOURCES:\n${sourceBlock}`}
        ],temperature:0.25,max_tokens:7000});
        const answer=synthesis?.response||synthesis?.choices?.[0]?.message?.content||"";
        if(!answer)return json({error:"Research synthesis failed."},502);
        return json({query:q,answer,sourceCount:discovered.length,readCount:usable.length,sources:usable.map((r,i)=>({id:i+1,title:r.title,url:r.url,snippet:r.snippet}))});
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

async function searchDDG(q) {
  const endpoints = [
    "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q),
    "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(q)
  ];

  let html = "";
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; OmniChat/13.0)" }
      });
      if (response.ok) {
        html = await response.text();
        break;
      }
    } catch (_) {}
  }

  if (!html) return [];

  const results = [];
  const seen = new Set();
  const patterns = [
    /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    /<a[^>]+class=["'][^"']*result-link[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null && results.length < 10) {
      const title = strip(match[2]);
      const href = decodeRedirect(match[1]);
      if (!title || !href || seen.has(href)) continue;
      if (/^javascript:/i.test(href)) continue;
      if (href.includes("duckduckgo.com/y.js")) continue;
      if (/DuckDuckGo|Privacy|Settings|Feedback/i.test(title) && !href.includes("wikipedia.org")) continue;

      seen.add(href);
      const nearby = html.slice(
        Math.max(0, match.index - 500),
        Math.min(html.length, match.index + 5000)
      );
      const snippetMatch =
        nearby.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/[a-z0-9]+>/i) ||
        nearby.match(/class=["'][^"']*snippet[^"']*["'][^>]*>([\s\S]*?)<\/[a-z0-9]+>/i);

      results.push({
        query: q,
        title,
        url: href,
        snippet: strip(snippetMatch ? snippetMatch[1] : "")
      });
    }
    if (results.length >= 10) break;
  }

  return results;
}
function normalizeUrl(u){try{const x=new URL(u);x.hash="";return x.toString().replace(/\/$/,"")}catch{return ""}}
async function fetchPageText(u){const r=await fetch(u,{headers:{"User-Agent":"Mozilla/5.0 (compatible; OmniChat-DeepResearch/13.0)"}});if(!r.ok)return "";const t=await r.text();if(!/^<html|<!doctype/i.test(t))return strip(t).slice(0,12000);return strip(t.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<nav[\s\S]*?<\/nav>/gi," ").replace(/<footer[\s\S]*?<\/footer>/gi," ")).slice(0,12000)}
function strip(s){return String(s||"").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/\s+/g," ").trim();}
function decodeRedirect(u){try{const x=new URL(u,"https://html.duckduckgo.com");const v=x.searchParams.get("uddg");return v?decodeURIComponent(v):u.startsWith("/")?"https://html.duckduckgo.com"+u:u}catch{return u}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json"}})}
                                                            
