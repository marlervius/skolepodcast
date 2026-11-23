"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      // I utvikling fjerner vi gamle service workers så de ikke cacher utdatert kode.
      void navigator.serviceWorker.getRegistrations().then((list) => list.forEach((registration) => void registration.unregister()));
      return;
    }
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
