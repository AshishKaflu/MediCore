const DEFAULT_MAX_DIMENSION = 1280;
const DEFAULT_QUALITY = 0.72;

export async function fileToOptimizedDataUrl(
  file: File,
  options?: {
    maxDimension?: number;
    quality?: number;
    mimeType?: string;
  }
): Promise<string> {
  const maxDimension = options?.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const quality = options?.quality ?? DEFAULT_QUALITY;
  const mimeType = options?.mimeType ?? 'image/jpeg';

  const bitmap = await createImageBitmap(file);

  let width = bitmap.width;
  let height = bitmap.height;
  const largestDimension = Math.max(width, height);

  if (largestDimension > maxDimension) {
    const scale = maxDimension / largestDimension;
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('Could not prepare image for upload');
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return canvas.toDataURL(mimeType, quality);
}
