<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/c0d5db27-37af-4e2b-8cda-8422ac741663

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Supabase API keys

Configure these names in `.env.local` for local development and in the deployment environment before building:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
```

The publishable key is used by browser and user-session clients. `SUPABASE_SECRET_KEY` is server-only and must never be added to a `NEXT_PUBLIC_*` variable. Keep legacy keys active until every application sharing the Supabase project, including WebBooking, has migrated and passed production checks.
