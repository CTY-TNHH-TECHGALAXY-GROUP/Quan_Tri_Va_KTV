'use client';

import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import Image from 'next/image';
import { ShieldAlert, Image as ImageIcon, Video, Wand2, Loader2, Upload } from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import { useAIFeatures } from './AIFeatures.logic';
import { t } from './AIFeatures.i18n';

// 🔧 UI CONFIGURATION
const IMAGE_SIZES = ['1K', '2K', '4K'];
const VIDEO_RATIOS = [
    { id: '16:9', label: t.ratioLandscape },
    { id: '9:16', label: t.ratioPortrait },
];

export default function AIFeaturesPage() {
    const {
        prompt,
        imageSize,
        aspectRatio,
        isGenerating,
        resultUrl,
        sourceImage,
        mounted,
        canAccessPage,
        setPrompt,
        setImageSize,
        setAspectRatio,
        handleMount,
        handleImageUpload,
        handleGenerateImage,
        handleGenerateVideo,
    } = useAIFeatures();

    React.useEffect(() => { handleMount(); }, []);

    if (!mounted) return null;

    if (!canAccessPage) {
        return (
            <AppLayout title="AI Assistant">
                <div className="flex flex-col items-center justify-center h-64 text-center">
                    <ShieldAlert size={48} className="text-red-500 mb-4" />
                    <h2 className="text-xl font-bold text-gray-900">{t.noAccess}</h2>
                </div>
            </AppLayout>
        );
    }

    return (
        <AppLayout title="AI Assistant">
            <div className="space-y-6 max-w-4xl mx-auto">
                <div>
                    <p className="text-sm text-gray-500">{t.pageSubtitle}</p>
                </div>

                <Tabs.Root defaultValue="image" className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                    <Tabs.List className="flex border-b border-gray-100 bg-gray-50/50">
                        <Tabs.Trigger value="image" className="flex-1 py-4 px-6 font-medium text-sm text-gray-600 hover:text-indigo-600 data-[state=active]:text-indigo-700 data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-indigo-600 flex items-center justify-center gap-2 transition-all">
                            <ImageIcon size={18} />
                            {t.tabImage}
                        </Tabs.Trigger>
                        <Tabs.Trigger value="video" className="flex-1 py-4 px-6 font-medium text-sm text-gray-600 hover:text-indigo-600 data-[state=active]:text-indigo-700 data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-indigo-600 flex items-center justify-center gap-2 transition-all">
                            <Video size={18} />
                            {t.tabVideo}
                        </Tabs.Trigger>
                    </Tabs.List>

                    <div className="p-6">
                        <Tabs.Content value="image" className="space-y-6 animate-in fade-in duration-300">
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">{t.imagePromptLabel}</label>
                                    <textarea
                                        value={prompt}
                                        onChange={(e) => setPrompt(e.target.value)}
                                        placeholder={t.imagePromptPlaceholder}
                                        className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none h-24 text-sm"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">{t.imageSizeLabel}</label>
                                    <div className="flex gap-3">
                                        {IMAGE_SIZES.map(size => (
                                            <button
                                                key={size}
                                                onClick={() => setImageSize(size)}
                                                className={`flex-1 py-2 px-4 rounded-lg border text-sm font-medium transition-colors ${imageSize === size
                                                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                                                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                                }`}
                                            >
                                                {size}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <button
                                    onClick={handleGenerateImage}
                                    disabled={!prompt || isGenerating}
                                    className="w-full py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
                                >
                                    {isGenerating ? (
                                        <><Loader2 size={18} className="animate-spin" /> {t.generatingImage}</>
                                    ) : (
                                        <><Wand2 size={18} /> {t.generateImage}</>
                                    )}
                                </button>
                            </div>
                        </Tabs.Content>

                        <Tabs.Content value="video" className="space-y-6 animate-in fade-in duration-300">
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">{t.uploadLabel}</label>
                                    <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:bg-gray-50 transition-colors relative">
                                        <input
                                            type="file"
                                            accept="image/*"
                                            onChange={handleImageUpload}
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                        />
                                        {sourceImage ? (
                                            <div className="flex flex-col items-center">
                                                <Image
                                                    src={sourceImage}
                                                    alt="Source"
                                                    width={200}
                                                    height={128}
                                                    className="h-32 w-auto object-contain rounded-lg mb-3 shadow-sm"
                                                    referrerPolicy="no-referrer"
                                                />
                                                <span className="text-sm text-indigo-600 font-medium">{t.changeImage}</span>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center text-gray-500">
                                                <Upload size={32} className="mb-2 text-gray-400" />
                                                <p className="text-sm font-medium text-gray-700">{t.uploadDragDrop}</p>
                                                <p className="text-xs mt-1">{t.uploadFormats}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">{t.videoRatioLabel}</label>
                                    <div className="flex gap-3">
                                        {VIDEO_RATIOS.map(ratio => (
                                            <button
                                                key={ratio.id}
                                                onClick={() => setAspectRatio(ratio.id)}
                                                className={`flex-1 py-2 px-4 rounded-lg border text-sm font-medium transition-colors ${aspectRatio === ratio.id
                                                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                                                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                                }`}
                                            >
                                                {ratio.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <button
                                    onClick={handleGenerateVideo}
                                    disabled={!sourceImage || isGenerating}
                                    className="w-full py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
                                >
                                    {isGenerating ? (
                                        <><Loader2 size={18} className="animate-spin" /> {t.generatingVideo}</>
                                    ) : (
                                        <><Video size={18} /> {t.generateVideo}</>
                                    )}
                                </button>
                            </div>
                        </Tabs.Content>
                    </div>

                    {/* Result Area */}
                    {resultUrl && (
                        <div className="p-6 border-t border-gray-100 bg-gray-50">
                            <h3 className="text-sm font-medium text-gray-700 mb-3">{t.resultTitle}</h3>
                            <div className="bg-white p-2 rounded-xl border border-gray-200 shadow-sm flex items-center justify-center min-h-[300px]">
                                {resultUrl === 'video_mock' ? (
                                    <div className="text-center">
                                        <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-3">
                                            <Video size={32} />
                                        </div>
                                        <p className="font-medium text-gray-900">{t.videoSuccess}</p>
                                        <p className="text-sm text-gray-500 mt-1">{t.videoMockNote}</p>
                                    </div>
                                ) : (
                                    <Image
                                        src={resultUrl}
                                        alt="Generated AI"
                                        width={800}
                                        height={500}
                                        className="max-w-full max-h-[500px] w-auto h-auto rounded-lg object-contain"
                                        referrerPolicy="no-referrer"
                                    />
                                )}
                            </div>
                        </div>
                    )}
                </Tabs.Root>
            </div>
        </AppLayout>
    );
}
