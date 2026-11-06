import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Like, MoreThan, MoreThanOrEqual, Repository } from 'typeorm';
import { AppError, badRequest, conflict, notFound } from '../../common/app-error';
import { fold } from '../../common/text';
import { AppConfig, CONFIG } from '../../config/config';
import { Gift } from '../../database/entities';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import {
  ConfirmGiftDto,
  CreateGiftDto,
  ListGiftsQuery,
  PatchGiftDto,
  UpsertGiftDto,
} from './gifts.dto';

export const giftToApi = (g: Gift) => ({
  id: g.id,
  event_id: g.eventId,
  guest_name: g.guestName,
  relationship_label: g.relationshipLabel,
  amount_vnd: g.amountVnd,
  note: g.note,
  status: g.status,
  source: g.source,
  side: g.side,
  transcript: g.transcript,
  created_at: g.createdAt.toISOString(),
  updated_at: g.updatedAt.toISOString(),
  deleted_at: g.deletedAt ? g.deletedAt.toISOString() : null,
});

const searchKeyOf = (name: string, rel?: string | null, note?: string | null) =>
  fold(`${name} ${rel ?? ''} ${note ?? ''}`).slice(0, 1400);

const clean = (s?: string | null) => {
  const t = (s ?? '').trim();
  return t.length ? t : null;
};

