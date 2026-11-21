# Stripe Checkout: configuration, acceptance and recovery

This change adds one-time hosted Checkout to the existing model-review workflow.
It is restored against backend `d3555ba1a7345e5e6b89410f8a7ddea62b6d79c2`, including
Patch 62. No audit rules or frozen `pricing-key-v1` formula identities change.

## Amount and order contract

The server recomputes the quote from the capability-bound source. Existing
F-score prices, discount calculation, whole-dollar GST rounding and the A$10
inclusive minimum remain authoritative. The final AUD amount converts to integer
cents once (A$827 becomes 82700). Fractional-cent/non-finite values and totals over
A$999,999.99 fail before session creation. A fully discounted model still costs
the existing minimum. Stripe automatic Tax and adaptive currency pricing are off;
the server total already includes GST. Do not add a second tax calculation.

Checkout intents are separate from paid orders. A signed webhook or authenticated operator reconciliation, each using a fresh
matching Stripe Session with `payment_status=paid`, creates a paid order. A return
URL, `unpaid`, or `no_payment_required` does not qualify. A paid order starts at
`pending_review`; the admin still starts the audit manually. Existing emulated
eWAY orders are not promoted to verified Stripe payments.

The separate frontend must implement:

1. `POST /api/verify-upload` → existing response plus `storedAs` and `uploadToken`.
2. `POST /api/unique-formulas` with both values for a staged quote. Existing quote
   fields and dollar display are unchanged.
3. `POST /api/stripe/checkout` with `{storedAs, uploadToken, fullName, company,
   email, quotedGrandTotal, promoCode?}` → `{success:true, checkoutId, checkoutUrl}`.
4. Redirect only to HTTPS `checkout.stripe.com`, or the exact trusted configured
   backend `/checkout/stripe-return` path for an already-paid retry.

Failures are non-2xx `{success:false, code, message}`. The browser never collects
or sends card details; `/api/submit-order` now returns 410. Keep the capability
private. Status uses a separate secret return token and exposes no customer PII.
The return page confirms server status and offers the same open/unpaid session
when a customer presses Back. Paid, held, processing and expired sessions cannot
create another charge by resuming that link.

## Configuration and environment

Use Node 22.19+ (verified locally with Node 24), `npm ci`, and the environment names
in `.env.example`. Stripe 23.2.0 is pinned with API 2026-11-18.endive. Configure:

| Variable | Requirement |
| --- | --- |
| `STRIPE_SECRET_KEY` | Server-only restricted API key preferred (`rk_test_`/`rk_live_`); `sk_` also supported. Account read, Product read and Checkout Session read/write are needed; validate permissions in the sandbox. |
| `STRIPE_ACCOUNT_ID` | Exact merchant/sandbox account authenticated by that key. No default account is embedded. |
| `STRIPE_PRODUCT_ID` | Active product in the same environment; the variable per-file amount is supplied server-side. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of this environment's endpoint, injected securely. |
| `STRIPE_LIVE_MODE` | `false` for isolated sandbox acceptance; explicit `true` only for verified live setup. |
| `PUBLIC_CHECKOUT_BASE_URL` | `https://plsfx.ai/fm-validator` for this deployment; an explicit staging URL for tests. |
| `STRIPE_PAYMENT_METHOD_CONFIGURATION` | Optional Dashboard configuration ID. Dynamic methods are otherwise used; test each enabled method, including delayed success/failure. |
| `VALIDATOR_API_KEY` | Strong internal server key; never embed in frontend JavaScript. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Separate admin application credentials; preserve proxy protection too. |
| `RESEND_API_KEY` / `NOTIFY_EMAIL` | Existing email delivery configuration. Missing/failed delivery remains a retry, not a successful notice. |

Store real keys in the hosting secret store, never committed source or chat.
Use a separate sandbox for acceptance. Account, product, mode and signing secret
must match; new checkout requires payment readiness and active product. Previously
paid sessions can still be recorded if new charges later become disabled or the
product is archived. Retain the matching configuration for older unresolved
sessions when rotating credentials. Do not substitute another merchant account.

## Hosting and webhook prerequisites

The public API returned an upstream Basic Auth challenge during preflight. The
hosting owner must narrowly allow the public paths below; the actual hosting
proxy product must be confirmed. Retain authentication everywhere privileged.
Allow browser OPTIONS/preflight where appropriate for these routes.

| Public path under `/fm-validator` | Method and control |
| --- | --- |
| `/api/verify-upload` | POST; rate limit, file validation, new capability |
| `/api/unique-formulas` | POST; staged-file capability and hash |
| `/api/validate-promo-code` | POST; preview, final validation repeated by checkout |
| `/api/stripe/checkout` | POST; capability, source, quote and rate limits |
| `/api/stripe/checkouts/<checkoutId>` | GET; secret return capability |
| `/checkout/stripe-return` | GET; no-store, no-referrer, restrictive CSP |
| `/api/stripe/webhook` | POST; raw-body Stripe signature, no browser login challenge |
| `/api/submit-demo-request` | POST only if the existing sample request form is enabled |

