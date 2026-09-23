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

## 1b. A → B Transition (v1.2)

The default view takes **two videos** and datamoshes from one into the other, the classic I-frame-removal melt:

1. Clip A plays clean up to the **cut point**.
2. Clip B's keyframe is dropped and **every B delta frame plays 1:1** on top of A's last frame: B's motion drags A's pixels while B's residuals paint B back in.
3. **Resolve** (no engineered keyframe pop):
   - **Melt**: B keeps moshing until its own frames take over.
   - **Sweep**: after a set melt, clean B sweeps in by 16 px columns, left to right, like an x264 periodic intra refresh (composited in the decoder output, since a real intra-refresh encode cannot share A's stream headers).
   - **Hold**: drops B's intra-heavy delta frames (tomato.py `-k 0.7` style) so the melt lasts longer.

Controls: cut point, resolve, melt-before-sweep and sweep time (Sweep), **heal speed** (B residual strength via x264 CRF 36→14), **bloom burst** (0–12 replayed frames at the cut only), audio. A's tail and B are encoded with identical x264 headers (`stitchable=1`, `sc_threshold 0`, no B-frames). Output size follows clip A; B is letterboxed to fit.

v1.1 replayed every B frame (Smear) and spliced in a clean B keyframe, which produced a one-frame hard cut (SSIM +0.44 in one frame on the S25B→S19 test) and a pose jump. v1.2 on the same clips: largest single-frame SSIM rise 0.08 across the sweep.

- `src/services/abTransition.ts`: pure frame planning and packet splicing (unit tested in `tests/abTransition.test.ts`).
- `renderABTransition` in `src/services/datamoshEngine.ts`: the render pipeline. Every segment is normalized to 30 fps x264 before the stream-copy join, because mixed timebases collapse timestamps.
- The original multi-region studio is still available under **Timeline**.

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
