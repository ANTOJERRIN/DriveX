import { createOrderHandler } from '../_shared/payments.mjs';
Deno.serve(createOrderHandler({ env: (name: string) => Deno.env.get(name) }));
