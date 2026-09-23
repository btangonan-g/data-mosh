# Data Mosh (`data-mosh`)

Browser-native generative video datamosh transition studio powered by **WebCodecs hardware acceleration**, **FFmpeg WASM**, and **mediabunny**.

Originally extracted from Google Flow Tool `BT_Datamosh` and engineered into a standalone, local-first web application.

---

## 1. Overview & Transition Mechanism

Datamoshing creates visual transitions between two video clips by manipulating video compression stream packets directly:

1. **Source Keyframe Anchor**: The engine isolates the anchor I-frame (keyframe) from the primary video (`Clip A`).
2. **Delta Motion Vector Transplant**: It strips the I-frame from the secondary transition video (`Clip B`) and transplants its P-frames and B-frames directly onto the keyframe of `Clip A`.
3. **Hardware WebCodecs Decode & Encode**:
   - `VideoDecoder`: Batch-decodes the corrupted packet stream without interval delays. The motion vectors from `Clip B` physically smear and drag the pixels of `Clip A`.
   - `VideoEncoder`: Re-encodes the resulting warped frames via hardware H.264 into a clean, standards-compliant MP4 file using `mediabunny`.
4. **Non-Destructive Multi-Region Timeline**: Users can define multiple transition and mosh regions (`liquid`, `bloom`, `stutter`, `transition`, `reverse`, `pulse`) across the timeline with millisecond precision and audio preservation.

---

## 2. Architecture & Modules

- **`src/services/datamoshEngine.ts`**: The core timeline rendering pipeline. Manages single-GOP re-encoding (`-g 99999999`), packet stream splicing, WebCodecs hardware decode/encode, and concat demuxing.
- **`src/services/ffmpegService.ts`**: Standalone web worker manager for FFmpeg WASM core. Bypasses CORS and packaging constraints by managing the worker lifecycle directly.
- **`src/components/Timeline.tsx`**: Multi-track visual timeline for setting mosh in/out points, adjusting transition intensity, and scrub playback.
- **`src/components/Sidebar.tsx`**: Preset inspector, transition clip uploader, audio mode selector, and render controls.
- **`src/components/VideoUploader.tsx`**: Drag-and-drop video importer.
- **`src/flow-sdk.ts`**: Dual-target bridge providing native browser fallbacks (`HTMLInputElement`, `URL.createObjectURL`) when running locally, while retaining compatibility with Google Flow.

---

## 3. Quick Start (Local Run)

```bash
# 1. Install dependencies
npm install

# 2. Run unit tests
npm test

# 3. Start local development server
npm run dev
```

Visit `http://localhost:5173` to launch the Datamosh Studio.

---

## 4. Verification

```bash
npm run build
npm test
```
