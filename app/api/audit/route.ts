import { database } from '@/lib/database';
import { AccessError, failure, requireUser, sameOrigin, templateAccess } from '@/lib/access-server';

import type { AuditIntegration, AuditRecord, CreateAuditRecord } from '@/lib/audit';

type AuditRow = {
  id: string;
  announcement_id: string;
  announcement_name: string;
  template: string;
  status: string;
  source: string;
  vendor_id: string | null;
  vendor_en: string | null;
  vendor_ar: string | null;
  integrations_json: string;
  start_date: string | null;
  start_time: string | null;
  end_date: string | null;
  end_time: string | null;
  duration_minutes: number;
  sent_at: string;
  sent_by: string;
  snapshot_json: string;
};


function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toRecord(row: AuditRow): AuditRecord {
  return {
    id: row.id,
    announcementId: row.announcement_id,
    announcementName: row.announcement_name,
    template: row.template,
    status: row.status,
    source: row.source,
    vendorId: row.vendor_id,
    vendorEn: row.vendor_en,
    vendorAr: row.vendor_ar,
    integrations: parseJson<AuditIntegration[]>(row.integrations_json, []),
    startDate: row.start_date,
    startTime: row.start_time,
    endDate: row.end_date,
    endTime: row.end_time,
    durationMinutes: row.duration_minutes,
    sentAt: row.sent_at,
    sentBy: row.sent_by,
    snapshot: parseJson<unknown>(row.snapshot_json, null),
  };
}

async function readAudit() {
  const result = await database().prepare(`
    SELECT id, announcement_id, announcement_name, template, status, source,
      vendor_id, vendor_en, vendor_ar, integrations_json, start_date, start_time,
      end_date, end_time, duration_minutes, sent_at, sent_by, snapshot_json
    FROM announcement_audit
    ORDER BY sent_at DESC
    LIMIT 2000
  `).all<AuditRow>();

  return Response.json({ records: result.results.map(toRecord) }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

async function deleteAudit() {
  const result = await database().prepare('DELETE FROM announcement_audit').run();
  return Response.json({ deleted: result.meta.changes || 0 }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

async function createAudit(request: Request, sentBy: string) {
  const body = await request.json() as Partial<CreateAuditRecord> & { sentAt?: string };
  if (!body.announcementId || !body.announcementName || !body.template || !body.status || !body.source) {
    return Response.json({ error: 'Missing required announcement details.' }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const importedSentAt = body.sentAt ? new Date(body.sentAt) : null;
  const sentAt = importedSentAt && !Number.isNaN(importedSentAt.getTime())
    ? importedSentAt.toISOString()
    : new Date().toISOString();
  const integrations = Array.isArray(body.integrations) ? body.integrations : [];
  const durationMinutes = Number.isFinite(body.durationMinutes) ? Math.max(0, Number(body.durationMinutes)) : 0;
  const snapshot = body.snapshot ?? body;

  await database().prepare(`
    INSERT INTO announcement_audit (
      id, announcement_id, announcement_name, template, status, source,
      vendor_id, vendor_en, vendor_ar, integrations_json, start_date, start_time,
      end_date, end_time, duration_minutes, sent_at, sent_by, snapshot_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    body.announcementId,
    body.announcementName,
    body.template,
    body.status,
    body.source,
    body.vendorId || null,
    body.vendorEn || null,
    body.vendorAr || null,
    JSON.stringify(integrations),
    body.startDate || null,
    body.startTime || null,
    body.endDate || null,
    body.endTime || null,
    durationMinutes,
    sentAt,
    sentBy,
    JSON.stringify(snapshot),
  ).run();

  return Response.json({ record: toRecord({
    id,
    announcement_id: body.announcementId,
    announcement_name: body.announcementName,
    template: body.template,
    status: body.status,
    source: body.source,
    vendor_id: body.vendorId || null,
    vendor_en: body.vendorEn || null,
    vendor_ar: body.vendorAr || null,
    integrations_json: JSON.stringify(integrations),
    start_date: body.startDate || null,
    start_time: body.startTime || null,
    end_date: body.endDate || null,
    end_time: body.endTime || null,
    duration_minutes: durationMinutes,
    sent_at: sentAt,
    sent_by: sentBy,
    snapshot_json: JSON.stringify(snapshot),
  }) }, { status: 201 });
}

export async function GET() {
  try { await requireUser('dashboard.view'); return await readAudit(); }
  catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    if (!user.isAdmin) throw new AccessError('Only administrators can clear sent history.');
    return await deleteAudit();
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser('announcement.send');
    const body = await request.clone().json() as { template?: string };
    templateAccess(user, body.template);
    return await createAudit(request, `${user.name} (@${user.username})`);
  } catch (error) { return failure(error); }
}
