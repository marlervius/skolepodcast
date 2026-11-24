# Lytterom

«Spotify for pensum»: lærere publiserer podkaster og undervisningsvideoer (for eksempel fra NotebookLM), og elevene lytter på mobilen uten å logge inn.

- **Elever** (`/`, `/fag/[kode]`): legger til fag med klassekode eller QR-kode, lytter i en spiller som fortsetter mens de navigerer, og styrer avspillingen fra låseskjermen.
- **Lærere** (`/studio`): oppretter konto, lager fagrom og kapitler, laster opp lyd og video med dra-og-slipp, og viser QR-kode på tavla.

## Kom i gang lokalt

Appen bruker **Supabase** til database og filer, også lokalt. Krever Node.js 22 eller nyere.

1. Opprett et gratis prosjekt på [supabase.com](https://supabase.com). Åpne **SQL Editor**, lim inn hele `supabase/schema.sql` og trykk **Run**.
2. Kopier `.env.example` til `.env.local` og fyll inn `SUPABASE_URL` og `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API), og en `LYTTEROM_SECRET` på minst 32 tegn.
3. Start appen:

```bash
npm install
npm run dev
```

Åpne <http://localhost:3000>. Eksempelfaget med klassekoden `HIST-VG3` legges inn automatisk første gang. Det finnes ingen demokonto: lag din egen lærerkonto i `/studio`. Under utvikling trengs ingen invitasjonskode.

### Nyttige kommandoer

| Kommando | Hva den gjør |
| --- | --- |
| `npm run dev` | Utviklingsserver med hot reload |
| `npm run build` og `npm start` | Produksjonsbygg |
| `npm run typecheck` | TypeScript-sjekk |

### Miljøvariabler

| Variabel | Påkrevd | Forklaring |
| --- | --- | --- |
| `SUPABASE_URL` | ja | Adressen til Supabase-prosjektet |
| `SUPABASE_SERVICE_ROLE_KEY` | ja | Hemmelig nøkkel. Brukes bare på serveren og må aldri deles |
| `LYTTEROM_SECRET` | i produksjon | Minst 32 tegn. Signerer lærerens innloggingscookie |
| `LYTTEROM_INVITE_CODE` | i produksjon | Kode nye lærere må oppgi. Uten den er registreringen stengt i produksjon |
| `LYTTEROM_MAX_UPLOAD_MB` | nei | Største filstørrelse, standard 50 (grensen på Supabase sin gratisplan) |

## Slik er appen bygget

- **Next.js 16 (App Router), React 19 og TypeScript.** Stilene er skrevet i vanlig CSS (`src/app/globals.css`, `src/app/studio/studio.css`, `src/components/player/Player.module.css`).
- **Database:** `src/lib/db.ts` bruker Supabase (PostgreSQL) med service role-nøkkelen, bare fra serveren. Skjemaet ligger i `supabase/schema.sql`. Tabellene har Row Level Security uten regler, så den offentlige anon-nøkkelen gir ingen tilgang.
- **Innlogging:** `src/lib/auth.ts` og `src/lib/password.ts`. Passord hashes med scrypt og unikt salt. Sesjonen lagres i en HMAC-SHA256-signert `HttpOnly`-cookie.
- **Filer:** `/api/uploads` sjekker filtype og størrelse og gir en tidsbegrenset opplastingslenke. Nettleseren laster opp direkte til bucketen `episode-media` i Supabase Storage, fordi Vercel bare tar imot omtrent 4,5 MB per forespørsel. Elevene strømmer fra bucketens offentlige adresse, som støtter spoling.
- **Spiller:** `src/context/PlayerContext.tsx` har minispiller, fullskjermspiller, Media Session API, hastighet, søvntimer og fremgang i `localStorage`.
- **PWA:** `public/manifest.json` og `public/sw.js`. Service workeren registreres bare i produksjon og slipper Range-forespørsler og API-kall rett gjennom.

### Personvern

Elevene har ingen konto. Fulgte klassekoder (`lytterom_followed_codes_v1`), fremgang (`lytterom_progress_v1`), sist spilte episode, hastighet og tema lagres bare i elevens egen nettleser. Serveren lagrer bare lærerkontoer og innholdet lærerne publiserer. YouTube-videoer bygges inn via `youtube-nocookie.com`.

## Publisering (Vercel)

1. Importer GitHub-repoet på [vercel.com/new](https://vercel.com/new). Vercel finner Next.js selv.
2. Legg inn de fire påkrevde miljøvariablene under **Settings → Environment Variables**, og deploy på nytt.
3. `vercel.json` setter opp en daglig cron-jobb mot `/api/health`. Den holder Supabase-prosjektet aktivt, fordi gratisprosjekter settes på pause etter en uke uten aktivitet.

Vercel gir HTTPS automatisk, så elevene kan installere appen fra Safari med «Legg til på Hjem-skjerm».
