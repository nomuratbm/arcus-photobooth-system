export type PhotoStatus = 'connected' | 'processing' | 'done' | 'error';

export interface PhotoSessionRecord {
  photoId: string;
  connectionId?: string;
  status: PhotoStatus;
  eventId?: string;
  bgId?: string;
  frameId?: string;
  /** Number of raw shots received so far (atomic counter, finalize at SHOT_COUNT). */
  shotsReceived?: number;
  error?: string;
  createdAt?: number;
  updatedAt?: number;
  ttl?: number;
}

export type WebSocketDoneMessage = {
  status: 'done';
  key: string;
};

export type WebSocketErrorMessage = {
  status: 'error';
  message: string;
};

export type WebSocketMessage = WebSocketDoneMessage | WebSocketErrorMessage;

export interface ServiceConfig {
  bucketName: string;
  tableName: string;
  wsEndpoint: string;
  bedrockRegion: string;
  bedrockModelId: string;
  defaultEventId: string;
}

export interface SlotInput {
  /** Subtle background image buffer for this slot. */
  backgroundBuffer: Buffer;
  /** Transparent background-removed cutout for this slot. */
  cutoutBuffer: Buffer;
}
