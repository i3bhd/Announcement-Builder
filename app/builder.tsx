'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BarChart3,
  Bold,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileCode2,
  FolderOpen,
  ImageDown,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  Pencil,
  Plus,
  Printer,
  RemoveFormatting,
  Save,
  Send,
  Settings2,
  Smile,
  Trash2,
  Underline,
  Undo2,
  X,
} from 'lucide-react';
import EmojiPicker, { EmojiStyle, Theme, type EmojiClickData } from 'emoji-picker-react';
import emojiRegex from 'emoji-regex';
import { toPng } from 'html-to-image';
import { sanitizeRichHtml, clipboardRichHtml } from '@/lib/rich-text';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { useAccess, authorizeAction } from '@/components/access-context';
import { AccountMenu } from '@/components/account-menu';
import type { Permission } from '@/lib/permissions';

type Pair = { en: string; ar: string };
type Impact = Pair & { id: string; integrationId?: string };
type Integration = { id: string; name: Pair; impact: Pair; note?: 'Confirmed' | 'Vendor mapping needs confirmation' };
type Vendor = { id: string; name: Pair; summary?: Pair; integrations: Integration[] };
type StatusKey = 'planned' | 'interruption' | 'restored' | 'postponed' | 'cancelled';
type TemplateKey = 'service' | 'general';
type PendingDraftDelete = { draft: Announcement; order: string[]; token: string; expiresAt: number };
type GeneralImage = {
  dataUrl: string;
  name: string;
  width: number;
  height: number;
  zoom: number;
  positionX: number;
  positionY: number;
};

const DRAFT_UNDO_MS = 5000;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type Announcement = {
  id: string;
  template: TemplateKey;
  name: string;
  status: StatusKey;
  source: 'vendor' | 'internal' | 'other';
  vendorId: string;
  selectedIntegrationIds: string[];
  headerLabel: Pair;
  footerLabel: Pair;
  footerWebsite: string;
  title: Pair;
  intro: Pair;
  summary: Pair;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  impacts: Impact[];
  contact: Pair;
  extraTitle: Pair;
  extraBody: Pair;
  generalMessage: Pair;
  generalContact: Pair;
  generalImage: GeneralImage | null;
  updatedAt?: string;
};

const uid = () => Math.random().toString(36).slice(2, 10);

const currentRiyadhDate = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

const GENERAL_HEADER_LABEL: Pair = {
  en: 'Announcement title',
  ar: 'عنوان الإعلان',
};

const DEFAULT_SELECTED_INTEGRATION_IDS = ['cashout-repayment', 'loan'];

const statusTemplates: Record<StatusKey, { label: Pair; title: Pair; intro: Pair }> = {
  planned: {
    label: { en: 'Planned maintenance', ar: 'صيانة مجدولة' },
    title: { en: 'Planned Service Maintenance', ar: 'تنبيه صيانة مجدولة' },
    intro: { en: 'There is planned service maintenance as follows:', ar: 'نحيطكم علمًا بوجود صيانة مجدولة حسب التفاصيل التالية:' },
  },
  interruption: {
    label: { en: 'Service interruption', ar: 'انقطاع في الخدمة' },
    title: { en: 'Service Interruption', ar: 'تنبيه انقطاع في الخدمة' },
    intro: { en: 'There is a service interruption as follows:', ar: 'نحيطكم علمًا بوجود انقطاع في الخدمة حسب التفاصيل التالية:' },
  },
  restored: {
    label: { en: 'Service restored', ar: 'استعادة الخدمة' },
    title: { en: 'Service Restored', ar: 'إشعار استعادة الخدمة' },
    intro: { en: 'The affected service has been restored as follows:', ar: 'تمت استعادة الخدمة المتأثرة حسب التفاصيل التالية:' },
  },
  postponed: {
    label: { en: 'Postponed', ar: 'تم التأجيل' },
    title: { en: 'Service Maintenance Postponed', ar: 'تأجيل صيانة الخدمة' },
    intro: { en: 'The previously announced maintenance has been postponed:', ar: 'تم تأجيل صيانة الخدمة المعلن عنها سابقاً:' },
  },
  cancelled: {
    label: { en: 'Cancelled', ar: 'تم الإلغاء' },
    title: { en: 'Service Maintenance Cancelled', ar: 'إلغاء صيانة الخدمة' },
    intro: { en: 'The previously announced maintenance has been cancelled:', ar: 'تم إلغاء صيانة الخدمة المعلن عنها سابقاً:' },
  },
};

const serviceDescription = (status: StatusKey): Pair => ({ ...statusTemplates[status].intro });

const vendorAnnouncementName = (vendorName: string, status: StatusKey) =>
  `${vendorName} ${statusTemplates[status].label.en.toLowerCase()}`;

const seedVendors: Vendor[] = [
  {
    id: 'anb',
    name: { en: 'ANB', ar: 'البنك العربي الوطني' },
    summary: { en: 'ANB services will be unavailable', ar: 'تعطل مؤقت في خدمات البنك العربي الوطني' },
    integrations: [
      { id: 'cashout-repayment', name: { en: 'Cashout and repayment', ar: 'السحب والسداد' }, impact: { en: 'Cashout and repayment services will be unavailable', ar: 'تعطل مؤقت في خدمات السحب والسداد' }, note: 'Confirmed' },
      { id: 'loan', name: { en: 'Loan disbursal', ar: 'صرف التمويل' }, impact: { en: 'Loan disbursal will be unavailable', ar: 'تعطل مؤقت في صرف التمويل' }, note: 'Confirmed' },
      { id: 'anb-sarie-merchant-auto-payment', name: { en: 'SARIE merchant auto-payment', ar: 'الدفع التلقائي للتاجر عبر سريع' }, impact: { en: 'Merchant auto-payment will be unavailable', ar: 'تعطل مؤقت في الدفع التلقائي للتاجر' }, note: 'Confirmed' },
      { id: 'anb-sarie-repayment-service', name: { en: 'SARIE repayment service', ar: 'خدمة السداد عبر سريع' }, impact: { en: 'Repayment service will be unavailable', ar: 'تعطل مؤقت في خدمة السداد' }, note: 'Confirmed' },
    ],
  },
  {
    id: 'azm',
    name: { en: 'AZM', ar: 'عزم' },
    summary: { en: 'AZM services will be unavailable', ar: 'تعطل مؤقت في خدمات عزم' },
    integrations: [
      { id: 'azm-digital-signing', name: { en: 'Digital signing', ar: 'التوقيع الرقمي' }, impact: { en: 'Digital signing will be unavailable', ar: 'تعطل مؤقت في خدمة التوقيع الرقمي' }, note: 'Confirmed' },
      { id: 'azm-promissory-note-signing', name: { en: 'Promissory note signing', ar: 'توقيع السند' }, impact: { en: 'Promissory note signing will be unavailable', ar: 'تعطل مؤقت في توقيع السند' }, note: 'Confirmed' },
    ],
  },
  {
    id: 'cleartax',
    name: { en: 'ClearTax', ar: 'كليرتاكس' },
    summary: { en: 'ClearTax services will be unavailable', ar: 'تعطل مؤقت في خدمات كليرتاكس' },
    integrations: [
      { id: 'cleartax-tax-invoice-creation', name: { en: 'Tax invoice creation', ar: 'إنشاء الفاتورة الضريبية' }, impact: { en: 'Tax invoice creation will be unavailable', ar: 'تعطل مؤقت في إنشاء الفاتورة الضريبية' }, note: 'Confirmed' },
    ],
  },
  {
    id: 'elm',
    name: { en: 'ELM', ar: 'علم' },
    summary: { en: 'ELM services will be unavailable', ar: 'تعطل مؤقت في خدمات علم' },
    integrations: [
      { id: 'elm-customer-kyc', name: { en: 'Customer KYC', ar: 'التحقق من بيانات العميل' }, impact: { en: 'Customer KYC service will be unavailable', ar: 'تعطل مؤقت في التحقق من بيانات العميل' }, note: 'Confirmed' },
      { id: 'elm-mobile-verification', name: { en: 'Mobile ownership verification', ar: 'التحقق من ملكية رقم الهاتف' }, impact: { en: 'Mobile ownership verification will be unavailable', ar: 'تعطل مؤقت في التحقق من ملكية رقم الهاتف' }, note: 'Confirmed' },
      { id: 'elm-nafath', name: { en: 'Nafath', ar: 'نفاذ' }, impact: { en: 'Nafath service will be unavailable', ar: 'تعطل مؤقت في خدمة نفاذ' }, note: 'Confirmed' },
    ],
  },
  {
    id: 'lean',
    name: { en: 'Lean', ar: 'لين' },
    summary: { en: 'Lean services will be unavailable', ar: 'تعطل مؤقت في خدمات لين' },
    integrations: [
      { id: 'lean-iban-validation', name: { en: 'IBAN validation', ar: 'التحقق من صحة الآيبان' }, impact: { en: 'IBAN validation will be unavailable', ar: 'تعطل مؤقت في التحقق من صحة الآيبان' }, note: 'Confirmed' },
      { id: 'lean-open-banking', name: { en: 'Open Banking', ar: 'الخدمات المصرفية المفتوحة' }, impact: { en: 'Open Banking services will be unavailable', ar: 'تعطل مؤقت في الخدمات المصرفية المفتوحة' }, note: 'Confirmed' },
    ],
  },
  {
    id: 'masdr',
    name: { en: 'MASDR', ar: 'مصدر' },
    summary: { en: 'MASDR services will be unavailable', ar: 'تعطل مؤقت في خدمات مصدر' },
    integrations: [
      { id: 'masdr-loan-processing', name: { en: 'Loan application processing', ar: 'معالجة طلب التمويل' }, impact: { en: 'Loan application processing will be unavailable', ar: 'تعطل مؤقت في معالجة طلب التمويل' }, note: 'Confirmed' },
    ],
  },
  {
    id: 'nafith',
    name: { en: 'Nafith', ar: 'نافذ' },
    summary: { en: 'Nafith services will be unavailable', ar: 'تعطل مؤقت في خدمات نافذ' },
    integrations: [
      { id: 'nafith-promissory-note-creation', name: { en: 'Promissory note creation', ar: 'إنشاء السند' }, impact: { en: 'Promissory note creation will be unavailable', ar: 'تعطل مؤقت في إنشاء السند' }, note: 'Confirmed' },
      { id: 'nafith-promissory-note-signing', name: { en: 'Promissory note signing', ar: 'توقيع السند' }, impact: { en: 'Promissory note signing will be unavailable', ar: 'تعطل مؤقت في توقيع السند' }, note: 'Confirmed' },
    ],
  },
  {
    id: 'simah',
    name: { en: 'SIMAH', ar: 'سمة' },
    summary: { en: 'SIMAH services will be unavailable', ar: 'تعطل مؤقت في خدمات سمة' },
    integrations: [
      { id: 'simah-government-salary', name: { en: 'Government-sector salary inquiry', ar: 'الاستعلام عن راتب القطاع الحكومي' }, impact: { en: 'Government-sector salary inquiry will be unavailable', ar: 'تعطل مؤقت في الاستعلام عن راتب القطاع الحكومي' }, note: 'Vendor mapping needs confirmation' },
      { id: 'simah-private-salary', name: { en: 'Private-sector salary inquiry', ar: 'الاستعلام عن راتب القطاع الخاص' }, impact: { en: 'Private-sector salary inquiry will be unavailable', ar: 'تعطل مؤقت في الاستعلام عن راتب القطاع الخاص' }, note: 'Vendor mapping needs confirmation' },
      { id: 'simah-services', name: { en: 'SIMAH services', ar: 'خدمات سمة' }, impact: { en: 'SIMAH services will be unavailable', ar: 'تعطل مؤقت في خدمات سمة' }, note: 'Confirmed' },
    ],
  },
  {
    id: 'zain',
    name: { en: 'Zain', ar: 'زين' },
    summary: { en: 'Zain SMS service will be affected', ar: 'تأثر مؤقت في خدمة الرسائل النصية' },
    integrations: [
      { id: 'zain-sms', name: { en: 'SMS service', ar: 'خدمة الرسائل النصية' }, impact: { en: 'SMS service will be temporarily affected', ar: 'تأثر مؤقت في خدمة الرسائل النصية' }, note: 'Confirmed' },
    ],
  },
];

const VENDOR_SEED_VERSION = 'fixed-master-data-v7-deduplicate-vendors';
const RETIRED_VENDOR_IDS = new Set(['generic-payment']);
const normalizeVendorName = (name: string) => name.normalize('NFKD').toLocaleLowerCase('en').replace(/[^a-z0-9]/g, '');

function mergeSeedVendors(saved: Vendor[]) {
  const seedIds = new Set(seedVendors.map((vendor) => vendor.id));
  const seedNames = new Set(seedVendors.map((vendor) => normalizeVendorName(vendor.name.en)));
  const customVendors = saved.filter((vendor) =>
    !seedIds.has(vendor.id)
    && !seedNames.has(normalizeVendorName(vendor.name.en))
    && !RETIRED_VENDOR_IDS.has(vendor.id)
  ).map((vendor) => ({
    ...vendor,
    summary: vendor.summary ? { ...vendor.summary, ar: vendor.summary.ar.replace(/قد\s+/g, '') } : undefined,
    integrations: vendor.integrations.map((integration) => ({
      ...integration,
      impact: { ...integration.impact, ar: integration.impact.ar.replace(/قد\s+/g, '') },
    })),
  }));
  return [...seedVendors, ...customVendors];
}

const sortByEnglishName = <T extends { name: Pair },>(items: T[]) =>
  [...items].sort((left, right) => left.name.en.localeCompare(right.name.en, 'en', { sensitivity: 'base' }));

