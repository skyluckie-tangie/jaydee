# Jaydee Supabase Setup (for real cloud / production)

This enables:
- Cloud project save/load (full project JSON with tracks, MIDI clips, automation etc.)
- Auth (email + anonymous guest)
- Realtime collab (currently clip move sync)
- Audio asset uploads to private storage (real WAV files persist across sessions)

## 1. Create Supabase Project
- Go to https://supabase.com
- New project
- Note the **Project URL** and **anon public key**

## 2. Configure Auth
Dashboard → Authentication → Providers
- Turn ON **Anonymous sign-ins** (for "Guest" button)
- Email provider can be on (magic link or password)

## 3. Run Database + Storage SQL
Copy the entire block from `.env.example` (after the keys) and paste into SQL Editor → Run.

It creates:
- `projects` table + RLS policy
- `audio_assets` bucket + RLS policies (upload + download own files only)

## 4. Local Development
```bash
cp .env.example .env
# edit .env with your real VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

When the two VITE_ keys are present:
- isCloudEnabled = true
- You can sign in (email or guest)
- Save/Load will prefer cloud
- File uploads in Asset Pool go to Supabase Storage

## 5. Production Deploy
Any static host (Vercel, Netlify, Cloudflare Pages...):

1. `npm run build`
2. Set environment variables in the hosting dashboard:
   - VITE_SUPABASE_URL
   - VITE_SUPABASE_ANON_KEY
3. Deploy the `dist/` folder.

The app will automatically use cloud mode in production.

## 6. Notes
- `demo:xxx` clips (Kick, Snare, Hats, Crash...) are synthetic and always work locally without storage.
- Real uploaded audio files become `storage:xxx` and are fetched from Supabase Storage on playback.
- Realtime currently syncs clip position moves. More events (new clips, MIDI notes) can be added later.
- For full multi-user realtime editing of notes/faders you would extend the broadcast events + RLS if needed.

## Troubleshooting
- "Supabase not configured" → check .env / hosting env vars
- Upload fails → check Storage bucket exists + policies (the SQL above)
- Sign in fails → enable Anonymous in Auth settings
- Cloud load returns nothing → make sure you are signed in with the same user that saved it

Enjoy the cloud DAW! ☁️🎹
