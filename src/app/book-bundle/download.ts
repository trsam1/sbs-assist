import { InjectionToken } from '@angular/core';

export interface DownloadRequest {
  name: string;
  mimeType: string;
  content: string;
}

/** Hand a generated file to the browser's download. Nothing is uploaded. */
export function downloadFile({ name, mimeType, content }: DownloadRequest): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been handed to the browser.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Injected so tests can replace the real download with a spy. */
export const DOWNLOAD_FILE = new InjectionToken<(req: DownloadRequest) => void>('DOWNLOAD_FILE', {
  providedIn: 'root',
  factory: () => downloadFile,
});
