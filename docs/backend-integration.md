# Backend Integration and Handoff Specification

## 1. Scope and Owned Deliverables

This document details the backend integration specification for Tom's deliverables in the arcus-photobooth-system repository. Tom owns the realtime connection tracking, upload presigning, sample event assets, delivery verification utilities, and the end-to-end integration test runner.

### Files Implemented

- `services/ws-connect/index.mjs`: API Gateway WebSocket `$connect` route Lambda handler. Validates `photoId` from scalar and multi-value query strings, registers connection, sets one-hour TTL, preserves status atomically on reconnect, and rejects expired jobs.
- `services/ws-connect/validate-photo-id.mjs`: Shared UUID v4 validation logic enforcing version 4 and RFC 4122 variant bits.
- `services/ws-connect/package.json`: Service manifest, runtime dependencies (`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`), and test scripts.
- `services/ws-connect/package-lock.json`: Deterministic dependency lockfile.
- `services/ws-connect/test/handler.test.mjs`: Offline unit tests covering connect registration, multi-value query validation, reconnect status preservation, expiration guard, input validation, and DynamoDB errors.
- `services/ws-disconnect/index.mjs`: API Gateway WebSocket `$disconnect` route Lambda handler. Queries reverse index by `connectionId`, performs conditional removal of `connectionId`, and preserves photo record and processing state.
- `services/ws-disconnect/validate-photo-id.mjs`: UUID v4 validator included within service boundary for self-containment.
- `services/ws-disconnect/package.json`: Service manifest and runtime dependencies.
- `services/ws-disconnect/package-lock.json`: Deterministic dependency lockfile.
- `services/ws-disconnect/test/handler.test.mjs`: Offline unit tests covering mapping lookup, pagination, stale socket disconnection safety, retry logic, and error handling.
- `services/presign/index.mjs`: S3 presigned PUT URL generator. Validates HTTP method, media type with parameters, strict base64 format, payload size, JSON shape, and photoId; configures `requestChecksumCalculation: "WHEN_REQUIRED"` and signs `Content-Type: image/jpeg` and `host`.
- `services/presign/delivery-url.mjs`: URL construction and validation utility for CloudFront delivery. Enforces domain format and key constraints (`final/{photoId}.jpg`).
- `services/presign/validate-photo-id.mjs`: UUID v4 validation logic.
- `services/presign/package.json`: Service manifest, dependencies (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`), test runner scripts, and devDependencies (`ws`, `jpeg-js`).
- `services/presign/package-lock.json`: Deterministic dependency lockfile.
- `services/presign/test/handler.test.mjs`: Offline unit tests covering presigning with real local S3Client signing without empty-body checksum, CORS, media-type parsing, base64 validation, size limits, and S3 signing errors.
- `services/presign/test/delivery-url.test.mjs`: Unit tests verifying valid delivery URL generation and rejection of malformed domains or paths.
- `services/presign/test/validate-photo-id.test.mjs`: Unit tests for UUID v4 validation including version and variant checks.
- `services/presign/test/assets.test.mjs`: Verification tests for sample event asset existence, PNG structure, canvas dimensions, RGBA color type, and transparent opening.
- `services/presign/test/e2e-runner.mjs`: Executable integration test runner script supporting overall deadline enforcement via AbortController, safe message shape validation, and genuine JPEG decoding.
- `services/presign/test/e2e-runner.test.mjs`: Complete offline test suite exercising the end-to-end runner against local mock WebSocket and HTTP servers, covering stalled requests, message shapes, and corrupted JPEGs.
- `services/presign/test/generate-assets.mjs`: Script to generate valid sample PNG assets with transparent center opening.
- `assets/frames/sample-event-001/frame.png`: Sample 1200x1600 RGBA frame PNG with transparent subject cutout.
- `assets/backgrounds/sample-event-001/background.png`: Sample 1200x1600 opaque background PNG.
- `docs/backend-integration.md`: Complete technical specification, verification evidence, and handoff contracts.

---

## 2. Execution and Testing Commands

### Installation

Use Node.js 24 and install the locked dependencies locally within each service:

```bash
cd services/ws-connect && npm ci
cd ../ws-disconnect && npm ci
cd ../presign && npm ci
```

### Offline Automated Testing

Run the offline test suite for each service (no AWS credentials or network access required):

```bash
# In services/ws-connect:
cd services/ws-connect
npm test

# In services/ws-disconnect:
cd services/ws-disconnect
npm test

# In services/presign:
cd services/presign
npm test
```

### Packaging for Deployment

Each service is packaged independently with production dependencies. Create `dist/` at the repository root before packaging. Run the offline tests before replacing development dependencies with production-only dependencies:

```bash
# ws-connect:
cd services/ws-connect
npm ci --omit=dev
zip -r ../../dist/ws-connect.zip index.mjs validate-photo-id.mjs package.json node_modules/

# ws-disconnect:
cd services/ws-disconnect
npm ci --omit=dev
zip -r ../../dist/ws-disconnect.zip index.mjs validate-photo-id.mjs package.json node_modules/

# presign:
cd services/presign
npm ci --omit=dev
zip -r ../../dist/presign.zip index.mjs delivery-url.mjs validate-photo-id.mjs package.json node_modules/
```

### Opt-In Live End-to-End Testing

The end-to-end runner (`services/presign/test/e2e-runner.mjs`) is an opt-in test against deployed AWS infrastructure. It connects to the live WebSocket API, requests a presigned URL, uploads a test JPEG, waits for processing completion over WebSocket, fetches the final composited image from CloudFront, and validates image decoding.

To execute against live infrastructure:

```bash
cd services/presign
export WS_URL="wss://<api-id>.execute-api.<region>.amazonaws.com/<stage>"
export PRESIGN_URL="https://<api-id>.execute-api.<region>.amazonaws.com/<stage>/presign"
export CLOUDFRONT_DOMAIN="<distribution-id>.cloudfront.net"
export TEST_IMAGE_PATH="/path/to/test-subject.jpg"
export TEST_TIMEOUT_MS=60000

npm run test:e2e
```

---

## 3. Handler Specifications and Payload Formats

| Service | File Entry Point | Exported Handler | Trigger / Event Format |
|---|---|---|---|
| `ws-connect` | `services/ws-connect/index.mjs` | `handler` | API Gateway WebSocket `$connect` route (v1 proxy event) |
| `ws-disconnect` | `services/ws-disconnect/index.mjs` | `handler` | API Gateway WebSocket `$disconnect` route (v1 proxy event) |
| `presign` | `services/presign/index.mjs` | `handler` | API Gateway HTTP API (v2 payload) or REST API (v1 payload) POST |

### Event Formats Handled

- `ws-connect`:
  - `event.requestContext.connectionId`: string (extracted directly from connection context).
  - `event.queryStringParameters.photoId`: string (scalar query parameter).
  - `event.multiValueQueryStringParameters.photoId`: string array (when provided by API Gateway). Duplicate, conflicting, or malformed multi-value query parameters return HTTP 400 without writing to DynamoDB.
- `ws-disconnect`:
  - `event.requestContext.connectionId`: string. (`photoId` is absent in disconnect events).
- `presign`:
  - Supports both REST API v1 (`event.httpMethod`, `event.headers`, `event.body`) and HTTP API v2 (`event.requestContext.http.method`, `event.headers`, `event.body`, `event.isBase64Encoded`).
  - Supports media types with parameters, such as `application/json; charset=utf-8`. Rejects `application/jsonp` and non-JSON media types with HTTP 415.
  - Supports strict base64 payloads; invalid base64 characters or padding return HTTP 400. Decoded payloads exceeding 4 KB return HTTP 413.

---

## 4. Environment Variables Matrix

| Environment Variable | Service | Required | Default / Description |
|---|---|---|---|
| `TABLE_NAME` | `ws-connect`, `ws-disconnect` | Yes | DynamoDB table name storing photo session state. |
| `CONNECTION_INDEX_NAME` | `ws-disconnect` | Yes | GSI name on the DynamoDB table (recommended: `connectionId-index`). |
| `BUCKET_NAME` | `presign` | Yes | S3 bucket name where raw photos are uploaded. |
| `ALLOWED_ORIGIN` | `presign` | No | Allowed web origin for CORS header reflection (e.g. `https://kiosk.arcus.org`). |
| `WS_URL` | `e2e-runner` | Yes (live) | Target WebSocket API URL (`wss://...`). |
| `PRESIGN_URL` | `e2e-runner` | Yes (live) | Target HTTP URL for presign Lambda (`https://.../presign`). |
| `CLOUDFRONT_DOMAIN` | `e2e-runner` | Yes (live) | Target CloudFront domain for final image delivery. |
| `TEST_IMAGE_PATH` | `e2e-runner` | Yes (live) | Local path to valid JPEG test image. |
| `TEST_TIMEOUT_MS` | `e2e-runner` | No (live) | Overall test timeout in ms (default: `60000`). Must be positive integer. |

---

## 5. Protocols and Contracts

### Photo ID Format

All backend services mandate lowercase UUID v4 matching:
`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`

- The 13th character must be `4` (version 4).
- The 17th character must be `8`, `9`, `a`, or `b` (RFC 4122 variant 1).
- Non-v4 UUIDs, all-zero UUIDs, uppercase characters, path traversals (`..`), slashes, backslashes, and malformed strings are rejected with HTTP 400.
- Joel's kiosk UI must generate `photoId` via `crypto.randomUUID()` and reuse this exact identifier across connect, presign, and result handling.

### WebSocket Connect Handshake

- Request URL: `wss://<endpoint>?photoId=<photoId>`
- Success Response: HTTP 200 (Connection accepted).
- Error Response: HTTP 400 (Bad request / invalid or ambiguous photo ID), HTTP 409 (Job expired), HTTP 500 (Server / database configuration error).
- Note: The `$connect` handler completes synchronously before the socket opens. No messages are sent over the socket during `$connect`.

### HTTP POST /presign Request and Response

- Request:
  - Method: `POST`
  - Path: `/presign`
  - Headers: `Content-Type: application/json` (or with parameters such as `charset=utf-8`)
  - Body:
    ```json
    {
      "photoId": "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d",
      "expiresIn": 180
    }
    ```
    (`expiresIn` is optional, integer between 60 and 300; default is 180 seconds).
- Success Response (HTTP 200):
  - Headers: `Content-Type: application/json`, `Cache-Control: no-store`
  - Body:
    ```json
    {
      "uploadUrl": "https://<bucket>.s3.<region>.amazonaws.com/raw/a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d.jpg?X-Amz-...",
      "key": "raw/a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d.jpg",
      "expiresIn": 180,
      "headers": {
        "Content-Type": "image/jpeg"
      }
    }
    ```
- Presigning Configuration:
  - S3Client configured with `requestChecksumCalculation: "WHEN_REQUIRED"` so the SDK does not bind the signed PUT URL to an empty-body checksum (`x-amz-checksum-crc32=AAAAAA==`).
  - Presigner configured with `signableHeaders: new Set(["content-type", "host"])` so that `Content-Type: image/jpeg` is included in `X-Amz-SignedHeaders`.
  - Cryptographic header signing ensures S3 requires `Content-Type: image/jpeg` during the direct upload; it does NOT inspect uploaded bytes (the presign Lambda never receives the photo bytes; decoding and byte validation occurs downstream in the processing service).
- Error Responses:
  - 400: Malformed JSON, extra unknown fields, invalid base64, or invalid `photoId`.
  - 405: Non-POST/OPTIONS method (includes `Allow: POST, OPTIONS`).
  - 413: Body or decoded base64 larger than 4 KB.
  - 415: Missing or non-JSON `Content-Type` (e.g. `application/jsonp`).
  - 500: Server configuration or signer failure.

### S3 Direct Upload

- Method: `PUT`
- URL: `uploadUrl` from presign response.
- Headers: Must include all headers returned in the presign response (specifically `Content-Type: image/jpeg`).
- Body: Raw JPEG binary image bytes.

### WebSocket Processing Notifications (Sent by Leyton's process-photo Lambda)

- Success notification:
  ```json
  { "status": "done", "key": "final/a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d.jpg" }
  ```
- Error notification:
  ```json
  { "status": "error", "message": "Failed to process photo" }
  ```

### Final Image Delivery

Final image retrieval uses CloudFront with S3 Origin Access Control (OAC):
- URL construction: `https://${CLOUDFRONT_DOMAIN}/final/${photoId}.jpg`
- The helper `buildDeliveryUrl(domain, key)` in `services/presign/delivery-url.mjs` enforces this contract.

---

## 6. State Management and Concurrency Policies

### DynamoDB Table Schema

- Table Name: Provided via `TABLE_NAME`.
- Partition Key: `photoId` (String).
- TTL Attribute: `ttl` (Number, Unix epoch seconds).
- Attributes:
  - `connectionId`: String (current active WebSocket connection ID).
  - `status`: String (`connected`, `processing`, `done`, `error`).
  - `ttl`: Number (Unix epoch seconds = `now + 3600`).

### Reverse Lookup GSI (Prerequisite for Ryan)

Because the `$disconnect` event only contains `connectionId`, a reverse lookup GSI is required:
- Index Name: Provided via `CONNECTION_INDEX_NAME` (recommended: `connectionId-index`).
- Partition Key: `connectionId` (String).
- Projected Attributes: `KEYS_ONLY` (the base table's `photoId` is automatically projected).

### Connect Concurrency & Status Preservation

In `services/ws-connect`:
- Uses `UpdateCommand` with atomic expression:
  ```
  SET connectionId = :cid, #ttl = :ttl, #st = if_not_exists(#st, :initial_status)
  ConditionExpression: attribute_not_exists(photoId) OR #ttl >= :now_epoch
  ```
- New photos: Initializes `status = "connected"` and sets `ttl = now + 3600`.
- Existing unexpired photos: Renews `connectionId` and `ttl`, while `if_not_exists(#st, :initial_status)` strictly preserves existing status (`processing`, `done`, `error`) and extra result attributes.
- Expired records: `ConditionExpression` rejects re-registration with HTTP 409, preventing stale jobs from being revived.

### Disconnect Safety and Stale Socket Protection

In `services/ws-disconnect`:
- Queries the GSI by `connectionId`.
- Includes an initial lookup and up to 3 retries with delays of 150, 300, and 450 ms to mitigate DynamoDB GSI eventual consistency lag.
- For each matching item, executes conditional update:
  ```
  REMOVE connectionId
  ConditionExpression: attribute_exists(photoId) AND connectionId = :cid
  ```
- If socket A disconnects after client reconnects on socket B, the condition `connectionId = :cid` fails harmlessly. Socket B remains active.
- Does NOT delete the photo record or alter processing status.

---

## 7. Least-Privilege IAM Policies

### 1. `ws-connect` Lambda Execution Role

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DynamoDBConnectUpdate",
      "Effect": "Allow",
      "Action": [
        "dynamodb:UpdateItem"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/${TABLE_NAME}"
    }
  ]
}
```

### 2. `ws-disconnect` Lambda Execution Role

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DynamoDBGSIQuery",
      "Effect": "Allow",
      "Action": [
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/${TABLE_NAME}/index/${CONNECTION_INDEX_NAME}"
    },
    {
      "Sid": "DynamoDBDisconnectUpdate",
      "Effect": "Allow",
      "Action": [
        "dynamodb:UpdateItem"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/${TABLE_NAME}"
    }
  ]
}
```

