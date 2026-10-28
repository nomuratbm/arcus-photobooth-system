# Shared Contracts

This document specifies the shared contracts between frontend, backend services, and infrastructure for `arcus-photobooth-system`.

---

## 1. S3 Keys & Layout

Bucket prefix conventions:

| Prefix | Pattern | Purpose | Written by | Read by |
|---|---|---|---|---|
| Raw Photos | `raw/{photoId}.jpg` | Uploaded raw photo taken by guest | Kiosk (via presigned URL) | `process-photo` Lambda |
| Final Photos | `final/{photoId}.jpg` | Finished composite image (background + cutout + frame) | `process-photo` Lambda | CloudFront / Kiosk / Admin |
| Frames | `assets/frames/{eventId}/{frameId}.png` | Transparent PNG overlay frame | Admin / Seed script | `process-photo` Lambda |
| Backgrounds | `assets/backgrounds/{eventId}/{bgId}.jpg` | Background image backdrop | Admin / Seed script | `process-photo` Lambda |

> **Safety rule**: The Lambda event notification filter MUST match prefix `raw/` and suffix `.jpg` to prevent infinite loops when writing to `final/`.

---

## 2. DynamoDB Table: State & Session Tracking

**Table Name**: Configurable via `TABLE_NAME` env var (e.g., `arcus-photobooth-sessions-dev`).

### Item Schema

| Attribute | Type | Key Type | Description |
|---|---|---|---|
| `photoId` | String (`S`) | Partition Key | Unique identifier for the photo session (e.g. UUID v4 or nanoid) |
| `connectionId` | String (`S`) | Attribute | API Gateway WebSocket connection ID |
| `status` | String (`S`) | Attribute | Session status: `connected` \| `processing` \| `done` \| `error` |
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
wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}?photoId={photoId}
```

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
The kiosk constructs the public URL for the image:
```
https://{CLOUDFRONT_DOMAIN}/final/{photoId}.jpg
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
