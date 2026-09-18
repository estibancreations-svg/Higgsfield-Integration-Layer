# API Reference

## Authentication

All routes require either:
- `x-api-key: <INTEGRATION_API_KEY>`
- A standard bearer token `Authorization` header carrying a CEO Dashboard JWT signed with `CEO_DASHBOARD_JWT_SECRET`

## Routes

### `POST /api/routes/generate-image`
Creates image-generation jobs for photorealistic, stylized, product, and batch illustration use cases.

**Body**
- `projectId: string`
- `workflowType: book-creation | film-production | social-campaigns | commerce-integration | ad-hoc`
- `prompt: string`
- `model: gpt-image-2 | nano-banana | flux`
- `mediaType: image`
- `triggeredBy: VisionWeaver | CEO Dashboard | Master-System-Buildout | n8n | internal-scheduler | unknown`
- `batchCount?: number`
- `options?: Record<string, unknown>`
- `tags?: string[]`

**Response** `202`
- `generationId`
- `jobId`
- `status`
- `creditsReserved`
- `media[]`
- `provenance`

### `POST /api/routes/generate-video`
Creates video jobs for Cinema Studio, Seedance, Kling, and multi-shot sequences.

**Additional body fields**
- `sourceImageUrl?: string`
- `shotPlan?: [{ id, prompt, transition?, motionEffect?, durationSeconds? }]`

### `GET /api/routes/manage-jobs?jobId=<id>`
Returns current job lifecycle metadata, progress, render estimates, and completed media.

### `GET /api/routes/media-library`
Query parameters:
- `projectId?`
- `mediaType?`
- `fromDate?` ISO timestamp
- `toDate?` ISO timestamp
- `search?`
- `limit?` (default 25, max 100)

### `GET /api/routes/credits-management`
Returns Higgsfield account balance and low-credit alert status.

### `POST /api/routes/credits-management`
Checks a workflow/project budget cap and records an auditable credit transaction.

**Body**
- `projectId: string`
- `model: gpt-image-2 | nano-banana | flux | seedance | kling | cinema-studio`
- `maxCredits: number`
- `workflowType?: book-creation | film-production | social-campaigns | commerce-integration | ad-hoc`
- `batchCount?: number`
- `shotCount?: number`

## Error Codes

- `400` invalid request body or query
- `401` missing/invalid credentials
- `403` authenticated but missing route permissions
- `405` unsupported method
- `429` rate limit or queue saturation
- `500` Higgsfield, Supabase, or internal orchestration failure
