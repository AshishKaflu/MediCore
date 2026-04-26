const DEFAULT_MAX_DIMENSION = 1280;
const DEFAULT_QUALITY = 0.72;
export const IMAGE_FILE_ACCEPT =
  'image/*,.jpg,.jpeg,.png,.webp,.avif,.heic,.heif';

type DecodedImage = {
  width: number;
  height: number;
  close: () => void;
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void;
};

function buildUnsupportedImageError(file: File): Error {
  const extension = file.name.includes('.') ? file.name.split('.').pop()?.toUpperCase() : '';
  const label = extension || file.type || 'this image';

  return new Error(
    `This browser could not read ${label}. JPG, JPEG, PNG, WEBP, and AVIF should work. HEIC/HEIF depends on browser support and may need conversion on some devices.`
  );
}

async function decodeWithImageBitmap(file: File): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(file);
  return {
    width: bitmap.width,
    height: bitmap.height,
    close: () => bitmap.close(),
    draw: (context, width, height) => context.drawImage(bitmap, 0, 0, width, height),
  };
}

async function decodeWithHtmlImage(file: File): Promise<DecodedImage> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image element could not decode file'));
      img.src = objectUrl;
    });

    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(objectUrl),
      draw: (context, width, height) => context.drawImage(image, 0, 0, width, height),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function decodeImageFile(file: File): Promise<DecodedImage> {
  try {
    return await decodeWithImageBitmap(file);
  } catch {
    try {
      return await decodeWithHtmlImage(file);
    } catch {
      throw buildUnsupportedImageError(file);
    }
  }
}

async function fileToOptimizedBlob(
  file: File,
  options?: {
    maxDimension?: number;
    quality?: number;
    mimeType?: string;
  }
): Promise<Blob> {
  const maxDimension = options?.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const quality = options?.quality ?? DEFAULT_QUALITY;
  const mimeType = options?.mimeType ?? 'image/jpeg';

  const image = await decodeImageFile(file);

  let width = image.width;
  let height = image.height;
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
    image.close();
    throw new Error('Could not prepare image for upload');
  }

  image.draw(context, width, height);
  image.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mimeType, quality)
  );

  if (!blob) {
    throw new Error('Could not export optimized image');
  }

  return blob;
}

export async function fileToOptimizedDataUrl(
  file: File,
  options?: {
    maxDimension?: number;
    quality?: number;
    mimeType?: string;
  }
): Promise<string> {
  const blob = await fileToOptimizedBlob(file, options);
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error('Could not read optimized image'));
    reader.readAsDataURL(blob);
  });
}

export async function fileToOptimizedJpegBlob(
  file: File,
  options?: {
    maxDimension?: number;
    quality?: number;
  }
): Promise<Blob> {
  return fileToOptimizedBlob(file, { ...options, mimeType: 'image/jpeg' });
}
