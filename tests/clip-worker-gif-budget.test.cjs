const { test } = require('node:test');
const assert = require('node:assert/strict');
const { writeFile, access } = require('node:fs/promises');
const { dirname } = require('node:path');
const { prepareGifForUpload } = require('../clip-worker/gif-upload-budget.js');

test('preserves GIFs that already fit without invoking FFmpeg', async () => {
  const original = Buffer.alloc(10);
  const result = await prepareGifForUpload(original, { maxBytes: 10, encode: () => { throw new Error('must not encode'); } });
  assert.equal(result, original);
});

test('reduces an oversized GIF before upload and removes temporary files', async () => {
  let calls = 0, directory;
  const result = await prepareGifForUpload(Buffer.alloc(20), { maxBytes: 10, encode: async (cmd, args, options) => {
    assert.equal(cmd, 'ffmpeg');
    assert.equal(options.timeout, 90_000);
    directory = dirname(args.at(-1));
    await writeFile(args.at(-1), Buffer.alloc(++calls === 1 ? 15 : 8));
  } });
  assert.equal(calls, 2);
  assert.equal(result.length, 8);
  await assert.rejects(access(directory));
});

test('rejects a GIF that still exceeds the upload limit, with bounded work', async () => {
  let calls = 0;
  await assert.rejects(prepareGifForUpload(Buffer.alloc(20), { maxBytes: 10, encode: async (_, args) => {
    calls++;
    await writeFile(args.at(-1), Buffer.alloc(15));
  } }), /after two bounded compression attempts/);
  assert.equal(calls, 2);
});

test('cleans up after encoder failure', async () => {
  let directory;
  await assert.rejects(prepareGifForUpload(Buffer.alloc(20), { maxBytes: 10, encode: async (_, args) => {
    directory = dirname(args.at(-1));
    throw new Error('encoder failed');
  } }), /encoder failed/);
  await assert.rejects(access(directory));
});