### 3. `presign` Lambda Execution Role

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3PresignPutObject",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::${BUCKET_NAME}/raw/*"
    }
  ]
}
```

---

## 8. Team Handoffs and Prerequisites

### Infrastructure Owner (Ryan)

1. **DynamoDB GSI**: Provision the Global Secondary Index on the sessions table with partition key `connectionId` (String).
2. **DynamoDB TTL**: Enable native TTL on the attribute named `ttl`.
3. **S3 Upload CORS**: Configure CORS on the S3 bucket allowing browser `PUT` requests from the kiosk origin:
   - AllowedMethods: `["PUT"]`
   - AllowedHeaders: `["Content-Type"]`
   - AllowedOrigins: Kiosk web origin (e.g. `https://kiosk.arcus.org`).
4. **API Gateway Endpoints**:
   - WebSocket `$connect` and `$disconnect` integrated with respective Lambda handlers.
   - HTTP route `POST /presign` integrated with presign Lambda handler.
   - Route `OPTIONS /presign` to the handler or configure equivalent API Gateway preflight responses. Set `ALLOWED_ORIGIN` to the exact kiosk origin for handler-managed CORS, and keep API Gateway CORS consistent with it.
   - Grant API Gateway permission to invoke each Lambda and grant the execution roles CloudWatch logging permissions alongside the service-specific policies above.
