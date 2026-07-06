/**
 * PairScanScreen — /pair-scan route.
 * Camera QR scanning (native only); web/desktop shows "unsupported" with manual fallback.
 * app-navigation-screens.md § Onboarding & pairing
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import styles from "./PairScanScreen.module.css";
import { Button } from "../primitives/index.js";
import {
  pairScanAvailability,
  importPairingOffer,
  type PairingSource,
  type PairingProbe,
  type PairingUpsert,
} from "../../onboarding/pairing.js";
import type { OnboardingPlatform } from "../../onboarding/welcome.js";

export interface PairScanScreenProps {
  platform: OnboardingPlatform;
  probe: PairingProbe;
  upsert: PairingUpsert;
  /** For manual fallback. */
  onManualEntry: () => void;
}

export function PairScanScreen({
  platform,
  probe,
  upsert,
  onManualEntry,
}: PairScanScreenProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const source: PairingSource = (searchParams.get("source") as PairingSource) || "onboarding";

  const availability = pairScanAvailability(platform);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Cleanup camera on unmount.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Start camera if available.
  useEffect(() => {
    if (availability !== "camera") return;
    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        setScanning(true);
      } catch {
        setError("Camera unavailable. Please enter the connection manually.");
      }
    }

    startCamera();
    return () => { cancelled = true; };
  }, [availability]);

  const handleQRDecode = useCallback(
    async (payload: string) => {
      setError(null);
      const result = await importPairingOffer({
        urlOrFragment: payload,
        source,
        probe,
        upsert,
      });
      if (result.ok) {
        navigate(result.route, { replace: true });
      } else {
        setError(result.error);
      }
    },
    [source, probe, upsert, navigate],
  );

  // Unsupported platform fallback.
  if (availability === "unsupported") {
    return (
      <div className={styles.container}>
        <h1 className={styles.title}>QR Scan</h1>
        <p className={styles.message}>
          QR scanning is not supported on this platform. Please enter the host address manually or paste a pairing link.
        </p>
        <Button onClick={onManualEntry}>Enter manually</Button>
        <Button variant="ghost" onClick={() => navigate(-1)}>
          Go back
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Scan QR Code</h1>
      <p className={styles.message}>
        Point your camera at the pairing QR code displayed on your host machine.
      </p>

      <div className={styles.cameraBox}>
        <video ref={videoRef} className={styles.video} playsInline muted />
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <Button variant="ghost" onClick={onManualEntry}>
        Enter manually instead
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export the decode handler so tests can exercise it without camera.
// ---------------------------------------------------------------------------
export { importPairingOffer } from "../../onboarding/pairing.js";
