# arcus-photobooth-system

An event photobooth that turns a guest's photo into a finished, framed image with a new background in about 10–15 seconds, with no manual editing by staff or guests.

Built by the AWS Student Builder Group ARCUS.

## How it works

A guest takes a photo at a kiosk running a Next.js web app. The photo goes straight to Amazon S3. An event-driven AWS Lambda removes the background and composites a premade frame onto the background, and the result is pushed back to the kiosk over a WebSocket.

1. The kiosk opens a WebSocket to the API Gateway and registers a photo ID.
2. The kiosk captures a photo and uploads it to S3 using a presigned URL.
3. The S3 upload event triggers a Lambda that removes the background, then composites the frame and background.
4. The Lambda writes the finished image to S3 and notifies the kiosk through the WebSocket.
5. The kiosk displays the final photo.

## Tech stack

| Layer | Technology | Role |
|---|---|---|
| Frontend | Next.js (React) | Camera capture, upload, result display |
| Storage | Amazon S3 | Raw and final photos, frame and background assets |
| Processing | AWS Lambda (Node.js) with Sharp | Background removal call, compositing |
| Background removal | Amazon Bedrock (Stability AI image-editing models) | Produces the cutout |
| Realtime | API Gateway WebSocket API | Pushes the result to the kiosk |
| State | Amazon DynamoDB | Maps photo ID to WebSocket connection ID |
| Delivery | CloudFront or presigned S3 URLs | Serves the final image |
| Infrastructure | AWS CloudFormation | Automates deployment of the backend |

## Routes

| Route | Purpose |
|---|---|
| `/` | Public kiosk page. Live camera view and photo view. Pressing "Take photo" starts a 10-second timer, captures the photo, then triggers processing. |
| `/print` | Admin-gated page. Admins can view and print the processed photos from S3. |

## Repository structure

```
arcus-photobooth-system/
├── infra/                  # CloudFormation templates and deploy scripts
│   ├── main.yaml
│   ├── stacks/             # storage, realtime, processing, delivery
│   ├── parameters/         # dev.json, prod.json
│   └── scripts/deploy.sh
├── apps/
│   └── kiosk/              # Next.js kiosk app
├── services/
│   ├── process-photo/      # Processing Lambda (Bedrock + Sharp)
│   ├── ws-connect/         # $connect Lambda
│   ├── ws-disconnect/      # $disconnect Lambda
│   └── presign/            # Presigned upload URL Lambda
├── shared/
│   └── contracts.md        # Keys, DB item, message formats
├── assets/
│   ├── frames/{eventId}/
│   └── backgrounds/{eventId}/
└── docs/
```

## Shared contracts

### S3 keys
- `raw/{photoId}.jpg`: original guest photo
- `final/{photoId}.jpg`: finished composited photo
- `assets/frames/{eventId}/...`: frame images
- `assets/backgrounds/{eventId}/...`: background images

### DynamoDB item
| Field | Description |
|---|---|
| `photoId` | Partition key |
| `connectionId` | WebSocket connection ID |
| `status` | `connected`, `processing`, `done`, or `error` |
| `ttl` | Expiry, one hour after connect |

### WebSocket messages to the kiosk
```json
{ "status": "done", "key": "final/{photoId}.jpg" }
{ "status": "error", "message": "..." }
```

### Environment variables
| Variable | Used by |
|---|---|
| `BUCKET_NAME` | process-photo, presign, kiosk server routes |
| `TABLE_NAME` | process-photo, ws-connect, ws-disconnect |
| `WS_ENDPOINT` | process-photo (for `PostToConnection`) |

## Processing Lambda steps

1. Read the raw photo from S3 using the key in the event.
2. Call the Bedrock background-removal model and receive a cutout with transparency.
3. Load the selected background and frame from `assets/`.
4. Composite with Sharp: background, then cutout, then frame.
5. Write `final/{photoId}.jpg`. The key comes from the photo ID, so a retried event overwrites rather than duplicates.
6. Look up the connection ID and send the result with `PostToConnection`. Ignore `GoneException`, which means the kiosk disconnected.

Suggested settings: 1.5–3 GB memory and a timeout of at least 60 seconds.

## Team

| Member | Area | Folder |
|---|---|---|
| Joel | Frontend (Next.js kiosk) | `apps/kiosk` |
| Lleyton | Image processing | `services/process-photo` |
| Tom | Realtime and state backend | `services/ws-*`, `services/presign` |
| Ryan | Infrastructure (CloudFormation) | `infra` |

## Getting started

### Prerequisites
- Node.js (LTS)
- AWS CLI configured with an account that has Bedrock model access enabled
- Access to the chosen AWS region

### Deploy the backend
```bash
cd infra
./scripts/deploy.sh dev
```
The stack outputs the bucket name, table name, and WebSocket URL.

### Run the kiosk locally
```bash
cd apps/kiosk
npm install
cp .env.example .env.local   # fill in values from the stack outputs
npm run dev
```

## Contributing

- Work inside your own folder; discuss changes to `shared/contracts.md` with the whole team first.
- Use feature branches and open a pull request into `main`.
- Do not commit AWS credentials or `.env` files.

## Known risks

- Background removal depends on Amazon Bedrock model availability and access in your region. Verify this early.
- Sharp must be built for the Lambda runtime (Linux).
- The S3 trigger must be filtered to `raw/` so writing to `final/` does not retrigger the Lambda.