5. **CloudFront OAC**: Ensure CloudFront can read from `final/*` only using S3 Origin Access Control. Ensure `raw/*` and `assets/*` are not accessible via CloudFront.

### Frontend Owner (Joel)

1. **Photo ID**: Generate a lowercase UUID v4 using `crypto.randomUUID()`. Reuse this exact identifier throughout the session.
2. **Order of Operations**:
   - Establish WebSocket connection to `wss://<endpoint>?photoId=<photoId>`.
   - Wait for socket `onopen` before initiating upload.
   - Send `POST /presign` with `{ "photoId": "<photoId>" }`.
   - Upload image binary directly to `uploadUrl` via HTTP `PUT` with `Content-Type: image/jpeg`.
3. **Result Handling**:
   - Listen for `{ "status": "done", "key": "final/<photoId>.jpg" }`.
   - Construct display URL using `https://${CLOUDFRONT_DOMAIN}/${key}`.

### Processing Owner (Leyton)

1. **Trigger Filter**: Ensure the S3 event trigger fires only on prefix `raw/` and suffix `.jpg` to prevent infinite loops.
2. **Status Lifecycle**: Transition DynamoDB status from `processing` to `done` (or `error`).
3. **Lookup Timing**: Look up `connectionId` from DynamoDB immediately prior to sending notification via `PostToConnection`.
4. **Connection Handling**: Catch and ignore `GoneException` (410) if the kiosk disconnects before processing finishes. Do not discard the final image or set photo status to error if only the notification delivery failed.