A public health endpoint is optional. Full audits, report/log downloads, promotion
administration and the admin app must remain protected. Origin/Referer is not
privileged authentication. Authenticated internal direct-upload audits remain
available; a customer order/staged-file audit additionally requires verified
payment and its exact paid source. Admin listens on 127.0.0.1.

Preserve original webhook bytes and `Stripe-Signature`. Prefix normalization and
the raw webhook route run before JSON parsing. Preserve actual client IPs and
configure proxy trust for the verified topology; do not enable blanket trust.

Configure the environment's webhook at:
`https://plsfx.ai/fm-validator/api/stripe/webhook`, subscribing to:

- `checkout.session.completed`
- `checkout.session.expired`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`

The handler retrieves current session/payment state, so stale failure/expiry
events cannot downgrade a paid order. A delayed failure records no paid order,
releases its promotion and sends a retryable failure notice. A delayed success
follows the same verified paid-order path. Enable only methods accepted in the
sandbox acceptance exercise.

## Persistence, recovery and operations

This file store supports multiple app/admin processes on **one shared persistent
filesystem**. Atomic rename/fsync and shared locks protect allocation, updates,
intent mapping and promotion reservations. It does not support independent
replica disks. Back up/restore `orders`, `payment-state`, `uploads` and existing
report artifacts together. `PAYMENT_DATA_DIR` and `ORDER_DATA_DIR` can relocate
state; all app/admin processes must use the same paths. Never remove state to
retry payment. File permissions are 0600 and new private directories 0700.

Session creation persists an immutable request and stable idempotency key before
calling Stripe. A lost API response retries the same session; after the bounded
creation window, recovery must reconcile instead of risking a duplicate charge.
Single-use codes reserve per email/code across concurrent uploads. Cancellation
keeps the reservation for the existing session; only a confirmed terminal outcome
or an exhaustive no-session recovery releases it. A crash before session creation
is also recoverable. A durable order itself is the checkout idempotency record,
so replay after interrupted intent mapping recovers that order.

```sh
node scripts/reconcile-stripe-checkout.js --list
node scripts/reconcile-stripe-checkout.js ci_<checkout-id>
node scripts/reconcile-stripe-checkout.js --all
```

These commands retrieve and reconcile existing Stripe state; they never initiate
a new charge. Unknown create outcomes are searched after the fixed session
expiry plus a ten-minute safety interval. An ambiguous result remains held for
operator review. `--list` includes manual-review notice types without customer
PII. After configuration, enable `STRIPE_RECONCILIATION_ENABLED=true` for startup
and hourly reconciliation, and monitor its safe checkout-ID/error-code output.

If a verified payment's source is missing/changed, an admin-visible paid held
order is created and both customer and admin are notified. Do not charge again.
Restore the exact original file at its stored location, clear the payment hold
in the authenticated admin (which verifies SHA-256), then reconcile that checkout
ID. The same order returns to `pending_review`; ordinary notices/status recover.
If the source cannot be restored, handle the purchase with the customer through
support and the Stripe Dashboard. A completed audit is not reset by replay after
normal source deletion.

Payment writes are durable before notifications. Each notice has a persisted
attempt state and stable Resend idempotency key. All recipients are attempted even
if one address fails. A delivery error leaves payment intact and retries via
webhook/reconciler. After 23 hours from an uncertain first attempt, automatic resend
stops at `manual_review` because Resend's deduplication window is 24 hours. Check
Resend delivery logs before sending a replacement; do not assume unlimited
exactly-once email delivery. This limit does not weaken payment/order idempotence.

Unresolved checkout/paid-review sources remain protected from the 48-hour working
file sweep. Reconcile abandoned sessions to release that protection. Completed,
unheld orders have source/contact data scrubbed after 14 days; duplicated checkout
contacts and filenames are scrubbed too, retaining money/source-hash/provider
references. Confirmed abandoned checkout contacts expire after 48 hours once their
required notifications are settled. Reports retain the existing separate policy.

## Validation and rollout

```sh
node scripts/run-tests.js stripe
node test-patch50.js
node test-patch62.js
```

The new tests use synthetic fixtures and fake payment transport. The HTTP suite
copies runtime code into a temporary directory and blocks outbound transport;
startup retention cannot affect real uploads/reports/logs. Patch 50's optional
private workbook fixture is explicitly skipped if absent. Tests do not send
provider payments, emails or audit API requests.

Before live rollout, complete real sandbox Checkout success, decline,
authentication challenge, cancellation/resume, webhook replay and every enabled
delayed payment method. Confirm the displayed inclusive total equals the charge,
exactly one paid order appears, notices arrive, and the audit remains manual.
Verify public proxy routes and rejection of public privileged requests. Deploy
the matching frontend/backend together. Live activation requires the owner's
confirmed merchant details, payout setup and explicit live configuration.

Rollback: disable new public checkout initiation, preserve payment/webhook and
recovery state, reconcile already-created sessions, and never revert to emulated
payment success. No production deployment or live payment is performed by this
patch.

References: [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment),
[webhook signatures](https://docs.stripe.com/webhooks),
[API idempotency](https://docs.stripe.com/api/idempotent_requests),
[dynamic methods](https://docs.stripe.com/payments/payment-methods/dynamic-payment-methods),
[Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).
