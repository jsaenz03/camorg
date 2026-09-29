/**
 * Downscale a photo data URL for on-screen preview.
 *
 * The report page shows up to 50 photos; full-size data URLs run to many MB
 * of strings each, and that total can push the Windows WebView2 renderer
 * past its memory ceiling — the window turns white and the app "randomly
 * crashes". 1200px covers the preview (and window.print rasterisation) at
 * well past screen density. Falls back to the original on any failure, so a
 * decode hiccup degrades to today's behaviour rather than dropping a photo.
 */
export async function downscaleImageDataUrl(
  dataUrl: string,
  maxEdge = 1200,
  quality = 0.85
): Promise<string> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image decode failed'));
      el.src = dataUrl;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale >= 1) return dataUrl;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return dataUrl;
  }
}
