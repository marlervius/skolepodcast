"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Headphones,
  LoaderCircle,
  Lock,
  Mic,
  Pause,
  Play,
  QrCode,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UploadCloud,
  WifiOff,
} from "lucide-react";
import { usePlayer } from "@/context/PlayerContext";
import { DEMO_COURSE_ID, demoCourse, demoEpisodes, demoTopics } from "@/lib/demo";
import { fetchWithTimeout, follow, readFollowed, writeCachedSummaries } from "@/lib/followed";
import { formatDuration, normalizeCode, type Course, type CourseSummary } from "@/lib/types";

const DEMO_EPISODES = demoEpisodes.map((episode) => ({
  ...episode,
  media_url: `${episode.media_url}?v=2`,
}));

const DEMO_COURSE: Course = {
  id: DEMO_COURSE_ID,
  teacher_id: "",
  teacher_name: "Demolærer Historie",
  ...demoCourse,
  episode_count: DEMO_EPISODES.length,
  topic_count: demoTopics.length,
  topics: demoTopics.map((topic) => ({
    ...topic,
    episodes: DEMO_EPISODES.filter((episode) => episode.topic_id === topic.id),
  })),
};

const FEATURED_EPISODE = DEMO_EPISODES[0];

const PILLARS = [
  {
    icon: QrCode,
    title: "Ingen elevkonto",
    text: "Elevene skanner QR-koden på tavla eller taster klassekoden. Null passord, null pålogging.",
  },
  {
    icon: ShieldCheck,
    title: "Personvern først",
    text: "Ingen sporing, ingen reklame og ingen elevdata på serveren. Alt lagres kun på elevens egen enhet.",
  },
  {
    icon: ClipboardCheck,
    title: "Faglig kvalitetssikret",
    text: "AI-manus kommer med faglig oversikt over fakta, teorier og teser som faglærer godkjenner før lyd lages.",
  },
  {
    icon: Smartphone,
    title: "Mobil, nett og iPhone-app",
    text: "Spiller på låseskjermen, husker hvor eleven slapp og fungerer også når dekningen er borte.",
  },
] as const;

const WORKFLOW_STEPS = [
  {
    number: "01",
    title: "Lag eller last opp podkast",
    text: "Lim inn pensumnotater i det innebygde AI-verktøyet med naturlige norske stemmer — eller send ferdige episoder rett fra NotebookLM.",
  },
  {
    number: "02",
    title: "Gjør en faglig vurdering",
    text: "Se straks hvilke fakta, teorier og teser episoden tar opp — og hva AI har lagt til utover kildeteksten. Rett opp med én beskjed før du lager lyd.",
  },
  {
    number: "03",
    title: "Vis én QR-kode på tavla",
    text: "Elevene skanner med mobilkameraet og får hele faget ryddig organisert i kapitler — klart for bussen, joggeturen eller eksamensrepetisjonen.",
  },
] as const;

const TEACHER_FEATURES = [
  {
    icon: Sparkles,
    title: "AI-podkast med to norske stemmer",
    text: "Velg samtale eller opplesning, lengde, episodetype (forklarende, eksamensrepetisjon, to perspektiver, quiz) og nivå for klassetrinnet.",
  },
  {
    icon: ClipboardCheck,
    title: "Faglig oversikt og kildekontroll",
    text: "Få oppsummering, fakta merket «Fra kilden» vs. «Lagt til av AI», teorier, teser og klikkbare referanser til hver replikk før publisering.",
  },
  {
    icon: UploadCloud,
    title: "Sømløs NotebookLM-integrasjon",
    text: "Koble fagrom til notatbøkene dine, dra-og-slipp lyd og video med automatisk WAV-komprimering, eller bruk Chrome-utvidelsen for ett-klikks publisering.",
  },
  {
    icon: BookOpen,
    title: "Ryddige fagrom og QR-plakat",
    text: "Organiser episoder i kapitler med egne fagfarger, nøkkelpunkter, refleksjonsspørsmål og utskriftsvennlig QR-kode til klasserommet.",
  },
] as const;

