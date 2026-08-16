import { useState, useMemo, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { ChildBookingForFeedback, FeedbackKtvInfo } from '../FeedbackDashboard.logic';

export type MergedFeedbackGroup = {
    ktvId: string;
    ktvName: string;
    serviceNames: string[];
    itemIds: string[];
};

export function useKioskFeedback(booking: ChildBookingForFeedback, onClose: () => void) {
    const [step, setStep] = useState<1 | 2>(1);
    const langCode = booking.customerLang?.toUpperCase() || 'VN';
    const initialLang = (['VN', 'EN', 'KR', 'JP'].includes(langCode)) ? (langCode as 'VN' | 'EN' | 'KR' | 'JP') : 'VN';
    const [language, setLanguage] = useState<'VN' | 'EN' | 'KR' | 'JP'>(initialLang);
    
    // State lưu điểm (từ 1 đến 5 sao) cho từng KTV (key = ktvId)
    const [ratings, setRatings] = useState<Record<string, number>>({});
    // State lưu ghi chú nếu khách muốn gõ thêm
    const [comments, setComments] = useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Reset state khi đổi khách (chuyển tab)
    useEffect(() => {
        setStep(1);
        setRatings({});
        setComments({});
    }, [booking.id]);

    // Xử lý logic gộp KTV:
    // User Yêu cầu: "nếu chung 1 KTV thì hiện 1 dịch vụ gộp + tên ktv luôn. nếu 1 đơn lẻ gộp khác ktv thì sẽ hiển thị 2 ktv tương ứng vs dịch vụ"
    const mergedKtvGroups = useMemo(() => {
        const groupsMap = new Map<string, MergedFeedbackGroup>();
        
        booking.ktvList.forEach(ktv => {
            if (groupsMap.has(ktv.ktvId)) {
                const existing = groupsMap.get(ktv.ktvId)!;
                if (!existing.serviceNames.includes(ktv.serviceName)) {
                    existing.serviceNames.push(ktv.serviceName);
                }
                if (!existing.itemIds.includes(ktv.itemId)) {
                    existing.itemIds.push(ktv.itemId);
                }
            } else {
                groupsMap.set(ktv.ktvId, {
                    ktvId: ktv.ktvId,
                    ktvName: ktv.ktvName,
                    serviceNames: [ktv.serviceName],
                    itemIds: [ktv.itemId]
                });
            }
        });
        
        return Array.from(groupsMap.values());
    }, [booking.ktvList]);

    const handleRatingChange = (ktvId: string, rating: number) => {
        setRatings(prev => ({ ...prev, [ktvId]: rating }));
    };

    const handleCommentChange = (ktvId: string, text: string) => {
        setComments(prev => ({ ...prev, [ktvId]: text }));
    };

    const handleSubmit = async () => {
        // Validation: Bắt buộc rate hết tất cả KTV mới cho qua
        const unratedKtvs = mergedKtvGroups.filter(g => !ratings[g.ktvId]);
        if (unratedKtvs.length > 0) {
            alert(
                language === 'VN' ? 'Vui lòng đánh giá cho tất cả nhân viên!' :
                language === 'EN' ? 'Please rate all staff members!' :
                'Please rate all staff members!'
            );
            return;
        }

        setIsSubmitting(true);
        try {
            // Update BookingItems.ktvRatings cho từng item
            // Do 1 KTV có thể làm nhiều item, ta lặp qua groups
            const updatePromises: any[] = [];
            
            // Để gom nhóm các update theo item ID (vì 1 item có thể có 2 KTV)
            // Cần query item hiện tại ra trước để merge JSONB, hoặc dùng RPC. 
            // Tuy nhiên, có thể viết RPC nhỏ hoặc gọi update thẳng nếu cấu trúc đơn giản.
            // Để đơn giản và an toàn, ta dùng Supabase update.
            // Nhưng để tránh ghi đè ktvRatings của KTV khác trong cùng 1 item, tốt nhất là query item đó trước.
            
            const itemIdsToUpdate = Array.from(new Set(booking.ktvList.map(k => k.itemId)));
            
            const { data: currentItems, error: fetchErr } = await supabase
                .from('BookingItems')
                .select('id, ktvRatings')
                .in('id', itemIdsToUpdate);
                
            if (fetchErr) throw fetchErr;

            for (const item of currentItems || []) {
                // Tái cấu trúc lại ktvRatings
                let currentRatings = item.ktvRatings || {};
                
                // Tìm các ktv thuộc item này và khách có rate
                booking.ktvList.forEach(k => {
                    if (k.itemId === item.id && ratings[k.ktvId]) {
                        currentRatings[k.ktvId] = ratings[k.ktvId];
                    }
                });
                
                // Tính trung bình rating cho item (itemRating) để đảm bảo trigger chạy chuẩn
                const ratingValues = Object.values(currentRatings) as number[];
                const avgRating = ratingValues.length > 0 
                    ? Math.round(ratingValues.reduce((a,b) => a+b, 0) / ratingValues.length) 
                    : null;

                const p = supabase
                    .from('BookingItems')
                    .update({ 
                        ktvRatings: currentRatings,
                        itemRating: avgRating
                    })
                    .eq('id', item.id)
                    .then(res => res);
                updatePromises.push(p);
            }

            // Đồng thời update trạng thái Bookings -> FEEDBACK
            const pBooking = supabase
                .from('Bookings')
                .update({ 
                    status: 'FEEDBACK', 
                    updatedAt: new Date().toISOString() 
                })
                .eq('id', booking.id)
                .then(res => res);
            
            updatePromises.push(pBooking);

            await Promise.all(updatePromises);
            
            alert(
                language === 'VN' ? 'Cảm ơn quý khách đã đánh giá!' :
                language === 'EN' ? 'Thank you for your feedback!' :
                'Cảm ơn quý khách đã đánh giá!'
            );
            
            onClose();
        } catch (e) {
            console.error("Error submitting feedback:", e);
            alert("Đã có lỗi xảy ra. Vui lòng thử lại.");
        } finally {
            setIsSubmitting(false);
        }
    };

    // Dictionary câu hỏi
    const DICT = {
        VN: {
            forgotTitle: 'Quý khách vui lòng kiểm tra lại tư trang',
            forgotDesc: 'Spa không chịu trách nhiệm đối với tài sản quý khách để quên.',
            btnCheckDone: 'Tôi đã kiểm tra xong',
            rateTitle: 'Đánh giá chất lượng dịch vụ',
            rateDesc: 'Ý kiến của quý khách giúp chúng tôi phục vụ tốt hơn.',
            serviceLbl: 'Dịch vụ',
            notePlaceholder: 'Góp ý thêm (không bắt buộc)...',
            btnSubmit: 'Gửi Đánh Giá',
            btnCancel: 'Bỏ qua'
        },
        EN: {
            forgotTitle: 'Please check your personal belongings',
            forgotDesc: 'The Spa is not responsible for any lost items.',
            btnCheckDone: 'I have checked',
            rateTitle: 'Rate our service quality',
            rateDesc: 'Your feedback helps us improve our service.',
            serviceLbl: 'Services',
            notePlaceholder: 'Additional comments (optional)...',
            btnSubmit: 'Submit Feedback',
            btnCancel: 'Skip'
        },
        KR: {
            forgotTitle: '소지품을 다시 한 번 확인해 주세요',
            forgotDesc: '분실물에 대해서는 스파에서 책임지지 않습니다.',
            btnCheckDone: '확인했습니다',
            rateTitle: '서비스 품질 평가',
            rateDesc: '고객님의 의견은 서비스 향상에 도움이 됩니다.',
            serviceLbl: '서비스',
            notePlaceholder: '추가 의견 (선택 사항)...',
            btnSubmit: '제출하기',
            btnCancel: '건너뛰기'
        },
        JP: {
            forgotTitle: 'お忘れ物がないかご確認ください',
            forgotDesc: 'スパは紛失物の責任を負いかねます。',
            btnCheckDone: '確認しました',
            rateTitle: 'サービス品質の評価',
            rateDesc: 'お客様のご意見はサービスの向上に役立ちます。',
            serviceLbl: 'サービス',
            notePlaceholder: '追加コメント（任意）...',
            btnSubmit: '送信する',
            btnCancel: 'スキップ'
        }
    };

    const t = DICT[language];

    return {
        step, setStep,
        language, setLanguage,
        mergedKtvGroups,
        ratings, handleRatingChange,
        comments, handleCommentChange,
        isSubmitting, handleSubmit,
        t
    };
}
