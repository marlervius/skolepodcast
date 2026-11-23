# Lytterom

«Spotify for pensum»: lærere publiserer podkaster og undervisningsvideoer (for eksempel fra NotebookLM), og elevene lytter på mobilen uten å logge inn.

- **Elever** (`/`, `/fag/[kode]`): legger til fag med klassekode eller QR-kode, lytter i en spiller som fortsetter mens de navigerer, og styrer avspillingen fra låseskjermen.
- **Lærere** (`/studio`): oppretter konto, lager fagrom og kapitler, laster opp lyd og video med dra-og-slipp, og viser QR-kode på tavla.

## Kom i gang lokalt

Krever **Node.js 22.13 eller nyere**, fordi databasen bruker Node sin innebygde `node:sqlite`.

```bash
npm install
npm run dev
```

Åpne <http://localhost:3000>. Databasen (`data/lytterom.db`) opprettes og fylles med eksempeldata første gang en side eller et API-kall bruker den.

**Demokonto i studio:** `demo@lytterom.no` / `historie123`. Eksempelfaget har klassekoden `HIST-VG3`.

### Nyttige kommandoer

| Kommando | Hva den gjør |
| --- | --- |
| `npm run dev` | Utviklingsserver med hot reload |
| `npm run build` og `npm start` | Produksjonsbygg |
| `npm run typecheck` | TypeScript-sjekk |

### Miljøvariabler (valgfrie)

| Variabel | Standard | Forklaring |
| --- | --- | --- |
| `LYTTEROM_DATA_DIR` | `data` | Mappe for database, opplastinger og sesjonsnøkkel |
| `LYTTEROM_SECRET` | genereres i `data/session-secret` | Minst 32 tegn. Brukes til å signere lærerens innloggingscookie |
| `LYTTEROM_MAX_UPLOAD_MB` | `500` | Største tillatte filstørrelse ved opplasting |

## Slik er appen bygget

- **Next.js 16 (App Router), React 19 og TypeScript.** Stilene er skrevet i vanlig CSS (`src/app/globals.css`, `src/app/studio/studio.css`, `src/components/player/Player.module.css`).
- **Database:** `src/lib/db.ts`, som bruker `node:sqlite`. Modulen hentes med `process.getBuiltinModule`, så bundleren aldri prøver å pakke den.
- **Innlogging:** `src/lib/auth.ts` og `src/lib/password.ts`. Passord hashes med scrypt og unikt salt. Sesjonen lagres i en HMAC-SHA256-signert `HttpOnly`-cookie.
- **Filer:** `src/lib/storage.ts` sjekker filtype og størrelse og lagrer i `data/uploads/`. Filene strømmes fra `/api/media/[filnavn]` med `206 Partial Content`, slik at spoling fungerer på mobil.
- **Spiller:** `src/context/PlayerContext.tsx` har minispiller, fullskjermspiller, Media Session API, hastighet, søvntimer og fremgang i `localStorage`.
- **PWA:** `public/manifest.json` og `public/sw.js`. Service workeren registreres bare i produksjon og slipper Range-forespørsler og API-kall rett gjennom.

### Personvern

Elevene har ingen konto. Fulgte klassekoder (`lytterom_followed_codes_v1`), fremgang (`lytterom_progress_v1`), sist spilte episode, hastighet og tema lagres bare i elevens egen nettleser. Serveren lagrer bare lærerkontoer og innholdet lærerne publiserer. YouTube-videoer bygges inn via `youtube-nocookie.com`.

## Publisering

Appen lagrer data på lokal disk og trenger derfor en server med vedvarende lagring, for eksempel en VPS, Railway, Fly.io eller Render med et «volume». Serveren må kjøre Node 22.13 eller nyere. Bruk HTTPS, ellers kan ikke appen installeres som PWA på mobil.

```bash
npm run build
LYTTEROM_SECRET="<lang tilfeldig streng>" LYTTEROM_DATA_DIR=/var/lytterom npm start
```

Vercel har ikke vedvarende disk. Der må lagringslaget byttes ut slik:

1. Opprett et Supabase-prosjekt og kjør `supabase/schema.sql`. Skjemaet lager også `episode-media`-bucketen.
2. Skriv om funksjonene i `src/lib/db.ts` til Supabase-klienten. Funksjonsnavnene og returtypene kan beholdes.
3. Bytt ut `saveUpload` og `deleteMedia` i `src/lib/storage.ts` med Supabase Storage, og la `media_url` peke til den offentlige adressen.
