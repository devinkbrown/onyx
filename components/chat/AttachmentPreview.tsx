'use client';

export interface PendingAttachment {
  id: string;
  file: File;
  objectUrl: string;
  type: 'image' | 'video' | 'audio' | 'document';
  uploadError?: string;
}

export interface AttachmentUploadState {
  progress: number;
  done?: boolean;
  error?: string;
}

export interface AttachmentPreviewProps {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
  onRetry?: (id: string) => void;
  /** Map from attachment id to upload progress/status. Optional — no overlay shown if absent. */
  uploadProgressMap?: Map<string, number | AttachmentUploadState>;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function getAttachmentType(file: File): PendingAttachment['type'] {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'document';
}

function normalizeUploadState(
  value: number | AttachmentUploadState | undefined,
  fallbackError?: string,
): AttachmentUploadState | undefined {
  if (typeof value === 'number') return { progress: value };
  if (value) return value;
  if (fallbackError) return { progress: 0, done: true, error: fallbackError };
  return undefined;
}

export default function AttachmentPreview({ attachments, onRemove, onRetry, uploadProgressMap }: AttachmentPreviewProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="attachment-strip elev-2 animate-fade-in" role="list" aria-label="Pending attachments" data-testid="attachment-preview">
      {attachments.map(att => {
        const uploadState = normalizeUploadState(uploadProgressMap?.get(att.id), att.uploadError);
        return (
          <div key={att.id} className={`attachment-item${uploadState?.error ? ' attachment-item--error' : ''}`} role="listitem">
            <AttachmentThumbnail attachment={att} uploadState={uploadState} />
            {uploadState?.error && (
              <div className="att-error" role="status">
                <span className="att-error__text" title={uploadState.error}>Upload failed</span>
                {onRetry && (
                  <button
                    className="att-error__retry"
                    type="button"
                    onClick={() => onRetry(att.id)}
                  >
                    Retry
                  </button>
                )}
              </div>
            )}
            <button
              className="attachment-remove"
              onClick={() => onRemove(att.id)}
              aria-label={`Remove ${att.file.name}`}
            >
              ×
            </button>
          </div>
        );
      })}

      <style>{`
        .attachment-strip {
          display: flex;
          gap: var(--sp-3, 12px);
          padding: var(--sp-3, 12px) var(--sp-4, 16px);
          flex-wrap: wrap;
          border-radius: var(--r-xl, 16px) var(--r-lg, 12px) var(--r-sm, 6px) var(--r-lg, 12px);
          border: 1px solid color-mix(in srgb, var(--lux, #d8b96a) 14%, var(--border-normal));
          border-bottom: 0;
        }

        .attachment-item {
          position: relative;
          flex-shrink: 0;
          transition: transform var(--t-control, 150ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1));
        }

        .attachment-item:hover {
          transform: translateY(-1px);
        }

        .attachment-item:hover .attachment-remove {
          opacity: 1;
          transform: scale(1);
        }

        .attachment-remove {
          position: absolute;
          top: -7px;
          right: -7px;
          width: 20px;
          height: 20px;
          border-radius: var(--r-full, 999px);
          border: 1px solid color-mix(in srgb, var(--bg-base, #0c1828) 82%, white);
          background: var(--elev-tint-3, var(--bg-deep, #06101d));
          color: var(--text-muted);
          cursor: pointer;
          font-size: 12px;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transform: scale(0.8);
          transition:
            opacity var(--t-fast, 150ms),
            color var(--t-fast, 150ms),
            background var(--t-fast, 150ms),
            transform 150ms var(--ease-spring, cubic-bezier(0.175,0.885,0.32,1.275));
          z-index: 2;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), 0 8px 18px rgba(0,0,0,0.35);
        }
        .attachment-remove:hover {
          color: #fff;
          background: var(--danger, #ef4444);
        }

        /* ── image / video thumbnails ── */
        .att-thumb {
          width: 82px;
          height: 82px;
          border-radius: var(--r-lg, 14px) var(--r-sm, 6px) var(--r-xl, 18px) var(--r-md, 10px);
          overflow: hidden;
          background: var(--elev-tint-1, var(--bg-deep));
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          border: 1px solid color-mix(in srgb, var(--lux, #d8b96a) 13%, var(--border-subtle));
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), 0 8px 20px rgba(0,0,0,0.28);
        }

        .att-thumb-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: inherit;
          display: block;
        }

        .att-play-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0,0,0,0.45);
          border-radius: inherit;
        }

        .att-play-icon {
          width: 26px;
          height: 26px;
          color: #fff;
          filter: drop-shadow(0 1px 4px rgba(0,0,0,0.7));
          opacity: 0.9;
        }

        /* ── audio / document ── */
        .att-file {
          width: 82px;
          height: 82px;
          border-radius: var(--r-lg, 14px) var(--r-sm, 6px) var(--r-xl, 18px) var(--r-md, 10px);
          background: var(--elev-tint-1, var(--bg-elevated));
          border: 1px solid color-mix(in srgb, var(--lux, #d8b96a) 13%, var(--border-subtle));
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 8px;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), 0 8px 20px rgba(0,0,0,0.28);
        }

        .att-file-icon {
          font-size: 26px;
          line-height: 1;
          flex-shrink: 0;
        }

        .att-file-name {
          font-size: 9px;
          font-weight: 600;
          color: var(--text-secondary);
          text-align: center;
          word-break: break-all;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          line-height: 1.3;
          width: 100%;
        }

        .att-file-size {
          font-size: 9px;
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .attachment-item--error .att-thumb,
        .attachment-item--error .att-file {
          border-color: color-mix(in srgb, var(--danger, #ef4444) 60%, var(--border-subtle));
        }

        .att-error {
          position: absolute;
          left: 6px;
          right: 6px;
          bottom: 6px;
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          gap: 5px;
          padding: 4px 5px 4px 7px;
          border-radius: var(--r-sm, 6px) var(--r-md, 10px) var(--r-sm, 6px) var(--r-md, 10px);
          background: color-mix(in srgb, var(--bg-void, #030812) 86%, var(--danger, #ef4444));
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), 0 8px 18px rgba(0,0,0,0.4);
          z-index: 2;
        }

        .att-error__text {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--danger, #ef4444);
          font-size: var(--text-2xs, 11px);
          font-weight: 700;
        }

        .att-error__retry {
          border: 0;
          border-radius: var(--r-xs, 4px) var(--r-md, 10px) var(--r-xs, 4px) var(--r-sm, 6px);
          background: var(--lux, #d8b96a);
          color: var(--bg-void, #030812);
          cursor: pointer;
          font-size: var(--text-2xs, 11px);
          font-weight: 800;
          line-height: 1;
          padding: 4px 6px;
        }

        .att-upload {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: inherit;
          background: rgba(3,8,16,0.74);
        }

        .att-progress-ring {
          --progress: 0;
          width: 42px;
          height: 42px;
          border-radius: var(--r-full, 999px);
          display: grid;
          place-items: center;
          background:
            conic-gradient(var(--lux, #d8b96a) calc(var(--progress) * 1turn), color-mix(in srgb, var(--text-muted) 24%, transparent) 0),
            var(--elev-tint-3, #111827);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), 0 10px 22px rgba(0,0,0,0.45);
        }

        .att-progress-ring::before {
          content: '';
          width: 30px;
          height: 30px;
          border-radius: inherit;
          background: var(--bg-void, #030812);
        }

        @media (prefers-reduced-motion: reduce) {
          .attachment-item,
          .attachment-remove {
            transition: none !important;
          }
          .attachment-item:hover {
            transform: none !important;
          }
        }
      `}</style>
    </div>
  );
}

