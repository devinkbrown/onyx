'use client';

export interface PendingAttachment {
  id: string;
  file: File;
  objectUrl: string;
  type: 'image' | 'video' | 'audio' | 'document';
}

export interface AttachmentPreviewProps {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
  /** Map from attachment id to upload progress (0..1). Optional — no overlay shown if absent. */
  uploadProgressMap?: Map<string, number>;
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

export default function AttachmentPreview({ attachments, onRemove, uploadProgressMap }: AttachmentPreviewProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="attachment-strip animate-fade-in" role="list" aria-label="Pending attachments">
      {attachments.map(att => {
        const uploadProgress = uploadProgressMap?.get(att.id);
        return (
          <div key={att.id} className="attachment-item" role="listitem">
            <AttachmentThumbnail attachment={att} uploadProgress={uploadProgress} />
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
          gap: 10px;
          padding: 10px 14px;
          flex-wrap: wrap;
          background: var(--bg-elevated, rgba(19,33,49,0.95));
          border-radius: var(--r-md, 8px) var(--r-md, 8px) 0 0;
          border: 1px solid var(--border-normal);
          border-bottom: none;
        }

        .attachment-item {
          position: relative;
          flex-shrink: 0;
          transition: transform 150ms var(--ease-out, cubic-bezier(0.16,1,0.3,1));
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
          border-radius: 50%;
          border: 1.5px solid var(--bg-base, #0c1828);
          background: var(--bg-deep, #06101d);
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
          box-shadow: 0 2px 6px rgba(0,0,0,0.5);
        }
        .attachment-remove:hover {
          color: #fff;
          background: var(--danger, #ef4444);
        }

        /* ── image / video thumbnails ── */
        .att-thumb {
          width: 82px;
          height: 82px;
          border-radius: var(--r-md, 8px);
          overflow: hidden;
          background: var(--bg-deep);
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          border: 1px solid var(--border-subtle);
          box-shadow: 0 2px 8px rgba(0,0,0,0.35);
        }

        .att-thumb-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: var(--r-md, 8px);
          display: block;
        }

        .att-play-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0,0,0,0.4);
          border-radius: var(--r-md, 8px);
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
          border-radius: var(--r-md, 8px);
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.25);
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
      `}</style>
    </div>
  );
}

// ── Individual thumbnail renderer ─────────────────────────────────────────────

function UploadProgressOverlay({ progress }: { progress: number }) {
  if (progress >= 1) return null;
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'rgba(3,8,16,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: 'inherit',
    }}>
      <div style={{
        width: '80%', height: 3,
        background: 'var(--border-normal)',
        borderRadius: 2,
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${progress * 100}%`,
          background: 'var(--accent)',
          borderRadius: 2,
          transition: 'width 0.1s linear',
        }} />
      </div>
    </div>
  );
}

function AttachmentThumbnail({ attachment, uploadProgress }: { attachment: PendingAttachment; uploadProgress?: number }) {
  if (attachment.type === 'image') {
    return (
      <div className="att-thumb">
        <img
          src={attachment.objectUrl}
          alt={attachment.file.name}
          className="att-thumb-img"
        />
        {typeof uploadProgress === 'number' && uploadProgress < 1 && (
          <UploadProgressOverlay progress={uploadProgress} />
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
        {typeof uploadProgress === 'number' && uploadProgress < 1 && (
          <UploadProgressOverlay progress={uploadProgress} />
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
        {typeof uploadProgress === 'number' && uploadProgress < 1 && (
          <UploadProgressOverlay progress={uploadProgress} />
        )}
      </div>
    );
  }

  return (
    <div className="att-file" style={{ position: 'relative' }}>
      <span className="att-file-icon" aria-hidden="true">📄</span>
      <span className="att-file-name" title={attachment.file.name}>{attachment.file.name}</span>
      <span className="att-file-size">{formatBytes(attachment.file.size)}</span>
      {typeof uploadProgress === 'number' && uploadProgress < 1 && (
        <UploadProgressOverlay progress={uploadProgress} />
      )}
    </div>
  );
}

const PlayIcon = () => (
  <svg className="att-play-icon" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);
