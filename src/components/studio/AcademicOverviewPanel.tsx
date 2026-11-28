"use client";

import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Copy,
  Lightbulb,
  LoaderCircle,
  RefreshCw,
  Scale,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  formatAcademicOverviewText,
  type PodcastAcademicOverview,
} from "@/lib/podcast";

type AcademicOverviewPanelProps = {
  title: string;
  overview: PodcastAcademicOverview | null;
  stale: boolean;
  approved: boolean;
  busy: boolean;
  busyLabel?: string;
  geminiConfigured: boolean;
  canAnalyze: boolean;
  compact?: boolean;
  onJumpToTurn?: (turnNumber: number) => void;
  onRefreshOverview?: () => void;
  onApplyCorrection?: (correction: string) => Promise<boolean>;
};

function TurnRefChips({
  turnNumbers,
  onJump,
}: {
  turnNumbers: number[];
  onJump?: (turnNumber: number) => void;
}) {
  if (!turnNumbers.length) return null;
  return (
    <span className="studio-pod-refs" aria-label="Replikkreferanser">
      {turnNumbers.map((num) =>
        onJump ? (
          <button
            key={num}
            type="button"
            className="studio-pod-ref"
            title={`Hopp til replikk #${num}`}
            onClick={() => onJump(num)}
          >
            #{num}
          </button>
        ) : (
          <span key={num} className="studio-pod-ref studio-pod-ref--static">
            #{num}
          </span>
        ),
      )}
    </span>
  );
}

