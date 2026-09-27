'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowLeft,
  Building2,
  CalendarCheck2,
  Clock3,
  Download,
  FileText,
  Layers3,
  Printer,
  RefreshCw,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import type { AuditRecord } from '@/lib/audit';
import { useAccess, authorizeAction } from '@/components/access-context';
import { AccountMenu } from '@/components/account-menu';

const statusLabels: Record<string, string> = {
  general: 'General message',
  planned: 'Planned maintenance',
  interruption: 'Service interruption',
  restored: 'Service restored',
  postponed: 'Postponed',
  cancelled: 'Cancelled',
};

const chartColors = ['#0f7751', '#1485a0', '#f0a51a', '#c63b4b', '#7c6db0'];

function formatDuration(minutes: number) {
  if (!minutes) return '—';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours ? `${hours}h` : '', remainder ? `${remainder}m` : ''].filter(Boolean).join(' ');
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Riyadh',
  }).format(new Date(value));
}

function formatCsvSentDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Riyadh',
  }).format(new Date(value)).replace(/\b(am|pm)\b/i, (period) => period.toUpperCase());
}

function formatCsvSchedule(date: string | null, time: string | null) {
  if (!date) return '';
  const [year, month, day] = date.split('-');
  const dateText = day && month && year ? `${day}/${month}/${year}` : date;
  if (!time) return dateText;
  const [hoursText, minutes = '00'] = time.split(':');
  const hours = Number(hoursText);
  if (!Number.isFinite(hours)) return `${dateText}, ${time}`;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${dateText}, ${String(displayHours).padStart(2, '0')}:${minutes} ${period}`;
}

function csvCell(value: string | number | null | undefined) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function EmptyChart() {
  return <div className="audit-chart-empty"><FileText /><span>No sent records match these filters.</span></div>;
}

function PrintMonthlyChart({ data }: { data: { label: string; total: number }[] }) {
  const maximum = Math.max(1, ...data.map((item) => item.total));
  return <div className="audit-print-chart audit-print-months" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }} aria-hidden="true">
    {data.map((item) => <div key={item.label}>
      <b>{item.total}</b>
      <svg viewBox="0 0 34 100" preserveAspectRatio="none" style={{ height: `${Math.max(4, (item.total / maximum) * 82)}%` }}>
        <rect width="34" height="100" rx="4" fill="#0f7751" />
      </svg>
      <span>{item.label}</span>
    </div>)}
  </div>;
}

function PrintRankChart({ data, color }: { data: { name: string; total: number }[]; color: string }) {
  const maximum = Math.max(1, ...data.map((item) => item.total));
  return <div className="audit-print-chart audit-print-ranks" aria-hidden="true">
    {data.map((item) => {
      const width = (item.total / maximum) * 100;
      const radius = Math.min(2, width / 2);
      const path = `M 0 0 H ${width - radius} Q ${width} 0 ${width} ${radius} V ${8 - radius} Q ${width} 8 ${width - radius} 8 H 0 Z`;
      return <div key={item.name}>
        <span>{item.name}</span>
        <svg viewBox="0 0 100 8" preserveAspectRatio="none">
          <path d={path} fill={color} />
        </svg>
        <b>{item.total}</b>
      </div>;
    })}
  </div>;
}

function PrintStatusChart({ data }: { data: { key: string; total: number; fill: string }[] }) {
  const total = data.reduce((sum, item) => sum + item.total, 0);
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = data.map((item) => {
    const length = total ? (item.total / total) * circumference : 0;
    const segment = { ...item, length, offset: -offset };
    offset += length;
    return segment;
  });

  return <div className="audit-print-chart audit-print-status" aria-hidden="true">
    <div className="audit-print-donut">
      <svg viewBox="0 0 120 120">
        {segments.map((item) => <circle
          key={item.key}
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={item.fill}
          strokeWidth="22"
          strokeDasharray={`${item.length} ${circumference - item.length}`}
          strokeDashoffset={item.offset}
          transform="rotate(-90 60 60)"
        />)}
      </svg>
      <strong>{total}</strong>
      <span>Total</span>
    </div>
  </div>;
}

export default function AuditDashboard() {
  const { can } = useAccess();
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [vendor, setVendor] = useState('all');
  const [integration, setIntegration] = useState('all');
  const [status, setStatus] = useState('all');
  const [printReady, setPrintReady] = useState(false);
  const printTimerRef = useRef<number | null>(null);

  const loadRecords = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/audit', { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load audit records.');
      const data = await response.json() as { records?: AuditRecord[] };
      setRecords(data.records || []);
    } catch {
      setError('The audit records could not be loaded. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetch('/api/audit', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load audit records.');
        return response.json() as Promise<{ records?: AuditRecord[] }>;
      })
      .then((data) => { if (active) setRecords(data.records || []); })
      .catch(() => { if (active) setError('The audit records could not be loaded. Please try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const finishPrint = () => setPrintReady(false);
    window.addEventListener('afterprint', finishPrint);
    return () => {
      window.removeEventListener('afterprint', finishPrint);
      if (printTimerRef.current !== null) window.clearTimeout(printTimerRef.current);
    };
  }, []);

  const vendors = useMemo(() => [...new Set(records.map((record) => record.vendorEn).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)), [records]);
  const integrations = useMemo(() => [...new Set(records.flatMap((record) => record.integrations.map((item) => item.nameEn)))].sort((a, b) => a.localeCompare(b)), [records]);

  const filtered = useMemo(() => records.filter((record) => {
    const sentDate = record.sentAt.slice(0, 10);
    return (!fromDate || sentDate >= fromDate)
      && (!toDate || sentDate <= toDate)
      && (vendor === 'all' || record.vendorEn === vendor)
      && (integration === 'all' || record.integrations.some((item) => item.nameEn === integration))
      && (status === 'all' || record.status === status);
  }), [records, fromDate, toDate, vendor, integration, status]);

  const metrics = useMemo(() => {
    const thisMonth = new Date().toISOString().slice(0, 7);
    const durationRecords = filtered.filter((record) => record.durationMinutes > 0);
    const duration = durationRecords.reduce((total, record) => total + record.durationMinutes, 0);
    return {
      total: filtered.length,
      thisMonth: filtered.filter((record) => record.sentAt.startsWith(thisMonth)).length,
      vendors: new Set(filtered.map((record) => record.vendorEn).filter(Boolean)).size,
      integrations: new Set(filtered.flatMap((record) => record.integrations.map((item) => item.nameEn))).size,
      averageDuration: durationRecords.length ? Math.round(duration / durationRecords.length) : 0,
      totalDuration: duration,
    };
  }, [filtered]);

  const monthlyData = useMemo(() => {
    const totals = new Map<string, number>();
    filtered.forEach((record) => {
      const month = record.sentAt.slice(0, 7);
      totals.set(month, (totals.get(month) || 0) + 1);
    });
    return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, total]) => ({
      month,
      label: new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(new Date(`${month}-01T00:00:00`)),
      total,
    }));
  }, [filtered]);

  const vendorData = useMemo(() => {
    const totals = new Map<string, number>();
    filtered.forEach((record) => {
      const name = record.vendorEn || (record.source === 'internal' ? 'Internal' : 'Other');
      totals.set(name, (totals.get(name) || 0) + 1);
    });
    return [...totals.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [filtered]);

  const integrationData = useMemo(() => {
    const totals = new Map<string, number>();
    filtered.forEach((record) => record.integrations.forEach((item) => totals.set(item.nameEn, (totals.get(item.nameEn) || 0) + 1)));
    return [...totals.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [filtered]);

  const statusData = useMemo(() => {
    const totals = new Map<string, number>();
    filtered.forEach((record) => totals.set(record.status, (totals.get(record.status) || 0) + 1));
    return [...totals.entries()].map(([key, total], index) => ({ key, name: statusLabels[key] || key, total, fill: chartColors[index % chartColors.length] })).sort((a, b) => b.total - a.total);
  }, [filtered]);

  const clearFilters = () => {
    setFromDate('');
    setToDate('');
    setVendor('all');
    setIntegration('all');
    setStatus('all');
  };

  const exportCsv = async () => {
    try { await authorizeAction('dashboard.export'); } catch (error) { window.alert(error instanceof Error ? error.message : 'Export unavailable.'); return; }
    const header = ['Sent date', 'Announcement', 'Template', 'Status', 'Vendor', 'Services', 'Start', 'End', 'Duration minutes', 'Sent by'];
    const rows = filtered.map((record) => [
      formatCsvSentDate(record.sentAt),
      record.announcementName,
      record.template,
      statusLabels[record.status] || record.status,
      record.vendorEn || '',
      record.integrations.map((item) => item.nameEn).join('; '),
      formatCsvSchedule(record.startDate, record.startTime),
      formatCsvSchedule(record.endDate, record.endTime),
      record.durationMinutes,
      record.sentBy,
    ]);
    const content = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tamam-announcement-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const printDashboard = async () => {
    try { await authorizeAction('dashboard.export'); } catch (error) { window.alert(error instanceof Error ? error.message : 'Export unavailable.'); return; }
    if (printTimerRef.current !== null) window.clearTimeout(printTimerRef.current);
    setPrintReady(true);
    printTimerRef.current = window.setTimeout(() => {
      printTimerRef.current = null;
      window.dispatchEvent(new Event('resize'));
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.print()));
    }, 250);
  };

  return <main className={`audit-shell${printReady ? ' print-ready' : ''}`}>
    <header className="topbar audit-topbar">
      <div className="brand-lockup">
        <Image className="tamam-mark" src="/tamam-logo.svg" alt="Tamam" width={112} height={34} priority />
        <div><h1>Tamam - Announcement Audit</h1><p>Sent announcement history and service trends</p></div>
      </div>
      <div className="top-actions audit-actions">
        {can('builder.view') && <a className="audit-nav-link" href="/"><ArrowLeft /> Builder</a>}
        {can('dashboard.export') && <Button variant="outline" onClick={printDashboard}><Printer /> Print / PDF</Button>}
        {can('dashboard.export') && <Button onClick={exportCsv} disabled={!filtered.length}><Download /> Export CSV</Button>}
        <AccountMenu />
      </div>
    </header>

    <div className="audit-content">
      <section className="audit-heading">
        <div><p className="eyebrow">Audit dashboard</p><h2>Announcement activity</h2><p>Every record below is captured when an announcement is marked as sent.</p></div>
        <Button variant="outline" size="sm" onClick={() => void loadRecords()} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} /> Refresh</Button>
      </section>

      <section className="audit-filters" aria-label="Dashboard filters">
        <label htmlFor="audit-from"><span>From</span><Input id="audit-from" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label htmlFor="audit-to"><span>To</span><Input id="audit-to" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
        <label><span>Vendor</span><NativeSelect value={vendor} onChange={(event) => setVendor(event.target.value)}><NativeSelectOption value="all">All vendors</NativeSelectOption>{vendors.map((name) => <NativeSelectOption key={name} value={name}>{name}</NativeSelectOption>)}</NativeSelect></label>
        <label><span>Service</span><NativeSelect value={integration} onChange={(event) => setIntegration(event.target.value)}><NativeSelectOption value="all">All services</NativeSelectOption>{integrations.map((name) => <NativeSelectOption key={name} value={name}>{name}</NativeSelectOption>)}</NativeSelect></label>
        <label><span>Status</span><NativeSelect value={status} onChange={(event) => setStatus(event.target.value)}><NativeSelectOption value="all">All statuses</NativeSelectOption>{Object.entries(statusLabels).map(([key, label]) => <NativeSelectOption key={key} value={key}>{label}</NativeSelectOption>)}</NativeSelect></label>
        <Button variant="ghost" size="sm" onClick={clearFilters}>Clear</Button>
      </section>

      {error && <div className="audit-error">{error}</div>}

      <section className="audit-kpis" aria-label="Audit summary">
        <article><span className="audit-kpi-icon green"><FileText /></span><div><small>Total sent</small><strong>{metrics.total}</strong><em>Matching current filters</em></div></article>
        <article><span className="audit-kpi-icon blue"><CalendarCheck2 /></span><div><small>This month</small><strong>{metrics.thisMonth}</strong><em>Sent announcements</em></div></article>
        <article><span className="audit-kpi-icon amber"><Building2 /></span><div><small>Vendors</small><strong>{metrics.vendors}</strong><em>Distinct affected vendors</em></div></article>
        <article><span className="audit-kpi-icon violet"><Layers3 /></span><div><small>Services</small><strong>{metrics.integrations}</strong><em>Distinct affected services</em></div></article>
        <article><span className="audit-kpi-icon red"><Clock3 /></span><div><small>Average duration</small><strong>{formatDuration(metrics.averageDuration)}</strong><em>{formatDuration(metrics.totalDuration)} total scheduled impact</em></div></article>
      </section>

      <section className="audit-chart-grid audit-chart-overview">
        <article className="audit-card wide">
          <div className="audit-card-heading"><div><h3>Announcements sent each month</h3><p>Each bar shows the number of announcements sent during that month.</p></div></div>
          {monthlyData.length ? <ResponsiveContainer width="100%" height={260}>
            <BarChart data={monthlyData} margin={{ left: -12, right: 12, top: 28, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e3eae6" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} interval={0} tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value) => [`${value} announcements`, 'Sent']} />
              <Bar dataKey="total" name="Announcements sent" fill="#0f7751" radius={[7, 7, 0, 0]} maxBarSize={56}>
                <LabelList dataKey="total" position="top" fill="#24362f" fontSize={13} fontWeight={700} />
              </Bar>
            </BarChart>
          </ResponsiveContainer> : <EmptyChart />}
          {monthlyData.length > 0 && <PrintMonthlyChart data={monthlyData} />}
        </article>
        <article className="audit-card"><div className="audit-card-heading"><div><h3>Status mix</h3><p>Current announcement outcomes</p></div></div>{statusData.length ? <><ResponsiveContainer width="100%" height={260}><PieChart><Pie data={statusData} dataKey="total" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={3} /></PieChart></ResponsiveContainer><PrintStatusChart data={statusData} /></> : <EmptyChart />}<div className="audit-legend">{statusData.map((item) => <span key={item.key}><i style={{ background: item.fill }} />{item.name}<b>{item.total}</b></span>)}</div></article>
      </section>
      <section className="audit-chart-grid audit-chart-breakdown">
        <article className="audit-card"><div className="audit-card-heading"><div><h3>Announcements by vendor</h3><p>Most frequently affected vendors</p></div></div>{vendorData.length ? <><ResponsiveContainer width="100%" height={300}><BarChart data={vendorData} layout="vertical" margin={{ left: 8, right: 15 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e3eae6"/><XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="name" width={78} interval={0} axisLine={false} tickLine={false}/><Tooltip/><Bar dataKey="total" name="Sent" fill="#1485a0" radius={[0, 6, 6, 0]}/></BarChart></ResponsiveContainer><PrintRankChart data={vendorData} color="#1485a0" /></> : <EmptyChart />}</article>
        <article className="audit-card"><div className="audit-card-heading"><div><h3>Affected services</h3><p>Services appearing most often</p></div></div>{integrationData.length ? <><ResponsiveContainer width="100%" height={300}><BarChart data={integrationData} layout="vertical" margin={{ left: 8, right: 15 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e3eae6"/><XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="name" width={112} interval={0} axisLine={false} tickLine={false} tick={{ fontSize: 11 }}/><Tooltip/><Bar dataKey="total" name="Affected" fill="#f0a51a" radius={[0, 6, 6, 0]}/></BarChart></ResponsiveContainer><PrintRankChart data={integrationData} color="#f0a51a" /></> : <EmptyChart />}</article>
      </section>

      <section className="audit-card audit-log">
        <div className="audit-card-heading"><div><h3>Sent announcement log</h3><p>{filtered.length} immutable {filtered.length === 1 ? 'record' : 'records'}</p></div></div>
        <div className="audit-table-wrap">
          <table>
            <thead><tr><th>Sent</th><th>Announcement</th><th>Vendor</th><th>Services</th><th>Status</th><th>Schedule</th><th>Duration</th><th>Sent by</th></tr></thead>
            <tbody>{filtered.map((record) => <tr key={record.id}>
              <td>{formatDateTime(record.sentAt)}</td>
              <td><b>{record.announcementName}</b><small>{record.template === 'general' ? 'General message' : 'Service announcement'}</small></td>
              <td>{record.vendorEn || '—'}{record.vendorAr && <small dir="rtl">{record.vendorAr}</small>}</td>
              <td>{record.integrations.length ? record.integrations.map((item) => item.nameEn).join(', ') : '—'}</td>
              <td><span className={`audit-status ${record.status}`}>{statusLabels[record.status] || record.status}</span></td>
              <td>{record.startDate ? <>{record.startDate}<small>{record.startTime || ''} → {record.endDate || ''} {record.endTime || ''}</small></> : '—'}</td>
              <td>{formatDuration(record.durationMinutes)}</td>
              <td>{record.sentBy}</td>
            </tr>)}</tbody>
          </table>
          {!loading && !filtered.length && <div className="audit-empty-log"><FileText /><b>No sent announcements yet</b><span>Return to the builder and use “Mark as sent” after an announcement is delivered.</span></div>}
          {loading && <div className="audit-empty-log"><RefreshCw className="spin" /><b>Loading audit records</b></div>}
        </div>
      </section>
    </div>
  </main>;
}