const emptyAnnouncement = (): Announcement => {
  const today = currentRiyadhDate();
  return {
  id: uid(),
  template: 'service',
  name: 'ANB planned maintenance',
  status: 'planned',
  source: 'vendor',
  vendorId: 'anb',
  selectedIntegrationIds: [...DEFAULT_SELECTED_INTEGRATION_IDS],
  headerLabel: { ...statusTemplates.planned.title },
  footerLabel: { en: 'Information Technology', ar: 'تقنية المعلومات' },
  footerWebsite: 'www.tamam.life',
  title: { ...statusTemplates.planned.title },
  intro: { ...statusTemplates.planned.intro },
  summary: { en: 'ANB services will be unavailable', ar: 'تعطل مؤقت في خدمات البنك العربي الوطني' },
  startDate: today,
  startTime: '04:00',
  endDate: today,
  endTime: '06:00',
  impacts: seedVendors[0].integrations
    .filter((integration) => DEFAULT_SELECTED_INTEGRATION_IDS.includes(integration.id))
    .map((integration) => ({ id: uid(), integrationId: integration.id, ...integration.impact })),
  contact: { en: 'For further information, please contact the Technology Support team', ar: 'للمزيد من المعلومات، يرجى التواصل مع فريق الدعم التقني' },
  extraTitle: { en: '', ar: '' },
  extraBody: { en: '', ar: '' },
  generalMessage: {
    en: '<p><strong>Dear Colleagues,</strong></p><p>Write your announcement here. Include the key details and any action required.</p>',
    ar: '<p><strong>الزميلات والزملاء الأعزاء،</strong></p><p>اكتب إعلانك هنا، مع توضيح التفاصيل الأساسية وأي إجراء مطلوب.</p>',
  },
  generalContact: { en: '', ar: '' },
  generalImage: null,
  };
};

const APPLE_EMOJI_IMAGE_BASE = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64';

function normalizeInlineEmoji(html: string) {
  return html.split(/(<[^>]+>)/g).map((part) => {
    if (part.startsWith('<')) return part;
    return part.replace(emojiRegex(), (emoji) => {
      const unified = Array.from(emoji)
        .map((character) => character.codePointAt(0)?.toString(16))
        .filter(Boolean)
        .join('-');
      return `<img src="${APPLE_EMOJI_IMAGE_BASE}/${unified}.png" alt="${emoji}" title="Emoji" class="inline-apple-emoji" draggable="false">`;
    });
  }).join('');
}

function legacyMessageToHtml(value: string) {
  if (!value) return '';
  if (/<(?:p|div|br|strong|em|u|b|i|ul|ol|li|span|font|img)\b/i.test(value)) return normalizeInlineEmoji(value);
  const escaped = value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character] || character);
  return normalizeInlineEmoji(escaped.split(/\n{2,}/).filter(Boolean).map((paragraph) => (
    `<p>${paragraph.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}</p>`
  )).join(''));
}


function normalizeAnnouncement(draft: Partial<Announcement>): Announcement {
  const fallback = emptyAnnouncement();
  const selectedIntegrationIds = Array.isArray(draft.selectedIntegrationIds)
    ? draft.selectedIntegrationIds
    : fallback.selectedIntegrationIds;
  const impacts = (draft.impacts || fallback.impacts).filter((impact) =>
    !impact.integrationId || selectedIntegrationIds.includes(impact.integrationId));
  const savedImage = draft.generalImage as Partial<GeneralImage> | undefined;
  const generalImage = savedImage?.dataUrl?.startsWith('data:image/') ? {
    dataUrl: savedImage.dataUrl,
    name: savedImage.name || 'Message image',
    width: Math.max(1, Number(savedImage.width) || 1),
    height: Math.max(1, Number(savedImage.height) || 1),
    zoom: Math.min(3, Math.max(1, Number(savedImage.zoom) || 1)),
    positionX: Math.min(100, Math.max(0, Number.isFinite(Number(savedImage.positionX)) ? Number(savedImage.positionX) : 50)),
    positionY: Math.min(100, Math.max(0, Number.isFinite(Number(savedImage.positionY)) ? Number(savedImage.positionY) : 50)),
  } : null;
  return {
    ...fallback,
    ...draft,
    template: draft.template || 'service',
    selectedIntegrationIds,
    impacts,
    generalMessage: {
      en: legacyMessageToHtml(draft.generalMessage?.en ?? fallback.generalMessage.en),
      ar: legacyMessageToHtml(draft.generalMessage?.ar ?? fallback.generalMessage.ar),
    },
    generalContact: draft.generalContact || fallback.generalContact,
    generalImage,
    footerLabel: {
      en: draft.footerLabel?.en ?? fallback.footerLabel.en,
      ar: draft.footerLabel?.ar ?? fallback.footerLabel.ar,
    },
    footerWebsite: draft.footerWebsite ?? fallback.footerWebsite,
  };
}

function newAnnouncementFor(template: TemplateKey): Announcement {
  const next = emptyAnnouncement();
  if (template === 'general') {
    next.template = 'general';
    next.name = 'New announcement';
    next.headerLabel = { ...GENERAL_HEADER_LABEL };
    next.footerLabel = { en: 'Department name', ar: 'اسم القسم' };
  }
  return next;
}

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="field">
    <span>{label}{hint && <small>{hint}</small>}</span>
    {children}
  </label>
);

const QUICK_TEXT_COLORS = [
  { label: 'Dark grey', value: '#0C0C0E' },
  { label: 'Tamam teal', value: '#2DB8DA' },
  { label: 'Tamam orange', value: '#FCB316' },
  { label: 'Tamam pink', value: '#C80050' },
  { label: 'Tamam green', value: '#1EDC73' },
  { label: 'Tamam cream', value: '#F9ECCE' },
];

type RgbColor = { r: number; g: number; b: number };
type HsvColor = { h: number; s: number; v: number };

const clampNumber = (value: number, min: number, max: number, fallback = min) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

const clampColor = (value: number, max = 255) => Math.round(clampNumber(value, 0, max));