// ── Individual thumbnail renderer ─────────────────────────────────────────────

function UploadProgressOverlay({ state }: { state: AttachmentUploadState }) {
  if (state.error || state.progress >= 1) return null;
  return (
    <div className="att-upload" aria-label={`Upload ${Math.round(state.progress * 100)} percent`}>
      <div
        className="att-progress-ring"
        style={{ '--progress': Math.max(0, Math.min(1, state.progress)) } as React.CSSProperties}
      />
    </div>
  );
}

function AttachmentThumbnail({ attachment, uploadState }: { attachment: PendingAttachment; uploadState?: AttachmentUploadState }) {
  if (attachment.type === 'image') {
    return (
      <div className="att-thumb">
        <img
          src={attachment.objectUrl}
          alt={attachment.file.name}
          className="att-thumb-img"
        />
        {uploadState && (
          <UploadProgressOverlay state={uploadState} />
        )}
      </div>
    );
  }

  if (attachment.type === 'video') {
    return (
      <div className="att-thumb">
        <video
          src={attachment.objectUrl}
          className="att-thumb-img"
          muted
          preload="metadata"
        />
        <div className="att-play-overlay" aria-hidden="true">
          <PlayIcon />
        </div>
        {uploadState && (
          <UploadProgressOverlay state={uploadState} />
        )}
      </div>
    );
  }

  if (attachment.type === 'audio') {
    return (
      <div className="att-file" style={{ position: 'relative' }}>
        <span className="att-file-icon" aria-hidden="true">🎵</span>
        <span className="att-file-name" title={attachment.file.name}>{attachment.file.name}</span>
        <span className="att-file-size">{formatBytes(attachment.file.size)}</span>
        {uploadState && (
          <UploadProgressOverlay state={uploadState} />
        )}
      </div>
    );
  }

  return (
    <div className="att-file" style={{ position: 'relative' }}>
      <span className="att-file-icon" aria-hidden="true">📄</span>
      <span className="att-file-name" title={attachment.file.name}>{attachment.file.name}</span>
      <span className="att-file-size">{formatBytes(attachment.file.size)}</span>
      {uploadState && (
        <UploadProgressOverlay state={uploadState} />
      )}
    </div>
  );
}

const PlayIcon = () => (
  <svg className="att-play-icon" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);
