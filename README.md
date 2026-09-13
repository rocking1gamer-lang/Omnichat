# OmniChat — Grok-style open-model app

This project is a direct, conversational AI app inspired by the *style* of Grok, but it does not impersonate or access xAI/Grok.

## Stack

- Cloudflare Workers
- Cloudflare Workers AI
- `@cf/zai-org/glm-4.7-flash`
- Static assets served by the same Worker
- Local chat history in the browser
- No provider API key is stored in the frontend

## Deploy

1. Create a Cloudflare account and open Workers & Pages.
2. Use Wrangler 4.20+.
3. Put these files in a project:
   - `worker.js`
   - `wrangler.jsonc`
   - `public/index.html`
   - `public/manifest.json`
4. Run:

```bash
npx wrangler login
npx wrangler deploy
```

The Worker must have the Workers AI binding configured by `wrangler.jsonc`.

## Free usage

Cloudflare Workers AI currently includes a daily free allocation of 10,000 Neurons. This is not unlimited free inference. Cloudflare also currently lists GLM-4.7-Flash among the models available on the Workers Free plan.

## Notes

The browser never receives a Cloudflare API token. The AI request is made by the Worker through its `AI` binding.

The app uses a system prompt to create a direct, witty conversational mode. It does not turn GLM into Grok and does not claim that it does.
