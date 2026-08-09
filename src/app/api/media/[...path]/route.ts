import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join, resolve, sep } from 'path';
import { existsSync } from 'fs';
import { getStoragePath } from '@/lib/runtime-config';

const STORAGE_PATH = getStoragePath();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const storageRoot = resolve(STORAGE_PATH);
    const filePath = resolve(join(storageRoot, ...path));
    if (filePath !== storageRoot && !filePath.startsWith(`${storageRoot}${sep}`)) {
      return new NextResponse('Not found', { status: 404 });
    }
    
    if (!existsSync(filePath)) {
      return new NextResponse('Not found', { status: 404 });
    }

    const file = await readFile(filePath);
    const ext = filePath.split('.').pop()?.toLowerCase();
    
    const contentType = ext === 'gif' ? 'image/gif' : 
                       ext === 'png' ? 'image/png' :
                       ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
                       ext === 'mp4' ? 'video/mp4' : 
                       'application/octet-stream';

    return new NextResponse(file, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    console.error('Error serving media:', error);
    return new NextResponse('Internal error', { status: 500 });
  }
}
