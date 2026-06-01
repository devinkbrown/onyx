'use client';

import { useState, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';

let _warnedAboutMediaUrl = false;

export interface UploadResult {
  file: File;
  url: string | null;     // null = upload failed
  localUrl: string;       // blob: URL for local preview (always set)
  error?: string;
}

export interface UploadProgress {
  file: File;
  progress: number;       // 0..1
  done: boolean;
  error?: string;
}

function uploadOneFile(
  file: File,
  mediaUrl: string,
  onProgress: (p: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded / e.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as { url: string };
          resolve(data.url);
        } catch {
          reject(new Error('Invalid response from media server'));
        }
      } else {
        reject(new Error(`Upload failed: HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new Error('Upload aborted'));

    xhr.open('POST', `${mediaUrl}/upload`);
    xhr.send(formData);
  });
}

export function useFileUpload(): {
  upload: (files: File[]) => Promise<UploadResult[]>;
  uploading: boolean;
  progress: UploadProgress[];
} {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress[]>([]);
  const addNotification = useOnyxStore(s => s.addNotification);

  const upload = useCallback(async (files: File[]): Promise<UploadResult[]> => {
    if (files.length === 0) return [];

    const mediaUrl = process.env.NEXT_PUBLIC_MEDIA_URL ?? '';

    // If no media server configured, fall back to blob URLs immediately
    if (!mediaUrl) {
      if (!_warnedAboutMediaUrl) {
        _warnedAboutMediaUrl = true;
        addNotification({
          type: 'system',
          text: 'File sharing is local only — set NEXT_PUBLIC_MEDIA_URL for cross-user sharing',
        });
      }
      return files.map(file => {
        const localUrl = URL.createObjectURL(file);
        return { file, url: null, localUrl };
      });
    }

    const initialProgress: UploadProgress[] = files.map(file => ({
      file,
      progress: 0,
      done: false,
    }));
    setProgress(initialProgress);
    setUploading(true);

    const results = await Promise.all(
      files.map(async (file, idx): Promise<UploadResult> => {
        const localUrl = URL.createObjectURL(file);

        try {
          const url = await uploadOneFile(file, mediaUrl, (p) => {
            setProgress(prev =>
              prev.map((entry, i) =>
                i === idx ? { ...entry, progress: p } : entry,
              ),
            );
          });

          setProgress(prev =>
            prev.map((entry, i) =>
              i === idx ? { ...entry, progress: 1, done: true } : entry,
            ),
          );

          return { file, url, localUrl };
        } catch (err) {
          const error = err instanceof Error ? err.message : 'Upload failed';

          setProgress(prev =>
            prev.map((entry, i) =>
              i === idx ? { ...entry, progress: 0, done: true, error } : entry,
            ),
          );

          return { file, url: null, localUrl, error };
        }
      }),
    );

    setUploading(false);
    return results;
  }, [addNotification]);

  return { upload, uploading, progress };
}
