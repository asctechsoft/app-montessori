import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { notFound } from '../../common/app-error';
import { GiftEvent } from '../../database/entities';
import { AuditService } from '../audit/audit.service';
import { CreateEventDto, PatchEventDto, UpsertEventDto } from './events.dto';

export const eventToApi = (e: GiftEvent) => ({
  id: e.id,
  name: e.name,
  type: e.type,
  event_date: e.eventDate,
  location: e.location,
  status: e.status,
  created_at: e.createdAt.toISOString(),
  updated_at: e.updatedAt.toISOString(),
  deleted_at: e.deletedAt ? e.deletedAt.toISOString() : null,
});

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(GiftEvent) private readonly repo: Repository<GiftEvent>,
    private readonly audit: AuditService,
  ) {}

  async list(ownerId: string, includeDeleted = false) {
    const rows = await this.repo.find({
      where: includeDeleted ? { ownerId } : { ownerId, deletedAt: IsNull() },
      order: { eventDate: 'DESC', createdAt: 'DESC' },
    });
    return { items: rows.map(eventToApi) };
  }

  /** Lấy event thuộc owner; không thuộc về/không có đều trả 404 (chống IDOR dò id). */
  async getOwned(ownerId: string, id: string, allowDeleted = false): Promise<GiftEvent> {
    const e = await this.repo.findOne({ where: { id, ownerId } });
    if (!e || (e.deletedAt && !allowDeleted)) throw notFound('Không tìm thấy sự kiện');
    return e;
  }

  async get(ownerId: string, id: string) {
    return eventToApi(await this.getOwned(ownerId, id));
  }

  async create(ownerId: string, dto: CreateEventDto) {
    const id = dto.id ?? randomUUID();
    const existing = await this.repo.findOne({ where: { id } });
    if (existing) {
      if (existing.ownerId !== ownerId) throw notFound('Không tìm thấy sự kiện');
      return eventToApi(existing); // idempotent
    }
    const now = new Date();
    const e = await this.repo.save(
      this.repo.create({
        id,
        ownerId,
        name: dto.name.trim(),
        type: dto.type ?? 'wedding',
        eventDate: dto.event_date,
        location: dto.location?.trim() || null,
        status: dto.status ?? 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );
    await this.audit.record(ownerId, 'event', e.id, 'create', null, { status: e.status });
    return eventToApi(e);
  }

  /** Upsert idempotent; bản của client cũ hơn server thì giữ bản server (last-write-wins). */
  async upsert(ownerId: string, id: string, dto: UpsertEventDto) {
    const existing = await this.repo.findOne({ where: { id } });
    if (existing && existing.ownerId !== ownerId) throw notFound('Không tìm thấy sự kiện');
    const incoming = dto.updated_at ? new Date(dto.updated_at) : new Date();
    if (!existing) return this.create(ownerId, { ...dto, id });
    if (incoming.getTime() < existing.updatedAt.getTime()) return eventToApi(existing);
    const before = { status: existing.status };
    Object.assign(existing, {
      name: dto.name.trim(),
      type: dto.type ?? existing.type,
      eventDate: dto.event_date,
      location: dto.location?.trim() || null,
      status: dto.status ?? existing.status,
      updatedAt: incoming,
      deletedAt: null, // upsert = event đang sống (client đã hoàn tác xoá)
    });
    const saved = await this.repo.save(existing);
    await this.audit.record(ownerId, 'event', id, 'update', before, { status: saved.status });
    return eventToApi(saved);
  }

  async patch(ownerId: string, id: string, dto: PatchEventDto) {
    const e = await this.getOwned(ownerId, id);
    const before = { status: e.status };
    if (dto.name !== undefined) e.name = dto.name.trim();
    if (dto.type !== undefined) e.type = dto.type;
    if (dto.event_date !== undefined) e.eventDate = dto.event_date;
    if (dto.location !== undefined) e.location = dto.location?.trim() || null;
    if (dto.status !== undefined) e.status = dto.status;
    e.updatedAt = new Date();
    const saved = await this.repo.save(e);
    await this.audit.record(ownerId, 'event', id, 'update', before, { status: saved.status });
    return eventToApi(saved);
  }

  /** BR09: lưu trữ (archive) = xoá mềm. */
  async remove(ownerId: string, id: string): Promise<void> {
    const e = await this.repo.findOne({ where: { id, ownerId } });
    if (!e) throw notFound('Không tìm thấy sự kiện');
    if (e.deletedAt) return; // idempotent
    e.deletedAt = new Date();
    e.updatedAt = e.deletedAt;
    await this.repo.save(e);
    await this.audit.record(ownerId, 'event', id, 'delete', null, { deleted: true });
  }
}
