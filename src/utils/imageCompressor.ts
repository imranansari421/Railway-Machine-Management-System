/**
 * Helper to compress and scale down image files before saving to Firestore.
 * Prevents "Document size limit exceeded (>1MB)" errors in Firebase.
 */
export async function compressImage(
  file: File,
  maxWidth: number = 300,
  maxHeight: number = 300,
  quality: number = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(event.target?.result as string);
          return;
        }

        // Fill background white in case of transparent PNG converted to JPEG
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/png');
        // If dataUrl is small enough (< 300KB), return PNG, else fallback to JPEG
        if (dataUrl.length < 400 * 1024) {
          resolve(dataUrl);
        } else {
          const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(jpegDataUrl);
        }
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}