---

## 9. Security and Operational Notes

- **Photo ID Limitation**: The `photoId` maps an upload to an active socket; it does not provide authentication or multi-tenant authorization. In an event setting with a dedicated kiosk, this is standard; for untrusted multi-client environments, session authentication tokens should be evaluated.
- **Direct Upload Inspection**: S3 presigned PUT cryptographically signs the `Content-Type` header passed during signing, but does not inspect uploaded file bytes. The downstream processing service must validate the JPEG file header and decode validity before feeding bytes to Sharp or Bedrock.
- **Eventual TTL Cleanup**: DynamoDB TTL deletion occurs asynchronously (typically within 48 hours). The `$connect` handler explicitly checks `#ttl >= :now_epoch` to guarantee application-level expiry enforcement regardless of DynamoDB deletion latency.

---

## 10. Assignment Coverage, Verification Evidence, and Status

### Core Tasks Status

1. **$connect Lambda**:
   - Status: Implemented; offline tests passed; live integration pending.
   - Verification: 19 unit tests passing. Verifies connection registration, epoch TTL, status preservation via `if_not_exists`, expired record rejection, and multi-value query parameter duplicate/conflict rejection with 0 DynamoDB calls.
   - External dependencies: Ryan (DynamoDB table, API Gateway route integration, IAM role).
