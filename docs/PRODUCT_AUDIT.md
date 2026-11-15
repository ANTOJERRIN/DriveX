# DriveX product audit

Historical Supabase implementation audit. The owner's subsequent Neon migration
supersedes its hosting/configuration status. See [the current Neon guide](../docs-neon-migration.md)
for the active Node/Neon runtime, migration limits and release acceptance.

Scope: the latest `prompts/v2/B0..B8` pack, with `prompts resources/new` as its duplicate. The user subsequently requested the remaining abilities from `prompts resources/04..06`: notifications, custom working hours and PWA. Those features are now implemented locally. The existing Supabase, vanilla JavaScript and Render architecture is retained; no Higgsfield-hosted copy is created.

## Inventory and changes

| Area | Found at the start of this work | Current source behavior |
| --- | --- | --- |
| Authentication | Signup/login/recovery/refresh client existed; login could change the protected role | Role is read from the server; signup requests are whitelisted by a profile trigger; errors do not produce a sample workspace |
| Instructor approval | Migration 0004 automatically approved instructors | New migration requires a fresh admin decision; pending/rejected instructors get only their account status |
| Plans | INR 1,500 / 10 credits and INR 4,000 / 30 credits existed | Prices and credits remain server-controlled; pending enrollment is reused; one unfinished enrollment is allowed through the dispatcher |
| Checkout | Browser directly activated plans; real provider orders were not stored | Real order creation, service-only order registration, signed webhook reconciliation, status polling and test-mode guard |
| Legacy activations | Browser-authorized `direct` payments and synthetic order IDs could appear paid | Preserved for audit, flagged for receipt review and blocked from booking/assessment until reviewed |
| Booking | Sample availability and localStorage bookings could mask RPC failures; reservation count was unbounded | Only real RPC availability; confirmed reservations cannot exceed unspent credits; assigned instructor is server-selected |
| Completion | Credit updates existed but lacked review gating | Assigned approved instructor assesses after end; completion is idempotent; a credit is used once |
| Syllabus | Learner theory UI existed; practical ownership check was absent | Theory is learner-marked; practical is current paid instructor-marked; school controls safe video links |
| Progress | Partial displays | Overall, theory and practical percentages use stored curriculum progress; dashboard includes next/recent lessons |
| Learner payments | Payment list existed without a trustworthy purchase flow | Pending/failed purchase can be resumed; only server-paid status activates a plan; school contact note for refunds |
| Instructor portal | Partial overview and learner list | Overview, schedule, assessment, current learners, practical milestones and attributable school plan collections |
| Admin portal | Several navigation entries rendered the overview again | Separate approvals, bookings, fleet, receipts/refund records and theory-resource screens |
| Historical receipts | Older per-lesson records were omitted by the enrollment-only payment query | Own/admin historical receipts remain visible; admin can record returned refunds for historical cancellation requests |
| Real inventory | Three fictitious seeded vehicles plus browser-added sample instructors | Browser samples removed; exact seeded fleet entries deactivated for school review, records preserved |
| Hosting/config | Render config existed; arbitrary key strings could pass validation | Shared public-key validation, complete module syntax checks, stricter script CSP, explicit Edge Function JWT configuration |
| Tests | 18 entries passed, including tests allowing payment/role bypass | Full migration chain, upgrade fixture, role isolation, real overlap rejection, credit lifecycle, webhook/HTTP handlers and client/presentation tests |
| Teaching availability | Eight fixed daily slots | Instructor/admin weekly windows, half-hour starts and blocked dates; edits cannot invalidate reserved lessons |
| Email notices | No queue or sender | Transactional queue, service-only worker, bounded retries, reminders and conditional cron/Vault wiring; provider setup and live delivery still required |
| PWA/offline | No install/offline shell | Manifest, icons, public offline page, install affordance and cache exclusion for private records, config and APIs |

## Screen map

```text
Landing → Learner / Instructor door → Sign in / Create account / Password recovery
  Server role: learner
    Overview · Plans · Book a lesson · My lessons · Learning & progress · Payments
  Server role: instructor
    Pending/rejected → status screen and sign out
    Approved → Overview · My learners · My schedule · Teaching hours · Plan collections
  Server role: admin
    Overview · Instructor approvals · All bookings · Training fleet
    Teaching hours · Payments & receipts · School emails · Theory resources
```

## Product boundaries

- Plan names represent credit packs. Calendar-based expiry is not specified in the latest data contract and is not introduced here.
- A paid plan reserves lessons immediately. The legacy 30-minute pending holds and all three exclusion constraints remain in the schema; expired legacy holds are released before availability/reservation.
- A cancellation before start releases the reserved credit. A completion consumes it. Plans cannot be purchased concurrently through the dispatcher.
- An existing pending checkout is resumed from Payments. A different pending plan/instructor is not substituted after an order may have been issued; school reconciliation is required.
- Full refund recording requires an unused paid plan and no reserved lessons. This records money already returned by staff; it does not initiate a provider refund. Partial refunds and instructor salary/payout processing are outside this release.
- Instructor collections mean school payments attributed to the instructor's plans, not money paid out to an instructor.
- Theory lessons ship without invented video URLs. An admin supplies reviewed YouTube videos.
- Weekly hours, blocked dates, queued email/reminders and the installable/offline shell are included in the current source. See `ADDITIONAL_ABILITIES.md` for their behavior, setup and remaining hosted acceptance.
- CAPTCHA remains a separate future client integration; it is not implemented and must not be enabled without its client token flow. Production SMTP/rate limits, backups and operational monitoring remain environment-level launch tasks; no provider credentials or live delivery configuration are invented.

## Release status

NOT VERIFIED in the hosted environment. The connected Supabase project reported `INACTIVE`; restoration was rejected because the organization reached its free-project limit. No other project was changed. Render access had no selected workspace. Browser automation stopped because it could not reliably identify the browser URL, so visual/mobile QA has not been completed.

The local fixture in `tests/browser-server.mjs` serves real application files and uses the real dispatcher in PGlite, with test-only Auth responses. `tests/integration.test.mjs` runs the actual client over local HTTP through the actual payment handlers and dispatcher, replacing only Auth/provider services. It covers purchase, signed/replayed payment events, booking, completion and practical progress. It does not prove Supabase Auth, SMTP, Razorpay, browser rendering or cross-session database locking.

The user has authorized GitHub branch publication. Hosted deployment remains gated by environment setup and acceptance checks. See `RELEASE.md` for the remaining environment steps.
