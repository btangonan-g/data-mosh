/**
 * flow-sdk Local Shim
 * 
 * Provides local browser fallbacks for Google Flow SDK APIs,
 * allowing the datamosh application to run both locally and inside Google Flow.
 */

export interface MediaSelectOptions {
  filter?: "video" | "image" | "audio" | "all";
}

export interface MediaResult {
  id?: string;
  mediaId?: string;
  dataUrl?: string;
  base64?: string;
  mimeType?: string;
  name?: string;
  type?: "video" | "image" | "audio" | string;
  file?: File;
  duration?: number;
}

export interface FlowSaveOptions {
  data?: Uint8Array | Blob;
  base64?: string;
  filename?: string;
  name?: string;
  mimeType?: string;
}

export const Flow = {
  media: {
    select: async (options: MediaSelectOptions = {}): Promise<MediaResult | null> => {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = options.filter === "video" ? "video/*" : "video/*,image/*";
        input.onchange = async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) {
            resolve(null);
            return;
          }
          const dataUrl = URL.createObjectURL(file);
          const buf = await file.arrayBuffer();
          let binary = "";
          const bytes = new Uint8Array(buf);
          const len = bytes.byteLength;
          for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);

          resolve({
            id: `media_${Date.now()}`,
            mediaId: `media_${Date.now()}`,
            dataUrl,
            base64,
            mimeType: file.type || "video/mp4",
            name: file.name,
            type: "video",
            file,
          });
        };
        input.oncancel = () => resolve(null);
        input.click();
      });
    },
  },
  save: async ({ data, base64, filename, mimeType }: FlowSaveOptions): Promise<void> => {
    let blob: Blob;
    if (data instanceof Blob) {
      blob = data;
    } else if (data) {
      blob = new Blob([data as any], { type: mimeType || "video/mp4" });
    } else if (base64) {
      const bin = atob(base64.replace(/\s/g, ""));
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        arr[i] = bin.charCodeAt(i);
      }
      blob = new Blob([arr as any], { type: mimeType || "video/mp4" });
    } else {
      throw new Error("No data or base64 provided to Flow.save");
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "datamosh_transition.mp4";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
};
