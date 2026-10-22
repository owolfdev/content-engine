"""Download the chosen Pexels clips and write 1920x1080 silent masters plus catalog.json.

Reads PEXELS_API_KEY from .env.local. Rebuilds a file when it is not already 1920x1080.
Portrait sources are center-cropped to 16:9.
"""

import json
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / ".env.local"
CATALOG = ROOT / "library" / "catalog.json"
PROXIES = ROOT / "public" / "library"
CANDIDATES = ROOT / "library" / "candidates.json"

PROPERTY = {"id": "palm-shore", "name": "Palm Shore"}

# id, title, tags. One stand-in resort, several scenes.
SELECTED = [
    ("30070764", "Aerial sandbar", ["beach", "aerial", "day", "guests"]),
    ("34103646", "Beach swing", ["beach", "day"]),
    ("6145259", "Villas from the shore", ["villa", "beach", "day"]),
    ("4701090", "Aerial water villas", ["villa", "aerial", "pool", "day"]),
    ("12540981", "Arrival along the pier", ["arrival", "villa", "day"]),
    ("25541490", "Villa entrance", ["arrival", "villa", "day"]),
    ("38022277", "Garden gateway", ["arrival", "sunset"]),
    ("14695740", "Pool loungers", ["pool", "day"]),
    ("10165855", "Infinity pool", ["pool", "day"]),
    ("31387465", "Pool at sunset", ["pool", "sunset"]),
    ("11459158", "Sunset deck", ["pool", "sunset", "guests"]),
    ("36775848", "Breakfast terrace", ["dining", "breakfast", "day"]),
    ("38591835", "Dinner on the beach", ["dining", "sunset"]),
    ("5190093", "Table on the sand", ["dining", "sunset"]),
    ("6423986", "Dinner after dark", ["dining", "night"]),
    ("38604837", "Ocean suite", ["room", "day"]),
    ("17887953", "Massage", ["spa"]),
    ("9335882", "Spa oil", ["spa"]),
    ("39465598", "Couple walking the shore", ["beach", "day", "guests", "walking"]),
    ("10494881", "Running in the shallows", ["beach", "day", "guests", "playing"]),
    ("8622074", "Into the waves", ["beach", "sunset", "guests", "playing"]),
    ("4782637", "Beach volleyball", ["beach", "aerial", "day", "guests", "playing"]),
    ("15207783", "Dinner by the water", ["dining", "sunset", "guests", "eating"]),
    ("6953392", "Plates at the table", ["dining", "guests", "eating"]),
    ("12169627", "Friends playing volleyball", ["beach", "day", "guests", "playing"]),
    ("5363080", "People on the beach", ["beach", "day", "guests"]),
    ("6474620", "Swimming", ["beach", "day", "guests", "playing"]),
    ("13076569", "Guests on the resort beach", ["beach", "day", "guests"]),
    ("8307046", "Posing on the beach", ["beach", "day", "guests"]),
    ("25961663", "Walking the dock", ["arrival", "day", "guests", "walking"]),
    ("38539345", "Couple walking at sunset", ["beach", "sunset", "guests", "walking"]),
    ("8456345", "Eating watermelon", ["beach", "day", "guests", "eating"]),
    ("6750892", "Back massage", ["spa"]),
    ("9154361", "Massage", ["spa"]),
    ("9154367", "Leg massage", ["spa"]),
    ("36720424", "Aerial beachfront", ["beach", "aerial", "day"]),
    ("34259125", "Beach at sunset", ["beach", "sunset"]),
    ("28639410", "Sunny tropical beach", ["beach", "day"]),
    ("19316040", "Aerial waves", ["beach", "aerial", "day"]),
    ("38005562", "Aerial coastline", ["beach", "aerial", "day"]),
    ("8627109", "Making pizza", ["dining", "cooking"]),
    ("19905870", "Plating food", ["dining", "cooking"]),
    ("8964522", "Chef in the kitchen", ["dining", "cooking"]),
    ("18124689", "Fishing", ["fishing", "day"]),
]


