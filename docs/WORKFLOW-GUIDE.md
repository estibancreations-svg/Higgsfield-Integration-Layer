# Workflow Guide

## Available Workflows

- `workflows/book-creation.yml`
- `workflows/film-production.yml`
- `workflows/social-campaigns.yml`
- `workflows/commerce-integration.yml`

## Triggering

These workflow definitions are scheduler-friendly and can be invoked from n8n, internal cron workers, or upstream systems that post into the route layer.

## Expected Outputs

- **Book creation**: illustration set, style board, compiled layout package.
- **Film production**: keyframes, shot clips, transition timeline, final render.
- **Social campaigns**: media variants, publishing queue, performance dashboard.
- **Commerce integration**: product photography, lifestyle videos, ad variants, affiliate revenue metrics.

## Monitoring

- Poll `GET /api/routes/manage-jobs` for lifecycle progress.
- Query `GET /api/routes/media-library` to review reusable outputs.
- Query `GET /api/routes/credits-management` before launching high-cost workflows.
- Use audit log output for accountability and governance review.
