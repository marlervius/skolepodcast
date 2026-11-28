import type { Metadata } from "next";
import "./landing.css";
import { LandingClient } from "@/components/LandingClient";

export const metadata: Metadata = {
  title: "Lytterom — Pensum på øret for norske skoler",
  description:
    "Lag, kvalitetssikre og publiser fagpodkaster og undervisningsvideoer til klassen. Elevene lytter rett på mobilen med QR-kode — helt uten innlogging.",
};

export default function HomePage() {
  return <LandingClient />;
}