function rgbToHex({ r, g, b }: RgbColor) {
  return `#${[r, g, b].map((value) => clampColor(value).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function hexToRgb(value: string): RgbColor | null {
  const compact = value.trim().replace(/^#/, '');
  const normalized = compact.length === 3 ? compact.split('').map((character) => character.repeat(2)).join('') : compact;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHsv({ r, g, b }: RgbColor): HsvColor {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  return {
    h: Math.round((hue + 360) % 360),
    s: max ? Math.round((delta / max) * 100) : 0,
    v: Math.round(max * 100),
  };
}

function hsvToRgb({ h, s, v }: HsvColor): RgbColor {
  const safeHue = clampNumber(h, 0, 360);
  const saturation = clampNumber(s, 0, 100) / 100;
  const brightness = clampNumber(v, 0, 100) / 100;
  const chroma = brightness * saturation;
  const segment = ((safeHue % 360) + 360) % 360 / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const offset = brightness - chroma;
  const [red, green, blue] = segment < 1 ? [chroma, x, 0]
    : segment < 2 ? [x, chroma, 0]
      : segment < 3 ? [0, chroma, x]
        : segment < 4 ? [0, x, chroma]
          : segment < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  return {
    r: Math.round((red + offset) * 255),
    g: Math.round((green + offset) * 255),
    b: Math.round((blue + offset) * 255),
  };
}

function cssColorToRgb(value: string): RgbColor | null {
  const hex = hexToRgb(value);
  if (hex) return hex;
  const match = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  return match ? { r: clampColor(Number(match[1])), g: clampColor(Number(match[2])), b: clampColor(Number(match[3])) } : null;
}

const AnnouncementHeader = ({ label }: { label?: Pair }) => {
  const headerLabel = { ar: label?.ar ?? 'تقنية المعلومات', en: label?.en ?? 'Information Technology' };

  return (
    <div className="source-header-wrap" role="img" aria-label={`TAMAM — ${headerLabel.en} / ${headerLabel.ar}`}>
      <img
        className="source-header"
        src="/announcement-header.svg"
        alt=""
        aria-hidden="true"
        draggable={false}
        decoding="sync"
      />
      <div className="source-header-copy">
        <span dir="rtl">{headerLabel.ar}</span>
        <strong>{headerLabel.en}</strong>
      </div>
    </div>
  );
};

const AnnouncementFooter = ({ label, website }: { label?: Pair; website?: string }) => {
  const footerLabel = {
    en: label?.en ?? 'Information Technology',
    ar: label?.ar ?? 'تقنية المعلومات',
  };
  const footerWebsite = website ?? 'www.tamam.life';
  const accessibleLabel = `${footerLabel.en} / ${footerLabel.ar} — ${footerWebsite}`;

  return (
    <div className="source-footer-wrap" role="img" aria-label={accessibleLabel}>
      <img
        className="source-footer"
        src="/announcement-footer-clean.svg"
        alt=""
        aria-hidden="true"
        draggable={false}
        decoding="sync"
      />
      <div className="source-footer-copy">
        <span>{footerLabel.en}</span>
        <i aria-hidden="true">|</i>
        <span dir="rtl">{footerLabel.ar}</span>
      </div>
      <strong className="source-footer-website">{footerWebsite}</strong>
    </div>
  );
};

type MessageEditorId = 'en' | 'ar';
type EditorSelectionSnapshot = {
  startPath: number[];
  startOffset: number;
  endPath: number[];
  endOffset: number;
};
type EditorHistoryEntry = { html: string; selection: EditorSelectionSnapshot | null };

const EDITOR_HISTORY_LIMIT = 100;
const EDITOR_TYPING_GROUP_MS = 650;

function RichTextEditor({
  value,
  onChange,
  dir,
  label,
  editorId,
  activeEditor,
  onActivate,
  toolbarHost,
}: {
  value: string;
  onChange: (value: string) => void;
  dir?: 'ltr' | 'rtl';
  label: string;
  editorId: MessageEditorId;
  activeEditor: MessageEditorId;
  onActivate: (editor: MessageEditorId) => void;
  toolbarHost: HTMLDivElement | null;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const toolbarTimer = useRef<number | null>(null);
  const colorApplyFrame = useRef<number | null>(null);
  const colorTargets = useRef<HTMLElement[]>([]);
  const colorPickerActive = useRef(false);
  const emojiPickerActive = useRef(false);
  const historyEntries = useRef<EditorHistoryEntry[]>([]);
  const historyIndex = useRef(-1);
  const historyGroup = useRef<{ key: string; updatedAt: number } | null>(null);
  const [showToolbar, setShowToolbar] = useState(false);
  const [hasTextSelection, setHasTextSelection] = useState(false);
  const [isChoosingColor, setIsChoosingColor] = useState(false);
  const [isChoosingEmoji, setIsChoosingEmoji] = useState(false);
  const [colorSelectionRects, setColorSelectionRects] = useState<Array<{ left: number; top: number; width: number; height: number }>>([]);
  const [pickerHsv, setPickerHsv] = useState<HsvColor>({ h: 160, s: 83, v: 46 });
  const [hexDraft, setHexDraft] = useState('#147653');
  const [activeFormats, setActiveFormats] = useState({ bold: false, italic: false, underline: false, bullets: false, numbering: false });

  useEffect(() => {
    if (activeEditor === editorId) return;
    if (toolbarTimer.current !== null) window.clearTimeout(toolbarTimer.current);
    toolbarTimer.current = null;
    colorTargets.current = [];
    colorPickerActive.current = false;
    emojiPickerActive.current = false;
    setIsChoosingColor(false);
    setIsChoosingEmoji(false);
    setColorSelectionRects([]);
    setHasTextSelection(false);
    setShowToolbar(false);
  }, [activeEditor, editorId]);

  useEffect(() => {
    const editor = editorRef.current;
    const nextValue = legacyMessageToHtml(value);
    if (!editor) return;
    if (document.activeElement !== editor && editor.innerHTML !== nextValue) {
      editor.innerHTML = nextValue;
      historyEntries.current = [{ html: nextValue, selection: null }];
      historyIndex.current = 0;
      historyGroup.current = null;
      return;
    }
    if (!historyEntries.current.length) {
      historyEntries.current = [{ html: nextValue, selection: null }];
      historyIndex.current = 0;
    }
  }, [value]);

  useEffect(() => () => {
    if (toolbarTimer.current !== null) window.clearTimeout(toolbarTimer.current);
    if (colorApplyFrame.current !== null) window.cancelAnimationFrame(colorApplyFrame.current);
  }, []);

  const pathFromEditor = (node: Node) => {
    const editor = editorRef.current;
    if (!editor || (node !== editor && !editor.contains(node))) return null;
    const path: number[] = [];
    let current: Node | null = node;
    while (current && current !== editor) {
      const parent: ParentNode | null = current.parentNode;
      if (!parent) return null;
      const index = Array.prototype.indexOf.call(parent.childNodes, current) as number;
      if (index < 0) return null;
      path.unshift(index);
      current = parent as Node;
    }
    return current === editor ? path : null;
  };

  const nodeFromEditorPath = (path: number[]) => {
    let current: Node | null = editorRef.current;
    for (const index of path) current = current?.childNodes[index] || null;
    return current;
  };

  const serializeRange = (range: Range | null): EditorSelectionSnapshot | null => {
    if (!range) return null;
    const startPath = pathFromEditor(range.startContainer);
    const endPath = pathFromEditor(range.endContainer);
    if (!startPath || !endPath) return null;
    return {
      startPath,
      startOffset: range.startOffset,
      endPath,
      endOffset: range.endOffset,
    };
  };

  const currentSelectionSnapshot = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (editor && selection?.rangeCount) {
      const range = selection.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) return serializeRange(range);
    }
    return serializeRange(savedRange.current);
  };

  const restoreSelectionSnapshot = (snapshot: EditorSelectionSnapshot | null) => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection) return;
    const range = document.createRange();
    const startNode = snapshot ? nodeFromEditorPath(snapshot.startPath) : null;
    const endNode = snapshot ? nodeFromEditorPath(snapshot.endPath) : null;
    if (snapshot && startNode && endNode) {
      const startLimit = startNode.nodeType === Node.TEXT_NODE ? startNode.textContent?.length || 0 : startNode.childNodes.length;
      const endLimit = endNode.nodeType === Node.TEXT_NODE ? endNode.textContent?.length || 0 : endNode.childNodes.length;
      range.setStart(startNode, Math.min(snapshot.startOffset, startLimit));
      range.setEnd(endNode, Math.min(snapshot.endOffset, endLimit));
    } else {
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange.current = range.cloneRange();
  };

  const resetHistoryGrouping = () => { historyGroup.current = null; };

  const recordHistory = (html: string, groupKey?: 'typing' | 'deleting' | 'color-picker') => {
    const entry = { html, selection: currentSelectionSnapshot() };
    if (!historyEntries.current.length) {
      historyEntries.current = [{ html: legacyMessageToHtml(value), selection: null }];
      historyIndex.current = 0;
    }
    const current = historyEntries.current[historyIndex.current];
    if (current?.html === html) {
      current.selection = entry.selection;
      return;
    }

    const now = Date.now();
    const previousGroup = historyGroup.current;
    const shouldCoalesce = Boolean(groupKey && previousGroup?.key === groupKey && (
      groupKey === 'color-picker' || now - previousGroup.updatedAt <= EDITOR_TYPING_GROUP_MS
    ));
    if (shouldCoalesce && historyIndex.current > 0) {
      historyEntries.current[historyIndex.current] = entry;
    } else {
      const nextEntries = historyEntries.current.slice(0, historyIndex.current + 1);
      nextEntries.push(entry);
      if (nextEntries.length > EDITOR_HISTORY_LIMIT) nextEntries.shift();
      historyEntries.current = nextEntries;
      historyIndex.current = nextEntries.length - 1;
    }
    historyGroup.current = groupKey ? { key: groupKey, updatedAt: now } : null;
  };

  const applyHistory = (direction: -1 | 1) => {
    const editor = editorRef.current;
    if (!editor) return;
    const nextIndex = historyIndex.current + direction;
    if (nextIndex < 0 || nextIndex >= historyEntries.current.length) return;
    const entry = historyEntries.current[nextIndex];
    historyIndex.current = nextIndex;
    resetHistoryGrouping();
    colorTargets.current = [];
    colorPickerActive.current = false;
    emojiPickerActive.current = false;
    setIsChoosingColor(false);
    setIsChoosingEmoji(false);
    setColorSelectionRects([]);
    editor.innerHTML = entry.html;
    editor.focus({ preventScroll: true });
    restoreSelectionSnapshot(entry.selection);
    onChange(entry.html);
    requestAnimationFrame(rememberSelection);
  };

  const hideToolbar = () => {
    if (toolbarTimer.current !== null) window.clearTimeout(toolbarTimer.current);
    toolbarTimer.current = null;
    colorTargets.current = [];
    colorPickerActive.current = false;
    emojiPickerActive.current = false;
    setIsChoosingColor(false);
    setIsChoosingEmoji(false);
    setColorSelectionRects([]);
    setHasTextSelection(false);
    setShowToolbar(false);
  };

  const rememberSelection = () => {
    // Keep the toolbar (and its anchored color picker) fixed while the picker is open.
    // Applying a color rebuilds the selected text range, which otherwise makes the
    // floating positioner follow the new range and causes the panel to jump.
    if (colorPickerActive.current || emojiPickerActive.current) {
      const currentEntry = historyEntries.current[historyIndex.current];
      if (currentEntry) currentEntry.selection = serializeRange(savedRange.current);
      setShowToolbar(true);
      setHasTextSelection(Boolean(savedRange.current && !savedRange.current.collapsed));
      return;
    }
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) {
      setHasTextSelection(false);
      setShowToolbar(false);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      setHasTextSelection(false);
      setShowToolbar(false);
      return;
    }
    savedRange.current = range.cloneRange();
    const currentEntry = historyEntries.current[historyIndex.current];
    if (currentEntry && currentEntry.html === sanitizeRichHtml(editor.innerHTML)) {
      currentEntry.selection = serializeRange(range);
    }
    setHasTextSelection(!range.collapsed && Boolean(selection.toString().trim()));
    setActiveFormats({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      bullets: document.queryCommandState('insertUnorderedList'),
      numbering: document.queryCommandState('insertOrderedList'),
    });
    setShowToolbar(true);
  };

  const showToolbarAfterPointer = () => {
    if (toolbarTimer.current !== null) window.clearTimeout(toolbarTimer.current);
    toolbarTimer.current = window.setTimeout(() => {
      toolbarTimer.current = null;
      rememberSelection();
    }, 160);
  };

  const publishValue = (groupKey?: 'typing' | 'deleting' | 'color-picker') => {
    const editor = editorRef.current;
    if (!editor) return;
    const selectionSnapshot = currentSelectionSnapshot();
    const html = sanitizeRichHtml(editor.innerHTML);
    if (editor.innerHTML !== html) {
      editor.innerHTML = html;
      restoreSelectionSnapshot(selectionSnapshot);
    }
    recordHistory(html, groupKey);
    onChange(html);
  };

  const convertListMarker = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return false;
    const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer as Element
      : range.startContainer.parentElement;
    const block = startElement?.closest('p, div');
    const currentBlock = block && editor.contains(block) ? block as HTMLElement : editor;
    if (startElement?.closest('li')) return false;

    const markerRange = document.createRange();
    markerRange.selectNodeContents(currentBlock);
    markerRange.setEnd(range.startContainer, range.startOffset);
    const marker = markerRange.toString();
    if (marker !== '*' && marker !== '1.' && marker !== '١.') return false;
    markerRange.deleteContents();

    const list = document.createElement(marker === '*' ? 'ul' : 'ol');
    const item = document.createElement('li');
    while (currentBlock.firstChild) item.appendChild(currentBlock.firstChild);
    if (!item.textContent && !item.querySelector('br')) item.appendChild(document.createElement('br'));
    list.appendChild(item);
    if (currentBlock === editor) editor.appendChild(list);
    else currentBlock.replaceWith(list);

    const caret = document.createRange();
    caret.selectNodeContents(item);
    caret.collapse(false);
    selection.removeAllRanges();
    selection.addRange(caret);
    resetHistoryGrouping();
    publishValue();
    return true;
  };

  const applyFormat = (command: 'bold' | 'italic' | 'underline' | 'removeFormat' | 'insertUnorderedList' | 'insertOrderedList') => {
    resetHistoryGrouping();
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection) return;
    const liveRange = selection.rangeCount ? selection.getRangeAt(0) : null;
    const range = liveRange && editor.contains(liveRange.commonAncestorContainer)
      ? liveRange.cloneRange() : savedRange.current?.cloneRange();
    if (!range || !editor.contains(range.commonAncestorContainer)) return;
    editor.focus({ preventScroll: true });
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand(command, false);
    publishValue();
    requestAnimationFrame(rememberSelection);
  };

  const applyTextColor = (color: string) => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    const savedSelection = savedRange.current;
    if (!editor || !selection || !savedSelection || savedSelection.collapsed) return;

    let targets = colorPickerActive.current
      ? colorTargets.current.filter((target) => target.isConnected && editor.contains(target))
      : [];

    if (!targets.length) {
      const startContainer = savedSelection.startContainer;
      const startOffset = savedSelection.startOffset;
      const endContainer = savedSelection.endContainer;
      const endOffset = savedSelection.endOffset;
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          if (!node.textContent) return NodeFilter.FILTER_REJECT;
          try {
            return savedSelection.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          } catch {
            return NodeFilter.FILTER_REJECT;
          }
        },
      });
      const textNodes: Text[] = [];
      let currentNode = walker.nextNode();
      while (currentNode) {
        textNodes.push(currentNode as Text);
        currentNode = walker.nextNode();
      }

      textNodes.reverse().forEach((textNode) => {
        const start = textNode === startContainer ? startOffset : 0;
        const end = textNode === endContainer ? endOffset : textNode.data.length;
        if (start >= end || start < 0 || end > textNode.data.length) return;
        if (end < textNode.data.length) textNode.splitText(end);
        const selectedText = start > 0 ? textNode.splitText(start) : textNode;
        if (!selectedText.parentNode) return;
        const span = document.createElement('span');
        span.style.color = color;
        selectedText.parentNode.insertBefore(span, selectedText);
        span.appendChild(selectedText);
        targets.unshift(span);
      });

      if (!targets.length) return;
      const exactRange = document.createRange();
      exactRange.setStartBefore(targets[0]);
      exactRange.setEndAfter(targets[targets.length - 1]);
      savedRange.current = exactRange.cloneRange();
      selection.removeAllRanges();
      selection.addRange(exactRange);
      if (colorPickerActive.current) colorTargets.current = targets;
    } else {
      targets.forEach((target) => { target.style.color = color; });
      if (savedRange.current) {
        selection.removeAllRanges();
        selection.addRange(savedRange.current);
      }
    }

    publishValue(colorPickerActive.current ? 'color-picker' : undefined);
    requestAnimationFrame(rememberSelection);
  };

  const queueTextColor = (color: string) => {
    if (colorApplyFrame.current !== null) window.cancelAnimationFrame(colorApplyFrame.current);
    colorApplyFrame.current = window.requestAnimationFrame(() => {
      colorApplyFrame.current = null;
      applyTextColor(color);
    });
  };

  const updatePickerColor = (next: HsvColor) => {
    const normalized = {
      h: clampNumber(next.h, 0, 360, pickerHsv.h),
      s: clampNumber(next.s, 0, 100, pickerHsv.s),
      v: clampNumber(next.v, 0, 100, pickerHsv.v),
    };
    const hex = rgbToHex(hsvToRgb(normalized));
    setPickerHsv(normalized);
    setHexDraft(hex);
    queueTextColor(hex);
  };

  const updatePickerRgb = (channel: keyof RgbColor, value: number) => {
    const next = { ...hsvToRgb(pickerHsv), [channel]: clampColor(value) };
    updatePickerColor(rgbToHsv(next));
  };

  const commitHexColor = (value: string) => {
    const rgb = hexToRgb(value);
    if (!rgb) {
      setHexDraft(rgbToHex(hsvToRgb(pickerHsv)));
      return;
    }
    const hex = rgbToHex(rgb);
    setHexDraft(hex);
    setPickerHsv(rgbToHsv(rgb));
    queueTextColor(hex);
  };

  const keepSelectionVisibleForColorPicker = () => {
    const range = savedRange.current;
    const shell = shellRef.current;
    if (!range || !shell) return;
    const shellRect = shell.getBoundingClientRect();
    setColorSelectionRects(Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        left: rect.left - shellRect.left,
        top: rect.top - shellRect.top,
        width: rect.width,
        height: rect.height,
      })));
  };

  const prepareColorPicker = () => {
    colorTargets.current = [];
    keepSelectionVisibleForColorPicker();
    const currentColor = cssColorToRgb(String(document.queryCommandValue('foreColor')))
      || hexToRgb('#147653')!;
    const hex = rgbToHex(currentColor);
    setPickerHsv(rgbToHsv(currentColor));
    setHexDraft(hex);
  };

  const setColorPickerOpen = (open: boolean) => {
    resetHistoryGrouping();
    colorPickerActive.current = open;
    setIsChoosingColor(open);
    if (!open) {
      colorTargets.current = [];
      setColorSelectionRects([]);
    }
  };

  const setEmojiPickerOpen = (open: boolean) => {
    resetHistoryGrouping();
    emojiPickerActive.current = open;
    setIsChoosingEmoji(open);
    if (open) {
      colorTargets.current = [];
      colorPickerActive.current = false;
      setIsChoosingColor(false);
      setColorSelectionRects([]);
      setShowToolbar(true);
    }
  };

  const insertAppleEmoji = (emoji: EmojiClickData) => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection) return;

    const range = savedRange.current?.cloneRange() || document.createRange();
    if (!savedRange.current || !editor.contains(range.commonAncestorContainer)) {
      range.selectNodeContents(editor);
      range.collapse(false);
    }

    const image = document.createElement('img');
    image.src = emoji.imageUrl;
    image.alt = emoji.emoji;
    image.title = emoji.names[0] || 'Emoji';
    image.className = 'inline-apple-emoji';
    image.draggable = false;

    range.deleteContents();
    range.insertNode(image);
    range.setStartAfter(image);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange.current = range.cloneRange();
    emojiPickerActive.current = false;
    setIsChoosingEmoji(false);
    publishValue();
    editor.focus({ preventScroll: true });
    requestAnimationFrame(rememberSelection);
  };

  const updateSaturationFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const saturation = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
    const brightness = Math.min(100, Math.max(0, 100 - ((event.clientY - rect.top) / rect.height) * 100));
    updatePickerColor({ ...pickerHsv, s: saturation, v: brightness });
  };

  const pickerRgb = hsvToRgb(pickerHsv);

  const toolbar = <div className="editor-toolbar-frame">
    <div className="selection-toolbar" role="toolbar" aria-label={dir === 'rtl' ? 'تنسيق النص' : 'Text formatting'}>
      <button type="button" title="Bold" aria-label="Bold" aria-pressed={activeFormats.bold} disabled={!showToolbar} onMouseDown={(event) => { event.preventDefault(); applyFormat('bold'); }}><Bold /></button>
      <button type="button" title="Italic" aria-label="Italic" aria-pressed={activeFormats.italic} disabled={!showToolbar} onMouseDown={(event) => { event.preventDefault(); applyFormat('italic'); }}><Italic /></button>
      <button type="button" title="Underline" aria-label="Underline" aria-pressed={activeFormats.underline} disabled={!showToolbar} onMouseDown={(event) => { event.preventDefault(); applyFormat('underline'); }}><Underline /></button>
      <button type="button" title="Bulleted list" aria-label="Bulleted list" aria-pressed={activeFormats.bullets} disabled={!showToolbar} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat('insertUnorderedList')}><List /></button>
      <button type="button" title="Numbered list" aria-label="Numbered list" aria-pressed={activeFormats.numbering} disabled={!showToolbar} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat('insertOrderedList')}><ListOrdered /></button>
      <span />
      <div className="text-color-swatches" aria-label="Text colors">
        {QUICK_TEXT_COLORS.map((color) => (
          <button
            key={color.value}
            type="button"
            className="text-color-swatch"
            title={hasTextSelection ? `${color.label} text` : 'Select text to apply a color'}
            aria-label={`${color.label} text color`}
            disabled={!hasTextSelection}
            onMouseDown={(event) => { event.preventDefault(); applyTextColor(color.value); }}
          >
            <span aria-hidden="true" style={{ backgroundColor: color.value }} />
          </button>
        ))}
        <Popover open={isChoosingColor} onOpenChange={setColorPickerOpen}>
          <PopoverTrigger
            className="custom-text-color"
            title={hasTextSelection ? 'Choose any text color' : 'Select text to choose a color'}
            aria-label="Choose any text color"
            aria-expanded={isChoosingColor}
            disabled={!hasTextSelection}
            onMouseDown={(event) => {
              event.preventDefault();
              if (!isChoosingColor) prepareColorPicker();
            }}
          >
            <span aria-hidden="true" />
          </PopoverTrigger>
          <PopoverContent className="custom-color-panel" side="bottom" sideOffset={10} align="center">
          <div className="custom-color-title">Custom text color</div>
          <div
            className="custom-color-spectrum"
            role="slider"
            tabIndex={0}
            aria-label="Saturation and brightness"
            aria-valuetext={`${Math.round(pickerHsv.s)}% saturation, ${Math.round(pickerHsv.v)}% brightness`}
            style={{ backgroundColor: `hsl(${pickerHsv.h} 100% 50%)` }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              updateSaturationFromPointer(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSaturationFromPointer(event);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') updatePickerColor({ ...pickerHsv, s: pickerHsv.s - 1 });
              else if (event.key === 'ArrowRight') updatePickerColor({ ...pickerHsv, s: pickerHsv.s + 1 });
              else if (event.key === 'ArrowUp') updatePickerColor({ ...pickerHsv, v: pickerHsv.v + 1 });
              else if (event.key === 'ArrowDown') updatePickerColor({ ...pickerHsv, v: pickerHsv.v - 1 });
              else return;
              event.preventDefault();
            }}
          >
            <span className="custom-color-spectrum-thumb" style={{ left: `${pickerHsv.s}%`, top: `${100 - pickerHsv.v}%` }} />
          </div>
          <div className="custom-color-hue-row">
            <span className="custom-color-preview" style={{ backgroundColor: rgbToHex(pickerRgb) }} aria-hidden="true" />
            <Slider
              className="custom-hue-slider"
              aria-label="Hue"
              min={0}
              max={360}
              step={1}
              value={[pickerHsv.h]}
              onValueChange={(value) => {
                const hue = Array.isArray(value) ? value[0] : value;
                if (typeof hue === 'number') updatePickerColor({ ...pickerHsv, h: hue });
              }}
            />
          </div>
          <div className="custom-color-values">
            <label className="custom-color-field custom-color-hex">
              <span>HEX</span>
              <Input
                value={hexDraft}
                maxLength={7}
                spellCheck={false}
                aria-label="Hex color"
                onChange={(event) => {
                  const next = event.target.value.toUpperCase();
                  setHexDraft(next);
                  if (/^#?[0-9A-F]{6}$/.test(next)) commitHexColor(next);
                }}
                onBlur={(event) => commitHexColor(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') commitHexColor(event.currentTarget.value); }}
              />
            </label>
            <div className="custom-color-rgb-section">
              <span className="custom-color-rgb-title">RGB</span>
              <div className="custom-color-rgb-fields">
                {(['r', 'g', 'b'] as const).map((channel) => (
                  <label className="custom-color-field" key={channel}>
                    <span>{channel.toUpperCase()}</span>
                    <Input
                      type="number"
                      min={0}
                      max={255}
                      aria-label={`${channel.toUpperCase()} color value`}
                      value={pickerRgb[channel]}
                      onChange={(event) => updatePickerRgb(channel, Number(event.target.value))}
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
          </PopoverContent>
        </Popover>
        <Popover open={isChoosingEmoji} onOpenChange={setEmojiPickerOpen}>
          <PopoverTrigger
            className="emoji-picker-trigger"
            title="Insert emoji"
            aria-label="Insert emoji"
            aria-expanded={isChoosingEmoji}
            disabled={!showToolbar}
            onMouseDown={(event) => event.preventDefault()}
          >
            <Smile />
          </PopoverTrigger>
          <PopoverContent className="emoji-picker-panel" side="bottom" sideOffset={10} align="center">
            <EmojiPicker
              width={330}
              height={360}
              theme={Theme.LIGHT}
              emojiStyle={EmojiStyle.APPLE}
              lazyLoadEmojis
              previewConfig={{ showPreview: false }}
              searchPlaceHolder="Search emoji"
              onEmojiClick={insertAppleEmoji}
            />
          </PopoverContent>
        </Popover>
      </div>
      <span />
      <button type="button" title="Clear formatting" aria-label="Clear formatting" disabled={!hasTextSelection} onMouseDown={(event) => { event.preventDefault(); applyFormat('removeFormat'); }}><RemoveFormatting /></button>
    </div>
  </div>;

  return <>
    {toolbarHost && activeEditor === editorId ? createPortal(toolbar, toolbarHost) : null}
    <div ref={shellRef} className={`rich-editor-shell ${showToolbar ? 'is-active' : ''}`} dir={dir}>
    {isChoosingColor && colorSelectionRects.map((rect, index) => (
      <span
        key={`${rect.left}-${rect.top}-${index}`}
        className="color-selection-overlay"
        aria-hidden="true"
        style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      />
    ))}
    <div
      ref={editorRef}
      className="rich-text-editor"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      aria-multiline="true"
      data-placeholder={dir === 'rtl' ? 'اكتب رسالتك هنا' : 'Write your message here'}
      onInput={(event) => {
        const inputType = (event.nativeEvent as InputEvent).inputType || '';
        if (inputType === 'insertText' || inputType === 'insertCompositionText') publishValue('typing');
        else if (inputType.startsWith('delete')) publishValue('deleting');
        else publishValue();
      }}
      onFocus={() => {
        onActivate(editorId);
        requestAnimationFrame(rememberSelection);
      }}
      onPointerDown={() => {
        onActivate(editorId);
        colorTargets.current = [];
        colorPickerActive.current = false;
        emojiPickerActive.current = false;
        setIsChoosingColor(false);
        setIsChoosingEmoji(false);
        setColorSelectionRects([]);
        setShowToolbar(true);
      }}
      onPointerUp={showToolbarAfterPointer}
      onKeyDown={(event) => {
        const modifier = event.metaKey || event.ctrlKey;
        const key = event.key.toLowerCase();
        if (modifier && !event.altKey && (key === 'z' || (event.ctrlKey && key === 'y'))) {
          event.preventDefault();
          if (key === 'y' || event.shiftKey) applyHistory(1);
          else applyHistory(-1);
          return;
        }
        if (event.key === 'Escape') hideToolbar();
        if (event.key === ' ' && !event.metaKey && !event.ctrlKey && !event.altKey && convertListMarker()) {
          event.preventDefault();
          hideToolbar();
          return;
        }
        if (event.key === 'Enter' && !event.altKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          hideToolbar();
          resetHistoryGrouping();
          // Enter is a soft break; Shift+Enter creates a paragraph or next list item.
          // Preserve the existing Ctrl/Cmd+Enter soft-break shortcut.
          document.execCommand(event.shiftKey && !modifier ? 'insertParagraph' : 'insertLineBreak', false);
          publishValue();
          requestAnimationFrame(rememberSelection);
        }
      }}
      onKeyUp={(event) => { if (event.key !== 'Escape') requestAnimationFrame(rememberSelection); }}
      onBlur={() => window.setTimeout(() => {
        const activeElement = document.activeElement;
        const focusStayedInToolbar = activeElement instanceof Node &&
          (shellRef.current?.contains(activeElement) || toolbarHost?.contains(activeElement));
        if (!colorPickerActive.current && !emojiPickerActive.current && !focusStayedInToolbar) {
          setShowToolbar(false);
          setHasTextSelection(false);
        }
      }, 100)}
      onPaste={(event) => {
        event.preventDefault();
        resetHistoryGrouping();
        const html = clipboardRichHtml(event.clipboardData.getData('text/html'), event.clipboardData.getData('text/plain'));
        document.execCommand('insertHTML', false, html);
        publishValue();
        requestAnimationFrame(rememberSelection);
      }}
    />
    </div>
  </>;
}

function formatDate(date: string, lang: 'en' | 'ar') {
  if (!date) return '—';
  void lang;
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

function formatTime(value: string, lang: 'en' | 'ar') {
  if (!value) return '—';
  const [hours, minutes] = value.split(':').map(Number);
  if (lang === 'ar') {
    const hour = hours % 12 || 12;
    const period = hours >= 12 ? 'مساءً' : 'صباحًا';
    return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${period}`;
  }
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(new Date(2026, 0, 1, hours, minutes));
}

