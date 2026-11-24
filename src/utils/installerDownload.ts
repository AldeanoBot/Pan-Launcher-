export interface DownloadProgressState {
  status: 'idle' | 'downloading' | 'done' | 'error';
  percent: number;
  loadedBytes: number;
  totalBytes: number;
  filename: string | null;
  error: string | null;
}

export const INITIAL_DOWNLOAD_STATE: DownloadProgressState = {
  status: 'idle',
  percent: 0,
  loadedBytes: 0,
  totalBytes: 0,
  filename: null,
  error: null,
};

export function formatBytesMb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0.0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function triggerBlobSave(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadInstallerWithProgress(
  endpointUrl: string,
  filename: string,
  onProgress: (state: DownloadProgressState) => void
): Promise<boolean> {
  onProgress({
    status: 'downloading',
    percent: 4,
    loadedBytes: 0,
    totalBytes: 0,
    filename,
    error: null,
  });

  try {
    const res = await fetch(endpointUrl, {
      credentials: 'include',
      cache: 'no-store',
    });

    if (!res.ok) {
      throw new Error(`El servidor respondió con estado ${res.status}.`);
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html')) {
      throw new Error(
        'La vista previa integrada bloqueó el archivo. Usa el botón «Abrir web de descarga en pestaña nueva».'
      );
    }

    const totalHeader = res.headers.get('content-length');
    const totalBytes = totalHeader ? Number.parseInt(totalHeader, 10) || 0 : 0;

    let blob: Blob;
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let loadedBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          loadedBytes += value.byteLength;
          const percent =
            totalBytes > 0
              ? Math.min(99, Math.max(8, Math.round((loadedBytes / totalBytes) * 100)))
              : Math.min(92, Math.max(12, Math.round(loadedBytes / 25_000)));
          onProgress({
            status: 'downloading',
            percent,
            loadedBytes,
            totalBytes,
            filename,
            error: null,
          });
        }
      }

      const combined = new Uint8Array(loadedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      blob = new Blob([combined], {
        type: contentType || 'application/octet-stream',
      });
    } else {
      blob = await res.blob();
    }

    if (blob.size < 1024) {
      throw new Error('El archivo descargado está vacío o incompleto.');
    }

    triggerBlobSave(filename, blob);
    onProgress({
      status: 'done',
      percent: 100,
      loadedBytes: blob.size,
      totalBytes: blob.size,
      filename,
      error: null,
    });
    return true;
  } catch (err) {
    onProgress({
      status: 'error',
      percent: 0,
      loadedBytes: 0,
      totalBytes: 0,
      filename,
      error:
        err instanceof Error
          ? err.message
          : 'No se pudo completar la descarga en este navegador.',
    });
    return false;
  }
}