@Injectable()
export class GiftsService {
  constructor(
    @InjectRepository(Gift) private readonly repo: Repository<Gift>,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** BR02/BR05: bản ghi confirmed phải có tên và số tiền hợp lệ. */
  private assertValid(status: string, name: string, amount: number): void {
    if (amount < 0 || amount > this.cfg.maxAmountVnd) {
      throw badRequest('amount_out_of_range', 'Số tiền vượt giới hạn cho phép');
    }
    if (status === 'confirmed') {
      if (amount <= 0) throw badRequest('amount_invalid', 'Số tiền phải lớn hơn 0');
      if (!name.trim()) throw badRequest('name_required', 'Bản ghi đã xác nhận phải có tên khách');
    }
  }

  async getOwned(ownerId: string, id: string, allowDeleted = false): Promise<Gift> {
    const g = await this.repo.findOne({ where: { id, ownerId } });
    if (!g || (g.deletedAt && !allowDeleted)) throw notFound('Không tìm thấy bản ghi');
    return g;
  }

  async get(ownerId: string, id: string) {
    return giftToApi(await this.getOwned(ownerId, id));
  }

  async list(ownerId: string, eventId: string, q: ListGiftsQuery) {
    await this.events.getOwned(ownerId, eventId, true);
    const limit = q.limit ?? 50;
    const base: FindOptionsWhere<Gift> = { ownerId, eventId };
    if (q.include_deleted !== 'true') base.deletedAt = IsNull();
    if (q.status) base.status = q.status;
    if (q.side) base.side = q.side;
    if (q.relationship !== undefined) base.relationshipLabel = q.relationship === '' ? IsNull() : q.relationship;
    const text = q.q ? fold(q.q) : '';
    if (text) base.searchKey = Like(`%${text.replace(/[%_]/g, '')}%`);

    let where: FindOptionsWhere<Gift> | FindOptionsWhere<Gift>[] = base;
    if (q.cursor) {
      const c = this.decodeCursor(q.cursor);
      // keyset pagination theo (created_at, id) - ổn định kể cả khi chèn mới.
      where = [
        { ...base, createdAt: MoreThan(c.t) },
        { ...base, createdAt: c.t, id: MoreThan(c.i) },
      ];
    }
    const rows = await this.repo.find({
      where,
      order: { createdAt: 'ASC', id: 'ASC' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(giftToApi),
      next_cursor: rows.length > limit && last ? this.encodeCursor(last) : null,
    };
  }

  private encodeCursor(g: Gift): string {
    return Buffer.from(JSON.stringify({ t: g.createdAt.toISOString(), i: g.id })).toString('base64url');
  }

  private decodeCursor(c: string): { t: Date; i: string } {
    try {
      const o = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
      const t = new Date(o.t);
      if (Number.isNaN(t.getTime()) || typeof o.i !== 'string') throw new Error();
      return { t, i: o.i };
    } catch {
      throw badRequest('invalid_cursor', 'cursor không hợp lệ');
    }
  }

  /** Nhập tay (idempotent theo client_request_id). */
  async createManual(ownerId: string, eventId: string, dto: CreateGiftDto) {
    const ev = await this.events.getOwned(ownerId, eventId);
    if (ev.status === 'closed') throw conflict('event_closed', 'Sự kiện đã đóng');
    const existing = await this.repo.findOne({ where: { ownerId, clientRequestId: dto.client_request_id } });
    if (existing) return giftToApi(existing);
    this.assertValid('confirmed', dto.guest_name, dto.amount_vnd);
    return giftToApi(
      await this.insert(ownerId, {
        id: dto.client_request_id,
        eventId,
        guestName: dto.guest_name.trim(),
        relationshipLabel: clean(dto.relationship_label),
        amountVnd: dto.amount_vnd,
        note: clean(dto.note),
        status: 'confirmed',
        source: 'manual',
        side: dto.side ?? 'mine',
        transcript: null,
      }),
    );
  }

  async insert(
    ownerId: string,
    v: Pick<
      Gift,
      'id' | 'eventId' | 'guestName' | 'relationshipLabel' | 'amountVnd' | 'note' | 'status' | 'source' | 'side' | 'transcript'
    > & { createdAt?: Date; updatedAt?: Date },
  ): Promise<Gift> {
    const now = new Date();
    const saved = await this.repo.save(
      this.repo.create({
        ...v,
        ownerId,
        clientRequestId: v.id,
        searchKey: searchKeyOf(v.guestName, v.relationshipLabel, v.note),
        createdAt: v.createdAt ?? now,
        updatedAt: v.updatedAt ?? now,
        deletedAt: null,
      }),
    );
    await this.audit.record(ownerId, 'gift', saved.id, 'create', null, {
      status: saved.status,
      amount_vnd: saved.amountVnd,
      event_id: saved.eventId,
      source: saved.source,
    });
    return saved;
  }

  /** PUT idempotent cho outbox của app; last-write-wins theo updated_at. */
  async upsert(ownerId: string, id: string, dto: UpsertGiftDto) {
    await this.events.getOwned(ownerId, dto.event_id, true);
    const existing = await this.repo.findOne({ where: { id } });
    if (existing && existing.ownerId !== ownerId) throw notFound('Không tìm thấy bản ghi');
    this.assertValid(dto.status, dto.guest_name, dto.amount_vnd);
    const updatedAt = dto.updated_at ? new Date(dto.updated_at) : new Date();

    if (!existing) {
      return giftToApi(
        await this.insert(ownerId, {
          id,
          eventId: dto.event_id,
          guestName: dto.guest_name.trim(),
          relationshipLabel: clean(dto.relationship_label),
          amountVnd: dto.amount_vnd,
          note: clean(dto.note),
          status: dto.status,
          source: dto.source ?? 'manual',
          side: dto.side ?? 'mine',
          transcript: this.cfg.storeTranscript ? clean(dto.transcript) : null,
          createdAt: dto.created_at ? new Date(dto.created_at) : undefined,
          updatedAt,
        }),
      );
    }
    if (updatedAt.getTime() < existing.updatedAt.getTime()) return giftToApi(existing);
    const before = { status: existing.status, amount_vnd: existing.amountVnd };
    existing.eventId = dto.event_id;
    existing.guestName = dto.guest_name.trim();
    existing.relationshipLabel = clean(dto.relationship_label);
    existing.amountVnd = dto.amount_vnd;
    existing.note = clean(dto.note);
    existing.status = dto.status;
    if (dto.side) existing.side = dto.side;
    existing.searchKey = searchKeyOf(existing.guestName, existing.relationshipLabel, existing.note);
    existing.updatedAt = updatedAt;
    existing.deletedAt = null; // upsert = bản ghi đang sống (hoàn tác xoá)
    const saved = await this.repo.save(existing);
    await this.audit.record(ownerId, 'gift', id, 'update', before, {
      status: saved.status,
      amount_vnd: saved.amountVnd,
    });
    return giftToApi(saved);
  }

  async patch(ownerId: string, id: string, dto: PatchGiftDto) {
    const g = await this.getOwned(ownerId, id);
    const before = { status: g.status, amount_vnd: g.amountVnd };
    const name = dto.guest_name ?? g.guestName;
    const amount = dto.amount_vnd ?? g.amountVnd;
    const status = dto.status ?? g.status;
    this.assertValid(status, name, amount);
    g.guestName = name.trim();
    g.amountVnd = amount;
    g.status = status;
    if (dto.side) g.side = dto.side;
    if (dto.relationship_label !== undefined) g.relationshipLabel = clean(dto.relationship_label);
    if (dto.note !== undefined) g.note = clean(dto.note);
    g.searchKey = searchKeyOf(g.guestName, g.relationshipLabel, g.note);
    g.updatedAt = new Date();
    const saved = await this.repo.save(g);
    await this.audit.record(ownerId, 'gift', id, 'update', before, {
      status: saved.status,
      amount_vnd: saved.amountVnd,
    });
    return giftToApi(saved);
  }

  /** Xác nhận bản ghi AI chờ duyệt (có thể kèm sửa). */
  async confirm(ownerId: string, id: string, dto: ConfirmGiftDto) {
    const g = await this.getOwned(ownerId, id);
    if (g.status === 'confirmed' && !dto.guest_name && !dto.amount_vnd && dto.relationship_label === undefined) {
      return giftToApi(g); // idempotent
    }
    return this.patch(ownerId, id, {
      guest_name: dto.guest_name,
      amount_vnd: dto.amount_vnd,
      relationship_label: dto.relationship_label,
      status: 'confirmed',
    });
  }

  /** BR09: xoá mềm + audit. Idempotent. */
  async remove(ownerId: string, id: string): Promise<void> {
    const g = await this.repo.findOne({ where: { id, ownerId } });
    if (!g) throw notFound('Không tìm thấy bản ghi');
    if (g.deletedAt) return;
    g.deletedAt = new Date();
    g.updatedAt = g.deletedAt;
    await this.repo.save(g);
    await this.audit.record(ownerId, 'gift', id, 'delete', { status: g.status }, { deleted: true });
  }

  /** BR06: cùng event + tên (không dấu) + số tiền trong ngưỡng thời gian. */
  async findDuplicates(
    ownerId: string,
    eventId: string,
    guestName: string,
    amountVnd: number,
    excludeId?: string,
  ): Promise<Gift[]> {
    if (!guestName.trim() || amountVnd <= 0) return [];
    const since = new Date(Date.now() - this.cfg.duplicateWindowMinutes * 60_000);
    const rows = await this.repo.find({
      where: { ownerId, eventId, amountVnd, deletedAt: IsNull(), createdAt: MoreThanOrEqual(since) },
    });
    const key = fold(guestName);
    return rows.filter((g) => g.id !== excludeId && fold(g.guestName) === key);
  }
}

export { AppError };
