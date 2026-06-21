import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { ensureRoleStore } from './storage/role-store.js';

const port = Number(process.env.PORT ?? 8787);

await ensureRoleStore();
const app = createApp();

serve({ fetch: app.fetch, port });

console.info(`八字命理学服务已启动：http://localhost:${port}`);
