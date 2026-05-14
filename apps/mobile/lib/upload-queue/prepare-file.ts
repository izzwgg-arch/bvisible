import * as FileSystem from 'expo-file-system';
import { Image } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';

const LONG_EDGE_MAX = 2048;
const COMPRESS_BYTES_THRESHOLD = 2.5 * 1024 * 1024;

export interface PreparedFile {
  uri: string;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
}

function isRasterImage(mime: string): boolean {
  return (
    mime === 'image/jpeg' ||
    mime === 'image/png' ||
    mime === 'image/webp'
  );
}

function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  if (i <= 0) return name;
  return name.slice(0, i);
}

/**
 * Downscale large camera photos (JPEG/PNG/WEBP). PDFs unchanged.
 */
export async function prepareUploadFile(args: {
  localUri: string;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
}): Promise<PreparedFile> {
  const { localUri, mimeType } = args;
  let { sizeBytes, originalFilename } = args;

  if (!isRasterImage(mimeType)) {
    return { uri: localUri, mimeType, sizeBytes, originalFilename };
  }

  let width = 0;
  let height = 0;
  try {
    const dim = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      Image.getSize(
        localUri,
        (w, h) => resolve({ w, h }),
        (err) => reject(err ?? new Error('image_size'))
      );
    });
    width = dim.w;
    height = dim.h;
  } catch {
    width = LONG_EDGE_MAX + 1;
    height = LONG_EDGE_MAX + 1;
  }

  const longEdge = Math.max(width, height);
  const needsResize = longEdge > LONG_EDGE_MAX;
  const needsShrinkBytes = sizeBytes >= COMPRESS_BYTES_THRESHOLD;

  if (!needsResize && !needsShrinkBytes) {
    return { uri: localUri, mimeType, sizeBytes, originalFilename };
  }

  const actions: ImageManipulator.Action[] = [];
  if (needsResize && width > 0 && height > 0) {
    if (width >= height) {
      actions.push({ resize: { width: LONG_EDGE_MAX } });
    } else {
      actions.push({ resize: { height: LONG_EDGE_MAX } });
    }
  }

  const compress = needsShrinkBytes ? 0.82 : 0.9;
  const result = await ImageManipulator.manipulateAsync(
    localUri,
    actions,
    {
      compress,
      format: ImageManipulator.SaveFormat.JPEG,
    }
  );

  const info = await FileSystem.getInfoAsync(result.uri, { size: true });
  const nextSize =
    info.exists && typeof info.size === 'number' ? info.size : sizeBytes;

  const base = stripExt(originalFilename.replace(/[/\\]/g, '') || 'photo');
  const nextName = `${base}.jpg`;

  return {
    uri: result.uri,
    mimeType: 'image/jpeg',
    sizeBytes: nextSize,
    originalFilename: nextName,
  };
}
