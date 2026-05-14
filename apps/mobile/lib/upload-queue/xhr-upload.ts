/**
 * PUT with upload progress (React Native XMLHttpRequest).
 */
export async function putUriWithProgress(args: {
  uri: string;
  url: string;
  authorizationBearer: string;
  onProgress: (percent0to100: number) => void;
}): Promise<void> {
  const { uri, url, authorizationBearer, onProgress } = args;

  const res = await fetch(uri);
  const blob = await res.blob();

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Authorization', `Bearer ${authorizationBearer}`);

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0) {
        onProgress(Math.min(100, Math.round((ev.loaded / ev.total) * 100)));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new Error('Upload aborted'));

    xhr.send(blob);
  });
}
