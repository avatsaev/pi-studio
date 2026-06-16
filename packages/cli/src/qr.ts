import QRCode from "qrcode";

/**
 * Render a string as a QR code drawn with terminal block characters (features/cli.md § Behavior —
 * "render a QR code / pairing link"). Used for the daemon pairing link.
 */
export function renderQrToTerminal(text: string): Promise<string> {
  return QRCode.toString(text, { type: "terminal", small: true });
}
