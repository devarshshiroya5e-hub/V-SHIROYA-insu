# V-SHIROYA-insu

AI-powered insurance policy management and analysis portal.

## AI policy analyzer

The existing frontend contract is preserved. Uploaded PDF policies are sent to the Render backend, then analyzed through OpenRouter. The server accepts PDF data as base64 and sends it to OpenRouter's PDF/file processing pipeline.

Required Render environment variable:

```text
OPENROUTER_API_KEY=your_openrouter_key
```

Default model:

```text
OPENROUTER_MODEL=openrouter/free
```

The backend also uses a reliability layer for bulk uploads: requests are serialized, transient 429/5xx responses are retried, request timeouts are bounded, and same-millisecond legacy policy IDs are made unique.

## Render

The repository contains `render.yaml` for the `v-shiroya-api` Node web service. The service builds with `npm install && npm run build`, starts with `npm start`, and exposes `/api/health` for the Render health check.

## Frontend/API routing

Firebase Hosting routes `/api/**` to the Render service `v-shiroya-api`; all other frontend routes continue to use the existing SPA rewrite.
