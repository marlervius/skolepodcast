"use client";

import { HelpCircle } from "lucide-react";
import { useMemo } from "react";
import { parseStudyNotes } from "@/lib/media";

export function StudyNotesView({ notes, className = "" }: { notes: string; className?: string }) {
  const blocks = useMemo(() => parseStudyNotes(notes), [notes]);
  if (!blocks.length) return null;

  return (
    <div className={`notes-structured ${className}`.trim()}>
      {blocks.map((block, index) => {
        if (block.kind === "bullets") {
          return (
            <ul key={index} className="notes-bullets">
              {block.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === "reflection") {
          return (
            <div key={index} className="notes-reflection">
              <div className="notes-reflection-head">
                <HelpCircle size={15} aria-hidden="true" />
                <span>Spørsmål til ettertanke</span>
              </div>
              <ul>
                {block.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          );
        }
        return (
          <p key={index} className="notes-paragraph">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}