2. **$disconnect Lambda**:
   - Status: Implemented; offline tests passed; live integration pending.
   - Verification: 12 unit tests passing. Verifies reverse GSI query, pagination, conditional removal, stale socket protection, and bounded retry.
   - External dependencies: Ryan (GSI on `connectionId`, route integration, IAM role).
3. **Presigned URL Lambda**:
   - Status: Implemented; offline tests passed; live integration pending.
   - Verification: 45 unit tests passing. Verifies local S3Client signing without empty-body checksum, signed content-type and host headers, media-type parsing with parameters, strict base64 decoding, size limits, and UUID v4 validation.
   - External dependencies: Ryan (HTTP route, S3 bucket CORS for browser PUT).
4. **Final-Image Delivery**:
   - Status: Implemented; offline tests passed; live integration pending.
   - Verification: 11 unit tests passing. Verifies CloudFront URL construction and strict validation against malformed domains and keys.
   - External dependencies: Ryan (CloudFront with OAC), Joel (kiosk display integration).
5. **Photo ID and Status Coordination**:
   - Status: Implemented; offline tests passed; live integration pending.
   - Verification: Enforces UUID v4 format across handlers and coordinates atomic `connected`/`processing`/`done`/`error` transitions.
   - External dependencies: Joel (UUID v4 generation), Leyton (processing status transitions).
6. **End-to-End Test Script**:
   - Status: Implemented; offline tests passed; live integration pending.
   - Verification: 19 offline mock tests passing. Verifies overall deadline cancellation with AbortController on stalled requests and response bodies, safe handling of malformed message shapes (JSON null, arrays, primitives), genuine JPEG decoding with `jpeg-js`, and corrupted image rejection.
   - External dependencies: Live AWS deployment for live execution.
