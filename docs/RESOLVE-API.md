# Visitor Resolve API: contract

**Status:** Proposed. Not built. Not frozen.
**Last updated:** 2026-11-12

This is the HTTP contract the client library codes against. It states what the
service must do, not how. It is hosted by Delivr. Which service hosts it and
how it is implemented are recorded outside this public repository.

The building blocks exist today: the Delivr pixel sets a visitor cookie and
Delivr attaches hashed emails to it, and Delivr holds person and company
profiles keyed by hashed email. What does not exist is an endpoint that a
site's own server can call with the cookie and get an answer back. Until it
ships, the client is built and tested against the fixtures in section 9.1.

The previous version of this contract took an IP address. That was wrong for
Delivr, which identifies visitors from its pixel cookie. It is in git history.

---

## 1. Purpose

Given the Delivr pixel cookie a visitor's browser sent to a site, return the
role and company attributes of the person Delivr associates with that cookie,
or state that there is no answer.

Server to server only. A browser never calls this endpoint.

## 2. Endpoint

```
POST {resolveUrl}
```

- HTTPS only. The request carries a secret and a visitor identifier.
- The path is assigned by the service owner. The client takes the full URL as
  configuration.
- The call is a read. It changes nothing and is safe to repeat.

## 3. Authentication

```
X-Delivr-Resolve-Key: <secret>
```

- One shared secret per site, issued by Delivr.
- Each secret is bound to one or more `pixel_id` values.
- The service should accept a current and a next secret at the same time, so
  a key can rotate without downtime.
- No CORS. The service reads no cookies from this request and sets none.

## 4. Request

Headers:

| Header                 | Value                              | Required |
| ---------------------- | ---------------------------------- | -------- |
| `Content-Type`         | `application/json`                 | yes      |
| `Accept`               | `application/json`                 | no       |
| `X-Delivr-Resolve-Key` | The secret                         | yes      |
| `User-Agent`           | `delivr-personalization/<version>` | no       |

Body, at most 1 KB:

```json
{
  "cookie_id": "152345678901234567",
  "pixel_id": "00000000-0000-4000-8000-000000000000",
  "visitor_country": "US",
  "request_id": "b1f6c0f2-5a0e-4a53-9a5b-0d2f6f3f9c11"
}
```

| Field             | Required | Format                                                                                                             |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `cookie_id`       | yes      | The value of the visitor's pixel cookie, as a string. 1 to 19 digits, no leading zero, at most 9223372036854775807 |
| `pixel_id`        | yes      | Opaque string, 1 to 64 characters                                                                                  |
| `visitor_country` | no       | ISO 3166-1 alpha-2, uppercase. Where the visitor is now, as the site's edge reports it. Absent when unknown        |
| `request_id`      | no       | 1 to 64 characters from `A-Z a-z 0-9 _ -`. Echoed back. For tracing only. It is not an idempotency key             |

`cookie_id` is a string because the value does not fit in a JavaScript number.

The client never calls for a request that carries a Global Privacy Control
signal or lacks the site's consent, and never sends a `cookie_id` that fails
the format above (SPEC section 5, IDENTITY.md sections 3 to 5). The service has
no GPC duty of its own.

## 5. Responses

Every response has `Content-Type: application/json` and
`Cache-Control: no-store`. No intermediary may cache an answer. No response
sets a cookie.

A response body is at most 4 KB. The client stops reading at 16 KB and treats
anything longer as invalid.

### 200, matched

```json
{
  "matched": true,
  "person": {
    "seniority": "vp",
    "department": "finance"
  },
  "company": {
    "domain": "acme.com",
    "name": "Acme Inc",
    "naics": "522110",
    "country": "US",
    "industry": "Commercial Banking",
    "employee_range": "1,001 to 5,000",
    "revenue_range": "$500M to $1B"
  },
  "as_of": "2026-11-09",
  "request_id": "b1f6c0f2-5a0e-4a53-9a5b-0d2f6f3f9c11"
}
```

