import { notificationWorker } from '../_shared/notifications.mjs';
Deno.serve(notificationWorker({ env: (name: string) => Deno.env.get(name) }));
