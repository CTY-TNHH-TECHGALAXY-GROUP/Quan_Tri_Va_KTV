'use client';

import React from 'react';
import Link from 'next/link';
import { AppLayout } from '@/components/layout/AppLayout';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight, Search, RefreshCw, Timer, Lock, ClipboardCheck, X, Clock, User, AlertTriangle } from 'lucide-react';
import { useAdminKtvHoursLogic, fmtHours, fmtShortDate } from './AdminKtvHours.logic';
import { fmtWeekday, fmtFullDate, fmtClock } from '@/lib/hours-format';

// 🔧 UI CONFIGURATION — cùng bảng màu với trang Chấm điểm Office.
const CSS_VARS = {
  '--bg': '#f4f1e9',
  '--surface': '#ffffff',
  '--surface-soft': '#f8f7f2',
  '--ink': '#1f2b23',
  '--muted': '#748074',
  '--line': '#e4e0d5',
  '--green': '#355b43',
  '--green-2': '#e7efe8',
  '--rust': '#a6533d',
  '--rust-2': '#f8ece7',
  '--amber': '#9a6a20',
  '--amber-2': '#fbf1dc',
  '--radius': '22px',
} as React.CSSProperties;

/** Màu huy chương cho 3 hạng đầu; từ hạng 4 dùng màu trung tính. */
const MEDALS: Record<number, { bg: string; ink: string; label: string }> = {
  1: { bg: '#f3e2b3', ink: '#7a5a10', label: 'Hạng 1' },
  2: { bg: '#e3e5e8', ink: '#5b6169', label: 'Hạng 2' },
  3: { bg: '#eddac9', ink: '#8a5230', label: 'Hạng 3' },
};

const Avatar = ({ row, size = 44 }: { row: { name: string; avatarUrl: string | null }; size?: number }) => (
  <div
    style={{ width: size, height: size }}
    className="rounded-full bg-[var(--green-2)] text-[var(--green)] font-bold flex items-center justify-center overflow-hidden shrink-0"
  >
    {row.avatarUrl
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={row.avatarUrl} alt={row.name} className="w-full h-full object-cover" />
      : <span style={{ fontSize: size * 0.38 }}>{row.name.charAt(0).toUpperCase()}</span>}
  </div>
);

const StatCard = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="bg-[var(--surface)] rounded-2xl p-4 shadow-sm">
    <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">{label}</p>
    <p className="text-xl md:text-2xl font-bold mt-1 tabular-nums">{value}</p>
    {hint && <p className="text-[11px] text-[var(--muted)] mt-0.5">{hint}</p>}
  </div>
);

/** Khung 3 con số của 1 KTV: làm thực → bị phạt → thực nhận. */
const HoursBreakdown = ({ earned, penalty, net }: { earned: number; penalty: number; net: number }) => (
  <div className="grid grid-cols-3 gap-2">
    <div className="bg-[var(--green-2)] rounded-2xl p-3 text-center">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--green)]">Làm thực</p>
      <p className="text-base md:text-xl font-bold tabular-nums mt-1 text-[var(--green)]">{fmtHours(earned)}</p>
    </div>
    <div className={`rounded-2xl p-3 text-center ${penalty > 0 ? 'bg-[var(--rust-2)]' : 'bg-[var(--surface-soft)]'}`}>
      <p className={`text-[10px] font-bold uppercase tracking-widest ${penalty > 0 ? 'text-[var(--rust)]' : 'text-[var(--muted)]'}`}>Bị phạt</p>
      <p className={`text-base md:text-xl font-bold tabular-nums mt-1 ${penalty > 0 ? 'text-[var(--rust)]' : 'text-[var(--muted)]'}`}>
        {penalty > 0 ? `− ${fmtHours(penalty)}` : fmtHours(0)}
      </p>
    </div>
    <div className="bg-[var(--ink)] rounded-2xl p-3 text-center">
      <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Thực nhận</p>
      <p className="text-base md:text-xl font-bold tabular-nums mt-1 text-white">{fmtHours(net)}</p>
    </div>
  </div>
);

