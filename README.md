# MediCore

MediCore is a caregiver-focused medication management web application built to support day-to-day care coordination. The app combines medication tracking, patient views, offline-capable local storage, and cloud synchronization through Supabase in a responsive React interface.

## Features

- Caregiver and patient role-based experiences
- Medication tracking and patient detail workflows
- Offline-first local persistence with Dexie
- Cloud sync with Supabase
- Multi-language support
- Responsive interface built with React and Vite

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- React Router
- Zustand
- Supabase
- Dexie

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Installation

```bash
npm install
```

### Environment Variables

Create a local environment file based on `.env.example` and provide the required values:

```bash
cp .env.example .env.local
```

Required variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `GEMINI_API_KEY`

## Development

Start the local development server:

```bash
npm run dev
```

## Production Build

Create a production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Project Structure

```text
src/
  components/
  lib/
  pages/
  store/
index.html
vite.config.ts
supabase_schema.sql
```

## Deployment

MediCore builds to static assets in `dist/` and can be deployed to modern static hosting platforms such as Cloudflare Pages, Vercel, Netlify, Amazon S3 + CloudFront, or GitHub Pages with SPA routing support.

## Notes

- Do not commit local environment files such as `.env.local`.
- Frontend environment variables are exposed at build time; secrets that must remain private should be moved behind a backend service.
