/**
 * Image Processing Utilities
 *
 * Helper functions for image compression, resizing, and format conversion.
 * Used by PhotoService and CameraService for optimizing photos before storage.
 */

/**
 * Compresses an image blob to reduce file size
 *
 * @param blob - Original image Blob
 * @param maxDimension - Maximum width/height in pixels (default: 1920)
 * @param quality - JPEG quality 0.0-1.0 (default: 0.85)
 * @returns Promise resolving to compressed Blob
 */
export async function compressImage(
  blob: Blob,
  maxDimension: number = 1920,
  quality: number = 0.85
): Promise<Blob> {
  const img = await loadImageFromBlob(blob);

  // Calculate new dimensions (maintaining aspect ratio)
  let { width, height } = img;
  if (width > maxDimension || height > maxDimension) {
    if (width > height) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
  }

  // Draw to canvas at new size
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  ctx.drawImage(img, 0, 0, width, height);

  // Convert to Blob with quality compression
  const compressedBlob = await canvasToBlob(canvas, 'image/jpeg', quality);
  return compressedBlob;
}

/**
 * Generates a square thumbnail from an image
 *
 * @param blob - Original image Blob
 * @param size - Thumbnail dimensions (default: 200x200)
 * @returns Promise resolving to thumbnail Blob
 */
export async function generateThumbnail(blob: Blob, size: number = 200): Promise<Blob> {
  const img = await loadImageFromBlob(blob);

  // Create square canvas
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // Calculate crop dimensions to maintain aspect ratio
  const { width, height } = img;
  const aspectRatio = width / height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = width;
  let sourceHeight = height;

  if (aspectRatio > 1) {
    // Landscape: crop width
    sourceWidth = height;
    sourceX = (width - height) / 2;
  } else {
    // Portrait: crop height
    sourceHeight = width;
    sourceY = (height - width) / 2;
  }

  // Draw cropped and scaled image
  ctx.drawImage(
    img,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    size,
    size
  );

  // Convert to Blob
  const thumbnailBlob = await canvasToBlob(canvas, 'image/jpeg', 0.8);
  return thumbnailBlob;
}

/**
 * Converts a Blob to a data URL
 *
 * @param blob - Image Blob
 * @returns Promise resolving to base64 data URL
 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert blob to data URL'));
      }
    };
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Converts a data URL to a Blob
 *
 * @param dataUrl - Base64 data URL
 * @returns Blob
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(',');
  const match = arr[0].match(/:(.*?);/);
  const mime = match ? match[1] : 'image/jpeg';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);

  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }

  return new Blob([u8arr], { type: mime });
}

/**
 * Resizes an image to exact dimensions
 *
 * @param blob - Original image Blob
 * @param width - Target width
 * @param height - Target height
 * @param quality - JPEG quality 0.0-1.0 (default: 0.9)
 * @returns Promise resolving to resized Blob
 */
export async function resizeImage(
  blob: Blob,
  width: number,
  height: number,
  quality: number = 0.9
): Promise<Blob> {
  const img = await loadImageFromBlob(blob);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  ctx.drawImage(img, 0, 0, width, height);

  const resizedBlob = await canvasToBlob(canvas, 'image/jpeg', quality);
  return resizedBlob;
}

/**
 * Gets image dimensions from a Blob
 *
 * @param blob - Image Blob
 * @returns Promise resolving to { width, height }
 */
export async function getImageDimensions(
  blob: Blob
): Promise<{ width: number; height: number }> {
  const img = await loadImageFromBlob(blob);
  return { width: img.width, height: img.height };
}

/**
 * Validates if a file is a supported image type
 *
 * @param file - File to check
 * @returns true if file is a supported image
 */
export function isValidImageType(file: File | Blob): boolean {
  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/webp'];
  return validTypes.includes(file.type);
}

/**
 * Validates image file size
 *
 * @param blob - Image Blob
 * @param maxSizeBytes - Maximum allowed size in bytes (default: 20MB)
 * @returns true if size is within limit
 */
export function isValidImageSize(blob: Blob, maxSizeBytes: number = 20 * 1024 * 1024): boolean {
  return blob.size <= maxSizeBytes;
}

/**
 * Helper: Load image from Blob into HTMLImageElement
 */
function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

/**
 * Helper: Convert canvas to Blob
 */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string = 'image/jpeg',
  quality: number = 0.9
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to convert canvas to blob'));
        }
      },
      mimeType,
      quality
    );
  });
}
