# MediCore

MediCore is a caregiver-focused medication management application designed to support patient tracking, medication scheduling, and adherence logging across caregiver and patient workflows. The project is built as a modern single-page application with offline-first local storage and optional cloud synchronization through Supabase.

## Overview

The application is designed for two primary user experiences:

- `Caregiver portal`: manage patients, maintain medication records, and review adherence activity
- `Patient portal`: view assigned medications and record dose activity

The frontend is built with React, TypeScript, and Vite. Local data is persisted with Dexie to support offline usage, while Supabase is used for cloud-backed synchronization when environment credentials are configured.

## Core Capabilities

- Role-based caregiver and patient flows
- Patient profile and medication management
- Medication event logging for taken, missed, and skipped doses
- Offline-first persistence using IndexedDB through Dexie
- Optional Supabase synchronization for cross-device access
- Multilingual interface support
- Responsive browser-based experience

## Architecture

### Frontend

- React 19
- TypeScript
- Vite
- React Router
- Zustand
- Tailwind CSS

### Data Layer

- Dexie for local IndexedDB storage
- Supabase for remote persistence and synchronization

### Storage Model

The local database stores three primary record types:

- `patients`
- `medications`
- `medication_logs`

Synchronization logic normalizes local identifiers, pushes scoped local data to Supabase, and pulls caregiver or patient data back into the local store as needed.

## Project Structure

```text
src/
  components/   Reusable UI components
  lib/          Data access, sync logic, helpers
  pages/        Route-level screens
  store/        Global client state
index.html      SPA entry document
vite.config.ts  Vite configuration
supabase_schema.sql
```

## Prerequisites

- Node.js 20 or later
- npm

## Local Development

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env.local
```

Start the development server:

```bash
npm run dev
```

The default local dev server runs on port `3000`.

## Environment Configuration

The application uses build-time environment variables. Configure the following values in `.env.local` for development or in your deployment platform for production builds.

Required for cloud sync:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Optional application integration:

- `GEMINI_API_KEY`

If Supabase variables are not configured, cloud synchronization features will be unavailable and the app will operate in local-only mode where possible.

## Available Scripts

- `npm run dev`: start the local Vite development server
- `npm run build`: create a production build in `dist/`
- `npm run preview`: preview the production build locally
- `npm run lint`: run TypeScript type-checking without emitting files
- `npm run clean`: remove the `dist/` directory

## Build and Deployment

Generate a production build:

```bash
npm run build
```

The compiled application is emitted to `dist/` and can be deployed to static hosting platforms such as:

- Cloudflare Pages
- Vercel
- Netlify
- Amazon S3 with CloudFront

Because the application uses client-side routing, production hosting should be configured with SPA fallback behavior so unknown routes resolve to `index.html`.

## Data and Sync Notes

- Local persistence is powered by IndexedDB, which enables offline access in supported browsers.
- Supabase sync is conditional and only enabled when the required environment variables are present.
- Sync behavior is scoped to caregiver or patient context to avoid pushing unrelated local data from shared devices.
- Local identifiers are normalized before sync to ensure compatibility with UUID-based cloud records.

## Security Considerations

- Do not commit `.env.local` or other local secret files.
- Frontend build-time variables are exposed to the client bundle and should not be treated as private server secrets.
- Sensitive operations that require truly private credentials should be moved behind a backend service.

## Database

The repository includes [supabase_schema.sql](/Users/ashishkafle/Desktop/medmanage_-caregiver-portal/supabase_schema.sql:1) for provisioning the expected Supabase schema.

That setup now also provisions the public Supabase Storage bucket used for caregiver, patient, and medication photos:

- Bucket: `medicore-photos`

If image upload shows `bucket not found`, rerun `supabase_schema.sql` in the Supabase SQL editor for the target project so the storage bucket and policies are created.

## Status

MediCore is currently structured as a frontend-first application suitable for prototype, pilot, or staged production hardening workflows. Before production use in a regulated environment, review authentication, authorization, secret handling, auditability, and compliance requirements in the context of your deployment target.
