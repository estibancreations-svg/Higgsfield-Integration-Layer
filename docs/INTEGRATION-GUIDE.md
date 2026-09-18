# Integration Guide

## VisionWeaver

- Use `generate-image` for illustration, concept art, product shots, and mood boards.
- Use `generate-video` for cinematic clips, shot sequences, and motion studies.
- Use `media-library` to attach reusable media to books, films, and campaign entities.

## MASTER_CEO_DASHBOARD

- Issue signed JWTs with route permissions such as `generate:image`, `generate:video`, `jobs:read`, `media:read`, and `credits:read`.
- Surface credit alerts and workflow-level budget checks through `credits-management`.
- Poll `manage-jobs` for dashboards, notifications, and executive reporting.

## Master-System-Buildout

- Ingest audit logger output as governance events.
- Apply the SQL schema to align accountability, provenance, and credit tracking with system-wide directives.
- Treat workflow YAML files as canonical automation definitions for orchestration layers.
