# Visitor Resolve API: contract

**Status:** Proposed. Not built. Not frozen.
**Last updated:** 2026-11-11

This is the HTTP contract the client library codes against. It states what the
service must do, not how. It is hosted by Delivr. Which service hosts it and
how it is implemented are recorded outside this public repository.

Nothing in this file exists yet. Until the service ships, the client is built
and tested against the fixtures in section 9.1.

---

## 1. Purpose

Given one visitor IP address, return the single company that Delivr.ai entity
resolution associates with that address, or state that there is no confident
answer.

Server to server only. A browser never calls this endpoint.

## 2. Endpoint

```
POST {resolveUrl}
```

- HTTPS only. The request carries a secret and visitor addresses.
- The path is assigned by the service owner. The client takes the full URL as
  configuration.
- The call is a read. It changes nothing and is safe to repeat.

## 3. Authentication

```
X-Delivr-Resolve-Key: <secret>
```

- One shared secret per site, issued by Delivr.
- Each secret is bound to one or more `pixel_id` values.
- The service should be able to accept a current and a next secret at the
  same time, so a key can rotate without downtime.
- No CORS. No cookies are read. No cookies are set.

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
  "ip": "203.0.113.5",
  "pixel_id": "00000000-0000-4000-8000-000000000000",
  "gpc": false,
  "request_id": "b1f6c0f2-5a0e-4a53-9a5b-0d2f6f3f9c11"
}
```

| Field        | Required | Format                                                                                                                                                             |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ip`         | yes      | One address in canonical text form. IPv4 dotted decimal, or IPv6 lowercase compressed (RFC 5952). No port, no brackets, no zone id. IPv4-mapped IPv6 is never sent |
| `pixel_id`   | yes      | Opaque string, 1 to 64 characters                                                                                                                                  |
| `gpc`        | no       | Boolean. `true` when the visitor's request carried `Sec-GPC: 1`. Absent means `false`                                                                              |
| `request_id` | no       | 1 to 64 characters from `A-Z a-z 0-9 _ -`. Echoed back. For tracing only. It is not an idempotency key                                                             |

