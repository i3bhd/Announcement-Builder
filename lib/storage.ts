import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { dataDirectory } from '../runtime/storage.mjs';

function objectPath(key: string) {
  if (!/^[a-zA-Z0-9/_-]+\.json$/.test(key) || key.startsWith('/')) throw new Error('Invalid storage key');
  return join(dataDirectory(), 'objects', key);
}
export const bucket = () => ({
  async get(key: string) {
    try {
      const content = await readFile(objectPath(key), 'utf8');
      return { json: async () => JSON.parse(content) as unknown };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  },
  async put(key: string, value: string) {
    const target = objectPath(key);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(temporary, value, { mode: 0o600, flag: 'wx' });
      await rename(temporary, target);
    } finally { await unlink(temporary).catch(() => {}); }
  },
  async delete(key: string) {
    try { await unlink(objectPath(key)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  },
});
