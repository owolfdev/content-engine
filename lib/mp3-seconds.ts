const mpeg1Rates = [44100, 48000, 32000];
const mpeg2Rates = [22050, 24000, 16000];
const mpeg25Rates = [11025, 12000, 8000];
const mpeg1Bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const mpeg2Bitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

function headerAt(bytes: Buffer, offset: number) {
  if (offset + 4 > bytes.length) return null;
  if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) return null;
  const header = bytes.readUInt32BE(offset);
  const version = (header >> 19) & 3;
  const layer = (header >> 17) & 3;
  const bitrateIndex = (header >> 12) & 15;
  const sampleIndex = (header >> 10) & 3;
  const padding = (header >> 9) & 1;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) return null;
  const mpeg1 = version === 3;
  const sampleRate = (mpeg1 ? mpeg1Rates : version === 2 ? mpeg2Rates : mpeg25Rates)[sampleIndex];
  const bitrate = (mpeg1 ? mpeg1Bitrates : mpeg2Bitrates)[bitrateIndex] * 1000;
  const samples = mpeg1 ? 1152 : 576;
  const frameLength = Math.floor((samples / 8) * (bitrate / sampleRate)) + padding;
  if (frameLength < 4) return null;
  return { frameLength, samples, sampleRate };
}

export function mp3Seconds(bytes: Buffer) {
  let offset = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33 && bytes.length > 10) {
    const size =
      ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    offset = 10 + size + (bytes[5] & 0x10 ? 10 : 0);
  }

  let seconds = 0;
  let frames = 0;
  while (offset + 4 < bytes.length && frames < 200_000) {
    const frame = headerAt(bytes, offset);
    if (!frame || offset + frame.frameLength > bytes.length) {
      offset += 1;
      continue;
    }
    seconds += frame.samples / frame.sampleRate;
    offset += frame.frameLength;
    frames += 1;
  }
  if (frames > 0) return seconds;
  return (bytes.length * 8) / 128_000;
}
