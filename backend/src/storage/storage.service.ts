import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { getConfig } from '../config';

export interface StoredObject {
  contentType?: string;
  sizeBytes: number;
}

export abstract class StorageService {
  healthCheck(): Promise<'ok' | 'not_configured'> {
    return Promise.resolve('not_configured');
  }

  abstract presignPut(
    key: string,
    contentType: string,
  ): Promise<string>;

  abstract head(
    key: string,
  ): Promise<StoredObject | null>;

  abstract get(key: string): Promise<Buffer>;

  abstract put(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void>;

  abstract delete(key: string): Promise<void>;

  abstract publicUrl(key: string): string;
}

@Injectable()
export class S3StorageService extends StorageService {
  private cfg = getConfig().storage;

  private client?: S3Client;

  async healthCheck(): Promise<'ok' | 'not_configured'> {
    if (!this.cfg.bucket && !this.cfg.accessKey && !this.cfg.secretKey) {
      return 'not_configured';
    }
    await this.s3().send(new HeadBucketCommand({ Bucket: this.cfg.bucket }));
    return 'ok';
  }

  private s3(): S3Client {
    const {
      bucket,
      accessKey,
      secretKey,
    } = this.cfg;

    if (!bucket || !accessKey || !secretKey) {
      throw new ServiceUnavailableException(
        'Object storage is not configured',
      );
    }

    return (
      this.client ??= new S3Client({
        region: this.cfg.region,
        endpoint: this.cfg.endpoint,
        forcePathStyle: !!this.cfg.endpoint,
        credentials: {
          accessKeyId: accessKey,
          secretAccessKey: secretKey,
        },
      })
    );
  }

  presignPut(
    key: string,
    contentType: string,
  ): Promise<string> {
    return getSignedUrl(
      this.s3(),
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        ContentType: contentType,
      }),
      {
        expiresIn: 300,
      },
    );
  }

  async head(
    key: string,
  ): Promise<StoredObject | null> {
    try {
      const r = await this.s3().send(
        new HeadObjectCommand({
          Bucket: this.cfg.bucket,
          Key: key,
        }),
      );

      return {
        contentType: r.ContentType,
        sizeBytes: r.ContentLength ?? 0,
      };
    } catch (e: any) {
      if (
        e?.$metadata?.httpStatusCode === 404 ||
        e?.name === 'NotFound'
      ) {
        return null;
      }

      throw e;
    }
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.s3().send(
      new GetObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
      }),
    );

    if (!response.Body) {
      throw new ServiceUnavailableException(
        'Uploaded image could not be read',
      );
    }

    return Buffer.from(
      await response.Body.transformToByteArray(),
    );
  }

  async put(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.s3().send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.s3().send(
      new DeleteObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
      }),
    );
  }

  publicUrl(key: string): string {
    const base =
      this.cfg.publicBaseUrl ??
      `${this.cfg.endpoint ?? ''}/${this.cfg.bucket}`;

    return `${base.replace(/\/$/, '')}/${key}`;
  }
}