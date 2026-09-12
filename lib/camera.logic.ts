/**
 * Shared utility for processing and compressing images from the camera.
 * Adds watermark and checks for brightness to ensure quality.
 */

export const getAverageBrightness = (canvas: HTMLCanvasElement): number => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return 255;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    let total = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 40) {
        total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        count++;
    }
    return count > 0 ? total / count : 255;
};

export interface CompressImageOptions {
    maxWidth?: number;
    quality?: number;
    minBrightness?: number;
    watermarkText?: string;
    fontSize?: number;
}

export const compressImageWithWatermark = (file: File, options: CompressImageOptions = {}): Promise<string> => {
    const {
        maxWidth = 600,
        quality = 0.5,
        minBrightness = 40,
        watermarkText = '',
        fontSize = 14
    } = options;

    return new Promise((resolve, reject) => {
        const img = new window.Image();
        const url = URL.createObjectURL(file);
        
        img.onload = () => {
            URL.revokeObjectURL(url);
            const canvas = document.createElement('canvas');
            let { width, height } = img;
            
            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }
            
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) { 
                reject(new Error('Canvas not supported')); 
                return; 
            }
            ctx.drawImage(img, 0, 0, width, height);

            // 🔆 Kiểm tra độ sáng
            const brightness = getAverageBrightness(canvas);
            if (brightness < minBrightness) {
                reject(new Error('TOO_DARK'));
                return;
            }

            // Mặc định luôn có watermark ngày giờ nếu không truyền
            const now = new Date();
            const vnTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
            const pad = (n: number) => String(n).padStart(2, '0');
            const timeStr = `${pad(vnTime.getHours())}:${pad(vnTime.getMinutes())}:${pad(vnTime.getSeconds())}`;
            const dateStr = `${pad(vnTime.getDate())}/${pad(vnTime.getMonth() + 1)}/${vnTime.getFullYear()}`;
            
            const finalWatermarkText = watermarkText 
                ? `${timeStr}  ${dateStr}  ${watermarkText}`
                : `${timeStr}  ${dateStr}`;

            ctx.font = `bold ${fontSize}px Arial`;
            ctx.textBaseline = 'top';
            const textWidth = ctx.measureText(finalWatermarkText).width;
            
            ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
            ctx.fillRect(8, 8, textWidth + 16, fontSize + 12);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(finalWatermarkText, 16, 14);

            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = url;
    });
};
