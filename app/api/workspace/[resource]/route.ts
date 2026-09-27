import { bucket } from '@/lib/storage';
import { database } from '@/lib/database';
import { AccessError, failure, json, readBody, requireUser, sameOrigin, templateAccess } from '@/lib/access-server';
import { hasPermission } from '@/lib/permissions';

type Context = { params: Promise<{ resource: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireUser('builder.view');
    const { resource } = await context.params;
    if (resource === 'vendors') {
      const row = await database().prepare("SELECT payload FROM vendor_library WHERE id = 'shared'").first<{ payload: string }>();
      return json({ vendors: row ? JSON.parse(row.payload) : null });
    }
    if (resource === 'drafts') {
      if (!hasPermission(user, 'drafts.manage')) throw new AccessError('You cannot access saved drafts.');
      const rows = await database().prepare('SELECT id, template, payload FROM user_drafts WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100').bind(user.id).all<{ id: string; template: string; payload: string }>();
      const drafts = await Promise.all(rows.results.filter(row => hasPermission(user, `template.${row.template}` as 'template.general' | 'template.service')).map(async row => {
        const object = await bucket().get(row.payload);
        if (!object) throw new Error('Draft content is unavailable');
        return await object.json();
      }));
      return json({ drafts });
    }
    return json({ error: 'Not found.' }, 404);
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const { resource } = await context.params;
    const user = await requireUser(resource === 'vendors' ? 'vendors.manage' : 'drafts.manage');
    const body = await readBody(request);
    if (resource === 'vendors') {
      if (!Array.isArray(body.vendors) || body.vendors.length > 500 || body.vendors.some((v: any) => typeof v.id !== 'string' || !v.name || typeof v.name.en !== 'string' || !Array.isArray(v.integrations) || v.integrations.some((i: any) => typeof i.id !== 'string' || typeof i.name?.en !== 'string' || typeof i.name?.ar !== 'string' || typeof i.impact?.en !== 'string' || typeof i.impact?.ar !== 'string'))) throw new AccessError('Invalid vendor library.', 400);
      const query = body.initialize
        ? "INSERT OR IGNORE INTO vendor_library (id, payload, updated_at) VALUES ('shared', ?, ?)"
        : "INSERT INTO vendor_library (id, payload, updated_at) VALUES ('shared', ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at";
      await database().prepare(query).bind(JSON.stringify(body.vendors), new Date().toISOString()).run();
      return json({ ok: true });
    }
    if (resource === 'drafts') {
      templateAccess(user, body.template);
      if (!hasPermission(user, 'announcement.edit') || !hasPermission(user, 'builder.view')) throw new AccessError('Your role cannot save announcement content.');
      if (typeof body.id !== 'string' || body.id.length > 100 || typeof body.name !== 'string') throw new AccessError('Invalid draft.', 400);
      const previous = await database().prepare('SELECT payload FROM user_drafts WHERE user_id = ? AND id = ?').bind(user.id, body.id).first<{ payload: string }>();
      if (!previous && !hasPermission(user, 'announcement.create')) throw new AccessError('Your role cannot create new drafts.');
      const objectKey = `drafts/${user.id}/${crypto.randomUUID()}.json`;
      await bucket().put(objectKey, JSON.stringify(body));
      try {
        await database().prepare('INSERT INTO user_drafts (id, user_id, template, payload, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, id) DO UPDATE SET template = excluded.template, payload = excluded.payload, updated_at = excluded.updated_at').bind(body.id, user.id, body.template, objectKey, new Date().toISOString()).run();
      } catch (error) { await bucket().delete(objectKey); throw error; }
      if (previous) await bucket().delete(previous.payload);
      return json({ ok: true });
    }
    return json({ error: 'Not found.' }, 404);
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireUser('drafts.manage');
    if ((await context.params).resource !== 'drafts') throw new AccessError('Not found.', 404);
    const { id } = await readBody(request);
    const row = await database().prepare('SELECT payload, template FROM user_drafts WHERE user_id = ? AND id = ?').bind(user.id, String(id)).first<{ payload: string; template: string }>();
    if (row) {
      templateAccess(user, row.template);
      await database().prepare('DELETE FROM user_drafts WHERE user_id = ? AND id = ?').bind(user.id, String(id)).run();
      await bucket().delete(row.payload);
    }
    return json({ ok: true });
  } catch (error) { return failure(error); }
}