| Field                    | Required when matched       | Format                                                             |
| ------------------------ | --------------------------- | ------------------------------------------------------------------ |
| `matched`                | yes                         | Boolean                                                            |
| `person`                 | see below                   | Object                                                             |
| `person.seniority`       | no                          | One of `cxo`, `vp`, `director`, `manager`, `staff`                 |
| `person.department`      | no                          | Lowercase text, up to 100 characters. Known values in section 6    |
| `company`                | see below                   | Object                                                             |
| `company.domain`         | yes, when `company` is sent | Lowercase hostname. No scheme, no path, no `www.`, no trailing dot |
| `company.name`           | no                          | Text, up to 200 characters                                         |
| `company.naics`          | no                          | Digit string, 2 to 6 digits                                        |
| `company.country`        | no                          | ISO 3166-1 alpha-2, uppercase. The company's country on file       |
| `company.industry`       | no                          | Text, up to 200 characters                                         |
| `company.employee_range` | no                          | Text, up to 50 characters                                          |
| `company.revenue_range`  | no                          | Text, up to 50 characters                                          |
| `as_of`                  | no                          | `YYYY-MM-DD`, date of the profile data                             |
| `request_id`             | when sent                   | The request's value                                                |

A matched answer carries a `company` with a `domain`, or a `person` with at
least one field, or both. When the service has a profile but none of those
fields, it answers `no_profile` instead. An unknown optional field is omitted.
It is never `null` and never an empty string.

### 200, not matched

```json
{
  "matched": false,
  "reason": "no_identity",
  "request_id": "..."
}
```

| `reason`      | Meaning                                                                             |
| ------------- | ----------------------------------------------------------------------------------- |
| `no_identity` | No hashed email is attached to this cookie for this pixel, or the cookie is unknown |
| `no_profile`  | A hashed email is attached, but Delivr has no usable person or company attributes   |
| `pending`     | A profile exists but is not ready to serve yet. A later request may match           |
| `declined`    | The service declines to answer this request                                         |

`reason` is required when `matched` is `false`.

`no_identity` covers both an unknown cookie and a known cookie with nothing
attached. The service does not distinguish the two.

A miss is a 200, not a 404. The client must be able to tell "no answer" from
"service broken".

### Other statuses

| Status | When                                                         | Extra header                   |
| ------ | ------------------------------------------------------------ | ------------------------------ |
| 400    | Body is not valid JSON, or a field breaks its format         |                                |
| 401    | Missing or unknown key                                       |                                |
| 403    | Key is not bound to `pixel_id`, or the site is not permitted |                                |
| 404    | Wrong path                                                   |                                |
| 405    | Method is not POST                                           |                                |
| 413    | Body over 1 KB                                               |                                |
| 415    | `Content-Type` is not `application/json`                     |                                |
| 429    | Rate limit or quota hit                                      | `Retry-After`, integer seconds |
| 500    | Service failure                                              |                                |
| 503    | Service unavailable                                          | `Retry-After`, integer seconds |

Error bodies are `{ "error": "<short code>", "request_id": "..." }`. The
client does not depend on the body.

For every non-200 status, every timeout and every body it cannot validate,
the client renders default content. How it treats each case for caching and
its circuit breaker is in SPEC sections 5 and 10. The client never retries
inside a page request.

## 6. Semantics

1. **One person or none.** A cookie can carry several hashed emails. The
   service answers for one person at most. Which one it picks is service
   policy.
2. **Delivr.ai data only.** Identity and attributes come from Delivr.ai's own
   pixel and entity resolution data. There is no fallback to any third-party
   dataset (decided 2026-11-11).
3. **No direct identifiers.** The response never carries an email, a hashed
   email, a name, a phone number, a postal address, a job title or a profile
   URL. It carries only the attributes used to choose content.
4. **Rule inputs.** v1 rules match on `company.domain`, `company.naics`,
   `company.country`, `person.seniority` and `person.department`.
   `company.name`, `company.industry`, `company.employee_range` and
   `company.revenue_range` are for display and debugging.
5. **Department values.** The known values are: `administrative`,
   `community and social services`, `customer service`, `education`,
   `engineering`, `executive`, `finance`, `health services`,
   `human resources`, `information technology`, `legal`, `marketing`,
   `media and communications`, `operations`, `product management`, `sales`.
   Other lowercase values can occur. The client passes them through.
6. **Bound to the pixel.** The service answers only for a cookie that the key's
   pixel has seen. Any other cookie gets `no_identity`. Required before any
   visitor can see personalized content, and before any second site receives
   a key (ROADMAP Phase D, stage 2).
7. **Regional policy.** The service applies the same regional identity policy
   the Delivr pixel applies when it collects data, using `visitor_country`.
   What it does when `visitor_country` is absent is service policy (R5). A
   request it will not answer gets `declined`. The finer reason stays in the
   service's own metrics.
8. **No visitor side effects.** The call does not create or refresh a visitor
   cookie, does not attach an identity to a cookie, and does not record a
   visitor event.
