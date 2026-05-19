import { NextRequest, NextResponse } from 'next/server';
import { sqliteService } from '@/lib/sqlite-service';

function isCollectionPath(path: string): boolean {
  return path.split('/').filter(Boolean).length % 2 === 1;
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const path = url.searchParams.get('path');

    if (!path) {
      return badRequest('Missing path');
    }

    if (isCollectionPath(path)) {
      const limitParam = url.searchParams.get('limit');
      const docs = sqliteService.getCollection(path, {
        orderBy: url.searchParams.get('orderBy') || undefined,
        orderDir: (url.searchParams.get('orderDir') as 'asc' | 'desc' | null) || undefined,
        limit: limitParam ? Number(limitParam) : undefined,
        whereField: url.searchParams.get('whereField') || undefined,
        whereOp: url.searchParams.get('whereOp') || undefined,
        whereValue: url.searchParams.get('whereValue') ?? undefined,
      }).docs;

      return NextResponse.json({ docs });
    }

    const result = sqliteService.getDoc(path);
    return NextResponse.json({
      exists: result.exists,
      id: result.id || path.split('/').filter(Boolean).pop(),
      data: result.data || null,
    });
  } catch (error) {
    console.error('[API /db] GET failed:', error);
    return NextResponse.json({ error: 'Failed to read data' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { path, data, merge } = await request.json();

    if (!path) {
      return badRequest('Missing path');
    }

    if (isCollectionPath(path)) {
      const result = sqliteService.addDoc(path, data || {});
      return NextResponse.json({ success: true, id: result.id });
    }

    sqliteService.setDoc(path, data || {}, Boolean(merge));
    return NextResponse.json({ success: true, id: path.split('/').filter(Boolean).pop() });
  } catch (error) {
    console.error('[API /db] POST failed:', error);
    return NextResponse.json({ error: 'Failed to write data' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { path, data } = await request.json();

    if (!path) {
      return badRequest('Missing path');
    }

    const existing = sqliteService.getDoc(path);
    if (existing.exists) {
      sqliteService.updateDoc(path, data || {});
    } else {
      sqliteService.setDoc(path, data || {}, false);
    }

    return NextResponse.json({ success: true, id: path.split('/').filter(Boolean).pop() });
  } catch (error) {
    console.error('[API /db] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update data' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const path = url.searchParams.get('path');

    if (!path) {
      return badRequest('Missing path');
    }

    sqliteService.deleteDoc(path);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API /db] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to delete data' }, { status: 500 });
  }
}
