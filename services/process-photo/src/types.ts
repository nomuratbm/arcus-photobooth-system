export type PhotoStatus = 'connected' | 'processing' | 'done' | 'error';

export interface PhotoSessionRecord {
  photoId: string;
  connectionId?: string;
  status: PhotoStatus;
  eventId?: string;
  bgId?: string;
  frameId?: string;
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

export interface CompositingAssets {
  backgroundBuffer: Buffer;
  cutoutBuffer: Buffer;
  frameBuffer: Buffer;
}

export interface CompositingDimensions {
  width: number;
  height: number;
}