The client never sends an address in its blocked ranges (CLIENT-IP.md section
6). It may send documentation-range addresses in tests. The service must
still answer safely for any address.

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
  "company": {
    "domain": "acme.com",
    "name": "Acme Inc",
    "naics": "541511",
    "industry": "Custom Computer Programming Services",
    "hq_country": "US",
    "employee_range": "201-1000",
    "revenue_range": "$50M-$100M"
  },
  "confidence": { "share": 0.82, "companies_on_ip": 3 },
  "as_of": "2026-11-01",
  "request_id": "b1f6c0f2-5a0e-4a53-9a5b-0d2f6f3f9c11"
}
```

| Field                        | Required when matched | Format                                                             |
| ---------------------------- | --------------------- | ------------------------------------------------------------------ |
| `matched`                    | yes                   | Boolean                                                            |
| `company.domain`             | yes                   | Lowercase hostname. No scheme, no path, no `www.`, no trailing dot |
| `company.name`               | no                    | Text, up to 200 characters                                         |
| `company.naics`              | no                    | Digit string, 2 to 6 digits                                        |
| `company.industry`           | no                    | Text, up to 200 characters                                         |
| `company.hq_country`         | no                    | ISO 3166-1 alpha-2, uppercase                                      |
| `company.employee_range`     | no                    | Text, up to 50 characters                                          |
| `company.revenue_range`      | no                    | Text, up to 50 characters                                          |
| `confidence.share`           | no                    | Number from 0 to 1 inclusive                                       |
| `confidence.companies_on_ip` | no                    | Integer, 1 or more                                                 |
| `as_of`                      | no                    | `YYYY-MM-DD`                                                       |
| `request_id`                 | when sent             | The request's value                                                |

An unknown optional field is omitted. It is never `null` and never an empty
string.

### 200, not matched

```json
{
  "matched": false,
  "reason": "ambiguous",
  "confidence": { "share": 0.34, "companies_on_ip": 6 },
  "request_id": "..."
}
```

| `reason`                 | Meaning                                                     |
| ------------------------ | ----------------------------------------------------------- |
| `no_record`              | Delivr has no company for this address                      |
| `ambiguous`              | Several companies share the address and none clears the bar |
| `non_public_ip`          | The address is not a public, routable address               |
| `unsupported_ip_version` | The service cannot answer for this IP version               |
| `declined`               | The service declines to answer this request                 |

`reason` is required when `matched` is `false`. With `ambiguous`, the service
may include `confidence` for the top company, without naming it. The client
passes it through to the host, so the threshold can be tuned from real
traffic.

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
its circuit breaker is in SPEC sections 4 and 9. The client never retries
inside a page request.

## 6. Semantics

1. **One company or none.** An IP address can be shared by several companies.
   The service returns the top company only when its `share` is greater than
   or equal to a service-side threshold. Below that it answers `ambiguous`.
   The threshold is service configuration. Starting value: `0.5`. It is not
   validated yet and is expected to change.
2. **Delivr.ai resolution only.** The answer comes from Delivr.ai entity
   resolution data. There is no fallback to any third-party IP dataset
   (decided 2026-11-11). When Delivr has no confident answer the answer is
   `matched: false`.
3. **Company level only.** No person data in v1: no email, no hashed email,
   no name, no title.
4. **Rule inputs.** v1 rules match on `domain`, `naics` and `hq_country`.
   `industry`, `employee_range` and `revenue_range` are for display and
   debugging.
5. **No visitor side effects.** The call does not create or refresh a visitor
   cookie and does not record a visitor event.
6. **Deterministic within a snapshot.** The same `ip` and `gpc` return the
   same answer until `as_of` changes.

## 7. Latency and limits

| Item                     | Value                    | Status                   |
| ------------------------ | ------------------------ | ------------------------ |
| Client deadline          | 100 ms, network included | Client default           |
| Service p99, server side | 25 ms                    | Proposed. Not measured   |
| Rate limit               | Per key                  | Value set by the service |
| Daily quota              | Per key                  | Value set by the service |

When the p99 is measured, record the number here with the method, the request
count and the date.

The endpoint answers "which company is behind this address" for any address a
key holder sends. Rate limits and quotas are what stop it from being used as
a bulk lookup service.

## 8. Versioning

- New optional response fields may appear at any time. The client ignores
  fields it does not know.
- New `reason` values may appear at any time. The client treats an unknown
  `reason` as not matched.
- A breaking change gets a new path.
- v1 has one consumer. Changes are agreed directly between the two sides.
  There is no deprecation policy yet.
- **Freeze.** When both sides agree, the status line at the top of this file
  changes to `Frozen YYYY-MM-DD`, and open items R1 and R2 are answered in
  section 11. After that, changes are additive only.

## 9. Testing the contract

Two separate things. The client is tested against canned answers. The service
is tested against the formats in section 5 using real addresses. They cannot
share data, because a real service has no company for a documentation-range
address.

### 9.1 Client fixtures

In `contracts/resolve/fixtures/`. One JSON file each:

```json
{
  "name": "matched-full",
  "conforming": true,
  "request": { "ip": "203.0.113.10", "gpc": false },
  "response": {
    "status": 200,
    "headers": {
      "content-type": "application/json",
      "cache-control": "no-store"
    },
    "body": { "matched": true, "company": { "domain": "acme.com" } }
  },
  "delayMs": 0
}
```

- `response.rawBody`, a string, replaces `body` when the body is not JSON.
- Each fixture has its own address from a documentation range
  (`203.0.113.0/24`, `2001:db8::/32`).
- The mock server answers by `request.ip`. An address with no fixture gets
  `not-matched-no-record`. `delayMs` is how long the mock waits first.
- `conforming: false` marks a response a correct service never sends. Those
  exist to prove the client stays safe anyway.

| Fixture                              | Conforming | Covers                                                 |
| ------------------------------------ | ---------- | ------------------------------------------------------ |
| `matched-full`                       | yes        | Every company field present                            |
| `matched-domain-only`                | yes        | Only `domain` present                                  |
| `matched-ipv6`                       | yes        | An IPv6 request                                        |
| `matched-extra-fields`               | yes        | Unknown extra fields the client must ignore            |
| `matched-null-fields`                | no         | Optional fields sent as `null` or the wrong type       |
| `matched-domain-unnormalized`        | no         | `WWW.Acme.com.` as the domain. Client normalizes it    |
| `matched-no-domain`                  | no         | `matched: true` with no usable domain. Invalid body    |
| `not-matched-no-record`              | yes        | `reason: no_record`                                    |
| `not-matched-ambiguous`              | yes        | `reason: ambiguous` with `confidence`                  |
| `not-matched-non-public-ip`          | yes        | `reason: non_public_ip`                                |
| `not-matched-unsupported-ip-version` | yes        | `reason: unsupported_ip_version`                       |
| `not-matched-declined`               | yes        | `reason: declined`, for a request with `gpc: true`     |
| `not-matched-unknown-reason`         | no         | A `reason` this version of the contract does not list  |
| `not-matched-no-reason`              | no         | `matched: false` with no `reason`                      |
| `invalid-matched-missing`            | no         | A 200 with no `matched` field                          |
| `invalid-not-json`                   | no         | A 200 whose body is not JSON                           |
| `invalid-empty-body`                 | no         | A 200 with an empty body                               |
| `invalid-oversize-body`              | no         | A 200 whose body is over 16 KB. Client does not parse  |
| `error-400`                          | yes        | Rejected request                                       |
| `error-401`                          | yes        | Bad key                                                |
| `error-403`                          | yes        | Key not bound to the pixel id                          |
| `error-404`                          | yes        | Wrong path                                             |
| `error-413`                          | yes        | Body too large                                         |
| `error-415`                          | yes        | Wrong content type                                     |
| `error-429`                          | yes        | Rate limited, `Retry-After: 7`                         |
| `error-429-no-header`                | no         | Rate limited, no `Retry-After`. Client uses 30         |
| `error-429-large`                    | yes        | `Retry-After: 600`. Client clamps to 60                |
| `error-429-date`                     | no         | `Retry-After` as an HTTP date. Client uses 30          |
| `error-500`                          | yes        | Service failure                                        |
| `error-503`                          | yes        | Unavailable, `Retry-After: 5`                          |
| `redirect-302`                       | no         | A redirect. Client treats it as a network error        |
| `slow-200`                           | yes        | A valid answer after `delayMs: 300`. Hits the deadline |

### 9.2 Service conformance

Run by the service owner against the deployed service. The addresses are
chosen internally and are not stored in this repository.

`contracts/resolve/response.schema.json` is a JSON Schema for the section 5
bodies. Both it and the fixtures are Phase A tasks in the ROADMAP.

The schema allows properties it does not list, so additive fields pass. It
restricts `reason` to the five values in section 5, so a misspelled reason
fails. When the contract gains a reason, the schema changes in the same
commit.

| #   | Send                                                | Expect                                         |
| --- | --------------------------------------------------- | ---------------------------------------------- |
| C1  | A set of real public addresses                      | Every 200 body validates against the schema    |
| C2  | An address the owner knows should match             | `matched: true` with a valid `domain`          |
| C3  | A documentation-range address                       | 200, `matched: false`                          |
| C4  | A private address                                   | 200, `reason: non_public_ip`                   |
| C5  | The same request twice                              | The same answer                                |
| C6  | No key, then an unknown key                         | 401 both times                                 |
| C7  | A valid key with a `pixel_id` it is not bound to    | 403                                            |
| C8  | GET instead of POST                                 | 405                                            |
| C9  | `Content-Type: text/plain`                          | 415                                            |
| C10 | A body over 1 KB                                    | 413                                            |
| C11 | Malformed JSON, then an `ip` that is not an address | 400 both times                                 |
| C12 | Requests above the rate limit                       | 429 with `Retry-After` as whole seconds        |
| C13 | Any request                                         | `Cache-Control: no-store`, and no `Set-Cookie` |
| C14 | Any request                                         | A response body of 4 KB or less                |

## 10. Out of scope for v1

- Cookie or hashed email input
- Contact fields
- Audience membership
- Intent topics
- Visit history
- Batch lookups

## 11. Open items

For the service owner unless marked.

| #   | Item                                                            |
| --- | --------------------------------------------------------------- |
| R1  | Final path and public host                                      |
| R2  | Auth mechanism: shared secret as above, or another scheme       |
| R3  | Threshold value, after looking at the real `share` distribution |
| R4  | IPv6 coverage                                                   |
| R5  | When the service answers `declined`. Product owner decides      |
| R6  | Rate limit and quota values                                     |
| R7  | Whether the 25 ms server-side p99 is realistic                  |
| R8  | Which NAICS edition the `naics` field uses                      |