9. **Stable within a short window.** The same request returns the same answer
   until an identity is attached to the cookie or the profile data changes.
   `pending` becomes a match or another miss within 60 seconds.

## 7. Latency and limits

| Item                     | Value                    | Status                   |
| ------------------------ | ------------------------ | ------------------------ |
| Client deadline          | 100 ms, network included | Client default and cap   |
| Service p99, server side | 25 ms                    | Proposed. Not measured   |
| `pending` resolved       | within 60 s              | Proposed. Not measured   |
| Rate limit               | Per key                  | Value set by the service |
| Daily quota              | Per key                  | Value set by the service |

The 25 ms target means the answer must come from data the service already
holds in fast storage. A profile that is not there yet is fetched in the
background, and the request is answered `pending` instead of waiting.

When the p99 is measured, record the number here with the method, the request
count and the date.

The endpoint maps a cookie value to a person's role and employer. Pixel
binding (section 6 point 6), rate limits and quotas are what stop a key holder,
or a visitor sending made-up cookies through a site, from using it to look up
arbitrary visitors.

## 8. Versioning

- New optional response fields may appear at any time. The client ignores
  fields it does not know.
- New `reason` values may appear at any time. The client treats an unknown
  `reason` as not matched.
- A new `seniority` value needs a new contract version, because the client
  drops values it does not know.
- A breaking change gets a new path.
- v1 has one consumer. Changes are agreed directly between the two sides.
- **Freeze.** When both sides agree, the status line at the top changes to
  `Frozen YYYY-MM-DD`, and open items R1, R2 and R7 are answered in section 11. The other open items do not change the wire format. After the freeze,
  changes are additive only.

## 9. Testing the contract

The client is tested against canned answers. The service is tested against
the formats in section 5 using real cookies. They cannot share data, because
a real service has no profile for a made-up cookie.

### 9.1 Client fixtures

In `contracts/resolve/fixtures/`. One JSON file each:

```json
{
  "name": "matched-full",
  "conforming": true,
  "request": { "cookie_id": "9000000000000000001", "visitor_country": "US" },
  "response": {
    "status": 200,
    "headers": {
      "content-type": "application/json",
      "cache-control": "no-store"
    },
    "body": {
      "matched": true,
      "person": { "seniority": "vp", "department": "finance" },
      "company": { "domain": "acme.com", "naics": "522110", "country": "US" }
    }
  },
  "delayMs": 0
}
```

- `response.rawBody`, a string, replaces `body` when the body is not JSON.
- Each fixture has its own `cookie_id`, a 19-digit value starting `9000`.
  Values from `9000000000000000000` up are reserved for fixtures.
- The mock server answers by `request.cookie_id`. A cookie with no fixture
  gets `not-matched-no-identity`. `delayMs` is how long the mock waits first.
- `conforming: false` marks a response a correct service never sends. Those
  exist to prove the client stays safe anyway.

| Fixture                       | Conforming | Covers                                                                                             |
| ----------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| `matched-full`                | yes        | Every person and company field present                                                             |
| `matched-company-only`        | yes        | `company` with only `domain`, no `person`                                                          |
| `matched-person-only`         | yes        | `person` only, no `company`                                                                        |
| `matched-other-department`    | yes        | A department outside the known list. Client passes it through                                      |
| `matched-extra-fields`        | yes        | Unknown extra fields the client must ignore                                                        |
| `matched-null-fields`         | no         | Optional fields sent as `null` or the wrong type                                                   |
| `matched-domain-unnormalized` | no         | `WWW.Acme.com.` as the domain. Client normalizes it                                                |
| `matched-bad-seniority`       | no         | `seniority: "ceo"`. Client drops the field                                                         |
| `matched-company-no-domain`   | no         | `company` with no usable domain, plus a valid `person`. Client drops `company` and keeps the match |
| `matched-nothing-usable`      | no         | `matched: true` with no usable `person` or `company`. Client treats it as `no_profile`             |
| `not-matched-no-identity`     | yes        | `reason: no_identity`                                                                              |
| `not-matched-no-profile`      | yes        | `reason: no_profile`                                                                               |
| `not-matched-pending`         | yes        | `reason: pending`                                                                                  |
| `not-matched-declined`        | yes        | `reason: declined`                                                                                 |
| `not-matched-unknown-reason`  | no         | A `reason` this version of the contract does not list                                              |
| `not-matched-no-reason`       | no         | `matched: false` with no `reason`                                                                  |
| `invalid-matched-missing`     | no         | A 200 with no `matched` field                                                                      |
| `invalid-not-json`            | no         | A 200 whose body is not JSON                                                                       |
| `invalid-empty-body`          | no         | A 200 with an empty body                                                                           |
| `invalid-oversize-body`       | no         | A 200 whose body is over 16 KB. Client does not parse it                                           |
| `error-400`                   | yes        | Rejected request                                                                                   |
| `error-401`                   | yes        | Bad key                                                                                            |
| `error-403`                   | yes        | Key not bound to the pixel id                                                                      |
| `error-404`                   | yes        | Wrong path                                                                                         |
| `error-413`                   | yes        | Body too large                                                                                     |
| `error-415`                   | yes        | Wrong content type                                                                                 |
| `error-429`                   | yes        | Rate limited, `Retry-After: 7`                                                                     |
| `error-429-no-header`         | no         | Rate limited, no `Retry-After`. Client uses 30                                                     |
| `error-429-large`             | yes        | `Retry-After: 600`. Client clamps to 60                                                            |
| `error-429-date`              | no         | `Retry-After` as an HTTP date. Client uses 30                                                      |
| `error-500`                   | yes        | Service failure                                                                                    |
| `error-503`                   | yes        | Unavailable, `Retry-After: 5`                                                                      |
| `redirect-302`                | no         | A redirect. Client treats it as a network error                                                    |
| `slow-200`                    | yes        | A valid answer after `delayMs: 300`. Hits the deadline                                             |
| `status-204`                  | no         | A 204 with no body. Treated like an invalid body                                                   |
| `network-error`               | no         | The mock resets the connection. Treated as a network error                                         |

