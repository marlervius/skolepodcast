import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Personvern",
  description: "Hvordan Lytterom og Lytterom-appen behandler opplysninger om elever og lærere.",
};

/** E-postadressen folk kan skrive til om personvern. Når den er tom, vises ingen adresse. */
const CONTACT_EMAIL = "marius.lervik@gmail.com";
const UPDATED = "25. november 2026";

export default function PrivacyPage() {
  return (
    <div className="page">
      <Link className="back-link" href="/mine-fag">← Til Mine fag</Link>
      <article className="prose">
        <h1>Personvern</h1>
        <p className="prose-lead">
          Lytterom lar elever lytte til podkaster og se undervisningsvideoer fra læreren sin. Elever trenger ingen konto,
          og vi samler ikke inn noe om dem. Her står det hva som lagres, hvor det lagres og hvordan du får det slettet.
        </p>
        <p className="prose-meta">Gjelder nettsiden {"skolepodcast.vercel.app"} og Lytterom-appen for iPhone. Sist oppdatert {UPDATED}.</p>

        <h2>Kort fortalt</h2>
        <ul>
          <li>Elever har ingen konto. Vi vet ikke hvem som lytter.</li>
          <li>Fagene du følger og hvor langt du har kommet, lagres bare på din egen telefon eller nettleser.</li>
          <li>Vi har ingen reklame, sporing eller analyseverktøy, og vi selger aldri opplysninger.</li>
          <li>Lærere som lager innhold, har en konto med navn, e-post og passord.</li>
        </ul>

        <h2>Elever</h2>
        <p>
          Når du legger til et fag med klassekoden, lagres koden på enheten din. Det samme gjør hvilke episoder du har
          hørt, hvor langt du har kommet i hver episode og hvilken avspillingshastighet du liker. Disse opplysningene sendes
          ikke til oss.
        </p>
        <p>
          For å vise innholdet spør appen og nettsiden serveren vår om fagene som hører til klassekodene dine. Forespørselen
          inneholder bare klassekodene, ikke noe som sier hvem du er.
        </p>
        <p>
          <strong>Kamera:</strong> Appen ber om tilgang til kameraet bare for å skanne QR-koden læreren viser. Bildet
          behandles på telefonen, blir ikke lagret og sendes ikke noe sted.
        </p>
        <p>
          <strong>Slik sletter du:</strong> Fjern et fag fra Mine fag, så forsvinner det og fremgangen din. Sletter du appen
          eller tømmer nettleserdataene, forsvinner alt.
        </p>

        <h2>Lærere</h2>
        <p>Når en lærer lager en konto i lærerstudioet, lagrer vi:</p>
        <ul>
          <li>navn og e-postadresse, slik at læreren kan logge inn og navnet kan vises på fagrommet</li>
          <li>passordet i kryptert form (en hash), slik at ingen kan lese det, heller ikke vi</li>
          <li>fagrom, kapitler, episoder, lyd- og videofiler og tekst som læreren selv legger inn</li>
        </ul>
        <p>
          Innloggingen bruker én nødvendig informasjonskapsel (cookie) som varer i 30 dager. Den brukes bare til å holde
          læreren innlogget.
        </p>
        <p>
          Opplysningene lagres så lenge kontoen finnes. Lærere kan slette fagrom og episoder selv i lærerstudioet. Vil du
          slette hele kontoen, kan du ta kontakt, så sletter vi den med alt innhold.
        </p>

        <h2>Hvem som behandler opplysningene</h2>
        <p>Lytterom bruker to leverandører som behandler opplysninger på våre vegne:</p>
        <ul>
          <li><strong>Vercel</strong> driver nettsiden og serveren.</li>
          <li><strong>Supabase</strong> lagrer lærerkontoer, fagrom og opplastede filer.</li>
        </ul>
        <p>
          Som alle nettsteder ser serveren IP-adressen til den som besøker den. Vi bruker den bare til å stoppe gjentatte
          gale innloggingsforsøk og lagrer den ikke selv. Driftsleverandøren kan ha tekniske logger i en kort periode.
        </p>
        <p>
          Hvis læreren har lagt inn en video fra YouTube eller Vimeo, hentes videoen derfra når du trykker på den. YouTube-videoer
          vises i personvernforbedret modus (youtube-nocookie.com). Da gjelder også personvernreglene til YouTube eller Vimeo.
        </p>

        <h2>Dine rettigheter</h2>
        <p>
          Etter personvernreglene (GDPR) har du rett til å få vite hvilke opplysninger vi har om deg, få dem rettet og få
          dem slettet. Siden elever ikke har konto, har vi ingen opplysninger om elever å vise frem. Mener du at vi behandler
          opplysninger feil, kan du klage til{" "}
          <a href="https://www.datatilsynet.no" target="_blank" rel="noreferrer">Datatilsynet</a>.
        </p>

        <h2>Kontakt</h2>
        {CONTACT_EMAIL ? (
          <p>Spørsmål om personvern kan sendes til <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
        ) : (
          <p>Spørsmål om personvern kan du stille til læreren din eller skolen.</p>
        )}
      </article>
    </div>
  );
}
