import { Fraunces, Outfit } from "next/font/google";
import { ChatScreen } from "@/app/chat-screen";

const display = Fraunces({ subsets: ["latin"], variable: "--font-display" });
const body = Outfit({ subsets: ["latin"], variable: "--font-body" });

export default function Home() {
  return (
    <div className={`${display.variable} ${body.variable} ${body.className}`}>
      <ChatScreen titleFont={display.style.fontFamily} bodyFont={body.style.fontFamily} />
    </div>
  );
}