/**
 * Một dòng sổ giờ đã được diễn giải sẵn cho UI.
 *
 * Phân loại theo `penaltyType` chứ KHÔNG theo `penalty > 0`: dấu mốc khoá tài khoản
 * (ACCOUNT_LOCK) có hours_penalty = 0, lấy số làm mốc thì nó hiện nhầm thành một tua
 * dịch vụ "+0h 00P".
 */
function readLedgerRow(r: any) {
  const isPenalty = !!r.penaltyType;
  const isMarker = isPenalty && r.penalty === 0;
  return {
    isPenalty,
    isMarker,
    /** Nhãn nhóm ở cột Nội dung. */
    badge: isMarker ? 'Dấu mốc' : isPenalty ? 'Vi phạm nội quy' : 'Giờ làm khách',
    /** Dòng đậm ở cột Nội dung: mã đơn với tua, tên lỗi với phiếu phạt. */
    heading: isPenalty ? (r.penaltyLabel || 'Phạt giờ') : (r.orderCode || 'Tua dịch vụ'),
    /** Dòng mờ bên dưới: `note` là tên dịch vụ với tua, là ghi chú với phiếu phạt. */
    sub: r.note || '',
    kindLabel: isMarker ? 'Ghi nhận' : isPenalty ? 'Vi phạm' : 'Làm khách',
    kindNote: isMarker ? 'Không trừ giờ' : isPenalty ? 'Trừ giờ' : 'Cộng giờ',
    amount: isMarker ? null : isPenalty ? `− ${fmtHours(r.penalty)}` : `+ ${fmtHours(r.earned)}`,
  };
}

/** Ô "Loại giao dịch" — viên thuốc có icon, dùng chung cho cả bảng lẫn thẻ. */
const KindPill = ({ v }: { v: ReturnType<typeof readLedgerRow> }) => (
  <div className={`inline-flex items-center gap-2 rounded-2xl px-3 py-2 ${
    v.isMarker ? 'bg-[var(--amber-2)]' : v.isPenalty ? 'bg-[var(--rust-2)]' : 'bg-[var(--green-2)]'
  }`}>
    <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-white/70 ${
      v.isMarker ? 'text-[var(--amber)]' : v.isPenalty ? 'text-[var(--rust)]' : 'text-[var(--green)]'
    }`}>
      {v.isPenalty ? <AlertTriangle size={14} /> : <User size={14} />}
    </span>
    <span className="leading-tight">
      <span className={`block text-[13px] font-bold ${
        v.isMarker ? 'text-[var(--amber)]' : v.isPenalty ? 'text-[var(--rust)]' : 'text-[var(--green)]'
      }`}>{v.kindLabel}</span>
      <span className="block text-[10px] text-[var(--muted)]">{v.kindNote}</span>
    </span>
  </div>
);

const ContentCell = ({ v }: { v: ReturnType<typeof readLedgerRow> }) => (
  <>
    <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-md mb-1 ${
      v.isMarker ? 'bg-[var(--amber-2)] text-[var(--amber)]'
        : v.isPenalty ? 'bg-[var(--rust-2)] text-[var(--rust)]'
        : 'bg-[var(--green-2)] text-[var(--green)]'
    }`}>{v.badge}</span>
    <p className="font-bold text-sm leading-snug">{v.heading}</p>
    {v.sub && <p className="text-xs text-[var(--muted)] leading-snug mt-0.5">{v.sub}</p>}
  </>
);

/**
 * Lịch sử giờ tích luỹ.
 *
 * Màn lớn dùng bảng 5 cột như quầy vẫn đối soát trên giấy; điện thoại đổ về thẻ
 * xếp chồng vì 5 cột nhét vào 375px thì cột nào cũng không đọc nổi.
 */
