import { Composition, registerRoot } from "remotion";
import { loadFont as loadFraunces } from "@remotion/google-fonts/Fraunces";
import { loadFont as loadOutfit } from "@remotion/google-fonts/Outfit";
import { Cut, type CutProps } from "../composition/Cut";

const display = loadFraunces("normal", { weights: ["500"], subsets: ["latin"] });
const body = loadOutfit("normal", { weights: ["400"], subsets: ["latin"] });

const empty: CutProps = {
  clips: [],
  title: "",
  spokenLine: "",
  wordmark: "",
  logo: "",
  music: null,
  voice: null,
  voiceFrames: 0,
  titleFont: display.fontFamily,
  bodyFont: body.fontFamily,
  titleColor: "#f7f3ea",
  accent: "#0e6e6a",
  background: "#f3eee4",
  margins: { top: 0.08, right: 0.06, bottom: 0.1, left: 0.06 },
  width: 1920,
  height: 1080,
};

function Root() {
  return (
    <Composition
      id="Cut"
      component={Cut}
      fps={30}
      width={1920}
      height={1080}
      durationInFrames={30}
      defaultProps={empty}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(
          1,
          props.clips.reduce((sum, clip) => sum + clip.durationInFrames, 0),
        ),
        width: props.width,
        height: props.height,
        props: {
          ...props,
          titleFont: props.titleFont === "body" || props.titleFont === body.fontFamily ? body.fontFamily : display.fontFamily,
          bodyFont: body.fontFamily,
        },
      })}
    />
  );
}

registerRoot(Root);
