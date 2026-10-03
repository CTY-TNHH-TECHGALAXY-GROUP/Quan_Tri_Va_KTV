'use client';

import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ChevronLeft, ChevronRight, RefreshCw, Trophy, Clock, Info, ListTree } from 'lucide-react';
import { useKtvHoursRankingLogic, RankRow } from './KtvHoursRanking.logic';
import { fmtHours, fmtShortDate } from '@/lib/hours-format';
import { HoursLedgerSheet } from '@/components/shared/HoursLedgerSheet';

/** Màu huy chương 3 hạng đầu, theo đúng modal "Thứ tự tua" trên dashboard. */
const MEDAL: Record<number, string> = {
  1: 'bg-amber-100 text-amber-600',
  2: 'bg-slate-200 text-slate-600',
  3: 'bg-orange-100 text-orange-600',
};

const Avatar = ({ row, size = 40 }: { row: { name: string; avatarUrl: string | null }; size?: number }) => (
  <div
    style={{ width: size, height: size }}
    className="rounded-full bg-slate-100 text-slate-500 font-black flex items-center justify-center overflow-hidden shrink-0"
  >
    {row.avatarUrl
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={row.avatarUrl} alt={row.name} className="w-full h-full object-cover" />
      : <span style={{ fontSize: size * 0.4 }}>{row.name.charAt(0).toUpperCase()}</span>}
  </div>
);

/** Thẻ thông báo dùng cho các trạng thái rỗng. */
const Notice = ({ title, desc }: { title: string; desc: string }) => (
  <div className="bg-white rounded-[32px] p-8 text-center shadow-sm border border-slate-100">
    <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-4">
      <Info size={26} />
    </div>
    <p className="font-black text-slate-800">{title}</p>
    <p className="text-sm text-slate-400 font-medium mt-1 leading-relaxed">{desc}</p>
  </div>
);

