import { supabase } from './supabase';
import { generateId } from './id';
import { fileToOptimizedDataUrl, fileToOptimizedJpegBlob } from './image';

export const PHOTO_BUCKET = 'medicore-photos';

const hasSupabaseKeys = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
);

export function isStorageUrl(value?: string | null): boolean {
  return Boolean(value && value.includes(`/storage/v1/object/public/${PHOTO_BUCKET}/`));
}

function mapStorageUploadError(error: { message?: string; statusCode?: string | number } | null): Error {
  const rawMessage = String(error?.message || '').toLowerCase();
  const rawStatus = String(error?.statusCode || '').toLowerCase();

  if (
    rawMessage.includes('bucket not found') ||
    rawMessage.includes('not found') ||
    rawStatus === '404'
  ) {
    return new Error(
      `Photo storage is not configured. Create the "${PHOTO_BUCKET}" Supabase storage bucket or rerun the updated supabase_schema.sql setup.`
    );
  }

  return new Error(error?.message || 'Failed to upload image');
}

export async function uploadImageToStorage(
  file: File,
  folder: 'caregivers' | 'patients' | 'medications'
): Promise<string> {
  if (!hasSupabaseKeys) {
    throw new Error('Supabase keys missing');
  }

  const blob = await fileToOptimizedJpegBlob(file, {
    maxDimension: folder === 'caregivers' ? 720 : 960,
    quality: 0.72,
  });

  const objectPath = `${folder}/${generateId()}.jpg`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(objectPath, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  });

  if (error) {
    throw mapStorageUploadError(error);
  }

  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}

export async function saveImageWithFallback(
  file: File,
  folder: 'caregivers' | 'patients' | 'medications'
): Promise<{ photo: string; storedInCloud: boolean; warning?: string }> {
  try {
    const photo = await uploadImageToStorage(file, folder);
    return { photo, storedInCloud: true };
  } catch (error) {
    console.warn('Falling back to local photo storage', error);

    const photo = await fileToOptimizedDataUrl(file, {
      maxDimension: folder === 'caregivers' ? 720 : 960,
      quality: 0.72,
      mimeType: 'image/jpeg',
    });

    const warning =
      error instanceof Error
        ? `${error.message} The photo was saved locally on this device instead.`
        : 'Cloud photo upload failed. The photo was saved locally on this device instead.';

    return {
      photo,
      storedInCloud: false,
      warning,
    };
  }
}

export async function removeImageFromStorage(photoUrl?: string | null): Promise<void> {
  if (!photoUrl || !isStorageUrl(photoUrl)) return;

  const marker = `/storage/v1/object/public/${PHOTO_BUCKET}/`;
  const index = photoUrl.indexOf(marker);
  if (index < 0) return;

  const objectPath = photoUrl.slice(index + marker.length);
  if (!objectPath) return;

  const { error } = await supabase.storage.from(PHOTO_BUCKET).remove([objectPath]);
  if (error) {
    console.warn('Failed to remove storage image', error);
  }
}
