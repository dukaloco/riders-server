import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../config/env";

/**
 * Cloudflare R2 storage service (S3-compatible).
 *
 * R2 free tier: 10 GB storage · 1M writes · 10M reads/month · zero egress fees.
 *
 * Setup (5 min):
 *  1. Go to dash.cloudflare.com → R2 → Create bucket
 *  2. Make the bucket public (Settings → Public access)
 *  3. Create an API token (Manage R2 API Tokens → Create token)
 *  4. Fill in the env vars below
 *
 * Required env vars:
 *   STORAGE_BUCKET      = your-bucket-name
 *   STORAGE_ENDPOINT    = https://<account_id>.r2.cloudflarestorage.com
 *   STORAGE_ACCESS_KEY  = <R2 Access Key ID>
 *   STORAGE_SECRET_KEY  = <R2 Secret Access Key>
 *   STORAGE_PUBLIC_URL  = https://pub-xxxx.r2.dev  (or your custom domain)
 */
const s3 = new S3Client({
    region: "auto",
    endpoint: env.STORAGE_ENDPOINT,
    credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY,
        secretAccessKey: env.STORAGE_SECRET_KEY,
    },
    forcePathStyle: false,
});

function buildKey(folder: string, originalName: string): string {
    const ext = originalName.split(".").pop() ?? "bin";
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${folder}/${unique}.${ext}`;
}

export const StorageService = {
    /**
     * Upload a file to R2 and return its public URL.
     * @param file    Multipart File object from the request body.
     * @param folder  Logical path, e.g. "avatars", "documents", "proof-of-delivery".
     */
    upload: async (file: File, folder: string): Promise<string> => {
        const key = buildKey(folder, file.name);
        const buffer = Buffer.from(await file.arrayBuffer());

        await s3.send(
            new PutObjectCommand({
                Bucket: env.STORAGE_BUCKET,
                Key: key,
                Body: buffer,
                ContentType: file.type,
                ContentLength: buffer.byteLength,
            })
        );

        return `${env.STORAGE_PUBLIC_URL}/${key}`;
    },

    /**
     * Delete a file from R2 by its public URL.
     */
    delete: async (publicUrl: string): Promise<void> => {
        const key = publicUrl.replace(`${env.STORAGE_PUBLIC_URL}/`, "");
        await s3.send(
            new DeleteObjectCommand({
                Bucket: env.STORAGE_BUCKET,
                Key: key,
            })
        );
    },
};