export function AcademicOverviewPanel({
  title,
  overview,
  stale,
  approved,
  busy,
  busyLabel,
  geminiConfigured,
  canAnalyze,
  compact = false,
  onJumpToTurn,
  onRefreshOverview,
  onApplyCorrection,
}: AcademicOverviewPanelProps) {
  const [expanded, setExpanded] = useState(!compact);
  const [copied, setCopied] = useState(false);
  const [correctionText, setCorrectionText] = useState("");
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  if (!overview) {
    if (compact) return null;
    return (
      <section className="studio-pod-review studio-pod-review--empty" aria-label="Faglig oversikt">
        <div className="studio-pod-review-head">
          <div className="studio-pod-review-title-wrap">
            <ClipboardCheck size={17} />
            <div>
              <strong>Faglig oversikt for lærer</strong>
              <small>Få en strukturert oversikt over fakta, teorier og teser i manuset før publisering.</small>
            </div>
          </div>
          {geminiConfigured && onRefreshOverview && (
            <button
              type="button"
              className="studio-button"
              disabled={busy || !canAnalyze}
              onClick={onRefreshOverview}
            >
              {busy ? <LoaderCircle size={14} className="studio-spinner" /> : <Sparkles size={14} />}
              Analyser manus faglig
            </button>
          )}
        </div>
      </section>
    );
  }

  const addedFactCount = overview.facts.filter((item) => item.origin === "added").length;

  async function copyOverview() {
    if (!overview) return;
    try {
      await navigator.clipboard.writeText(formatAcademicOverviewText(title, overview));
      setCopied(true);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Utklippstavle ikke tilgjengelig. */
    }
  }

  async function submitCorrection() {
    const trimmed = correctionText.trim();
    if (!trimmed || !onApplyCorrection || busy) return;
    const ok = await onApplyCorrection(trimmed);
    if (ok) setCorrectionText("");
  }

  return (
    <section className="studio-pod-review" aria-label="Faglig oversikt for lærer">
      <div className="studio-pod-review-head">
        <div className="studio-pod-review-title-wrap">
          <ClipboardCheck size={18} />
          <div>
            <div className="studio-pod-review-title-row">
              <strong>Faglig oversikt for lærer</strong>
              {stale ? (
                <span className="studio-pod-status studio-pod-status--warn">Manuset er endret</span>
              ) : approved ? (
                <span className="studio-pod-status studio-pod-status--ok">Faglig vurdert</span>
              ) : (
                <span className="studio-pod-status">Til vurdering</span>
              )}
              {addedFactCount > 0 && (
                <span
                  className="studio-pod-status studio-pod-status--ai"
                  title="Opplysninger som er hentet utover kildeteksten og bør dobbeltsjekkes"
                >
                  {addedFactCount} lagt til av AI
                </span>
              )}
            </div>
            <small>
              {overview.facts.length} fakta · {overview.theories.length} teorier/begreper · {overview.theses.length} teser
              {" · "}Kun synlig for lærer
            </small>
          </div>
        </div>

        <div className="studio-pod-review-head-actions">
          <button
            type="button"
            className="studio-nb-link-btn"
            disabled={busy}
            onClick={() => void copyOverview()}
            title="Kopier faglig oversikt til utklippstavlen"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Kopiert" : "Kopier"}
          </button>
          <button
            type="button"
            className="studio-nb-link-btn"
            aria-expanded={expanded}
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            {expanded ? "Skjul" : "Vis"}
          </button>
        </div>
      </div>

      {stale && !compact && onRefreshOverview && (
        <div className="studio-pod-review-stale" role="status">
          <span>Du har endret manuset manuelt. Oppdater oversikten for å kontrollere endringene.</span>
          {geminiConfigured && (
            <button
              type="button"
              className="studio-pod-chip"
              disabled={busy || !canAnalyze}
              onClick={onRefreshOverview}
            >
              {busy ? <LoaderCircle size={13} className="studio-spinner" /> : <RefreshCw size={13} />}
              Oppdater oversikt
            </button>
          )}
        </div>
      )}

      {expanded && (
        <div className="studio-pod-review-body">
          {overview.summary && (
            <div className="studio-pod-review-block">
              <h4>Hva episoden handler om</h4>
              <p className="studio-pod-review-summary">{overview.summary}</p>
            </div>
          )}

          {overview.facts.length > 0 && (
            <div className="studio-pod-review-block">
              <h4>
                <BookOpen size={14} aria-hidden="true" />
                Fakta og saksopplysninger
              </h4>
              <ul className="studio-pod-review-list">
                {overview.facts.map((fact, idx) => (
                  <li key={`${idx}-${fact.claim.slice(0, 24)}`}>
                    <div className="studio-pod-review-item-main">
                      <span>{fact.claim}</span>
                      <span className="studio-pod-review-item-meta">
                        <span
                          className={`studio-pod-origin ${
                            fact.origin === "added"
                              ? "studio-pod-origin--added"
                              : "studio-pod-origin--source"
                          }`}
                          title={
                            fact.origin === "added"
                              ? "Lagt til av AI utover kildeteksten — bør dobbeltsjekkes"
                              : "Har dekning i kildeteksten du la inn"
                          }
                        >
                          {fact.origin === "added" ? "Lagt til av AI" : "Fra kilden"}
                        </span>
                        <TurnRefChips turnNumbers={fact.turn_numbers} onJump={onJumpToTurn} />
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {overview.theories.length > 0 && (
            <div className="studio-pod-review-block">
              <h4>
                <Lightbulb size={14} aria-hidden="true" />
                Teorier, modeller og fagbegreper
              </h4>
              <ul className="studio-pod-review-list">
                {overview.theories.map((theory, idx) => (
                  <li key={`${idx}-${theory.name}`}>
                    <div className="studio-pod-review-item-main">
                      <span>
                        <strong>{theory.name}:</strong> {theory.explanation}
                      </span>
                      <TurnRefChips turnNumbers={theory.turn_numbers} onJump={onJumpToTurn} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {overview.theses.length > 0 && (
            <div className="studio-pod-review-block">
              <h4>
                <Scale size={14} aria-hidden="true" />
                Teser og drøftinger
              </h4>
              <ul className="studio-pod-review-list">
                {overview.theses.map((thesis, idx) => (
                  <li key={`${idx}-${thesis.statement.slice(0, 24)}`}>
                    <div className="studio-pod-review-item-main">
                      <span>
                        <strong>{thesis.statement}</strong>
                        {thesis.perspectives && (
                          <span className="studio-pod-review-sub"> — {thesis.perspectives}</span>
                        )}
                      </span>
                      <TurnRefChips turnNumbers={thesis.turn_numbers} onJump={onJumpToTurn} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {overview.caveats.length > 0 && (
            <div className="studio-pod-review-caveats">
              <div className="studio-pod-review-caveats-head">
                <AlertTriangle size={14} aria-hidden="true" />
                <strong>Forenklinger og sjekkpunkter</strong>
              </div>
              <ul>
                {overview.caveats.map((caveat, idx) => (
                  <li key={idx}>{caveat}</li>
                ))}
              </ul>
            </div>
          )}

          {!compact && onApplyCorrection && geminiConfigured && (
            <div className="studio-pod-correction">
              <label htmlFor="podcast-academic-correction">
                Faglig korrigering — be AI rette opp manuset og oversikten
              </label>
              <div className="studio-pod-correction-row">
                <input
                  id="podcast-academic-correction"
                  type="text"
                  value={correctionText}
                  maxLength={1000}
                  disabled={busy}
                  onChange={(e) => setCorrectionText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void submitCorrection();
                    }
                  }}
                  placeholder="F.eks. «Rett årstallet i #4 til 1933, og ta med motargumentet fra teori B»"
                />
                <button
                  type="button"
                  className="studio-button"
                  disabled={busy || !correctionText.trim() || !canAnalyze}
                  onClick={() => void submitCorrection()}
                >
                  {busy && busyLabel ? (
                    <LoaderCircle size={14} className="studio-spinner" />
                  ) : (
                    <Sparkles size={14} />
                  )}
                  Rett opp
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
