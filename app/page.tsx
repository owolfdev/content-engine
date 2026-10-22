import { Fraunces, Outfit } from "next/font/google";
import { PlanRequest } from "@/app/plan-request";
import { StyleGuidePreview } from "@/app/style-guide";
import { VoiceLine } from "@/app/voice-line";
import { styleGuide } from "@/lib/style";

const display = Fraunces({ subsets: ["latin"], variable: "--font-display" });
const body = Outfit({ subsets: ["latin"], variable: "--font-body" });

export default function Home() {
  return (
    <div className={`${display.variable} ${body.variable} ${body.className} min-h-full bg-white text-zinc-900`}>
      <PlanRequest
        titleFont={display.style.fontFamily}
        bodyFont={body.style.fontFamily}
      />
      <StyleGuidePreview
        guide={styleGuide}
        displayFont={display.style.fontFamily}
        bodyFont={body.style.fontFamily}
      />
      <VoiceLine />
    </div>
  );
}
