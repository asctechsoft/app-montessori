import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { Between, In, IsNull, LessThan, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { AppError, notFound } from '../../common/app-error';
import { excelSafe } from '../../common/text';
import { AppConfig, CONFIG } from '../../config/config';
import { ExportJob, Gift } from '../../database/entities';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { CreateExportDto } from './export.dto';

const LABELS: Record<string, string> = {
  guest: 'Tên khách',
  amount: 'Số tiền (VND)',
  relationship: 'Quan hệ',
  note: 'Ghi chú',
  status: 'Trạng thái',
  created_at: 'Thời gian ghi',
  side: 'Nhóm khách',
};

@Injectable()
export class ExportService {
  private readonly log = new Logger('Export');

  constructor(
    @InjectRepository(ExportJob) private readonly jobs: Repository<ExportJob>,
    @InjectRepository(Gift) private readonly gifts: Repository<Gift>,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  async create(ownerId: string, eventId: string, dto: CreateExportDto) {
    const event = await this.events.getOwned(ownerId, eventId, true);
    const columns = dto.columns?.length ? dto.columns : ['guest', 'amount', 'relationship'];
    const includePending = dto.include_pending === true;
    const statuses = includePending ? ['confirmed', 'pending_review'] : ['confirmed'];
    const withStatus = includePending && !columns.includes('status') ? [...columns, 'status'] : columns;

    let createdAt: any;
    if (dto.from && dto.to) createdAt = Between(new Date(dto.from), new Date(dto.to));
    else if (dto.from) createdAt = MoreThanOrEqual(new Date(dto.from));
    else if (dto.to) createdAt = LessThanOrEqual(new Date(dto.to));
    const rows = await this.gifts.find({
      where: { ownerId, eventId, deletedAt: IsNull(), status: In(statuses), ...(createdAt ? { createdAt } : {}) },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('GiftFlow');
    ws.columns = [
      { header: 'STT', key: 'no', width: 6 },
      ...withStatus.map((c) => ({ header: LABELS[c], key: c, width: c === 'note' ? 36 : 22 })),
    ];
    ws.getRow(1).font = { bold: true };
    let total = 0;
    rows.forEach((g, i) => {
      const confirmed = g.status === 'confirmed';
      if (confirmed) total += g.amountVnd;
      const rec: Record<string, unknown> = { no: i + 1 };
      for (const c of withStatus) {
        if (c === 'guest') rec.guest = excelSafe(g.guestName);
        else if (c === 'amount') rec.amount = g.amountVnd;
        else if (c === 'relationship') rec.relationship = excelSafe(g.relationshipLabel ?? '');
        else if (c === 'side') rec.side = g.side === 'parents' ? 'Khách bố mẹ' : 'Khách của mình';
        else if (c === 'note') rec.note = excelSafe(g.note ?? '');
        else if (c === 'status') rec.status = confirmed ? 'Đã xác nhận' : 'Chờ xác nhận';
        else if (c === 'created_at') rec.created_at = g.createdAt.toISOString();
      }
      ws.addRow(rec);
    });
    if (withStatus.includes('amount')) {
      const totalRow: Record<string, unknown> = { no: '', amount: total };
      if (withStatus.includes('guest')) totalRow.guest = 'Tổng đã xác nhận';
      ws.addRow(totalRow).font = { bold: true };
    }

    fs.mkdirSync(this.cfg.exportDir, { recursive: true });
    const id = randomUUID();
    const filePath = path.resolve(this.cfg.exportDir, `${id}.xlsx`);
    await wb.xlsx.writeFile(filePath);
    const fileName = `GiftFlow_${event.name.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '')}.xlsx`;
    const job = await this.jobs.save(
      this.jobs.create({
        id,
        ownerId,
        eventId,
        filePath,
        fileName: fileName.slice(0, 200),
        rows: rows.length,
        confirmedTotal: total,
        expiresAt: new Date(Date.now() + this.cfg.exportTtlMinutes * 60_000),
      }),
    );
    await this.audit.record(ownerId, 'export', id, 'create', null, { event_id: eventId });
    void this.cleanupExpired();
    return {
      id: job.id,
      file_name: job.fileName,
      rows: job.rows,
      confirmed_total_vnd: job.confirmedTotal,
      expires_at: job.expiresAt.toISOString(),
      download_url: `/v1/exports/${job.id}`,
    };
  }

  /** BR15: chỉ chủ sở hữu tải được, file có TTL. */
  async resolveDownload(ownerId: string, id: string) {
    const job = await this.jobs.findOne({ where: { id, ownerId } });
    if (!job) throw notFound('Không tìm thấy file xuất');
    if (job.expiresAt.getTime() < Date.now() || !fs.existsSync(job.filePath)) {
      throw new AppError(410, 'export_expired', 'File xuất đã hết hạn, hãy xuất lại');
    }
    return job;
  }

  async cleanupExpired(): Promise<void> {
    try {
      const old = await this.jobs.find({ where: { expiresAt: LessThan(new Date()) }, take: 50 });
      for (const j of old) {
        fs.rmSync(j.filePath, { force: true });
        await this.jobs.delete({ id: j.id });
      }
    } catch (e) {
      this.log.warn(`cleanup failed: ${(e as Error).message}`);
    }
  }
}