const STUDENT_FEATURES = [
  {
    icon: QrCode,
    title: "I gang på fem sekunder",
    text: "Ingen brukerprofil, ingen e-post, ingen glemt pålogging. Skann koden én gang, så ligger faget klart i Mine fag.",
  },
  {
    icon: Headphones,
    title: "Laget for lytting i farta",
    text: "Avspilling i bakgrunnen og på låseskjermen, justerbar hastighet, 15-sekunders hopp og søvntimer.",
  },
  {
    icon: Mic,
    title: "Nøkkelpunkter og refleksjon",
    text: "Hver episode kan åpnes med kjernebegreper og spørsmål til ettertanke rett under spilleren — ideelt før prøver.",
  },
  {
    icon: WifiOff,
    title: "Fungerer også uten dekning",
    text: "Fulgte fag og fremgang lagres lokalt på telefonen. Installer som app på Hjem-skjermen eller bruk iPhone-appen.",
  },
] as const;

export function LandingClient() {
  const router = useRouter();
  const { playEpisode, currentEpisode, isPlaying, lastPlayed } = usePlayer();
  const [followedCount, setFollowedCount] = useState(0);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setFollowedCount(readFollowed().length);
  }, []);

  const demoPlaying = Boolean(currentEpisode?.id === FEATURED_EPISODE.id && isPlaying);

  function toggleDemoSample() {
    playEpisode(FEATURED_EPISODE, DEMO_COURSE);
  }

  async function handleCodeSubmit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeCode(code);
    if (!normalized) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetchWithTimeout(`/api/courses?code=${encodeURIComponent(normalized)}`, {
        cache: "no-store",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Fant ikke fagrommet. Sjekk klassekoden.");
      const course = data.course as CourseSummary;
      follow(course.code);
      writeCachedSummaries([course]);
      router.push(`/fag/${encodeURIComponent(course.code)}`);
    } catch (failure) {
      setError(
        failure instanceof Error && failure.name !== "AbortError"
          ? failure.message
          : "Kunne ikke slå opp klassekoden akkurat nå. Prøv igjen.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="landing">
      {followedCount > 0 && (
        <div className="landing-wrap">
          <div className="landing-return-bar">
            <div className="landing-return-text">
              <span className="landing-return-dot" aria-hidden="true" />
              <span>
                <strong>Velkommen tilbake.</strong> Du følger {followedCount}{" "}
                {followedCount === 1 ? "fag" : "fag"} på denne enheten
                {lastPlayed ? ` · Sist spilt: ${lastPlayed.episode.title}` : ""}.
              </span>
            </div>
            <Link href="/mine-fag" className="landing-return-link">
              Åpne Mine fag <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      )}

      {/* ==================== HERO ==================== */}
      <section className="landing-hero">
        <div className="landing-wrap landing-hero-grid">
          <div className="landing-hero-copy">
            <p className="landing-pill">
              <Headphones size={14} aria-hidden="true" />
              Podkast- og videoplattform for skolen
            </p>
            <h1>
              Pensum på øret — laget og kvalitetssikret av <em>faglærer</em>.
            </h1>
            <p className="landing-lead">
              Lytterom gjør det enkelt for lærere å lage og publisere fagpodkaster og undervisningsvideoer — og lar
              elevene lytte rett på mobilen med én QR-kode, helt uten innlogging.
            </p>

            <div className="landing-cta-row">
              <Link href="/studio" className="button button--primary landing-cta-btn">
                Åpne Lærerstudio
                <ArrowRight size={17} />
              </Link>
              <Link href="/fag/HIST-VG3" className="button landing-cta-btn">
                Prøv eksempelfag
              </Link>
            </div>

            <form className="landing-code-box" onSubmit={handleCodeSubmit}>
              <label htmlFor="landing-class-code">
                Er du elev? Skriv inn klassekoden fra læreren din
              </label>
              <div className="landing-code-row">
                <input
                  id="landing-class-code"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.toUpperCase());
                    if (error) setError("");
                  }}
                  placeholder="F.eks. HIST-VG3"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={32}
                />
                <button
                  type="submit"
                  className="button button--accent"
                  disabled={submitting || !normalizeCode(code)}
                >
                  {submitting ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}
                  <span>Åpne fag</span>
                </button>
              </div>
              {error ? (
                <p className="form-error" role="alert">{error}</p>
              ) : (
                <p className="landing-code-hint">
                  <QrCode size={14} aria-hidden="true" />
                  Eller skann QR-koden på tavla med mobilkameraet.{" "}
                  <Link href="/mine-fag">Gå til Mine fag →</Link>
                </p>
              )}
            </form>
          </div>

          {/* Visuell, levende forhåndsvisning */}
          <div className="landing-hero-visual" aria-label="Forhåndsvisning av Lytterom">
            <div className="landing-player-card">
              <div className="landing-player-top">
                <span className="landing-player-tag">Historie VG3 · Eksempelepisode</span>
                <span className="landing-player-speed">1.0×</span>
              </div>

              <div className="landing-player-title">
                <strong>{FEATURED_EPISODE.title}</strong>
                <span>{FEATURED_EPISODE.description}</span>
              </div>

              <div className={`landing-wave${demoPlaying ? " landing-wave--playing" : ""}`} aria-hidden="true">
                {[34, 62, 48, 86, 56, 94, 42, 74, 88, 52, 66, 96, 58, 40, 78, 60, 46, 70, 50, 36].map((h, i) => (
                  <span key={i} style={{ height: `${h}%`, animationDelay: `${(i % 6) * 0.12}s` }} />
                ))}
              </div>

              <div className="landing-player-controls">
                <button
                  type="button"
                  className="landing-play-btn"
                  onClick={toggleDemoSample}
                  aria-label={demoPlaying ? "Pause eksempelepisode" : "Spill av eksempelepisode"}
                >
                  {demoPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                </button>
                <div className="landing-player-meta">
                  <strong>{demoPlaying ? "Spiller nå i Lytterom" : "Hør en ekte smakebit"}</strong>
                  <small>{formatDuration(FEATURED_EPISODE.duration_seconds)} · Ingen innlogging kreves</small>
                </div>
                <Link href="/fag/HIST-VG3" className="landing-player-open">
                  Se faget →
                </Link>
              </div>
            </div>

            <div className="landing-float-grid">
              <div className="landing-review-card">
                <div className="landing-review-head">
                  <ClipboardCheck size={15} aria-hidden="true" />
                  <strong>Faglig oversikt</strong>
                  <span className="landing-badge-ok">
                    <CheckCircle2 size={12} aria-hidden="true" /> Godkjent
                  </span>
                </div>
                <ul>
                  <li>
                    <span>Versaillestraktaten (1919) og krigserstatning</span>
                    <em className="landing-tag-source">Fra kilden</em>
                  </li>
                  <li>
                    <span>Børskrakket i 1929 svekket demokratiet</span>
                    <em className="landing-tag-ref">#4</em>
                  </li>
                </ul>
              </div>

              <div className="landing-qr-card">
                <div className="landing-qr-icon" aria-hidden="true">
                  <QrCode size={26} />
                </div>
                <div>
                  <small>Del med klassen</small>
                  <strong>HIST-VG3</strong>
                  <span>1 skann → i lomma</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== PILLARS ==================== */}
      <section className="landing-pillars" aria-label="Nøkkelegenskaper">
        <div className="landing-wrap">
          <div className="landing-pillar-grid">
            {PILLARS.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="landing-pillar">
                  <span className="landing-icon-badge" aria-hidden="true">
                    <Icon size={19} />
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ==================== 3-STEP WORKFLOW ==================== */}
      <section className="landing-section">
        <div className="landing-wrap">
          <div className="landing-section-head">
            <p className="eyebrow eyebrow--accent">Slik fungerer det</p>
            <h2>Fra pensumnotater til klassens ører på minutter.</h2>
            <p>
              Ingen tung plattform eller komplisert oppsett. Læreren har full faglig kontroll hele veien fra manus til publisering.
            </p>
          </div>

          <ol className="landing-steps">
            {WORKFLOW_STEPS.map((step) => (
              <li key={step.number} className="landing-step">
                <span className="landing-step-num" aria-hidden="true">{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ==================== FOR LÆRERE & FOR ELEVER ==================== */}
      <section className="landing-section landing-section--tinted">
        <div className="landing-wrap">
          <div className="landing-section-head">
            <p className="eyebrow eyebrow--accent">To roller, én enkel opplevelse</p>
            <h2>Bygget for begge sider av klasserommet.</h2>
          </div>

          <div className="landing-roles">
            <article className="landing-role-card landing-role-card--teacher">
              <div className="landing-role-head">
                <span className="landing-role-tag">For lærere · Lærerstudio</span>
                <h3>Lag, kvalitetssikre og publiser på ett sted</h3>
                <p>
                  Enten du vil generere en engasjerende samtale fra egne notater eller publisere podkaster du har laget i NotebookLM.
                </p>
              </div>
              <ul className="landing-feature-list">
                {TEACHER_FEATURES.map((feat) => {
                  const Icon = feat.icon;
                  return (
                    <li key={feat.title}>
                      <span className="landing-feature-icon" aria-hidden="true"><Icon size={17} /></span>
                      <div>
                        <strong>{feat.title}</strong>
                        <p>{feat.text}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="landing-role-foot">
                <Link href="/studio" className="button button--primary">
                  Gå til Lærerstudio <ArrowRight size={16} />
                </Link>
              </div>
            </article>

            <article className="landing-role-card landing-role-card--student">
              <div className="landing-role-head">
                <span className="landing-role-tag landing-role-tag--green">For elever · Mine fag</span>
                <h3>Pensum som passer inn i hverdagen</h3>
                <p>
                  Perfekt for repetisjon på vei til skolen, for elever som lærer best ved å lytte, og som støtte før prøver og eksamen.
                </p>
              </div>
              <ul className="landing-feature-list">
                {STUDENT_FEATURES.map((feat) => {
                  const Icon = feat.icon;
                  return (
                    <li key={feat.title}>
                      <span className="landing-feature-icon landing-feature-icon--green" aria-hidden="true">
                        <Icon size={17} />
                      </span>
                      <div>
                        <strong>{feat.title}</strong>
                        <p>{feat.text}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="landing-role-foot">
                <Link href="/mine-fag" className="button">
                  Åpne Mine fag <ArrowRight size={16} />
                </Link>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* ==================== PERSONVERN-GARANTI ==================== */}
      <section className="landing-section">
        <div className="landing-wrap">
          <div className="landing-privacy-card">
            <div className="landing-privacy-copy">
              <p className="landing-privacy-eyebrow">
                <Lock size={14} aria-hidden="true" />
                Bygget for norsk skole og GDPR
              </p>
              <h2>Trygt personvern uten unødvendige elevdata.</h2>
              <p>
                Elever oppretter aldri konto i Lytterom. Fulgte klassekoder, avspillingsposisjon og hastighet blir
                værende lokalt på elevens egen mobil eller nettleser. Ingen reklame, ingen analyseverktøy og
                YouTube-videoer bygges alltid inn via <code>youtube-nocookie.com</code>.
              </p>
            </div>
            <div className="landing-privacy-points">
              <ul>
                <li><CheckCircle2 size={16} aria-hidden="true" /> Null elevkontoer og null persondata om elever</li>
                <li><CheckCircle2 size={16} aria-hidden="true" /> Ingen tredjeparts sporing eller reklame</li>
                <li><CheckCircle2 size={16} aria-hidden="true" /> Kun lærer har konto — enkel sletting når som helst</li>
              </ul>
              <Link href="/personvern" className="landing-privacy-link">
                Les hele personvernerklæringen <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== AVSLUTTENDE CTA ==================== */}
      <section className="landing-final">
        <div className="landing-wrap">
          <div className="landing-final-box">
            <p className="eyebrow eyebrow--accent">Kom i gang</p>
            <h2>Klar til å gi klassen pensum på øret?</h2>
            <p>
              Test eksempelfaget Historie VG3 som elev, eller logg inn i Lærerstudio og lag din første episode på få minutter.
            </p>
            <div className="landing-cta-row landing-cta-row--center">
              <Link href="/studio" className="button button--primary landing-cta-btn">
                Åpne Lærerstudio <ArrowRight size={17} />
              </Link>
              <Link href="/fag/HIST-VG3" className="button landing-cta-btn">
                Lytt til eksempelfaget HIST-VG3
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== FOOTER ==================== */}
      <footer className="landing-footer">
        <div className="landing-wrap landing-footer-inner">
          <div>
            <strong className="landing-footer-brand">Lytterom</strong>
            <p>Podkaster og undervisningsvideoer fra læreren din — rett på mobilen, uten innlogging.</p>
          </div>
          <nav className="landing-footer-links" aria-label="Bunnmeny">
            <Link href="/mine-fag">Mine fag</Link>
            <Link href="/studio">Lærerstudio</Link>
            <Link href="/fag/HIST-VG3">Eksempelfag</Link>
            <Link href="/personvern">Personvern</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