const KtvHoursRankingPage = () => {
  const logic = useKtvHoursRankingLogic();
  const me = logic.me;

  /**
   * Chọn tháng + tải lại.
   *
   * Bản `compact` nằm gọn trên thanh header của điện thoại — màn nhỏ thì mỗi dòng
   * đều quý, để một hàng riêng chỉ để chọn tháng là phí. Bản thường vẫn ở trong
   * trang cho màn lớn, nơi header mobile không tồn tại.
   */
  const MonthControls = ({ compact = false }: { compact?: boolean }) => (
    <div className={compact ? 'flex items-center gap-1' : 'flex items-center justify-between gap-3'}>
      <div className={`flex items-center bg-white rounded-2xl border border-slate-100 ${compact ? 'p-0.5 shadow-none' : 'p-1 shadow-sm'}`}>
        <button
          onClick={() => logic.changeMonth(-1)}
          aria-label="Tháng trước"
          className={`flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-50 ${compact ? 'w-7 h-7' : 'w-10 h-10'}`}
        ><ChevronLeft size={compact ? 15 : 19} /></button>
        <span className={`text-center font-black text-slate-700 ${compact ? 'min-w-[76px] text-xs' : 'min-w-[104px] text-sm'}`}>
          {compact ? logic.month : `Tháng ${logic.month}`}
        </span>
        <button
          onClick={() => logic.changeMonth(1)}
          disabled={!logic.canGoNext}
          aria-label="Tháng sau"
          className={`flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent ${compact ? 'w-7 h-7' : 'w-10 h-10'}`}
        ><ChevronRight size={compact ? 15 : 19} /></button>
      </div>
      <button
        onClick={logic.refresh}
        title="Tải lại"
        aria-label="Tải lại"
        className={`rounded-2xl bg-white border border-slate-100 text-slate-500 flex items-center justify-center ${compact ? 'w-8 h-8 shadow-none' : 'w-11 h-11 shadow-sm'}`}
      ><RefreshCw size={compact ? 14 : 17} className={logic.loading ? 'animate-spin' : ''} /></button>
    </div>
  );

  return (
    <AppLayout title="Xếp Hạng Giờ" headerRight={<MonthControls compact />}>
      <div className="max-w-2xl mx-auto pb-24 space-y-4">

        {/* Màn lớn không có header mobile nên vẫn cần hàng chọn tháng trong trang. */}
        <div className="hidden lg:block">
          <MonthControls />
        </div>

        {logic.loading && (
          <p className="py-16 text-center text-slate-400 font-medium">Đang tải bảng xếp hạng…</p>
        )}

        {!logic.loading && logic.loadError && (
          <div className="bg-rose-50 border border-rose-100 text-rose-600 p-5 rounded-[32px] flex items-center justify-between gap-4 flex-wrap">
            <span className="font-bold text-sm">{logic.loadError}</span>
            <button onClick={logic.refresh} className="h-10 px-4 rounded-xl font-bold bg-rose-600 text-white text-sm">Thử lại</button>
          </div>
        )}

        {!logic.loading && !logic.loadError && !logic.applicable && (
          <Notice
            title="Chưa áp dụng cho nhóm của bạn"
            desc="Bảng xếp hạng giờ tích lũy hiện chỉ dành cho KTV Loại D — nhóm chia tua theo giờ làm."
          />
        )}

        {!logic.loading && !logic.loadError && logic.applicable && !logic.enabled && (
          <Notice
            title="Quản lý đã tắt bảng xếp hạng"
            desc="Tính năng này đang được tắt trong Cài đặt hệ thống. Liên hệ quản lý nếu bạn cần xem."
          />
        )}

        {!logic.loading && !logic.loadError && logic.applicable && logic.enabled && (
          <>
            {/* Thẻ của chính mình */}
            {me && (
              <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-[32px] p-5 shadow-lg text-white">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm border border-white/30 shrink-0">
                    <Trophy size={26} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-[10px] uppercase tracking-widest text-blue-100">Hạng của bạn</p>
                    <p className="font-black text-3xl leading-none mt-1">
                      {me.rank ?? '—'}
                      {me.rank != null && (
                        <span className="text-sm font-medium opacity-70 ml-1">/ {logic.rankedCount}</span>
                      )}
                    </p>
                    {me.rank == null && (
                      <p className="text-[11px] font-medium text-blue-100 mt-1">
                        Điểm danh xong mới vào bảng xếp hạng.
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-[10px] uppercase tracking-widest text-blue-100">Thực nhận</p>
                    <p className="font-black text-2xl leading-none mt-1">{fmtHours(me.net)}</p>
                  </div>
                </div>

                {/* Ba ô làm thực / bị phạt / thực nhận đã gộp vào bảng chi tiết —
                    trên thẻ chỉ giữ con số quyết định (thực nhận) cho đỡ rối. */}
                <button
                  onClick={() => logic.setShowDetail(true)}
                  className="w-full mt-4 bg-white/15 hover:bg-white/25 active:scale-[0.98] backdrop-blur-sm rounded-2xl px-4 py-3 flex items-center justify-center gap-2 transition-all border border-white/20"
                >
                  <ListTree size={16} />
                  <span className="font-black text-sm uppercase tracking-wider">Xem chi tiết</span>
                </button>

                <p className="text-[11px] font-medium text-blue-100 mt-3 flex items-center gap-1.5">
                  <Clock size={12} className="shrink-0" />
                  {me.turns} tua · {me.days ?? 0} ngày · gần nhất {fmtShortDate(me.lastDate)}
                </p>
              </div>
            )}

            {logic.rows.length === 0 ? (
              <Notice
                title="Tháng này chưa có dữ liệu"
                desc="Chưa có tua nào được ghi vào sổ giờ trong tháng đang xem."
              />
            ) : (
              <>
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 px-1 pt-2">
                  Cả nhóm · {logic.rows.length} KTV
                </p>

                <div className="space-y-2">
                  {logic.rows.map((r: RankRow) => {
                    const pct = logic.maxNet > 0 ? Math.max(0, (r.net / logic.maxNet) * 100) : 0;
                    return (
                      <div
                        key={r.id}
                        className={`flex items-center gap-3 p-4 rounded-[24px] border ${
                          r.isMe
                            ? 'bg-blue-50 border-blue-200 shadow-md shadow-blue-100/50'
                            : 'bg-white border-slate-100 shadow-sm'
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${(r.rank != null && MEDAL[r.rank]) || 'bg-slate-100 text-slate-400'}`}>
                          {r.rank != null ? `#${r.rank}` : '—'}
                        </div>

                        <Avatar row={r} />

                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-bold truncate ${r.isMe ? 'text-blue-700' : 'text-slate-700'}`}>
                            {r.name}
                            {r.isMe && <span className="text-[10px] bg-blue-500 text-white px-1.5 py-0.5 rounded ml-1.5 align-middle">BẠN</span>}
                          </p>
                          <div className="h-1.5 bg-slate-100 rounded-full mt-1.5 overflow-hidden">
                            <div
                              style={{ width: `${pct}%` }}
                              className={`h-full rounded-full ${r.net < 0 ? 'bg-rose-400' : r.isMe ? 'bg-blue-500' : 'bg-slate-300'}`}
                            />
                          </div>
                          <p className="text-[10px] font-medium text-slate-400 mt-1">{r.code} · {r.turns} tua</p>
                        </div>

                        <div className="text-right shrink-0">
                          <p className={`font-black text-lg leading-none tabular-nums ${r.isMe ? 'text-blue-600' : 'text-slate-600'}`}>
                            {fmtHours(r.net)}
                          </p>
                          <p className="text-[9px] uppercase tracking-widest text-slate-400 font-bold mt-1">Giờ làm</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <p className="text-[11px] text-slate-400 font-medium leading-relaxed bg-white rounded-[24px] p-4 border border-slate-100">
              Xếp theo <b className="text-slate-600">giờ thực nhận</b> — giờ làm thực trong dịch vụ trừ đi giờ bị phạt
              kỷ luật. Đây cũng là con số quyết định thứ tự nhận tua. Số liệu cập nhật ngay khi bạn kết thúc đơn.
              Giờ làm thực và giờ bị phạt của đồng nghiệp không hiển thị.
            </p>
          </>
        )}
      </div>

      {logic.showDetail && me && (
        <HoursLedgerSheet
          subtitle={`${me.code} · Tháng ${logic.month} · Hạng ${me.rank}`}
          earned={me.earned ?? 0}
          penalty={me.penalty ?? 0}
          net={me.net}
          rows={logic.ledger}
          onClose={() => logic.setShowDetail(false)}
        />
      )}
    </AppLayout>
  );
};

export default KtvHoursRankingPage;
