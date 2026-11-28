import type { Metadata } from "next";
import { HomeClient } from "@/components/HomeClient";

export const metadata: Metadata = {
  title: "Mine fag",
  description: "Dine fulgte fag og episoder i Lytterom.",
};

export default function MineFagPage() {
  return <HomeClient />;
}