function durationLabel(a: Announcement, lang: 'en' | 'ar') {
  const minutes = durationMinutes(a);
  if (minutes <= 0) return lang === 'ar' ? 'تحقق من الوقت' : 'Check timing';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (lang === 'ar') {
    const arabicUnit = (value: number, singular: string, dual: string, plural: string) => {
      const lastTwoDigits = value % 100;
      if (lastTwoDigits === 2) return dual;
      if (lastTwoDigits >= 3 && lastTwoDigits <= 10) return plural;
      return singular;
    };
    const hourText = hours ? `${hours} ${arabicUnit(hours, 'ساعة', 'ساعتان', 'ساعات')}` : '';
    const minuteText = rest ? `${rest} ${arabicUnit(rest, 'دقيقة', 'دقيقتان', 'دقائق')}` : '';
    return [hourText, minuteText].filter(Boolean).join(' و');
  }
  return [hours ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : '', rest ? `${rest} min` : ''].filter(Boolean).join(' ');
}

function durationMinutes(a: Announcement) {
  const start = new Date(`${a.startDate}T${a.startTime}`);
  const end = new Date(`${a.endDate}T${a.endTime}`);
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function prepareGeneralImage(file: File): Promise<GeneralImage> {
  const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!supportedTypes.has(file.type)) throw new Error('Choose a JPG, PNG, or WebP image.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose an image smaller than 20 MB.');

  const objectUrl = URL.createObjectURL(file);
  try {
    const source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('This image could not be opened.'));
      image.src = objectUrl;
    });
    if (!source.naturalWidth || !source.naturalHeight) throw new Error('This image has no usable dimensions.');

    const longestSide = Math.max(source.naturalWidth, source.naturalHeight);
    let scale = Math.min(1, 1920 / longestSide);
    let result: Blob | null = null;
    let width = source.naturalWidth;
    let height = source.naturalHeight;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      width = Math.max(1, Math.round(source.naturalWidth * scale));
      height = Math.max(1, Math.round(source.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser could not prepare the image.');
      context.drawImage(source, 0, 0, width, height);
      const quality = Math.max(.68, .9 - attempt * .035);
      result = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
      if (!result) throw new Error('This browser could not prepare the image.');
      if (result.size <= 600_000 || scale <= .45) break;
      scale *= .84;
    }

    return {
      dataUrl: await blobToDataUrl(result as Blob),
      name: file.name,
      width,
      height,
      zoom: 1,
      positionX: 50,
      positionY: 50,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function renderAnnouncementPng(sourceNode: HTMLElement, transparentBackground = false) {
  const exportStage = document.createElement('div');
  exportStage.style.cssText = `position:absolute;left:-100000px;top:0;width:1920px;background:${transparentBackground ? 'transparent' : '#fff'};overflow:visible;`;

  const exportNode = sourceNode.cloneNode(true) as HTMLElement;
  Object.assign(exportNode.style, {
    width: '1920px',
    maxWidth: 'none',
    height: 'auto',
    margin: '0',
    overflow: 'visible',
    boxShadow: 'none',
    backgroundColor: transparentBackground ? 'transparent' : '#fff',
  });
  if (transparentBackground) {
    const sourceBody = exportNode.querySelector<HTMLElement>('.source-body');
    if (sourceBody) sourceBody.style.backgroundColor = 'transparent';
  }
  exportStage.appendChild(exportNode);
  document.body.appendChild(exportStage);

  try {
    await document.fonts.ready;
    await Promise.all(Array.from(exportNode.querySelectorAll('img')).map((image) => {
      if (image.complete && image.naturalWidth > 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => resolve(), { once: true });
      });
    }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

    const bounds = exportNode.getBoundingClientRect();
    const width = Math.ceil(Math.max(exportNode.scrollWidth, bounds.width));
    const height = Math.ceil(Math.max(exportNode.scrollHeight, bounds.height));
    const dataUrl = await toPng(exportNode, {
      width,
      height,
      canvasWidth: width,
      canvasHeight: height,
      pixelRatio: 1,
      backgroundColor: transparentBackground ? undefined : '#ffffff',
      cacheBust: true,
      skipAutoScale: true,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        maxWidth: 'none',
        margin: '0',
        overflow: 'visible',
        boxShadow: 'none',
        backgroundColor: transparentBackground ? 'transparent' : '#fff',
      },
    });
    return { dataUrl, width, height };
  } finally {
    exportStage.remove();
  }
}

async function buildEmbeddedAnnouncement(sourceNode: HTMLElement) {
  const assetCache = new Map<string, string>();
  const embedAsset = async (source: string) => {
    if (source.startsWith('data:') || source.startsWith('blob:') || source.startsWith('#')) return source;
    const absoluteUrl = new URL(source, window.location.href).href;
    const cached = assetCache.get(absoluteUrl);
    if (cached) return cached;
    const response = await fetch(absoluteUrl);
    if (!response.ok) throw new Error(`Unable to embed ${source}`);
    const dataUrl = await blobToDataUrl(await response.blob());
    assetCache.set(absoluteUrl, dataUrl);
    return dataUrl;
  };

  const clone = sourceNode.cloneNode(true) as HTMLElement;
  await Promise.all(Array.from(clone.querySelectorAll('img')).map(async (image) => {
    image.src = await embedAsset(image.getAttribute('src') || image.src);
  }));

  let styles = Array.from(document.styleSheets).flatMap((sheet) => {
    try { return Array.from(sheet.cssRules).map((rule) => rule.cssText); } catch { return []; }
  }).join('\n');
  const cssAssetUrls = Array.from(new Set(Array.from(styles.matchAll(/url\((['"]?)(.*?)\1\)/g))
    .map((match) => match[2].trim())
    .filter((source) => source && !source.startsWith('data:') && !source.startsWith('blob:') && !source.startsWith('#'))));
  await Promise.all(cssAssetUrls.map(async (source) => {
    const embedded = await embedAsset(source);
    styles = styles.split(source).join(embedded);
  }));

  return { clone, styles };
}

export default function Home() {
  const { user, can } = useAccess();
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [announcement, setAnnouncement] = useState<Announcement>(() => can('template.service') ? emptyAnnouncement() : newAnnouncementFor('general'));
  const [vendors, setVendors] = useState<Vendor[]>(seedVendors);
  const [drafts, setDrafts] = useState<Announcement[]>([]);
  const [pendingDraftDeletes, setPendingDraftDeletes] = useState<PendingDraftDelete[]>([]);
  const [savedText, setSavedText] = useState('Ready to save');
  const [vendorDialog, setVendorDialog] = useState(false);
  const [draftDialog, setDraftDialog] = useState(false);
  const [markSentDialog, setMarkSentDialog] = useState(false);
  const [markingSent, setMarkingSent] = useState(false);
  const [markSentError, setMarkSentError] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [generalImageBusy, setGeneralImageBusy] = useState(false);
  const [generalImageError, setGeneralImageError] = useState('');
  const [generalImageDragging, setGeneralImageDragging] = useState(false);
  const [activeMessageEditor, setActiveMessageEditor] = useState<MessageEditorId>('en');
  const [messageToolbarHost, setMessageToolbarHost] = useState<HTMLDivElement | null>(null);
  const [vendorSearch, setVendorSearch] = useState('ANB');
  const [newVendor, setNewVendor] = useState<Pair>({ en: '', ar: '' });
  const [manageVendorId, setManageVendorId] = useState('anb');
  const [editingIntegrationId, setEditingIntegrationId] = useState<string | null>(null);
  const [newIntegration, setNewIntegration] = useState<{ name: Pair; impact: Pair }>({
    name: { en: '', ar: '' }, impact: { en: '', ar: '' },
  });
  const previewRef = useRef<HTMLElement>(null);
  const generalImageInputRef = useRef<HTMLInputElement>(null);
  const generalImageFrameRef = useRef<HTMLElement>(null);
  const generalImageElementRef = useRef<HTMLImageElement>(null);
  const generalImageStateRef = useRef<GeneralImage | null>(announcement.generalImage);
  const generalImageCommitTimerRef = useRef<number | null>(null);
  const generalImagePaintFrameRef = useRef<number | null>(null);
  const generalImageDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    positionX: number;
    positionY: number;
    width: number;
    height: number;
    zoom: number;
  } | null>(null);
  const deleteTimerRefs = useRef<Map<string, number>>(new Map());

  const currentVendor = vendors.find((vendor) => vendor.id === announcement.vendorId);
  const managedVendor = vendors.find((vendor) => vendor.id === manageVendorId);
  const sortedVendors = useMemo(() => sortByEnglishName(vendors), [vendors]);
  const sortedCurrentIntegrations = useMemo(() => sortByEnglishName(currentVendor?.integrations || []), [currentVendor]);
  const sortedManagedIntegrations = useMemo(() => sortByEnglishName(managedVendor?.integrations || []), [managedVendor]);
  const durationEn = useMemo(() => durationLabel(announcement, 'en'), [announcement]);
  const durationAr = useMemo(() => durationLabel(announcement, 'ar'), [announcement]);
  const hasGeneralImage = announcement.generalImage !== null;
  generalImageStateRef.current = announcement.generalImage;
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      try {
        const libraryResponse = await fetch('/api/workspace/vendors', { cache: 'no-store' });
        if (!libraryResponse.ok) throw new Error('Unable to load your workspace. Please reload and sign in again if needed.');
        const library = await libraryResponse.json() as { vendors: Vendor[] | null };
        let nextVendors = library.vendors || seedVendors;
        if (!library.vendors && user.isAdmin) {
          const legacy = localStorage.getItem('tamam-vendors-v2');
          if (legacy && ['technology', 'it'].includes(user.username) && user.isAdmin) { try { nextVendors = mergeSeedVendors(JSON.parse(legacy)); } catch { /* Preserve malformed legacy data untouched. */ } }
          await workspaceRequest('vendors', { vendors: nextVendors, initialize: true });
        }
        if (!cancelled) setVendors(nextVendors);
        if (can('drafts.manage')) {
          const response = await fetch('/api/workspace/drafts', { cache: 'no-store' });
          if (!response.ok) throw new Error('Unable to load your drafts. Please try reloading.');
          const result = await response.json() as { drafts: Partial<Announcement>[] };
          const saved = (result.drafts as Partial<Announcement>[]).map(normalizeAnnouncement);
          if (['technology', 'it'].includes(user.username) && user.isAdmin && !localStorage.getItem('tamam-legacy-drafts-imported')) {
            const legacy = localStorage.getItem('tamam-drafts-v2');
            if (legacy) {
              const oldDrafts = (JSON.parse(legacy) as Partial<Announcement>[]).map(normalizeAnnouncement);
              for (const draft of oldDrafts) {
                if (!saved.some(item => item.id === draft.id)) { await workspaceRequest('drafts', draft); saved.push(draft); }
              }
            }
            localStorage.setItem('tamam-legacy-drafts-imported', '1');
          }
          if (!cancelled) setDrafts(saved);
        }
        if (!cancelled) setWorkspaceReady(true);
      } catch (error) { if (!cancelled) setWorkspaceError(error instanceof Error ? error.message : 'Unable to load the workspace. Please reload.'); }
    }
    void hydrate();
    return () => { cancelled = true; };
  }, [user.id]);

  async function workspaceRequest(resource: string, body: unknown, method = 'POST') {
    const response = await fetch(`/api/workspace/${resource}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || 'Unable to save. Please try again.');
    return result;
  }
  async function persistVendors(next: Vendor[]) {
    try { await workspaceRequest('vendors', { vendors: next }); setVendors(next); setWorkspaceError(''); return true; }
    catch (error) { setWorkspaceError(error instanceof Error ? error.message : 'Unable to save vendors.'); return false; }
  }
  async function permitted(permission: Permission) {
    try { await authorizeAction(permission, announcement.template); return true; }
    catch (error) { setWorkspaceError(error instanceof Error ? error.message : 'Action unavailable.'); return false; }
  }

  useEffect(() => () => {
    deleteTimerRefs.current.forEach((timer) => window.clearTimeout(timer));
    deleteTimerRefs.current.clear();
    if (generalImageCommitTimerRef.current !== null) window.clearTimeout(generalImageCommitTimerRef.current);
    if (generalImagePaintFrameRef.current !== null) window.cancelAnimationFrame(generalImagePaintFrameRef.current);
  }, []);

  const patchAnnouncement = (patch: Partial<Announcement>) => {
    setAnnouncement((current) => ({ ...current, ...patch }));
    setSavedText('Unsaved changes');
  };

  const patchPair = (key: 'headerLabel' | 'footerLabel' | 'title' | 'intro' | 'summary' | 'contact' | 'extraTitle' | 'extraBody' | 'generalMessage' | 'generalContact', lang: 'en' | 'ar', value: string) => {
    setAnnouncement((current) => ({ ...current, [key]: { ...current[key], [lang]: value } }));
    setSavedText('Unsaved changes');
  };

  const chooseTemplate = (template: TemplateKey) => {
    if (!can(`template.${template}`)) return;
    if (template === announcement.template) return;
    patchAnnouncement({
      template,
      ...(template === 'general' &&
        announcement.footerLabel.en === 'Information Technology' &&
        announcement.footerLabel.ar === 'تقنية المعلومات'
        ? { footerLabel: { en: 'Department name', ar: 'اسم القسم' } }
        : {}),
      headerLabel: template === 'service'
        ? { ...statusTemplates[announcement.status].title }
        : { ...GENERAL_HEADER_LABEL },
      name: template === 'general'
        ? 'New announcement'
        : currentVendor
          ? vendorAnnouncementName(currentVendor.name.en, announcement.status)
          : 'Service announcement',
    });
  };

  const selectGeneralImage = async (file?: File) => {
    if (!file) return;
    setGeneralImageBusy(true);
    setGeneralImageError('');
    try {
      const generalImage = await prepareGeneralImage(file);
      patchAnnouncement({ generalImage });
    } catch (error) {
      setGeneralImageError(error instanceof Error ? error.message : 'The image could not be added.');
    } finally {
      setGeneralImageBusy(false);
      if (generalImageInputRef.current) generalImageInputRef.current.value = '';
    }
  };

  const removeGeneralImage = () => {
    if (generalImageCommitTimerRef.current !== null) {
      window.clearTimeout(generalImageCommitTimerRef.current);
      generalImageCommitTimerRef.current = null;
    }
    generalImageStateRef.current = null;
    patchAnnouncement({ generalImage: null });
    generalImageDragRef.current = null;
    setGeneralImageDragging(false);
    setGeneralImageError('');
    if (generalImageInputRef.current) generalImageInputRef.current.value = '';
  };

  const updateGeneralImage = useCallback((patch: Partial<Pick<GeneralImage, 'zoom' | 'positionX' | 'positionY'>>) => {
    setAnnouncement((current) => {
      if (!current.generalImage) return current;
      const generalImage = { ...(generalImageStateRef.current || current.generalImage), ...patch };
      generalImageStateRef.current = generalImage;
      return { ...current, generalImage };
    });
    setSavedText('Unsaved changes');
  }, []);

  const paintGeneralImage = useCallback(() => {
    if (generalImagePaintFrameRef.current !== null) return;
    generalImagePaintFrameRef.current = window.requestAnimationFrame(() => {
      generalImagePaintFrameRef.current = null;
      const image = generalImageStateRef.current;
      const element = generalImageElementRef.current;
      if (!image || !element) return;
      element.style.transform = `translate3d(${-(image.zoom - 1) * image.positionX}%, ${-(image.zoom - 1) * image.positionY}%, 0) scale(${image.zoom})`;
    });
  }, []);

  const commitGeneralImageInteraction = useCallback(() => {
    const image = generalImageStateRef.current;
    if (!image) return;
    setAnnouncement((current) => current.generalImage ? { ...current, generalImage: image } : current);
    setSavedText('Unsaved changes');
  }, []);

  const startGeneralImageDrag = (event: React.PointerEvent<HTMLElement>) => {
    const image = generalImageStateRef.current;
    if (!image || image.zoom <= 1 || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    if (generalImageCommitTimerRef.current !== null) {
      window.clearTimeout(generalImageCommitTimerRef.current);
      generalImageCommitTimerRef.current = null;
      setAnnouncement((current) => current.generalImage ? { ...current, generalImage: image } : current);
      setSavedText('Unsaved changes');
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    generalImageDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      positionX: image.positionX,
      positionY: image.positionY,
      width: bounds.width,
      height: bounds.height,
      zoom: image.zoom,
    };
    setGeneralImageDragging(true);
  };

  const moveGeneralImage = (event: React.PointerEvent<HTMLElement>) => {
    const drag = generalImageDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const overflowX = drag.width * (drag.zoom - 1);
    const overflowY = drag.height * (drag.zoom - 1);
    generalImageStateRef.current = { ...generalImageStateRef.current!,
      positionX: overflowX ? clamp(drag.positionX - ((event.clientX - drag.startX) / overflowX) * 100, 0, 100) : 50,
      positionY: overflowY ? clamp(drag.positionY - ((event.clientY - drag.startY) / overflowY) * 100, 0, 100) : 50,
    };
    paintGeneralImage();
  };

  const stopGeneralImageDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (generalImageDragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    generalImageDragRef.current = null;
    setGeneralImageDragging(false);
    commitGeneralImageInteraction();
  };

  useEffect(() => {
    const frame = generalImageFrameRef.current;
    if (!frame || !hasGeneralImage) return;

    const zoomGeneralImage = (event: WheelEvent) => {
      const image = generalImageStateRef.current;
      if (!image) return;
      const deltaInPixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY * 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? event.deltaY * frame.clientHeight
          : event.deltaY;
      const isMouseWheel = !event.ctrlKey && (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || Math.abs(deltaInPixels) >= 48);
      const nextZoom = isMouseWheel
        ? clamp(image.zoom + (deltaInPixels < 0 ? .12 : -.12), 1, 3)
        : clamp(image.zoom * Math.exp(-clamp(deltaInPixels, -40, 40) * (event.ctrlKey ? .004 : .002)), 1, 3);
      if (nextZoom === image.zoom) return;
      event.preventDefault();

      const bounds = frame.getBoundingClientRect();
      const focusX = clamp(((event.clientX - bounds.left) / bounds.width) * 100, 0, 100);
      const focusY = clamp(((event.clientY - bounds.top) / bounds.height) * 100, 0, 100);
      const sourceX = (focusX + (image.zoom - 1) * image.positionX) / image.zoom;
      const sourceY = (focusY + (image.zoom - 1) * image.positionY) / image.zoom;
      const nextImage = nextZoom === 1 ? {
        ...image,
        zoom: 1,
        positionX: 50,
        positionY: 50,
      } : {
        ...image,
        zoom: nextZoom,
        positionX: clamp((sourceX * nextZoom - focusX) / (nextZoom - 1), 0, 100),
        positionY: clamp((sourceY * nextZoom - focusY) / (nextZoom - 1), 0, 100),
      };

      generalImageStateRef.current = nextImage;
      paintGeneralImage();

      if (generalImageCommitTimerRef.current !== null) window.clearTimeout(generalImageCommitTimerRef.current);
      generalImageCommitTimerRef.current = window.setTimeout(() => {
        generalImageCommitTimerRef.current = null;
        commitGeneralImageInteraction();
      }, 140);
    };

    frame.addEventListener('wheel', zoomGeneralImage, { passive: false });
    return () => frame.removeEventListener('wheel', zoomGeneralImage);
  }, [commitGeneralImageInteraction, hasGeneralImage, paintGeneralImage]);

  const moveGeneralImageWithKeyboard = (event: React.KeyboardEvent<HTMLElement>) => {
    const image = announcement.generalImage;
    if (!image) return;
    if (event.key === '0') {
      event.preventDefault();
      updateGeneralImage({ zoom: 1, positionX: 50, positionY: 50 });
      return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      updateGeneralImage({ zoom: clamp(image.zoom + .1, 1, 3) });
      return;
    }
    if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      const zoom = clamp(image.zoom - .1, 1, 3);
      updateGeneralImage(zoom === 1 ? { zoom, positionX: 50, positionY: 50 } : { zoom });
      return;
    }
    if (image.zoom <= 1 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 3;
    updateGeneralImage({
      positionX: clamp(image.positionX + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0), 0, 100),
      positionY: clamp(image.positionY + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0), 0, 100),
    });
  };

  const chooseVendor = (vendorId: string) => {
    const vendor = vendors.find((item) => item.id === vendorId);
    if (!vendor) return;
    if (vendor.id === announcement.vendorId) return;
    const startsNewDraft = Boolean(announcement.updatedAt) || drafts.some((draft) => draft.id === announcement.id);
    setVendorSearch(vendor.name.en);
    patchAnnouncement({
      ...(startsNewDraft ? { id: uid(), updatedAt: undefined } : {}),
      vendorId: vendor.id,
      name: vendorAnnouncementName(vendor.name.en, announcement.status),
      selectedIntegrationIds: [],
      impacts: [],
      title: { ...statusTemplates[announcement.status].title },
      intro: serviceDescription(announcement.status),
      summary: vendor.summary ? { ...vendor.summary } : announcement.summary,
    });
  };

  const toggleIntegration = (integration: Integration, selected: boolean) => {
    setAnnouncement((current) => {
      const ids = selected
        ? [...new Set([...current.selectedIntegrationIds, integration.id])]
        : current.selectedIntegrationIds.filter((id) => id !== integration.id);
      const impacts = selected
        ? current.impacts.some((impact) => impact.integrationId === integration.id)
          ? current.impacts
          : [...current.impacts, { id: uid(), integrationId: integration.id, ...integration.impact }]
        : current.impacts.filter((impact) => impact.integrationId !== integration.id);
      return { ...current, selectedIntegrationIds: ids, impacts };
    });
    setSavedText('Unsaved changes');
  };

  const saveDraft = async () => {
    const saved = { ...announcement, updatedAt: new Date().toISOString() };
    try { await workspaceRequest('drafts', saved); setWorkspaceError(''); }
    catch (error) { setWorkspaceError(error instanceof Error ? error.message : 'Unable to save draft.'); return; }
    const next = drafts.some((draft) => draft.id === saved.id)
      ? drafts.map((draft) => draft.id === saved.id ? saved : draft)
      : [saved, ...drafts];
    setAnnouncement(saved);
    setDrafts(next);
    setSavedText('Draft saved');
  };

  const markAsSent = async () => {
    setMarkingSent(true);
    setMarkSentError('');
    try {
      const isServiceVendor = announcement.template === 'service' && announcement.source === 'vendor';
      const selectedIntegrations = isServiceVendor ? currentVendor?.integrations
        .filter((integration) => announcement.selectedIntegrationIds.includes(integration.id))
        .map((integration) => ({ id: integration.id, nameEn: integration.name.en, nameAr: integration.name.ar })) || [] : [];
      const response = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          announcementId: announcement.id,
          announcementName: announcement.name,
          template: announcement.template,
          status: announcement.template === 'general' ? 'general' : announcement.status,
          source: announcement.source,
          vendorId: isServiceVendor ? currentVendor?.id || null : null,
          vendorEn: isServiceVendor ? currentVendor?.name.en || null : null,
          vendorAr: isServiceVendor ? currentVendor?.name.ar || null : null,
          integrations: selectedIntegrations,
          startDate: announcement.template === 'service' ? announcement.startDate : null,
          startTime: announcement.template === 'service' ? announcement.startTime : null,
          endDate: announcement.template === 'service' ? announcement.endDate : null,
          endTime: announcement.template === 'service' ? announcement.endTime : null,
          durationMinutes: announcement.template === 'service' ? durationMinutes(announcement) : 0,
          snapshot: announcement,
        }),
      });
      if (!response.ok) throw new Error('Unable to record this announcement.');
      setMarkSentDialog(false);
      setSavedText('Marked as sent');
    } catch {
      setMarkSentError('The audit record could not be saved. Please try again.');
    } finally {
      setMarkingSent(false);
    }
  };

  const newAnnouncement = async () => {
    if (!(await permitted('announcement.create'))) return;
    const next = newAnnouncementFor(announcement.template);
    setAnnouncement(next);
    setVendorSearch(seedVendors[0].name.en);
    setSavedText('New draft');
  };

  const duplicate = async () => {
    if (!(await permitted('announcement.create'))) return;
    setAnnouncement((current) => ({ ...current, id: uid(), name: `${current.name} copy`, updatedAt: undefined }));
    setSavedText('Duplicated — not saved');
  };

  const deleteDraft = async (id: string) => {
    try { await workspaceRequest('drafts', { id }, 'DELETE'); }
    catch (error) { setWorkspaceError(error instanceof Error ? error.message : 'Unable to delete draft.'); return; }
    const deletedIndex = drafts.findIndex((draft) => draft.id === id);
    if (deletedIndex < 0) return;
    const deletedDraft = drafts[deletedIndex];
    const deletedOrder = drafts.map((draft) => draft.id);
    const next = drafts.filter((draft) => draft.id !== id);
    setDrafts(next);
    setSavedText(announcement.id === id ? 'Removed from drafts' : 'Draft deleted');

    const deletedAt = Date.now();
    const token = uid();
    setPendingDraftDeletes((current) => [...current, { draft: deletedDraft, order: deletedOrder, token, expiresAt: deletedAt + DRAFT_UNDO_MS }]);
    const timer = window.setTimeout(() => {
      setPendingDraftDeletes((current) => current.filter((pending) => pending.token !== token));
      deleteTimerRefs.current.delete(token);
    }, DRAFT_UNDO_MS);
    deleteTimerRefs.current.set(token, timer);
  };

  const undoDraftDelete = async (token: string) => {
    const pendingDelete = pendingDraftDeletes.find((pending) => pending.token === token);
    if (!pendingDelete) return;
    const { draft, order } = pendingDelete;
    try { await workspaceRequest('drafts', draft); }
    catch (error) { setWorkspaceError(error instanceof Error ? error.message : 'Unable to restore draft.'); return; }
    const timer = deleteTimerRefs.current.get(token);
    if (timer !== undefined) window.clearTimeout(timer);
    deleteTimerRefs.current.delete(token);
    setDrafts((current) => {
      if (current.some((item) => item.id === draft.id)) return current;
      const restored = [...current];
      const deletedIndex = order.indexOf(draft.id);
      const nextExistingId = order.slice(deletedIndex + 1).find((id) => current.some((item) => item.id === id));
      const previousExistingId = [...order.slice(0, deletedIndex)].reverse().find((id) => current.some((item) => item.id === id));
      const insertAt = nextExistingId
        ? current.findIndex((item) => item.id === nextExistingId)
        : previousExistingId
          ? current.findIndex((item) => item.id === previousExistingId) + 1
          : current.length;
      restored.splice(insertAt, 0, draft);
      return restored;
    });
    setPendingDraftDeletes((current) => current.filter((pending) => pending.token !== token));
    setSavedText('Draft restored');
  };

  const addVendor = async () => {
    if (!newVendor.en.trim()) return;
    const vendor: Vendor = { id: uid(), name: { en: newVendor.en.trim(), ar: newVendor.ar.trim() || newVendor.en.trim() }, integrations: [] };
    const next = [...vendors, vendor];
    if (!(await persistVendors(next))) return;
    setManageVendorId(vendor.id);
    setNewVendor({ en: '', ar: '' });
  };

  const deleteVendor = async (id: string) => {
    if (vendors.length === 1) return;
    const next = vendors.filter((vendor) => vendor.id !== id);
    if (!(await persistVendors(next))) return;
    setManageVendorId(next[0].id);
  };

  const resetIntegrationForm = () => {
    setEditingIntegrationId(null);
    setNewIntegration({ name: { en: '', ar: '' }, impact: { en: '', ar: '' } });
  };

  const startEditingIntegration = (integration: Integration) => {
    setEditingIntegrationId(integration.id);
    setNewIntegration({ name: { ...integration.name }, impact: { ...integration.impact } });
  };

  const saveIntegration = async () => {
    if (!managedVendor || !newIntegration.name.en.trim()) return;
    const integration: Integration = {
      id: editingIntegrationId || uid(),
      name: { en: newIntegration.name.en.trim(), ar: newIntegration.name.ar.trim() || newIntegration.name.en.trim() },
      impact: { en: newIntegration.impact.en.trim(), ar: newIntegration.impact.ar.trim() },
    };
    const next = vendors.map((vendor) => vendor.id === managedVendor.id ? {
      ...vendor,
      integrations: editingIntegrationId
        ? vendor.integrations.map((item) => item.id === editingIntegrationId ? integration : item)
        : [...vendor.integrations, integration],
    } : vendor);
    if (!(await persistVendors(next))) return;
    if (editingIntegrationId && announcement.vendorId === managedVendor.id && announcement.selectedIntegrationIds.includes(editingIntegrationId)) {
      setAnnouncement((current) => ({
        ...current,
        impacts: current.impacts.map((impact) => impact.integrationId === editingIntegrationId
          ? { ...impact, ...integration.impact }
          : impact),
      }));
      setSavedText('Unsaved changes');
    }
    resetIntegrationForm();
  };

  const deleteIntegration = async (id: string) => {
    if (!managedVendor) return;
    const next = vendors.map((vendor) => vendor.id === managedVendor.id ? { ...vendor, integrations: vendor.integrations.filter((item) => item.id !== id) } : vendor);
    if (!(await persistVendors(next))) return;
    if (announcement.vendorId === managedVendor.id && announcement.selectedIntegrationIds.includes(id)) {
      setAnnouncement((current) => ({
        ...current,
        selectedIntegrationIds: current.selectedIntegrationIds.filter((integrationId) => integrationId !== id),
        impacts: current.impacts.filter((impact) => impact.integrationId !== id),
      }));
      setSavedText('Unsaved changes');
    }
    if (editingIntegrationId === id) resetIntegrationForm();
  };

  const addImpact = () => patchAnnouncement({ impacts: [...announcement.impacts, { id: uid(), en: '', ar: '' }] });
  const updateImpact = (id: string, lang: 'en' | 'ar', value: string) => patchAnnouncement({ impacts: announcement.impacts.map((impact) => impact.id === id ? { ...impact, [lang]: value } : impact) });
  const removeImpact = (id: string) => patchAnnouncement({ impacts: announcement.impacts.filter((impact) => impact.id !== id) });

  const exportHtml = async () => {
    if (!(await permitted('export.html'))) return;
    if (!previewRef.current) return;
    setExportOpen(false);
    const { clone, styles } = await buildEmbeddedAnnouncement(previewRef.current);
    const exportTitle = announcement.template === 'general' ? announcement.name : announcement.title.en;
    const safeTitle = exportTitle.replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    })[character] || character);
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="only light"><title>${safeTitle}</title><style>${styles}</style></head><body>${clone.outerHTML}</body></html>`;
    downloadFile(announcement.template === 'general' ? 'tamam-general-message.html' : 'tamam-announcement.html', html, 'text/html');
  };

  const exportHtmlSnippet = async () => {
    if (!(await permitted('export.html'))) return;
    if (!previewRef.current) return;
    setExportOpen(false);
    const { clone, styles } = await buildEmbeddedAnnouncement(previewRef.current);
    const announcementHtml = clone.outerHTML.replace(/[^\x00-\x7F]/gu, (character) => `&#${character.codePointAt(0)};`);
    const html = `\uFEFF<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="only light"><title>Tamam Announcement</title><style>${styles}</style></head><body>${announcementHtml}</body></html>`;
    downloadFile(announcement.template === 'general' ? 'tamam-general-message-embed.html' : 'tamam-announcement-embed.html', html, 'text/html;charset=utf-8');
    setSavedText('HTML snippet downloaded');
  };

  const exportPng = async () => {
    if (!(await permitted('export.png'))) return;
    if (!previewRef.current) return;
    setExportOpen(false);
    const { dataUrl } = await renderAnnouncementPng(previewRef.current, true);
    const anchor = document.createElement('a');
    anchor.download = announcement.template === 'general' ? 'tamam-general-message.png' : 'tamam-announcement.png';
    anchor.href = dataUrl;
    anchor.click();
  };

  const exportPdf = async () => {
    if (!(await permitted('export.pdf'))) return;
    if (!previewRef.current) return;
    setExportOpen(false);
    const { jsPDF } = await import('jspdf');
    const { dataUrl, width, height } = await renderAnnouncementPng(previewRef.current);
    const pageWidth = width * .75;
    const pageHeight = height * .75;
    const pdf = new jsPDF({
      orientation: width >= height ? 'landscape' : 'portrait',
      unit: 'pt',
      format: [pageWidth, pageHeight],
      compress: true,
    });
    pdf.addImage(dataUrl, 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
    pdf.save(announcement.template === 'general' ? 'tamam-general-message.pdf' : 'tamam-announcement.pdf');
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <img className="tamam-mark" src="/tamam-logo.svg" alt="Tamam" />
          <div><h1>Tamam - Announcement Builder</h1><p>Create clear bilingual internal messages</p></div>
        </div>
        <div className="top-actions">
          <span className={`saved-state ${savedText.startsWith('Unsaved') ? 'unsaved' : ''}`}><span /> {savedText}</span>
          {can('dashboard.view') && <a className="audit-nav-link" href="/dashboard"><BarChart3 /> Dashboard</a>}
          {can('announcement.create') && <Button variant="outline" disabled={!workspaceReady} onClick={newAnnouncement}><Plus /> New</Button>}
          {can('drafts.manage') && <Button variant="outline" disabled={!workspaceReady} onClick={() => setDraftDialog(true)}><FolderOpen /> Drafts</Button>}
          {can('announcement.create') && <Button variant="outline" disabled={!workspaceReady} onClick={duplicate}><Copy /> Duplicate</Button>}
          {can('drafts.manage') && can('announcement.edit') && <Button variant="outline" disabled={!workspaceReady} onClick={saveDraft}><Save /> Save</Button>}
          {can('announcement.send') && <Button className="mark-sent-button" variant="outline" disabled={!workspaceReady} onClick={() => { setMarkSentError(''); setMarkSentDialog(true); }}><Send /> Mark as sent</Button>}
          {(can('export.html') || can('export.png') || can('export.pdf')) && <div className="export-wrap">
            <Button onClick={() => setExportOpen((open) => !open)}><Download /> Export <ChevronDown /></Button>
            {exportOpen && <div className="export-menu">
              {can('export.html') && <button onClick={exportHtml}><FileCode2 /> HTML <small>Editable web file</small></button>}
              {can('export.html') && <button onClick={exportHtmlSnippet}><Copy /> HTML snippet <small>Embeddable HTML file</small></button>}
              {can('export.png') && <button onClick={exportPng}><ImageDown /> PNG <small>High-resolution image</small></button>}
              {can('export.pdf') && <button onClick={exportPdf}><Printer /> PDF <small>Complete one-page document</small></button>}
            </div>}
          </div>}
          <AccountMenu />
        </div>
      </header>

      {workspaceError && <div className="access-error" role="alert">{workspaceError}</div>}
      {!workspaceReady && !workspaceError && <div className="workspace-loading" role="status">Loading your workspace…</div>}

      <section className="workspace">
        <aside className="editor-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Announcement editor</p><h2>Build your message</h2></div>
            {announcement.template === 'service' && can('vendors.manage') && <Button variant="outline" size="sm" disabled={!workspaceReady} onClick={() => setVendorDialog(true)}><Settings2 /> Vendors & services</Button>}
          </div>
          {!can('announcement.edit') && <p className="access-hint">Your role has view-only access to the editor.</p>}
          <div inert={!can('announcement.edit') || !workspaceReady}>
          <div className="section-rule"><span>Choose template</span></div>
          <div className="template-switch" role="radiogroup" aria-label="Message template">
            {can('template.service') && <button type="button" role="radio" aria-checked={announcement.template === 'service'} className={announcement.template === 'service' ? 'active' : ''} onClick={() => chooseTemplate('service')}>
              <b>Service announcement</b><span>Vendor, impact and schedule</span>
              {announcement.template === 'service' && <Check className="template-selected-check" aria-hidden="true" />}
            </button>}
            {can('template.general') && <button type="button" role="radio" aria-checked={announcement.template === 'general'} className={announcement.template === 'general' ? 'active' : ''} onClick={() => chooseTemplate('general')}>
              <b>General bilingual message</b><span>Flexible internal communication</span>
              {announcement.template === 'general' && <Check className="template-selected-check" aria-hidden="true" />}
            </button>}
          </div>

          {announcement.template === 'service' ? <>
          <div className="section-rule"><span>Source & status</span></div>
          <div className="form-grid">
            <Field label="Announcement name" hint="Only visible to you"><Input value={announcement.name} onChange={(event) => patchAnnouncement({ name: event.target.value })} /></Field>
            <Field label="Announcement status">
              <NativeSelect className="w-full" value={announcement.status} onChange={(event) => {
                const status = event.target.value as StatusKey;
                patchAnnouncement({
                  status,
                  headerLabel: { ...statusTemplates[status].title },
                  name: announcement.source === 'vendor' && currentVendor
                    ? vendorAnnouncementName(currentVendor.name.en, status)
                    : announcement.name,
                  title: { ...statusTemplates[status].title },
                  intro: serviceDescription(status),
                });
              }}>
                {Object.entries(statusTemplates).map(([key, value]) => <NativeSelectOption key={key} value={key}>{value.label.en}</NativeSelectOption>)}
              </NativeSelect>
            </Field>
            <Field label="Source">
              <NativeSelect className="w-full" value={announcement.source} onChange={(event) => {
                const source = event.target.value as Announcement['source'];
                patchAnnouncement({
                  source,
                  title: { ...statusTemplates[announcement.status].title },
                  intro: serviceDescription(announcement.status),
                });
              }}>
                <NativeSelectOption value="vendor">Vendor</NativeSelectOption><NativeSelectOption value="internal">Internal</NativeSelectOption><NativeSelectOption value="other">Other</NativeSelectOption>
              </NativeSelect>
            </Field>
            {announcement.source === 'vendor' && <Field label="Vendor" hint="Choose from the list">
              <NativeSelect className="w-full" value={announcement.vendorId} onChange={(event) => chooseVendor(event.target.value)} aria-label="Vendor">
                {sortedVendors.map((vendor) => <NativeSelectOption key={vendor.id} value={vendor.id}>{vendor.name.en} — {vendor.name.ar}</NativeSelectOption>)}
              </NativeSelect>
            </Field>}
          </div>

          {announcement.source === 'vendor' && <div className="integration-box">
            <div className="integration-title"><div><b>Affected services</b><span>Choosing one adds its saved impact automatically.</span></div>{can('vendors.manage') && <Button variant="ghost" size="sm" onClick={() => setVendorDialog(true)}><Plus /> Add missing</Button>}</div>
            <div className="integration-list">
              {sortedCurrentIntegrations.length ? sortedCurrentIntegrations.map((integration) => {
                const checked = announcement.selectedIntegrationIds.includes(integration.id);
                const checkboxId = `integration-${integration.id}`;
                return <div className={`integration-option ${checked ? 'selected' : ''}`} key={integration.id}>
                  <Checkbox id={checkboxId} checked={checked} onCheckedChange={(value) => toggleIntegration(integration, value === true)} />
                  <label htmlFor={checkboxId}><b>{integration.name.en}</b><small dir="rtl">{integration.name.ar}</small></label>
                </div>;
              }) : <div className="empty-inline">No services yet. Add the first one for this vendor.</div>}
            </div>
          </div>}

          <div className="section-rule"><span>Schedule</span></div>
          <div className="timing-grid">
            <Field label="Start date"><Input type="date" value={announcement.startDate} onChange={(event) => patchAnnouncement({ startDate: event.target.value })} /></Field>
            <Field label="Start time"><Input type="time" value={announcement.startTime} onChange={(event) => patchAnnouncement({ startTime: event.target.value })} /></Field>
            <Field label="End date"><Input type="date" value={announcement.endDate} onChange={(event) => patchAnnouncement({ endDate: event.target.value })} /></Field>
            <Field label="End time"><Input type="time" value={announcement.endTime} onChange={(event) => patchAnnouncement({ endTime: event.target.value })} /></Field>
            <div className="duration-pill"><span>Duration</span><b>{durationEn}</b><small dir="rtl">{durationAr}</small></div>
          </div>

          <div className="section-rule"><span>Header</span></div>
          <div className="form-grid header-fields">
            <Field label="Header label"><Input value={announcement.headerLabel?.en || ''} onChange={(event) => patchPair('headerLabel', 'en', event.target.value)} /></Field>
            <Field label="نص الترويسة"><Input dir="rtl" value={announcement.headerLabel?.ar || ''} onChange={(event) => patchPair('headerLabel', 'ar', event.target.value)} /></Field>
          </div>

          <div className="section-rule"><span>Bilingual message</span></div>
          <div className="language-grid">
            <div className="language-column">
              <div className="language-label"><span>EN</span> English</div>
              <Field label="Title"><Input value={announcement.title.en} onChange={(event) => patchPair('title', 'en', event.target.value)} /></Field>
              <Field label="Description"><Textarea value={announcement.intro.en} onChange={(event) => patchPair('intro', 'en', event.target.value)} /></Field>
              <Field label="Impact summary"><Textarea value={announcement.summary.en} onChange={(event) => patchPair('summary', 'en', event.target.value)} /></Field>
            </div>
            <div className="language-column" dir="rtl">
              <div className="language-label"><span>AR</span> العربية</div>
              <Field label="العنوان"><Input value={announcement.title.ar} onChange={(event) => patchPair('title', 'ar', event.target.value)} /></Field>
              <Field label="الوصف"><Textarea value={announcement.intro.ar} onChange={(event) => patchPair('intro', 'ar', event.target.value)} /></Field>
              <Field label="ملخص التأثير"><Textarea value={announcement.summary.ar} onChange={(event) => patchPair('summary', 'ar', event.target.value)} /></Field>
            </div>
          </div>

          <div className="section-rule impact-rule"><span>Business impacts</span><Button variant="outline" size="sm" onClick={addImpact}><Plus /> Add impact</Button></div>
          <div className="impact-editor">
            {announcement.impacts.map((impact, index) => <div className="impact-row" key={impact.id}>
              <span className="impact-number">{index + 1}</span>
              <Input aria-label={`Impact ${index + 1} English`} value={impact.en} onChange={(event) => updateImpact(impact.id, 'en', event.target.value)} placeholder="English impact" />
              <Input aria-label={`Impact ${index + 1} Arabic`} dir="rtl" value={impact.ar} onChange={(event) => updateImpact(impact.id, 'ar', event.target.value)} placeholder="التأثير بالعربية" />
              <Button aria-label="Delete impact" variant="ghost" size="icon" onClick={() => removeImpact(impact.id)}><Trash2 /></Button>
            </div>)}
          </div>

          <div className="section-rule"><span>Contact</span></div>
          <div className="language-grid">
            <div className="language-column compact">
              <Field label="English contact"><Input value={announcement.contact.en} onChange={(event) => patchPair('contact', 'en', event.target.value)} /></Field>
            </div>
            <div className="language-column compact" dir="rtl">
              <Field label="جهة التواصل"><Input value={announcement.contact.ar} onChange={(event) => patchPair('contact', 'ar', event.target.value)} /></Field>
            </div>
          </div>
          </> : <>
            <div className="section-rule"><span>Message details</span></div>
            <div className="form-grid single-name-field">
              <Field label="Message name" hint="Only visible to you"><Input value={announcement.name} onChange={(event) => patchAnnouncement({ name: event.target.value })} /></Field>
            </div>

            <div className="section-rule"><span>Image</span></div>
            <div className="general-image-editor">
              <input
                ref={generalImageInputRef}
                className="general-image-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Choose message image"
                onChange={(event) => void selectGeneralImage(event.target.files?.[0])}
              />
              {announcement.generalImage ? <>
                <div className="general-image-selected">
                  <img src={announcement.generalImage.dataUrl} alt="Selected message" />
                  <span><b>{announcement.generalImage.name}</b><small>{announcement.generalImage.width} × {announcement.generalImage.height}px · Scroll or pinch on the preview to zoom, then drag</small></span>
                  <Button type="button" variant="outline" size="sm" disabled={generalImageBusy} onClick={() => generalImageInputRef.current?.click()}><ImagePlus /> Replace</Button>
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove message image" title="Remove image" onClick={removeGeneralImage}><X /></Button>
                </div>
              </> : <button className="general-image-empty" type="button" disabled={generalImageBusy} onClick={() => generalImageInputRef.current?.click()}>
                <span><ImagePlus /></span>
                <span><b>{generalImageBusy ? 'Preparing image…' : 'Add an image'}</b><small>JPG, PNG, or WebP · Optional</small></span>
              </button>}
              {generalImageError && <p className="general-image-error" role="alert">{generalImageError}</p>}
            </div>

            <div className="section-rule"><span>Header</span></div>
            <div className="form-grid header-fields">
              <Field label="Header label"><Input value={announcement.headerLabel?.en || ''} onChange={(event) => patchPair('headerLabel', 'en', event.target.value)} /></Field>
              <Field label="نص الترويسة"><Input dir="rtl" value={announcement.headerLabel?.ar || ''} onChange={(event) => patchPair('headerLabel', 'ar', event.target.value)} /></Field>
            </div>

            <div className="section-rule"><span>Bilingual message</span></div>
            <div className="shared-message-toolbar" aria-label="Message formatting controls">
              <div className="shared-message-toolbar-label">
                <Settings2 />
                <span>Text formatting</span>
              </div>
              <div ref={setMessageToolbarHost} className="shared-message-toolbar-host" />
            </div>
            <div className="language-grid general-editor-grid">
              <div className="language-column">
                <div className="language-label"><span>EN</span> English</div>
                <Field label="Message"><RichTextEditor label="English message" editorId="en" activeEditor={activeMessageEditor} onActivate={setActiveMessageEditor} toolbarHost={messageToolbarHost} value={announcement.generalMessage.en} onChange={(value) => patchPair('generalMessage', 'en', value)} /></Field>
                <Field label="Contact line"><Input value={announcement.generalContact.en} onChange={(event) => patchPair('generalContact', 'en', event.target.value)} /></Field>
              </div>
              <div className="language-column" dir="rtl">
                <div className="language-label"><span>AR</span> العربية</div>
                <Field label="الرسالة"><RichTextEditor label="الرسالة العربية" editorId="ar" activeEditor={activeMessageEditor} onActivate={setActiveMessageEditor} toolbarHost={messageToolbarHost} dir="rtl" value={announcement.generalMessage.ar} onChange={(value) => patchPair('generalMessage', 'ar', value)} /></Field>
                <Field label="جهة التواصل"><Input value={announcement.generalContact.ar} onChange={(event) => patchPair('generalContact', 'ar', event.target.value)} /></Field>
              </div>
            </div>
          </>}

          <div className="section-rule"><span>Footer</span></div>
          <div className="form-grid footer-fields">
            <Field label="Footer label"><Input value={announcement.footerLabel.en} onChange={(event) => patchPair('footerLabel', 'en', event.target.value)} /></Field>
            <Field label="نص التذييل"><Input dir="rtl" value={announcement.footerLabel.ar} onChange={(event) => patchPair('footerLabel', 'ar', event.target.value)} /></Field>
            <Field label="Website"><Input value={announcement.footerWebsite} onChange={(event) => patchAnnouncement({ footerWebsite: event.target.value })} /></Field>
          </div>
          </div>
        </aside>

        <section className="preview-panel">
          <div className="preview-heading"><div><span className="live-dot" /> <span>Live preview</span></div><span className="preview-size">Bilingual · Auto-updating</span></div>
          <div className="preview-canvas">
          <div className="preview-sheet">
          {announcement.template === 'service' ? <article className="announcement-card source-template" ref={previewRef}>
            <AnnouncementHeader label={announcement.headerLabel} />
            <div className="source-body">
              <section className="source-language source-english">
                <header className="source-message-heading">
                  <p>{announcement.intro.en || 'Announcement description'}</p>
                </header>
                <div className="source-spacer" />
                <dl className="source-details">
                  <div><dt>Status</dt><dd>{announcement.source === 'vendor' ? `${currentVendor?.name.en.split('—')[0].trim() || vendorSearch} Services Maintenance` : statusTemplates[announcement.status].label.en}</dd></div>
                  <div><dt>Impact</dt><dd>{announcement.summary.en || '—'}</dd></div>
                  <div><dt>Start Date</dt><dd>{formatDate(announcement.startDate, 'en')}</dd></div>
                  <div><dt>Start Time</dt><dd>{formatTime(announcement.startTime, 'en')}</dd></div>
                  <div><dt>End Date</dt><dd>{formatDate(announcement.endDate, 'en')}</dd></div>
                  <div><dt>End Time</dt><dd>{formatTime(announcement.endTime, 'en')}</dd></div>
                  <div><dt>Duration</dt><dd>{durationEn}</dd></div>
                </dl>
                <div className="source-spacer source-spacer-lower" />
                <section className={`source-impact ${announcement.impacts.filter((impact) => impact.en).length === 1 ? 'source-impact-single' : ''}`}>
                  <h4>Affected Services</h4>
                  <ul>{announcement.impacts.filter((impact) => impact.en).map((impact) => <li key={impact.id}>{impact.en}</li>)}</ul>
                </section>
                {announcement.contact.en.trim() && <p className="source-contact">{announcement.contact.en}</p>}
              </section>

              <section className="source-language source-arabic" dir="rtl">
                <header className="source-message-heading">
                  <p>{announcement.intro.ar || 'وصف الإعلان'}</p>
                </header>
                <div className="source-spacer" />
                <dl className="source-details">
                  <div><dt>الحالة</dt><dd>{announcement.source === 'vendor' ? `صيانة خدمات ${currentVendor?.name.ar || vendorSearch}` : statusTemplates[announcement.status].label.ar}</dd></div>
                  <div><dt>التأثير</dt><dd>{announcement.summary.ar || '—'}</dd></div>
                  <div><dt>تاريخ البداية</dt><dd>{formatDate(announcement.startDate, 'ar')}</dd></div>
                  <div><dt>وقت البداية</dt><dd>{formatTime(announcement.startTime, 'ar')}</dd></div>
                  <div><dt>تاريخ النهاية</dt><dd>{formatDate(announcement.endDate, 'ar')}</dd></div>
                  <div><dt>وقت النهاية</dt><dd>{formatTime(announcement.endTime, 'ar')}</dd></div>
                  <div><dt>المدة</dt><dd>{durationAr}</dd></div>
                </dl>
                <div className="source-spacer source-spacer-lower" />
                <section className={`source-impact ${announcement.impacts.filter((impact) => impact.ar).length === 1 ? 'source-impact-single' : ''}`}>
                  <h4>الخدمات المتأثرة</h4>
                  <ul>{announcement.impacts.filter((impact) => impact.ar).map((impact) => <li key={impact.id}>{impact.ar}</li>)}</ul>
                </section>
                {announcement.contact.ar.trim() && <p className="source-contact">{announcement.contact.ar}</p>}
              </section>
            </div>
            <AnnouncementFooter label={announcement.footerLabel} website={announcement.footerWebsite} />
          </article> : <article className="announcement-card source-template general-message-template" ref={previewRef}>
            <AnnouncementHeader label={announcement.headerLabel} />
            {announcement.generalImage && <figure
              ref={generalImageFrameRef}
              className={`general-message-image ${announcement.generalImage.zoom > 1 ? 'is-adjustable' : ''} ${generalImageDragging ? 'is-dragging' : ''}`}
              style={{ aspectRatio: `${announcement.generalImage.width} / ${announcement.generalImage.height}` }}
              tabIndex={0}
              aria-label="Message image. Scroll or pinch to zoom, drag to reposition, and double-click to reset."
              title="Scroll or pinch to zoom · Drag to reposition · Double-click to reset"
              onPointerDown={startGeneralImageDrag}
              onPointerMove={moveGeneralImage}
              onPointerUp={stopGeneralImageDrag}
              onPointerCancel={stopGeneralImageDrag}
              onLostPointerCapture={stopGeneralImageDrag}
              onDoubleClick={() => updateGeneralImage({ zoom: 1, positionX: 50, positionY: 50 })}
              onKeyDown={moveGeneralImageWithKeyboard}
            >
              <img
                ref={generalImageElementRef}
                src={announcement.generalImage.dataUrl}
                alt={announcement.generalImage.name || 'Message image'}
                draggable={false}
                style={{
                  transform: `translate3d(${-(announcement.generalImage.zoom - 1) * announcement.generalImage.positionX}%, ${-(announcement.generalImage.zoom - 1) * announcement.generalImage.positionY}%, 0) scale(${announcement.generalImage.zoom})`,
                }}
              />
            </figure>}
            <div className="source-body general-source-body">
              <section className="source-language source-english general-source-language">
                <div className="general-message-copy" dangerouslySetInnerHTML={{ __html: legacyMessageToHtml(announcement.generalMessage.en) }} />
                {announcement.generalContact.en.trim() && <p className="source-contact">{announcement.generalContact.en}</p>}
              </section>
              <section className="source-language source-arabic general-source-language" dir="rtl">
                <div className="general-message-copy" dangerouslySetInnerHTML={{ __html: legacyMessageToHtml(announcement.generalMessage.ar) }} />
                {announcement.generalContact.ar.trim() && <p className="source-contact">{announcement.generalContact.ar}</p>}
              </section>
            </div>
            <AnnouncementFooter label={announcement.footerLabel} website={announcement.footerWebsite} />
          </article>}
          </div>
          </div>
        </section>
      </section>

      <Dialog open={vendorDialog} onOpenChange={(open) => {
        setVendorDialog(open);
        if (!open) resetIntegrationForm();
      }}>
        <DialogContent className="vendor-dialog">
          <DialogHeader><DialogTitle>Vendors & services</DialogTitle><DialogDescription>Save each vendor once, then reuse its services and bilingual impact suggestions.</DialogDescription></DialogHeader>
          {workspaceError && <p className="access-error" role="alert">{workspaceError}</p>}
          <div className="vendor-manager">
            <aside className="vendor-list-panel">
              {sortedVendors.map((vendor) => <button key={vendor.id} className={manageVendorId === vendor.id ? 'active' : ''} onClick={() => { setManageVendorId(vendor.id); resetIntegrationForm(); }}><span><b>{vendor.name.en}</b><small dir="rtl">{vendor.name.ar}</small></span><em>{vendor.integrations.length}</em></button>)}
              <div className="new-vendor-form"><Input placeholder="New vendor name" value={newVendor.en} onChange={(event) => setNewVendor((value) => ({ ...value, en: event.target.value }))} /><Input dir="rtl" placeholder="اسم المورد بالعربية" value={newVendor.ar} onChange={(event) => setNewVendor((value) => ({ ...value, ar: event.target.value }))} /><Button onClick={addVendor}><Plus /> Add vendor</Button></div>
            </aside>
            <section className="integration-manager">
              {managedVendor && <>
                <div className="manager-title"><div><h3>{managedVendor.name.en}</h3><p dir="rtl">{managedVendor.name.ar}</p></div><Button variant="destructive" size="sm" disabled={vendors.length === 1} onClick={() => deleteVendor(managedVendor.id)}><Trash2 /> Delete</Button></div>
                <div className="saved-integrations">{sortedManagedIntegrations.map((integration) => <div
                  key={integration.id}
                  className={editingIntegrationId === integration.id ? 'editing' : ''}
                  role="button"
                  tabIndex={0}
                  aria-label={`Edit ${integration.name.en}`}
                  onClick={() => startEditingIntegration(integration)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      startEditingIntegration(integration);
                    }
                  }}
                ><span><b>{integration.name.en}</b><small dir="rtl">{integration.name.ar}</small><p>{integration.impact.en}</p><p dir="rtl">{integration.impact.ar}</p></span><span className="integration-row-actions"><Pencil aria-hidden="true" /><Button aria-label={`Delete ${integration.name.en}`} variant="ghost" size="icon" onClick={(event) => { event.stopPropagation(); deleteIntegration(integration.id); }}><Trash2 /></Button></span></div>)}</div>
                <div className="new-integration-form"><h4>{editingIntegrationId ? 'Edit service and its ready impact' : 'Add service and its ready impact'}</h4><div className="manager-grid"><Field label="Service"><Input value={newIntegration.name.en} onChange={(event) => setNewIntegration((value) => ({ ...value, name: { ...value.name, en: event.target.value } }))} placeholder="e.g. Cashout" /></Field><Field label="الخدمة"><Input dir="rtl" value={newIntegration.name.ar} onChange={(event) => setNewIntegration((value) => ({ ...value, name: { ...value.name, ar: event.target.value } }))} placeholder="مثال: السحب" /></Field><Field label="Suggested impact"><Textarea value={newIntegration.impact.en} onChange={(event) => setNewIntegration((value) => ({ ...value, impact: { ...value.impact, en: event.target.value } }))} /></Field><Field label="التأثير المقترح"><Textarea dir="rtl" value={newIntegration.impact.ar} onChange={(event) => setNewIntegration((value) => ({ ...value, impact: { ...value.impact, ar: event.target.value } }))} /></Field></div><div className="integration-form-actions"><Button onClick={saveIntegration}>{editingIntegrationId ? <Save /> : <Plus />} {editingIntegrationId ? 'Save changes' : 'Save service'}</Button>{editingIntegrationId && <Button variant="outline" onClick={resetIntegrationForm}>Cancel</Button>}</div></div>
              </>}
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={draftDialog} onOpenChange={setDraftDialog}>
        <DialogContent className="draft-dialog">
          <DialogHeader><DialogTitle>Saved drafts</DialogTitle><DialogDescription>Drafts are saved to your department account.</DialogDescription></DialogHeader>
          {workspaceError && <p className="access-error" role="alert">{workspaceError}</p>}
          {pendingDraftDeletes.length > 0 && <div className="draft-undo-stack">
            {pendingDraftDeletes.map((pendingDelete) => {
              const remainingMs = Math.max(0, pendingDelete.expiresAt - Date.now());
              const progress = Math.min(1, remainingMs / DRAFT_UNDO_MS);
              return <div className="draft-undo" role="status" key={`${pendingDelete.token}-${draftDialog}`}>
                <div className="draft-undo-copy">
                  <span className="draft-undo-icon"><Trash2 /></span>
                  <span><b>Draft deleted</b><small>{pendingDelete.draft.name}</small></span>
                </div>
                <Button className="draft-undo-button" variant="outline" size="sm" onClick={() => undoDraftDelete(pendingDelete.token)}><Undo2 /> Undo</Button>
                <span
                  className="draft-undo-progress"
                  aria-hidden="true"
                  style={{ transform: `scaleX(${progress})`, animationDuration: `${remainingMs}ms` }}
                />
              </div>;
            })}
          </div>}
          <div className="draft-list">{drafts.length ? drafts.map((draft) => <div className="draft-row" key={draft.id}>
            <button className="draft-load" onClick={() => { setAnnouncement(normalizeAnnouncement(draft)); setVendorSearch(vendors.find((vendor) => vendor.id === draft.vendorId)?.name.en || ''); setSavedText('Draft loaded'); setDraftDialog(false); }}>
              <span><b>{draft.name}</b><small>{draft.template === 'general' ? 'General bilingual message' : draft.title.en}</small></span>
              <em>{draft.updatedAt ? new Date(draft.updatedAt).toLocaleString() : ''}</em>
            </button>
            <Button className="draft-delete" variant="ghost" size="sm" aria-label={`Delete ${draft.name}`} title="Delete draft" onClick={() => deleteDraft(draft.id)}><Trash2 /><span>Delete</span></Button>
          </div>) : <div className="empty-state"><FolderOpen /><b>No saved drafts yet</b><span>Use Save when your announcement is ready to keep.</span></div>}</div>
        </DialogContent>
      </Dialog>

      <Dialog open={markSentDialog} onOpenChange={setMarkSentDialog}>
        <DialogContent className="mark-sent-dialog">
          <DialogHeader>
            <DialogTitle>Record this announcement as sent?</DialogTitle>
            <DialogDescription>This creates a permanent audit record. It does not send the announcement for you.</DialogDescription>
          </DialogHeader>
          <div className="mark-sent-summary">
            <span><small>Announcement</small><b>{announcement.name}</b></span>
            <span><small>Vendor</small><b>{announcement.template === 'service' && announcement.source === 'vendor' ? currentVendor?.name.en || 'Not selected' : 'Not applicable'}</b></span>
            <span><small>Services</small><b>{announcement.template === 'service' ? announcement.selectedIntegrationIds.length || 'None' : 'Not applicable'}</b></span>
          </div>
          {markSentError && <p className="mark-sent-error">{markSentError}</p>}
          <div className="mark-sent-actions">
            <Button variant="ghost" onClick={() => setMarkSentDialog(false)} disabled={markingSent}>Cancel</Button>
            <Button onClick={() => void markAsSent()} disabled={markingSent}><Send /> {markingSent ? 'Recording…' : 'Confirm sent'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
