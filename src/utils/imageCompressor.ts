/**
 * Helper to compress and scale down image files before saving to Firestore.
 * Prevents "Document size limit exceeded (>1MB)" errors in Firebase.
 */
export async function compressImage(
  input: File | Blob | string,
  maxWidth: number = 280,
  maxHeight: number = 280,
  quality: number = 0.8
): Promise<string> {
  return new Promise((resolve, reject) => {
    const processImageSrc = (src: string) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = src;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(width, 1);
        canvas.height = Math.max(height, 1);

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(src);
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Try PNG first to preserve transparency
        const pngData = canvas.toDataURL('image/png');
        if (pngData.length < 80 * 1024) {
          resolve(pngData);
          return;
        }

        // Try WebP next (supports transparency and high compression)
        const webpData = canvas.toDataURL('image/webp', quality);
        if (webpData.startsWith('data:image/webp') && webpData.length < 100 * 1024) {
          resolve(webpData);
          return;
        }

        // Fallback: draw with clean background for JPEG if needed
        const jpgCanvas = document.createElement('canvas');
        jpgCanvas.width = width;
        jpgCanvas.height = height;
        const jpgCtx = jpgCanvas.getContext('2d');
        if (jpgCtx) {
          jpgCtx.fillStyle = '#ffffff';
          jpgCtx.fillRect(0, 0, width, height);
          jpgCtx.drawImage(img, 0, 0, width, height);
          const jpegData = jpgCanvas.toDataURL('image/jpeg', quality);
          resolve(jpegData);
        } else {
          resolve(pngData);
        }
      };
      img.onerror = (err) => reject(err);
    };

    if (typeof input === 'string') {
      processImageSrc(input);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        processImageSrc(e.target?.result as string);
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(input);
    }
  });
}

