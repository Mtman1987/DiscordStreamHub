export const SAY_VOICE_MAX_MS = 15_000;
// Discord supplies 48 kHz stereo signed 16-bit PCM; STT consumes mono 16 kHz WAV.
export function discordPcmToWav(pcm: Buffer): Buffer {
  const frames = Math.floor(pcm.length / 12);
  const out = Buffer.alloc(44 + frames * 2);
  out.write('RIFF', 0); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(16000, 24); out.writeUInt32LE(32000, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let j = 0; j < 6; j++) sum += pcm.readInt16LE(i * 12 + j * 2);
    out.writeInt16LE(Math.round(sum / 6), 44 + i * 2);
  }
  return out;
}
