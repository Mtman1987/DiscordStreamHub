import { db } from '@/lib/db';

// Auth stub - not needed for server-side operations
const auth = null;
const app = null;

// Stub FieldValue and Timestamp for compatibility
const FieldValue = {
  increment: (n: number) => ({ _increment: n }),
  serverTimestamp: () => new Date(),
};

class Timestamp {
  seconds: number;
  nanoseconds: number;
  constructor(seconds: number, nanoseconds: number) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }
  toDate(): Date { return new Date(this.seconds * 1000); }
  static now(): Timestamp {
    const ms = Date.now();
    return new Timestamp(Math.floor(ms / 1000), 0);
  }
  static fromDate(date: Date): Timestamp {
    return new Timestamp(Math.floor(date.getTime() / 1000), 0);
  }
}

if (process.env.SQLITE_DEBUG_LOGS === 'true') {
  console.log('[SQLiteDB] Server init: using SQLite via @/lib/db');
}

export { db, auth, app, FieldValue, Timestamp };
