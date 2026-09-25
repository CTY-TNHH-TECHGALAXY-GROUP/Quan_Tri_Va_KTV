/**
 * Text dictionary for AI Features page.
 */
export const t = {
    // Page
    pageTitle: 'AI Studio (Ảnh & Video)',
    pageSubtitle: 'Tạo nội dung marketing chuyên nghiệp cho Spa bằng AI.',

    // Permission
    noAccess: 'Không có quyền truy cập',

    // Tabs
    tabImage: 'Tạo Ảnh (Nano Banana Pro)',
    tabVideo: 'Tạo Video từ Ảnh (Veo)',

    // Image tab
    imagePromptLabel: 'Mô tả ảnh cần tạo',
    imagePromptPlaceholder: 'Ví dụ: Một không gian spa sang trọng với ánh sáng ấm áp, có giường massage và tinh dầu...',
    imageSizeLabel: 'Kích thước ảnh',
    generateImage: 'Tạo Ảnh Ngay',
    generatingImage: 'Đang tạo ảnh...',

    // Video tab
    uploadLabel: 'Tải ảnh lên',
    uploadDragDrop: 'Kéo thả hoặc nhấn để tải ảnh lên',
    uploadFormats: 'Hỗ trợ JPG, PNG',
    changeImage: 'Nhấn để thay đổi ảnh',
    videoRatioLabel: 'Tỷ lệ Video',
    generateVideo: 'Tạo Video',
    generatingVideo: 'Đang tạo video (có thể mất vài phút)...',

    // Video ratio options
    ratioLandscape: '16:9 (Ngang - Youtube)',
    ratioPortrait: '9:16 (Dọc - Tiktok/Reels)',

    // Result
    resultTitle: 'Kết quả:',
    videoSuccess: 'Video đã tạo thành công!',
    videoMockNote: 'Đây là bản demo, video thực tế sẽ hiển thị ở đây.',

    // Errors
    noApiKey: 'Chưa cấu hình Gemini API Key. Vui lòng thiết lập biến môi trường NEXT_PUBLIC_GEMINI_API_KEY.',
} as const;
