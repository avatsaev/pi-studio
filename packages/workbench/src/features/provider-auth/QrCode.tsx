/**
 * QrCode — renders a string as a scannable QR image (sprint-065/task-005).
 *
 * Why this exists at all: the browser showing a login dialog is frequently **not** the machine that
 * can complete an OAuth redirect. A relay user drives a headless daemon; the callback server a Pi
 * OAuth flow opens binds on the *daemon* host (Anthropic's, for instance, is a fixed
 * `127.0.0.1:53692/callback`), so the redirect can only ever be completed from a browser that can
 * reach that host. Scanning the auth URL onto a phone or onto the daemon's own desktop is the
 * shortest path, exactly as relay pairing already works.
 *
 * `qrcode` is used daemon/CLI-side for *terminal* rendering (`packages/cli/src/qr.ts`); nothing
 * browser-side existed. This wraps its `toDataURL` and nothing else.
 *
 * Colours are deliberately left at the library default (black modules on a white background, baked
 * into the PNG together with its quiet-zone margin) rather than themed: scanners expect dark-on-light
 * and a themed QR trades real scan reliability for looks. That is also why no CSS background is
 * needed here — the image carries its own.
 */

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import styles from "./QrCode.module.css";

/** Bitmap is generated at 2x the CSS box (10rem = 160px at the default scale) so it stays sharp
 *  on HiDPI screens. */
const QR_PIXELS = 320;

interface QrCodeProps {
  value: string;
  /** Accessible description — the QR is an aid, so this says what scanning it does. */
  label: string;
}

export function QrCode({ value, label }: QrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setDataUrl(null);
    setFailed(false);
    QRCode.toDataURL(value, { width: QR_PIXELS, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => {
        if (live) setDataUrl(url);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [value]);

  // A QR is never the only path to the url (there is always a link and a copy button), so a
  // generation failure renders nothing rather than an error the user can do anything about.
  if (failed) return null;
  if (!dataUrl) return <div className={styles.placeholder} aria-hidden="true" />;
  return <img className={styles.qr} src={dataUrl} alt={label} />;
}
