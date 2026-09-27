import { database } from '@/lib/database';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    await database().prepare('SELECT 1 FROM access_users LIMIT 1').first();
    return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ status: 'unavailable' }, { status: 503 }); }
}
