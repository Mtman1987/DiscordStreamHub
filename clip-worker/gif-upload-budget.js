const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtemp, writeFile, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

// Match /api/clips/upload. Keep the original when it already fits.
const MAX_GIF_UPLOAD_BYTES = 50 * 1024 * 1024;
const runEncoder = promisify(execFile);

async function prepareGifForUpload(buffer, { maxBytes = MAX_GIF_UPLOAD_BYTES, encode = runEncoder } = {}) {
  if (buffer.length <= maxBytes) return buffer;
  const directory = await mkdtemp(join(tmpdir(), 'dsh-gif-budget-'));
  try {
    const input = join(directory, 'source.gif');
    await writeFile(input, buffer);
    for (const [width, fps] of [[320, 8], [240, 6]]) {
      const output = join(directory, `bounded-${width}.gif`);
      const filter = `fps=${fps},scale='min(${width},iw)':-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=5`;
      await encode('ffmpeg', ['-y', '-threads', '1', '-i', input, '-filter_complex_threads', '1', '-filter_complex', filter, '-loop', '0', output], {
        timeout: 90_000, maxBuffer: 1024 * 1024,
      });
      const candidate = await readFile(output);
      if (candidate.length > 0 && candidate.length <= maxBytes) return candidate;
    }
    throw new Error(`GIF remains above the ${maxBytes}-byte upload limit after two bounded compression attempts`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

module.exports = { prepareGifForUpload, MAX_GIF_UPLOAD_BYTES };
