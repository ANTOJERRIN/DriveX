import { webhookHandler } from '../_shared/payments.mjs';
Deno.serve(webhookHandler({ env: (name: string) => Deno.env.get(name) }));
