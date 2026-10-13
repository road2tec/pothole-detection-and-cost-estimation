# Security

## Authentication

* Passwords: bcrypt (12 rounds, `bcryptjs`), policy ≥ 10 characters with letters and digits.
* Registration creates a **pending** account; an administrator approves it. Users cannot self-register as admin.
* Access token: JWT (HS256), 15 minutes, issuer/audience checked, kept **in memory** in the browser.
* Refresh token: 48 random bytes, stored only as a SHA-256 hash, sent as an `HttpOnly; SameSite=Strict` cookie scoped to
  `/api/v1/auth` (`Secure` when `COOKIE_SECURE=true`, required in production). Rotated on every use; re-use of a rotated
  token revokes the whole token family.
* Every request re-checks that the account is still active and uses the current role, so deactivation or a role
  change takes effect immediately. Password change/reset and role change revoke all refresh tokens.
* Login lockout: 5 failures → 15-minute lock. Unknown emails take the same bcrypt time (no enumeration).
* Forgot password: response never reveals whether the email exists; tokens are hashed, single-use, 30-minute expiry.
  Without SMTP the user is told to contact an administrator (in development only, the link is written to the server log).
* **No default administrator.** The first admin is created with `npm --prefix server run bootstrap:admin`
  (password from `ADMIN_PASSWORD` or a hidden prompt, never a CLI argument); it refuses to run once an admin exists.

## Authorisation

Enforced in Express middleware on every route (the UI hides links but is not trusted).

| Capability | Admin | Engineer | Inspector |
|---|---|---|---|
| Upload images/video, calibrate own uploads, submit for review | ✓ | ✓ | ✓ (own) |
| See uploads/potholes | all | all | **own uploads only** |
| Correct measurements | ✓ | ✓ | own, until reviewed |
| Flag incorrect detection | ✓ | ✓ | own |
| Verify/reject, change severity, repair status, location | ✓ | ✓ | ✗ |
| Work orders, review queue, priority list | ✓ | ✓ | ✗ |
| Analytics / reports | all data | all data | own data |
| Power BI export & status | ✓ | ✓ | ✗ |
| Users, settings, cost rates, camera profiles, jobs, audit log, API keys, recalculation | ✓ | ✗ | ✗ |
| Download a report | ✓ | own | own |

The matrix is covered by automated tests that call the API directly (`server/tests/workflow.test.ts`).

## Uploads and files

* Multer writes to `storage/tmp` with random names; files are validated by **magic bytes** (JPEG/PNG/MP4/XML), not
  client MIME, and by per-type size limits; then moved to `storage/uploads/<yyyy-mm>/<uuid>.<ext>`.
* Files are served only through authorised routes (`/uploads/:id/original`, `/potholes/:id/crop`, …) with
  `X-Content-Type-Options: nosniff`; storage paths are never accepted from clients. Path resolution in both services
  rejects absolute paths and `..` traversal.
* The AI service is not public: all endpoints except `/health` require a shared `X-Service-Token`
  (constant-time comparison). Bind it to localhost or a private network.

## Other controls

* Helmet (CSP `default-src 'none'` for the API), strict CORS allow-list with credentials, JSON body limit 1 MB.
* Rate limiting: 600 requests/min per IP for the API, 20 per 15 min for auth endpoints.
* Input validation with Zod on every body/query; MongoDB `$regex` inputs are escaped; Mongoose `strictQuery`.
* CSV exports neutralise spreadsheet formulas (`=`, `+`, `-`, `@`, tab, CR prefixed with `'`).
* Audit log for registrations, approvals, role/status changes, logins/failures, uploads, calibrations, measurement
  corrections, reviews, status/location changes, work orders, settings and rate versions, exports, reports and API keys.
* Logs redact authorization headers, cookies, API keys and password fields.
* Power BI: the client secret and Azure AD tokens never leave the server; embedding uses Microsoft's secure-embed URL
  (viewer's own login), so no embed token is sent to browsers. Analytics API keys are read-only, hashed and revocable.
* Configuration is validated at start-up; the server refuses to start with weak/missing secrets, and refuses
  `COOKIE_SECURE=false` in production.

## Operational recommendations

Serve everything over HTTPS (reverse proxy), keep MongoDB and the AI service on a private network, back up MongoDB and
`storage/`, rotate `JWT_*` and `AI_SERVICE_TOKEN` secrets periodically (rotating JWT secrets signs everyone out).
