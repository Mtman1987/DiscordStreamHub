import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_STREAMWEAVER_MEDIA_BYTES, validateUploadedGifConversion } from '../src/lib/uploaded-media-gif-validation';

test('accepts only bounded MP4 files for known StreamWeaver slots', () => {
  assert.equal(validateUploadedGifConversion({
    tenantId: 'tenant-1', slot: 'avatar-idle', fileName: 'athena.mp4', mimeType: 'video/mp4', size: 1024,
  }), null);
  assert.match(validateUploadedGifConversion({
    tenantId: 'tenant-1', slot: 'private-dm', fileName: 'athena.gif', mimeType: 'image/gif', size: 1024,
  }) || '', /Only MP4/);
  assert.match(validateUploadedGifConversion({
    tenantId: 'tenant-1', slot: 'unknown', fileName: 'athena.mp4', mimeType: 'video/mp4', size: 1024,
  }) || '', /Unsupported/);
  assert.match(validateUploadedGifConversion({
    tenantId: 'tenant-1', slot: 'public-discord', fileName: 'athena.mp4', mimeType: 'video/mp4', size: MAX_STREAMWEAVER_MEDIA_BYTES + 1,
  }) || '', /60 MB/);
});
