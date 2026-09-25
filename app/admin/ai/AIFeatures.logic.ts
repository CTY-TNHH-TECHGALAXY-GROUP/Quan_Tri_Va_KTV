'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { GoogleGenAI } from '@google/genai';

/**
 * Custom hook for AI Features page logic.
 * Handles image generation (Gemini) and video generation (Veo mock).
 */
export const useAIFeatures = () => {
    const { hasPermission } = useAuth();
    const [prompt, setPrompt] = useState('');
    const [imageSize, setImageSize] = useState('1K');
    const [aspectRatio, setAspectRatio] = useState('16:9');
    const [isGenerating, setIsGenerating] = useState(false);
    const [resultUrl, setResultUrl] = useState<string | null>(null);
    const [sourceImage, setSourceImage] = useState<string | null>(null);
    const [mounted, setMounted] = useState(false);

    const canAccessPage = hasPermission('ai_features');

    // --- HANDLERS ---
    const handleMount = () => setMounted(true);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setSourceImage(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleGenerateImage = async () => {
        if (!prompt) return;
        setIsGenerating(true);
        setResultUrl(null);

        try {
            const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
            if (!apiKey) {
                alert('Chưa cấu hình Gemini API Key. Vui lòng thiết lập biến môi trường NEXT_PUBLIC_GEMINI_API_KEY.');
                return;
            }
            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: [{ parts: [{ text: prompt }] }],
                config: {
                    imageConfig: {
                        aspectRatio: aspectRatio as any,
                    },
                },
            });

            for (const part of response.candidates?.[0]?.content?.parts || []) {
                if (part.inlineData) {
                    const base64Data = part.inlineData.data;
                    setResultUrl(`data:image/png;base64,${base64Data}`);
                    break;
                }
            }
        } catch (error) {
            console.error('Error generating image:', error);
            alert('Đã xảy ra lỗi khi gọi Gemini API. Vui lòng kiểm tra lại cấu hình.');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleGenerateVideo = async () => {
        if (!sourceImage) {
            alert('Vui lòng tải lên một ảnh để tạo video.');
            return;
        }
        setIsGenerating(true);
        setResultUrl(null);

        try {
            await new Promise(resolve => setTimeout(resolve, 5000));
            setResultUrl('video_mock');
        } catch (error) {
            console.error('Error generating video:', error);
            alert('Đã xảy ra lỗi khi tạo video.');
        } finally {
            setIsGenerating(false);
        }
    };

    return {
        // State
        prompt,
        imageSize,
        aspectRatio,
        isGenerating,
        resultUrl,
        sourceImage,
        mounted,

        // Computed
        canAccessPage,

        // Setters
        setPrompt,
        setImageSize,
        setAspectRatio,

        // Handlers
        handleMount,
        handleImageUpload,
        handleGenerateImage,
        handleGenerateVideo,
    };
};
