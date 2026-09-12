import { useState, useMemo, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { ChildBookingForFeedback, FeedbackKtvInfo } from '../FeedbackDashboard.logic';
import { submitFeedbackAction } from './actions';

export type MergedFeedbackGroup = {
    ktvId: string;
    ktvName: string;
    serviceNames: string[];
    itemIds: string[];
};

export function useKioskFeedback(booking: ChildBookingForFeedback, onClose: () => void) {
    const [step, setStep] = useState<1 | 2>(1);
    const langCode = booking.customerLang?.toUpperCase() || 'VN';
    const initialLang = (['VN', 'EN', 'KR', 'JP', 'ZH'].includes(langCode)) ? (langCode as 'VN' | 'EN' | 'KR' | 'JP' | 'ZH') : 'VN';
    const [language, setLanguage] = useState<'VN' | 'EN' | 'KR' | 'JP' | 'ZH'>(initialLang);
    
    // State lưu điểm (từ 1 đến 4) dùng chung cho tất cả KTV của khách này
    const [globalRating, setGlobalRating] = useState<number>(0);
    // State lưu ghi chú chung
    const [globalComment, setGlobalComment] = useState<string>('');
    
    // State lưu danh sách câu hỏi vi phạm từ DB
    const [reminders, setReminders] = useState<any[]>([]);
    // State lưu mảng ID các lỗi khách chọn
    const [violations, setViolations] = useState<string[]>([]);
    
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);

    // Fetch câu hỏi từ DB
    useEffect(() => {
        const fetchReminders = async () => {
            const { data } = await supabase
                .from('Reminders_Customer')
                .select('*')
                .eq('is_active', true)
                .order('order_index', { ascending: true });
            if (data) {
                setReminders(data);
            }
        };
        fetchReminders();
    }, []);

    // Lấy câu hỏi theo ngôn ngữ hiện tại
    const getReminderText = (reminder: any) => {
        switch (language) {
            case 'EN': return reminder.contentEN || reminder.contentVN;
            case 'KR': return reminder.contentKR || reminder.contentVN;
            case 'JP': return reminder.contentJP || reminder.contentVN;
            case 'ZH': return reminder.contentCN || reminder.contentVN;
            default: return reminder.contentVN;
        }
    };

    // Toggle chọn lỗi
    const toggleViolation = (reminderId: string) => {
        setViolations(prev => 
            prev.includes(reminderId) ? prev.filter(id => id !== reminderId) : [...prev, reminderId]
        );
    };

    // Reset state khi đổi khách (chuyển tab)
    useEffect(() => {
        setStep(1);
        setGlobalRating(0);
        setGlobalComment('');
        setViolations([]);
        setIsSuccess(false);
    }, [booking.id]);

    // Xử lý logic gộp KTV:
    // User Yêu cầu: "nếu chung 1 KTV thì hiện 1 dịch vụ gộp + tên ktv luôn. nếu 1 đơn lẻ gộp khác ktv thì sẽ hiển thị 2 ktv tương ứng vs dịch vụ"
    const mergedKtvGroups = useMemo(() => {
        const groupsMap = new Map<string, MergedFeedbackGroup>();
        
        booking.ktvList.forEach(ktv => {
            if (groupsMap.has(ktv.ktvId)) {
                const existing = groupsMap.get(ktv.ktvId)!;
                ktv.serviceNames.forEach(sn => {
                    if (!existing.serviceNames.includes(sn)) {
                        existing.serviceNames.push(sn);
                    }
                });
                if (!existing.itemIds.includes(ktv.itemId)) {
                    existing.itemIds.push(ktv.itemId);
                }
            } else {
                groupsMap.set(ktv.ktvId, {
                    ktvId: ktv.ktvId,
                    ktvName: ktv.ktvName,
                    serviceNames: [...ktv.serviceNames],
                    itemIds: [ktv.itemId]
                });
            }
        });
        
        return Array.from(groupsMap.values());
    }, [booking.ktvList]);

    const handleRatingChange = (rating: number) => {
        setGlobalRating(rating);
    };

    const handleCommentChange = (text: string) => {
        setGlobalComment(text);
    };

    const handleSubmit = async () => {
        // Validation: Bắt buộc rate mới cho qua
        if (!globalRating) {
            return;
        }

        setIsSubmitting(true);
        console.log('[Feedback Submit] Bắt đầu submit feedback. booking:', booking);
        console.log('[Feedback Submit] globalRating:', globalRating, 'globalComment:', globalComment);
        console.log('[Feedback Submit] isGuestFlow:', booking.isGuestFlow);

        try {
            console.log('[Feedback Submit] Calling Server Action with payload...', booking);

            const payload = {
                bookingId: booking.parentBookingId || booking.id,
                isGuestFlow: !!booking.isGuestFlow,
                ktvList: booking.ktvList,
                globalRating: globalRating,
                globalComment: globalComment,
                violations: violations
            };

            const result = await submitFeedbackAction(payload);
            
            if (!result.success) {
                throw new Error(result.error);
            }

            console.log('[Feedback Submit] Server Action success!');

            
            setIsSuccess(true);
            setTimeout(() => {
                onClose();
            }, 3000);
        } catch (e: any) {
            console.error("[Feedback Submit] Error submitting feedback:", e);
            alert(`Đã có lỗi xảy ra. Vui lòng thử lại. (${e?.message || ''})`);
        } finally {
            setIsSubmitting(false);
        }
    };

    // Dictionary câu hỏi
    const DICT = {
        VN: {
            forgotTitle: 'Quý khách vui lòng kiểm tra lại tư trang',
            forgotDesc: 'Spa không chịu trách nhiệm đối với tài sản quý khách để quên.',
            itemPhone: 'Điện thoại',
            itemWallet: 'Ví tiền',
            itemJewelry: 'Đồng hồ / Trang sức',
            itemKeys: 'Chìa khóa / Thẻ',
            btnCheckDone: 'Tôi đã kiểm tra xong',
            rateTitle: 'Đánh giá chất lượng dịch vụ',
            rateDesc: 'Ý kiến của quý khách giúp chúng tôi phục vụ tốt hơn.',
            serviceLbl: 'Dịch vụ',
            notePlaceholder: 'Góp ý thêm (không bắt buộc)...',
            btnSubmit: 'Gửi Đánh Giá',
            btnCancel: 'Bỏ qua',
            rateBad: 'Tệ',
            rateOk: 'Bình thường',
            rateGood: 'Tốt',
            rateExcellent: 'Tuyệt vời',
            violationsSectionTitle: 'Góp ý dịch vụ (nếu có)',
            experienceTitle: 'Trải nghiệm của bạn',
            staffLbl: 'Nhân viên phục vụ'
        },
        EN: {
            forgotTitle: 'Please check your personal belongings',
            forgotDesc: 'The Spa is not responsible for any lost items.',
            itemPhone: 'Phone',
            itemWallet: 'Wallet',
            itemJewelry: 'Watch / Jewelry',
            itemKeys: 'Keys / Cards',
            btnCheckDone: 'I have checked',
            rateTitle: 'Rate our service quality',
            rateDesc: 'Your feedback helps us improve our service.',
            serviceLbl: 'Services',
            notePlaceholder: 'Additional comments (optional)...',
            btnSubmit: 'Submit Feedback',
            btnCancel: 'Skip',
            rateBad: 'Bad',
            rateOk: 'Ok',
            rateGood: 'Good',
            rateExcellent: 'Excellent',
            violationsSectionTitle: 'Service feedback (if any)',
            experienceTitle: 'Your experience',
            staffLbl: 'Served by'
        },
        KR: {
            forgotTitle: '소지품을 다시 한 번 확인해 주세요',
            forgotDesc: '분실물에 대해서는 스파에서 책임지지 않습니다.',
            itemPhone: '휴대폰',
            itemWallet: '지갑',
            itemJewelry: '시계 / 보석',
            itemKeys: '열쇠 / 카드',
            btnCheckDone: '확인했습니다',
            rateTitle: '서비스 품질 평가',
            rateDesc: '고객님의 의견은 서비스 향상에 도움이 됩니다.',
            serviceLbl: '서비스',
            notePlaceholder: '추가 의견 (선택 사항)...',
            btnSubmit: '제출하기',
            btnCancel: '건너뛰기',
            rateBad: '나쁨',
            rateOk: '보통',
            rateGood: '좋음',
            rateExcellent: '매우 좋음',
            violationsSectionTitle: '서비스 피드백 (선택)',
            experienceTitle: '고객님의 경험',
            staffLbl: '담당 직원'
        },
        JP: {
            forgotTitle: 'お忘れ物がないかご確認ください',
            forgotDesc: 'スパは紛失物の責任を負いかねます。',
            itemPhone: 'スマートフォン',
            itemWallet: '財布',
            itemJewelry: '時計 / アクセサリー',
            itemKeys: '鍵 / カード',
            btnCheckDone: '確認しました',
            rateTitle: 'サービス品質の評価',
            rateDesc: 'お客様のご意見はサービスの向上に役立ちます。',
            serviceLbl: 'サービス',
            notePlaceholder: '追加コメント（任意）...',
            btnSubmit: '送信する',
            btnCancel: 'スキップ',
            rateBad: '悪い',
            rateOk: '普通',
            rateGood: '良い',
            rateExcellent: '素晴らしい',
            violationsSectionTitle: 'サービスのフィードバック (任意)',
            experienceTitle: 'お客様の体験',
            staffLbl: '担当スタッフ'
        },
        ZH: {
            forgotTitle: '请再次检查您的随身物品',
            forgotDesc: '水疗中心对任何遗失物品概不负责。',
            itemPhone: '手机',
            itemWallet: '钱包',
            itemJewelry: '手表 / 首饰',
            itemKeys: '钥匙 / 卡',
            btnCheckDone: '我已检查',
            rateTitle: '评价我们的服务质量',
            rateDesc: '您的反馈将帮助我们改进服务。',
            serviceLbl: '服务',
            notePlaceholder: '补充意见（选填）...',
            btnSubmit: '提交评价',
            btnCancel: '跳过',
            rateBad: '差',
            rateOk: '一般',
            rateGood: '好',
            rateExcellent: '极好',
            violationsSectionTitle: '服务反馈 (选填)',
            experienceTitle: '您的体验',
            staffLbl: '服务人员'
        }
    };

    const t = DICT[language];

    return {
        step, setStep,
        language, setLanguage,
        mergedKtvGroups,
        globalRating, handleRatingChange,
        globalComment, handleCommentChange,
        reminders, violations, getReminderText, toggleViolation,
        isSubmitting, handleSubmit,
        isSuccess, setIsSuccess,
        t
    };
}
