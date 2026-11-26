import type { Metadata } from "next";
import { StudioClient } from "@/components/studio/StudioClient";
import { isGeminiConfigured } from "@/lib/gemini";
import { MAX_UPLOAD_MB } from "@/lib/limits";
import "./studio.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Lærerstudio",
  description: "Lag fagrom, publiser episoder og del undervisningen med klassen.",
};

export default function StudioPage() {
  return <StudioClient maxUploadMb={MAX_UPLOAD_MB} geminiConfigured={isGeminiConfigured()} />;
}