const LedgerTable = ({ rows, total }: { rows: any[]; total: number }) => (
  <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--line)] overflow-hidden">
    <div className="flex items-center justify-between gap-3 flex-wrap p-4 border-b border-[var(--line)]">
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-full bg-[var(--surface-soft)] text-[var(--green)] flex items-center justify-center shrink-0">
          <Clock size={20} />
        </span>
        <div>
          <p className="font-bold">Lịch sử giờ tích luỹ</p>
          <p className="text-xs text-[var(--muted)]">Tất cả giao dịch cộng trừ giờ làm việc</p>
        </div>
      </div>
      <div className="flex items-center gap-2 bg-[var(--surface-soft)] rounded-2xl px-4 py-2">
        <span className="text-xs text-[var(--muted)]">Tổng giờ hiện tại</span>
        <Clock size={16} className="text-[var(--muted)]" />
        <span className="font-bold tabular-nums">{fmtHours(total)}</span>
      </div>
    </div>

    {/* Bảng — từ md trở lên */}
    <table className="hidden md:table w-full text-left">
      <thead>
        <tr className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
          <th className="px-4 py-3 font-bold">Ngày</th>
          <th className="px-4 py-3 font-bold">Nội dung</th>
          <th className="px-4 py-3 font-bold">Loại giao dịch</th>
          <th className="px-4 py-3 font-bold text-right">Số giờ</th>
          <th className="px-4 py-3 font-bold text-right">Còn lại</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r: any) => {
          const v = readLedgerRow(r);
          return (
            <tr key={r.id} className="border-t border-[var(--line)] align-top">
              <td className="px-4 py-3 whitespace-nowrap">
                <p className="font-bold text-sm">{fmtWeekday(r.date)}</p>
                <p className="text-xs text-[var(--muted)] tabular-nums">{fmtFullDate(r.date)}</p>
                {fmtClock(r.at) && <p className="text-xs text-[var(--muted)] tabular-nums">{fmtClock(r.at)}</p>}
              </td>
              <td className="px-4 py-3 max-w-[280px]"><ContentCell v={v} /></td>
              <td className="px-4 py-3"><KindPill v={v} /></td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                {v.amount === null
                  ? <span className="text-xs font-bold text-[var(--amber)] uppercase tracking-widest">Dấu mốc</span>
                  : <span className={`font-bold tabular-nums ${v.isPenalty ? 'text-[var(--rust)]' : 'text-[var(--green)]'}`}>{v.amount}</span>}
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5 font-bold tabular-nums">
                  <Clock size={14} className="text-[var(--muted)]" />
                  {fmtHours(r.balance)}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>

    {/* Thẻ xếp chồng — dưới md */}
    <div className="md:hidden divide-y divide-[var(--line)]">
      {rows.map((r: any) => {
        const v = readLedgerRow(r);
        return (
          <div key={r.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-[var(--muted)] tabular-nums">
                  {fmtWeekday(r.date)} · {fmtFullDate(r.date)}{fmtClock(r.at) ? ` · ${fmtClock(r.at)}` : ''}
                </p>
                <div className="mt-1"><ContentCell v={v} /></div>
              </div>
              <div className="text-right shrink-0">
                {v.amount === null
                  ? <p className="text-[11px] font-bold text-[var(--amber)] uppercase tracking-widest">Dấu mốc</p>
                  : <p className={`font-bold tabular-nums ${v.isPenalty ? 'text-[var(--rust)]' : 'text-[var(--green)]'}`}>{v.amount}</p>}
                <p className="text-[11px] text-[var(--muted)] mt-0.5">Còn {fmtHours(r.balance)}</p>
              </div>
            </div>
            <div className="mt-2"><KindPill v={v} /></div>
          </div>
        );
      })}
    </div>
  </div>
);

const AdminKtvHoursPage = () => {
  const logic = useAdminKtvHoursLogic();
  const { totals, maxValue } = logic;

  // Bục chỉ có nghĩa khi cả 3 hạng đầu đều CÓ giờ. Đầu tháng gần như ai cũng 0h,
  // lúc đó bục chỉ tôn vinh thứ tự tên gọi chứ không phải thành tích.
  const top3 = logic.ranked.slice(0, 3);
  const podium = !logic.searchQuery.trim() && top3.length === 3 && top3.every(r => r.net > 0)
    ? top3
    : [];

  const d = logic.detail;

  return (
    <AppLayout title="Giờ Tích Lũy KTV">
      <div style={CSS_VARS} className="min-h-screen bg-[var(--bg)] text-[var(--ink)] font-sans pb-24">
        <main className="max-w-5xl mx-auto p-5 md:p-8">

          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-5 mb-6">
            <div>
              <p className="text-[var(--green)] font-bold text-xs tracking-widest uppercase mb-1">Kỹ thuật viên loại D</p>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight flex items-center gap-3">
                <Timer size={30} className="text-[var(--green)]" /> Giờ tích lũy
              </h1>
              <p className="text-sm text-[var(--muted)] mt-2 max-w-xl leading-relaxed">
                Xếp hạng theo <b className="text-[var(--ink)]">giờ thực nhận</b> — thời gian làm thực trong dịch vụ trừ
                đi giờ bị phạt. Bấm vào từng KTV để xem sổ giờ chi tiết.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Link
                href="/admin/ktv-office"
                className="h-11 px-4 rounded-2xl bg-[var(--surface)] shadow-sm font-bold text-sm flex items-center gap-2 hover:bg-[var(--green-2)]"
              ><ClipboardCheck size={16} /> Chấm điểm</Link>
              <button
                onClick={logic.refresh}
                title="Tải lại"
                className="w-11 h-11 rounded-2xl bg-[var(--surface)] shadow-sm flex items-center justify-center hover:bg-[var(--green-2)]"
              ><RefreshCw size={17} className={logic.loading ? 'animate-spin' : ''} /></button>
            </div>
          </div>

          {/* Kỳ xem — quy chế loại D tính giờ theo TỪNG THÁNG nên chỉ xem theo tháng. */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex items-center bg-[var(--surface)] p-1 rounded-2xl shadow-sm">
              <button onClick={() => logic.changeMonth(-1)} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-[var(--green-2)]"><ChevronLeft size={19} /></button>
              <span className="min-w-[104px] text-center font-bold text-sm">Tháng {logic.month}</span>
              <button
                onClick={() => logic.changeMonth(1)}
                disabled={!logic.canGoNext}
                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-[var(--green-2)] disabled:opacity-30 disabled:hover:bg-transparent"
              ><ChevronRight size={19} /></button>
            </div>
          </div>

          {/* Tổng quan */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <StatCard label="Tổng giờ làm thực" value={fmtHours(totals.earned)} hint={`${totals.active}/${totals.staff} KTV có giờ`} />
            <StatCard label="Giờ bị phạt" value={fmtHours(totals.penalty)} hint="Trừ theo kỷ luật" />
            <StatCard label="Tổng thực nhận" value={fmtHours(totals.net)} hint={`TB ${fmtHours(totals.avg)}/KTV có giờ`} />
            <StatCard label="Tổng số tua" value={totals.turns.toLocaleString('vi-VN')} hint="Tua có phát sinh giờ" />
          </div>

          {/* Tìm kiếm */}
          <div className="flex items-center gap-3 px-4 h-14 bg-[var(--surface)] rounded-2xl shadow-sm mb-6">
            <Search size={20} className="text-[var(--muted)]" />
            <input
              type="search"
              placeholder="Tìm tên hoặc mã KTV"
              className="w-full bg-transparent border-none focus:outline-none text-[var(--ink)]"
              value={logic.searchQuery}
              onChange={e => logic.setSearchQuery(e.target.value)}
            />
          </div>

          {logic.loading && (
            <p className="py-16 text-center text-[var(--muted)]">Đang tính giờ tích lũy…</p>
          )}

          {!logic.loading && logic.loadError && (
            <div className="bg-[var(--rust-2)] text-[var(--rust)] p-5 rounded-2xl flex items-center justify-between gap-4 flex-wrap">
              <span className="font-bold text-sm">{logic.loadError}</span>
              <button onClick={logic.refresh} className="h-10 px-4 rounded-xl font-bold bg-[var(--green)] text-white">Thử lại</button>
            </div>
          )}

          {!logic.loading && !logic.loadError && logic.rows.length === 0 && (
            <p className="py-16 text-center text-[var(--muted)]">
              {logic.searchQuery ? 'Không tìm thấy KTV nào khớp.' : 'Chưa có dữ liệu giờ trong kỳ này.'}
            </p>
          )}

          {!logic.loading && !logic.loadError && logic.rows.length > 0 && (
            <>
              {/* Bục 3 hạng đầu */}
              {podium.length === 3 && (
                <div className="grid grid-cols-3 gap-3 mb-6">
                  {[podium[1], podium[0], podium[2]].map(r => {
                    const medal = MEDALS[r.rank];
                    const isTop = r.rank === 1;
                    return (
                      <button
                        key={r.id}
                        onClick={() => logic.openDetail(r)}
                        className={`bg-[var(--surface)] rounded-[var(--radius)] p-4 text-center shadow-sm flex flex-col items-center hover:shadow-md transition-shadow ${isTop ? 'md:-mt-4 ring-2 ring-[var(--green)]' : ''}`}
                      >
                        <span
                          style={{ background: medal.bg, color: medal.ink }}
                          className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full mb-3"
                        >{medal.label}</span>
                        <Avatar row={r} size={isTop ? 64 : 52} />
                        <p className="font-bold mt-2 text-sm leading-tight line-clamp-2">{r.name}</p>
                        <p className="text-[11px] text-[var(--muted)]">{r.code}</p>
                        <p className={`font-bold tabular-nums mt-2 ${isTop ? 'text-2xl text-[var(--green)]' : 'text-lg'}`}>
                          {fmtHours(r.net)}
                        </p>
                        <p className="text-[11px] text-[var(--muted)]">{r.turns} tua · {r.days} ngày</p>
                      </button>
                    );
                  })}
                </div>
              )}

              <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted)] mb-2">
                Xếp theo giờ thực nhận · {logic.rows.length} KTV
              </p>

              <div className="space-y-2">
                {logic.rows.map(r => {
                  const pct = maxValue > 0 ? Math.max(0, (r.net / maxValue) * 100) : 0;
                  const medal = MEDALS[r.rank];
                  return (
                    <button
                      key={r.id}
                      onClick={() => logic.openDetail(r)}
                      className="w-full text-left bg-[var(--surface)] rounded-2xl p-4 shadow-sm flex items-center gap-3 md:gap-4 hover:shadow-md hover:bg-[var(--surface-soft)] transition-all"
                    >
                      <div
                        style={medal ? { background: medal.bg, color: medal.ink } : undefined}
                        className={`w-9 h-9 rounded-xl shrink-0 flex items-center justify-center font-bold text-sm tabular-nums ${medal ? '' : 'bg-[var(--surface-soft)] text-[var(--muted)]'}`}
                      >{r.rank}</div>

                      <Avatar row={r} />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold truncate">{r.name}</p>
                          <span className="text-[11px] text-[var(--muted)]">{r.code}</span>
                          {r.locked && (
                            <span className="text-[10px] font-bold text-[var(--rust)] bg-[var(--rust-2)] px-2 py-0.5 rounded-full flex items-center gap-1">
                              <Lock size={10} /> Đang khóa
                            </span>
                          )}
                        </div>

                        {/* Thanh tỉ lệ so với người dẫn đầu */}
                        <div className="h-1.5 bg-[var(--surface-soft)] rounded-full mt-2 overflow-hidden">
                          <div
                            style={{ width: `${pct}%` }}
                            className={`h-full rounded-full ${r.net < 0 ? 'bg-[var(--rust)]' : 'bg-[var(--green)]'}`}
                          />
                        </div>

                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--muted)] mt-1.5">
                          <span>Làm thực {fmtHours(r.earned)}</span>
                          {r.penalty > 0 && (
                            <span className="text-[var(--rust)] font-bold">Phạt − {fmtHours(r.penalty)}</span>
                          )}
                          <span>{r.turns} tua · {r.days} ngày</span>
                          <span>Gần nhất {fmtShortDate(r.lastDate)}</span>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <p className="text-lg md:text-xl font-bold tabular-nums leading-tight">{fmtHours(r.net)}</p>
                        <p className="text-[10px] text-[var(--muted)] uppercase tracking-widest">thực nhận</p>
                      </div>
                      <ChevronRight size={18} className="text-[var(--muted)] shrink-0" />
                    </button>
                  );
                })}
              </div>

              <p className="text-xs text-[var(--muted)] leading-relaxed mt-6 bg-[var(--surface-soft)] p-4 rounded-2xl">
                <b className="text-[var(--ink)]">Giờ làm thực</b> là tổng thời gian đã phục vụ trong dịch vụ, chưa trừ phạt.{' '}
                <b className="text-[var(--ink)]">Giờ thực nhận</b> là giờ làm thực trừ đi giờ phạt kỷ luật — đây mới là con số
                quyết định thứ tự nhận tua ở bảng điều phối. Số liệu lấy thẳng từ sổ giờ tua, cập nhật ngay khi KTV
                kết thúc đơn — không phải chờ chốt sổ cuối ngày.
              </p>
            </>
          )}
        </main>

        {/* Sổ giờ chi tiết của 1 KTV */}
        <AnimatePresence>
          {logic.detailOf && (
            <div
              className="fixed inset-0 z-50 flex justify-center items-end md:items-center bg-black/40 backdrop-blur-sm p-0 md:p-6"
              onClick={e => { if (e.target === e.currentTarget) logic.closeDetail(); }}
            >
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="bg-[var(--surface)] w-full max-w-4xl max-h-[92vh] flex flex-col rounded-t-[26px] md:rounded-[26px] overflow-hidden shadow-2xl"
              >
                {/* Header */}
                <div className="p-5 border-b border-[var(--line)] flex justify-between items-start gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar row={logic.detailOf} size={46} />
                    <div className="min-w-0">
                      <h2 className="text-lg font-bold tracking-tight truncate">{logic.detailOf.name}</h2>
                      <p className="text-sm text-[var(--muted)]">
                        {logic.detailOf.code} · Sổ giờ tháng {logic.month} · Hạng {logic.detailOf.rank}
                      </p>
                    </div>
                  </div>
                  <button onClick={logic.closeDetail} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-gray-100 shrink-0">
                    <X size={20} />
                  </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-5 pb-8">
                  {logic.detailLoading && (
                    <p className="py-10 text-center text-[var(--muted)]">Đang tải sổ giờ…</p>
                  )}

                  {!logic.detailLoading && !d && (
                    <p className="py-10 text-center text-[var(--muted)]">Không tải được sổ giờ của KTV này.</p>
                  )}

                  {!logic.detailLoading && d && (
                    <>
                      <HoursBreakdown earned={d.hours.earned} penalty={d.hours.penalty} net={d.hours.net} />

                      <p className="text-xs text-[var(--muted)] text-center mt-3">
                        {d.hours.turns} tua · {d.hours.days} ngày có tua
                        {d.hours.days > 0 && ` · TB ${fmtHours(d.hours.earned / d.hours.days)}/ngày`}
                      </p>

                      <div className="mt-6">
                        {d.hours.rows.length === 0 ? (
                          <p className="py-8 text-center text-[var(--muted)] text-sm">Tháng này chưa có dòng nào trong sổ giờ.</p>
                        ) : (
                          <LedgerTable rows={d.hours.rows} total={d.hours.net} />
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-[var(--line)]">
                  <button
                    onClick={logic.closeDetail}
                    className="w-full h-12 rounded-xl font-bold bg-[var(--green)] text-white"
                  >Đóng</button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </AppLayout>
  );
};

export default AdminKtvHoursPage;
