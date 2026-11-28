"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function StudioModal({
  title,
  headingExtra,
  close,
  busy = false,
  wide = false,
  children,
}: {
  title: string;
  headingExtra?: ReactNode;
  close: () => void;
  busy?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  useEffect(() => {
    const element = dialogRef.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      className={`studio-dialog${wide ? " studio-dialog--wide" : ""}`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) close();
      }}
    >
      <div className="studio-dialog-body">
        <header className="studio-dialog-top">
          {headingExtra ? (
            <div className="studio-pod-heading">
              <h2 id={headingId}>{title}</h2>
              {headingExtra}
            </div>
          ) : (
            <h2 id={headingId}>{title}</h2>
          )}
          <button
            type="button"
            className="studio-icon-button"
            onClick={close}
            disabled={busy}
            aria-label="Lukk"
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