def load_key() -> str:
    for line in ENV.read_text().splitlines():
        if line.startswith("PEXELS_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("PEXELS_API_KEY missing from .env.local")


def api_get(key: str, url: str) -> dict:
    req = urllib.request.Request(url, headers={"Authorization": key, "User-Agent": "content-engine"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def best_file(video: dict) -> dict:
    files = [f for f in video.get("video_files") or [] if f.get("file_type") == "video/mp4" and f.get("link")]
    if not files:
        raise RuntimeError(f"no mp4 for {video.get('id')}")
    files.sort(key=lambda f: (f.get("width") or 0) * (f.get("height") or 0), reverse=True)
    return files[0]


def download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "content-engine"})
    with urllib.request.urlopen(req, timeout=300) as resp, dest.open("wb") as out:
        while True:
            chunk = resp.read(1024 * 256)
            if not chunk:
                break
            out.write(chunk)


def proxy(src: Path, dest: Path) -> None:
    # Cover the 16:9 frame, then keep the center. Vertical shots lose top and bottom.
    cover = "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080"
    result = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-nostdin",
            "-t",
            "8",
            "-i",
            str(src),
            "-an",
            "-vf",
            cover,
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(dest),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        tail = result.stderr.decode("utf-8", "replace")[-1500:]
        raise RuntimeError(f"ffmpeg failed for {src.name}: {tail}")


def probe(path: Path) -> dict:
    raw = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,duration",
            "-of",
            "json",
            str(path),
        ]
    )
    stream = json.loads(raw)["streams"][0]
    return {
        "width": int(stream["width"]),
        "height": int(stream["height"]),
        "duration": round(float(stream["duration"]), 2),
    }


def main() -> None:
    key = load_key()
    PROXIES.mkdir(parents=True, exist_ok=True)
    known = {}
    if CANDIDATES.exists():
        for item in json.loads(CANDIDATES.read_text()):
            known[str(item["id"])] = item

    clips = []
    for vid, title, tags in SELECTED:
        dest = PROXIES / f"{vid}.mp4"
        meta = known.get(vid, {})
        info = probe(dest) if dest.exists() and dest.stat().st_size > 1000 else None
        if info is None or info["width"] != 1920 or info["height"] != 1080:
            video = api_get(key, f"https://api.pexels.com/videos/videos/{vid}")
            source = best_file(video)
            raw = dest.with_suffix(".src.mp4")
            print(f"download {vid} {title} from {source.get('width')}x{source.get('height')}", flush=True)
            download(source["link"], raw)
            print(f"proxy {vid}", flush=True)
            proxy(raw, dest)
            raw.unlink(missing_ok=True)
            meta = {
                "page": video.get("url"),
                "user": (video.get("user") or {}).get("name"),
                "user_url": (video.get("user") or {}).get("url"),
            }
            info = probe(dest)
        clips.append(
            {
                "id": vid,
                "title": title,
                "propertyId": PROPERTY["id"],
                "tags": tags,
                "orientation": "landscape",
                "duration": info["duration"],
                "width": info["width"],
                "height": info["height"],
                "file": f"/library/{vid}.mp4",
                "source": meta.get("page"),
                "author": meta.get("user"),
                "authorUrl": meta.get("user_url"),
                "license": "Pexels License",
            }
        )
        print(f"ready {vid} {info['width']}x{info['height']} {info['duration']}s", flush=True)

    CATALOG.parent.mkdir(parents=True, exist_ok=True)
    CATALOG.write_text(
        json.dumps(
            {
                "property": PROPERTY,
                "note": "Stock stand-in for a private trial. Masters are 1920x1080. Vertical sources are center-cropped to 16:9.",
                "clips": clips,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"wrote {CATALOG} ({len(clips)} clips)")


if __name__ == "__main__":
    main()
