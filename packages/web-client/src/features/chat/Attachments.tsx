/**
 * Attachment preview strip — presentational thumbnail row with remove buttons (POC
 * `renderAttachments`, POC_TO_APP_PLAN_UI.md §4.4). Pending-image state lives in `Composer`;
 * this component only renders `images` and forwards `onRemove(index)`.
 */

import styles from "./Attachments.module.css";

export interface PendingImage {
  mimeType: string;
  /** Base64 payload, no `data:...;base64,` prefix — sent to the daemon as-is. */
  data: string;
  /** Full data URL, for the thumbnail `<img src>`. */
  thumbUrl: string;
}

export interface AttachmentsProps {
  images: PendingImage[];
  onRemove: (index: number) => void;
}

export function Attachments({ images, onRemove }: AttachmentsProps) {
  if (images.length === 0) return null;

  return (
    <div className={styles.strip}>
      {images.map((img, i) => (
        <div key={i} className={styles.thumb}>
          <img src={img.thumbUrl} alt="" />
          <button
            type="button"
            className={styles.remove}
            title="Remove"
            onClick={() => onRemove(i)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/** `FileReader.readAsDataURL` wrapped as a promise (POC `addImageFile`). */
export function readImageFile(file: File): Promise<PendingImage> {
  const { promise, resolve, reject } = Promise.withResolvers<PendingImage>();
  const reader = new FileReader();
  reader.onload = () => {
    const result = reader.result;
    if (typeof result !== "string") {
      reject(new Error("Unexpected FileReader result"));
      return;
    }
    const commaIndex = result.indexOf(",");
    const data = commaIndex >= 0 ? result.slice(commaIndex + 1) : result;
    resolve({ mimeType: file.type, data, thumbUrl: result });
  };
  reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
  reader.readAsDataURL(file);
  return promise;
}
