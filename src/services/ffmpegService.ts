/**
 * FFmpegService: Manual Worker Management
 * 
 * Bypasses @ffmpeg/ffmpeg and @ffmpeg/util to avoid CORS/atob issues in the 
 * Flow sandboxed iframe. 
 */

interface FFMessage {
  id: number;
  type: string;
  data?: any;
}

class FFmpegService {
  private worker: Worker | null = null;
  private messageId = 0;
  private callbacks = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private logCallback?: (msg: string) => void;
  private progressCallback?: (p: { progress: number }) => void;
  private loaded = false;
  private loadingPromise?: Promise<void>;

  async load(onLog?: (msg: string) => void) {
    if (this.loaded) return;
    if (this.loadingPromise) return this.loadingPromise;
    this.logCallback = onLog;
    this.loadingPromise = this.internalLoad(onLog);
    return this.loadingPromise;
  }

  private async internalLoad(onLog?: (msg: string) => void) {

    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';

    onLog?.('Fetching FFmpeg core assets...');
    
    // 1. Fetch JS core as a Blob URL for importScripts
    const jsRes = await fetch(`${baseURL}/ffmpeg-core.js`);
    const jsBlob = await jsRes.blob();
    const coreURL = URL.createObjectURL(new Blob([jsBlob], { type: 'text/javascript' }));

    // 2. Fetch WASM as an ArrayBuffer to pass directly
    const wasmRes = await fetch(`${baseURL}/ffmpeg-core.wasm`);
    const wasmBinary = await wasmRes.arrayBuffer();

    // 3. Create the classic worker script.
    const workerScript = `
      let ffmpeg;
      const FFMessageType = {
        LOAD: "LOAD", EXEC: "EXEC", WRITE_FILE: "WRITE_FILE", 
        READ_FILE: "READ_FILE", DELETE_FILE: "DELETE_FILE",
        LOG: "LOG", PROGRESS: "PROGRESS", ERROR: "ERROR"
      };

      self.onmessage = async ({ data: { id, type, data } }) => {
        try {
          switch (type) {
            case FFMessageType.LOAD:
              importScripts(data.coreURL);
              
              ffmpeg = await self.createFFmpegCore({
                wasmBinary: data.wasmBinary,
                onRuntimeInitialized: () => {},
              });
              
              // Ensure log is always a string before sending
              ffmpeg.setLogger((log) => {
                const message = typeof log === 'string' ? log : (log.message || '');
                self.postMessage({ type: FFMessageType.LOG, data: message });
              });

              ffmpeg.setProgress((p) => {
                const progress = typeof p === 'object' ? p.progress : p;
                self.postMessage({ type: FFMessageType.PROGRESS, data: progress });
              });
              
              self.postMessage({ id, type, data: true });
              break;

            case FFMessageType.EXEC:
              const ret = ffmpeg.exec(...data.args);
              self.postMessage({ id, type, data: ret });
              break;

            case FFMessageType.WRITE_FILE:
              ffmpeg.FS.writeFile(data.path, data.data);
              self.postMessage({ id, type, data: true });
              break;

            case FFMessageType.READ_FILE:
              const fileData = ffmpeg.FS.readFile(data.path);
              const buffer = fileData.buffer.slice(0);
              self.postMessage({ id, type, data: new Uint8Array(buffer) }, [buffer]);
              break;

            case FFMessageType.DELETE_FILE:
              ffmpeg.FS.unlink(data.path);
              self.postMessage({ id, type, data: true });
              break;
          }
        } catch (err) {
          self.postMessage({ id, type: FFMessageType.ERROR, data: err.toString() });
        }
      };
    `;

    const workerBlob = new Blob([workerScript], { type: 'text/javascript' });
    this.worker = new Worker(URL.createObjectURL(workerBlob));

    this.worker.onmessage = (e: MessageEvent) => {
      const { id, type, data } = e.data;
      if (type === 'LOG') {
        // Double-check normalization to string
        const msgStr = typeof data === 'string' ? data : JSON.stringify(data);
        this.logCallback?.(msgStr);
        return;
      }
      if (type === 'PROGRESS') {
        this.progressCallback?.({ progress: data });
        return;
      }
      const cb = this.callbacks.get(id);
      if (!cb) return;
      if (type === 'ERROR') {
        cb.reject(new Error(data));
      } else {
        cb.resolve(data);
      }
      this.callbacks.delete(id);
    };

    await this.send('LOAD', { coreURL, wasmBinary }, [wasmBinary]);
    this.loaded = true;
  }

  private async send(type: string, data?: any, transfer: Transferable[] = []): Promise<any> {
    if (!this.worker) throw new Error('Worker not initialized');
    const id = this.messageId++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.worker!.postMessage({ id, type, data }, transfer);
    });
  }

  async exec(args: string[]) {
    return this.send('EXEC', { args });
  }

  async writeFile(path: string, data: Uint8Array) {
    return this.send('WRITE_FILE', { path, data });
  }

  async readFile(path: string): Promise<Uint8Array> {
    return this.send('READ_FILE', { path });
  }

  async deleteFile(path: string) {
    return this.send('DELETE_FILE', { path });
  }

  onProgress(cb: (p: { progress: number }) => void) {
    this.progressCallback = cb;
  }
}

export const ffmpegService = new FFmpegService();