### 9.2 Service conformance

Run by the service owner against the deployed service. The cookies used are
chosen internally and are not stored in this repository.

`contracts/resolve/response.schema.json` is a JSON Schema for the section 5
bodies. Both it and the fixtures are Phase A tasks in the ROADMAP.

The schema allows properties it does not list, so additive fields pass. It
restricts `reason` to the four values in section 5 and `seniority` to its five
values, so a misspelling fails. When the contract gains a value, the schema
changes in the same commit.

| #   | Send                                                           | Expect                                              |
| --- | -------------------------------------------------------------- | --------------------------------------------------- |
| C1  | A set of real cookies seen by the pixel                        | Every 200 body validates against the schema         |
| C2  | A cookie the owner knows has an identity and a profile         | `matched: true`                                     |
| C3  | A fixture cookie value                                         | 200, `reason: no_identity`                          |
| C4  | The same matched request twice                                 | The same answer                                     |
| C5  | No key, then an unknown key                                    | 401 both times                                      |
| C6  | A valid key with a `pixel_id` it is not bound to               | 403                                                 |
| C7  | GET instead of POST                                            | 405                                                 |
| C8  | `Content-Type: text/plain`                                     | 415                                                 |
| C9  | A body over 1 KB                                               | 413                                                 |
| C10 | Malformed JSON, then a `cookie_id` with a letter in it         | 400 both times                                      |
| C11 | Requests above the rate limit                                  | 429 with `Retry-After` as whole seconds             |
| C12 | Any request                                                    | `Cache-Control: no-store`, and no `Set-Cookie`      |
| C13 | Any request                                                    | A response body of 4 KB or less                     |
| C14 | Every matched body from C1                                     | No field from the section 6 point 3 list            |
| C15 | A real cookie with an identity, seen only by a different pixel | 200, `reason: no_identity`                          |
| C16 | A cookie the service answered `pending` for                    | Within 60 s, a request gets a match or another miss |

## 10. Out of scope for v1

- IP address input
- Direct identifiers in the response (section 6 point 3)
- Audience membership
- Intent topics
- Visit history
- Batch lookups

## 11. Open items

For the service owner unless marked.

| #   | Item                                                                                            |
| --- | ----------------------------------------------------------------------------------------------- |
| R1  | Final path and public host                                                                      |
| R2  | Auth mechanism: shared secret as above, or another scheme                                       |
| R3  | Which person to answer for when a cookie carries several hashed emails                          |
| R4  | How pixel binding (section 6 point 6) is recorded                                               |
| R5  | When the service answers `declined`, including with no `visitor_country`. Product owner decides |
| R6  | Rate limit and quota values                                                                     |
| R7  | Whether 25 ms p99 and 60 s `pending` are achievable. Answered before the freeze                 |
| R8  | Which NAICS edition the `naics` field uses                                                      |
| R9  | Whether `company.country` is the headquarters country or another address                        |
