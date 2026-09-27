export type AuditIntegration = {
  id: string;
  nameEn: string;
  nameAr: string;
};

export type AuditRecord = {
  id: string;
  announcementId: string;
  announcementName: string;
  template: string;
  status: string;
  source: string;
  vendorId: string | null;
  vendorEn: string | null;
  vendorAr: string | null;
  integrations: AuditIntegration[];
  startDate: string | null;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  durationMinutes: number;
  sentAt: string;
  sentBy: string;
  snapshot: unknown;
};

export type CreateAuditRecord = Omit<AuditRecord, 'id' | 'sentAt' | 'sentBy'>;
