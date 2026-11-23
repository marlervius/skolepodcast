"use client";

import { usePlayer } from "@/context/PlayerContext";
import { AppHeader } from "./AppHeader";

/** Felles ramme som gir plass til minispilleren nederst når noe spilles. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { currentEpisode } = usePlayer();
  return (
    <div className="app-shell" data-player={currentEpisode ? "open" : "closed"}>
      <AppHeader />
      <main className="app-main">{children}</main>
    </div>
  );
}
