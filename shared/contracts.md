# Shared Contracts

This document specifies the shared contracts between frontend, backend services, and infrastructure for `arcus-photobooth-system`.

---

## 1. S3 Keys & Layout

Bucket prefix conventions:

| Prefix | Pattern | Purpose | Written by | Read by |
|---|---|---|---|---|
| Raw Shots | `raw/{sessionId}/{index}.jpg` | One raw photo per shot (`index` = 1..3) | Kiosk (via presigned URL) | `process-photo` Lambda |
| Work Cutouts | `work/{sessionId}/{index}.png` | Background-removed cutout per shot (intermediate) | `process-photo` Lambda | `process-photo` Lambda (finalize) |
| Final Strip | `final/{sessionId}.jpg` | Finished 3-slot composite strip | `process-photo` Lambda | CloudFront / Kiosk / Admin |
| Frames | `assets/frames/{eventId}/{frameId}.png` | Baked frame overlay PNG (transparent slot openings) | Bake script / seed | `process-photo` Lambda |
| Backgrounds | `assets/backgrounds/{eventId}/{bgId}.jpg` | Background image backdrop (random per slot) | Admin / Seed script | `process-photo` Lambda |

> **Safety rule**: The Lambda event notification filter MUST match prefix `raw/` and suffix `.jpg` to prevent infinite loops when writing to `final/` or `work/`.

### Multi-shot sessions
Each guest session captures **3 shots** (`SHOT_COUNT = 3`). Every raw upload triggers the
processing Lambda, which removes the background for that shot, stores the cutout in
`work/`, and atomically increments the session's `shotsReceived` counter. The invocation
that reaches `shotsReceived == 3` finalizes: it loads all 3 cutouts, picks a random
background per slot, composites them into the frame overlay, and writes `final/{sessionId}.jpg`.

---

## 2. DynamoDB Table: State & Session Tracking

**Table Name**: Configurable via `TABLE_NAME` env var (e.g., `arcus-photobooth-sessions-dev`).

### Item Schema

| Attribute | Type | Key Type | Description |
|---|---|---|---|
| `photoId` | String (`S`) | Partition Key | Unique identifier for the session (UUID v4); also the `sessionId` |
| `connectionId` | String (`S`) | Attribute | API Gateway WebSocket connection ID |
| `status` | String (`S`) | Attribute | Session status: `connected` \| `processing` \| `done` \| `error` |
| `shotsReceived` | Number (`N`) | Attribute | Atomic counter of raw shots received (finalize at 3) |
| `eventId` | String (`S`) | Attribute | Event identifier (defaults to `default` if unspecified) |
| `bgId` | String (`S`) | Attribute | Selected background ID |
| `frameId` | String (`S`) | Attribute | Selected frame ID |
| `error` | String (`S`) | Attribute | Optional error message if status is `error` |
| `createdAt` | Number (`N`) | Attribute | Unix timestamp in milliseconds |
| `updatedAt` | Number (`N`) | Attribute | Unix timestamp in milliseconds |
| `ttl` | Number (`N`) | Attribute | Expiry timestamp in seconds (TTL: 1 hour after creation) |

---

## 3. WebSocket Realtime Protocol

### Connection URL
```
wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}?photoId={sessionId}
```
`photoId` carries the session UUID; all 3 shots of a session share it.

### Outbound Messages (Server → Kiosk)

#### Processing Completed
```json
{
  "status": "done",
  "key": "final/{photoId}.jpg"
}
```

#### Processing Failed
```json
{
  "status": "error",
  "message": "Human readable error description"
}
```

### Final Image Delivery
The kiosk constructs the public URL for the finished strip:
```
https://{CLOUDFRONT_DOMAIN}/final/{sessionId}.jpg
```

---

## 4. Environment Variables

| Variable | Description | Example | Used in |
|---|---|---|---|
| `BUCKET_NAME` | S3 photobooth bucket name | `arcus-photobooth-storage-dev` | `process-photo`, `presign` |
| `TABLE_NAME` | DynamoDB sessions table name | `arcus-photobooth-sessions-dev` | `process-photo`, `ws-*` |
| `WS_ENDPOINT` | API Gateway WebSocket management endpoint | `https://{id}.execute-api.ap-southeast-1.amazonaws.com/dev` | `process-photo` |
| `BEDROCK_REGION` | AWS region where Bedrock model runs | `us-east-1` | `process-photo` |
| `BEDROCK_MODEL_ID` | Bedrock model / inference profile ID | `us.stability.stable-image-remove-background-v1:0` | `process-photo` |
| `DEFAULT_EVENT_ID` | Default event ID when unspecified | `default` | `process-photo` |
| `CLOUDFRONT_DOMAIN` | CloudFront distribution domain | `d123456789.cloudfront.net` | Kiosk frontend |
