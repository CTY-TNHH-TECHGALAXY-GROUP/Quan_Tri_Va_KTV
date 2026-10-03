'use client';

import React, { useEffect, useRef, useState } from 'react';
import { CameraOff, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import type QrScannerType from 'qr-scanner';
import { t } from './promotion.i18n';

// 🔧 UI CONFIGURATION
const MAX_SCANS_PER_SECOND = 8;

export type CameraState = 'requesting' | 'scanning' | 'denied' | 'unavailable';

interface QRScannerProps {
  /** Raw decoded text. The scanner stops itself after one result. */
  onDecode: (text: string) => void;
  /** When true the camera is released (e.g. while a lookup is running). */
  paused?: boolean;
  onStateChange?: (state: CameraState) => void;
}

const isPermissionError = (err: unknown): boolean => {
  const name = (err as { name?: string })?.name ?? '';
  const msg = String((err as Error)?.message ?? err ?? '');
  return name === 'NotAllowedError' || name === 'SecurityError' || /permission|denied|not allowed/i.test(msg);
};

/**
 * Browser camera QR scanner (getUserMedia + `qr-scanner`, works on iOS Safari
 * which lacks BarcodeDetector). Rear camera by default.
 */
const QRScanner = ({ onDecode, paused = false, onStateChange }: QRScannerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScannerType | null>(null);
  const onDecodeRef = useRef(onDecode);
  const [state, setState] = useState<CameraState>('requesting');
  const [attempt, setAttempt] = useState(0);

  onDecodeRef.current = onDecode;

  useEffect(() => {
    onStateChange?.(state);
  }, [state, onStateChange]);

  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    setState('requesting');

    const start = async () => {
      if (typeof window === 'undefined' || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setState('unavailable');
        return;
      }
      const { default: QrScanner } = await import('qr-scanner');
      if (cancelled || !videoRef.current) return;

      const scanner = new QrScanner(
        videoRef.current,
        (result) => {
          scanner.stop();
          onDecodeRef.current(result.data);
        },
        {
          preferredCamera: 'environment',
          maxScansPerSecond: MAX_SCANS_PER_SECOND,
          highlightScanRegion: true,
          highlightCodeOutline: true,
          returnDetailedScanResult: true,
        },
      );
      scannerRef.current = scanner;
      try {
        await scanner.start();
        if (!cancelled) setState('scanning');
      } catch (err) {
        if (cancelled) return;
        setState(isPermissionError(err) ? 'denied' : 'unavailable');
      }
    };

    start().catch(() => !cancelled && setState('unavailable'));

    return () => {
      cancelled = true;
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
  }, [paused, attempt]);

  const retry = () => setAttempt((n) => n + 1);

  if (state === 'denied' || state === 'unavailable') {
    const denied = state === 'denied';
    return (
      <div role="alert" className="flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-3xl border border-gray-200 bg-gray-50 p-6 text-center">
        {denied ? <ShieldAlert size={40} className="text-amber-500" aria-hidden /> : <CameraOff size={40} className="text-gray-400" aria-hidden />}
        <p className="font-semibold text-gray-900">{denied ? t.scan.cameraDenied : t.scan.cameraUnavailable}</p>
        <p className="max-w-xs text-sm text-gray-600">{denied ? t.scan.cameraDeniedHint : t.scan.cameraUnavailableHint}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-100"
        >
          <RefreshCw size={16} aria-hidden />
          {t.actions.retry}
        </button>
      </div>
    );
  }

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-black">
      <video ref={videoRef} className="h-full w-full object-cover" muted playsInline aria-label={t.scan.hint} />
      {state === 'requesting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-white">
          <Loader2 className="animate-spin" size={28} aria-hidden />
          <span className="text-sm">{t.scan.requesting}</span>
        </div>
      )}
      {state === 'scanning' && (
        <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-4 pt-8 text-center text-sm text-white">{t.scan.hint}</p>
      )}
    </div>
  );
};

export default QRScanner;