7. **First-Event Sample Frames and Backgrounds**:
   - Status: Implemented; offline tests passed; live integration pending.
   - Verification: 8 tests passing. Verifies PNG headers, dimensions (1200x1600), RGBA color type, and transparent center cutout opening.
   - External dependencies: Ryan (S3 asset upload), Leyton (Sharp compositing pipeline).

### Quality and Architecture Checks

| Quality Check | Status | Evidence / Notes |
|---|---|---|
| S3 Presign Checksum Calculation | Verified | `S3Client` configured with `requestChecksumCalculation: "WHEN_REQUIRED"`. Verified no auto-generated empty-body checksum is added to the signed PUT URL. |
| Signed Header Enforcement | Verified | Presigner configured with `signableHeaders: new Set(["content-type", "host"])`. Verified `X-Amz-SignedHeaders` contains `content-type` and `host`. |
| Content-Type Enforcement vs Image Inspection | Verified | Documented distinction: signing enforces declared header during upload; byte validation and decoding occurs downstream in processing service. |
| Overall Deadline Enforcement | Verified | Runner coordinates all HTTP requests and socket lifecycles with `AbortController` and single deadline timer; verified against stalled requests and body streams. |
| WebSocket Message Shape Safety | Verified | Runner validates object type, non-null, string status, and expected key format; verified that malformed messages are ignored without crashing. |
| Multi-Value Query Parameter Handling | Verified | `ws-connect` inspects `multiValueQueryStringParameters`, rejecting duplicate or conflicting `photoId` values before touching DynamoDB. |
| Media-Type & Base64 Validation | Verified | `presign` accepts `application/json; charset=utf-8`, rejects `application/jsonp` (415), enforces strict base64 character set and padding (400/413). |
| Genuine JPEG Test Fixture & Decoder | Verified | Runner tests use genuine decodable 1x1 JPEG fixture and decode input/output with `jpeg-js`, rejecting truncated and corrupt buffers. |
| Lowercase UUID v4 Enforcement | Verified | Validator enforces version 4 (`4...`) and RFC 4122 variant 1 (`[89ab]...`), rejecting all-zero ID, version 1, and uppercase characters. |
| Packaging and Modularity | Verified | All three services import cleanly without cross-service dependencies; root `.gitignore` prevents committing `node_modules/`. |

### Summary of Automated Test Results

Running `npm test` in each service with Node.js v24.12.0 and npm 11.6.2 passed all 114 tests, with no failures, cancellations, or skipped tests.

| Service / Test Suite | File | Tests Run | Passed | Failed |
|---|---|---|---|---|
| `ws-connect` | `test/handler.test.mjs` | 19 | 19 | 0 |
| `ws-disconnect` | `test/handler.test.mjs` | 12 | 12 | 0 |
| `presign` | `test/handler.test.mjs` | 32 | 32 | 0 |
| `presign` | `test/validate-photo-id.test.mjs` | 13 | 13 | 0 |
| `presign` | `test/delivery-url.test.mjs` | 11 | 11 | 0 |
| `presign` | `test/assets.test.mjs` | 8 | 8 | 0 |
| `presign` | `test/e2e-runner.test.mjs` | 19 | 19 | 0 |
| **Total** | | **114** | **114** | **0** |

### Pending Integration Acceptance

Live AWS integration, browser CORS, and the complete photobooth flow remain unverified. Offline tests use mocked DynamoDB calls, local S3 signing, local HTTP/WebSocket servers, and checked-in sample assets.

- Ryan: Provision the table, TTL, reverse-lookup GSI, Lambda configuration and permissions, API routes, S3 processing notifications, S3 browser PUT CORS, and CloudFront OAC. Upload the sample frame and background for `sample-event-001` using the processor's agreed asset keys.
- Joel and Ryan: Verify presign preflight and response CORS plus direct S3 PUT from the actual kiosk browser origin, including the returned signed `Content-Type` header.
- Leyton and Tom: Run `npm run test:e2e` against the deployed endpoints with a genuine JPEG and verify processing status, WebSocket notification, CloudFront retrieval, and JPEG decoding.
- Team: Verify the complete kiosk capture, upload, compositing, result display, and print flow together. Passing offline tests does not establish production readiness.
