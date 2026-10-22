import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Series,
  getRemotionEnvironment,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type CutProps = {
  clips: { src: string; durationInFrames: number }[];
  title: string;
  spokenLine: string;
  wordmark: string;
  logo: string;
  music: string | null;
  voice: string | null;
  voiceFrames: number;
  titleFont: string;
  bodyFont: string;
  titleColor: string;
  accent: string;
  background: string;
  margins: { top: number; right: number; bottom: number; left: number };
  width: number;
  height: number;
};

function mediaSrc(src: string) {
  if (!src.startsWith("/")) return src;
  if (getRemotionEnvironment().isRendering) return staticFile(src.slice(1));
  return src;
}

export function Cut({
  clips,
  title,
  spokenLine,
  wordmark,
  logo,
  music,
  voice,
  voiceFrames,
  titleFont,
  bodyFont,
  titleColor,
  accent,
  background,
  margins,
}: CutProps) {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const titleWindow = Math.min(90, Math.max(30, durationInFrames - 15));
  const titleOpacity = interpolate(
    frame,
    [0, 12, Math.max(13, titleWindow - 12), titleWindow],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const musicVolume = (at: number) => {
    if (!voice || voiceFrames <= 0) return 0.45;
    const fade = 15;
    if (at < voiceFrames) return 0.12;
    if (at < voiceFrames + fade) {
      return 0.12 + ((at - voiceFrames) / fade) * 0.33;
    }
    return 0.45;
  };

  return (
    <AbsoluteFill style={{ background }}>
      <Series>
        {clips.map((clip, index) => (
          <Series.Sequence key={`${clip.src}-${index}`} durationInFrames={clip.durationInFrames}>
            <AbsoluteFill>
              <OffthreadVideo
                src={mediaSrc(clip.src)}
                volume={0}
                muted
                toneMapped={false}
                pauseWhenBuffering
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </AbsoluteFill>
          </Series.Sequence>
        ))}
      </Series>

      {music ? <Audio src={mediaSrc(music)} volume={musicVolume} /> : null}
      {voice ? <Audio src={mediaSrc(voice)} /> : null}

      <Img
        src={mediaSrc(logo)}
        alt=""
        style={{
          position: "absolute",
          top: height * margins.top,
          left: width * margins.left,
          width: height * 0.07,
          height: height * 0.07,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: width * margins.left,
          right: width * margins.right,
          bottom: height * margins.bottom,
          opacity: titleOpacity,
        }}
      >
        <p
          style={{
            margin: 0,
            color: accent,
            fontFamily: bodyFont,
            fontSize: height * 0.028,
            letterSpacing: "0.04em",
          }}
        >
          {wordmark}
        </p>
        <h1
          style={{
            margin: "0.2em 0 0",
            color: titleColor,
            fontFamily: titleFont,
            fontSize: height * 0.07,
            fontWeight: 500,
            lineHeight: 1.05,
            textShadow: "0 2px 16px rgba(0,0,0,0.35)",
          }}
        >
          {title}
        </h1>
      </div>

      {spokenLine ? (
        <p
          style={{
            position: "absolute",
            left: width * margins.left,
            right: width * margins.right,
            bottom: height * 0.04,
            margin: 0,
            color: titleColor,
            fontFamily: bodyFont,
            fontSize: height * 0.026,
            lineHeight: 1.3,
            textShadow: "0 1px 10px rgba(0,0,0,0.45)",
          }}
        >
          {spokenLine}
        </p>
      ) : null}
    </AbsoluteFill>
  );
}
