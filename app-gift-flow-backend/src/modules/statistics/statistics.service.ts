import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Gift } from '../../database/entities';
import { EventsService } from '../events/events.service';

const n = (v: unknown) => Number(v ?? 0);

@Injectable()
export class StatisticsService {
  constructor(
    @InjectRepository(Gift) private readonly repo: Repository<Gift>,
    private readonly events: EventsService,
  ) {}

  /** BR10: tổng = SUM(amount) của confirmed, chưa xoá. pending tách riêng. */
  async forEvent(ownerId: string, eventId: string) {
    await this.events.getOwned(ownerId, eventId, true);
    const base = () =>
      this.repo
        .createQueryBuilder('g')
        .where('g.ownerId = :ownerId AND g.eventId = :eventId AND g.deletedAt IS NULL', { ownerId, eventId });

    const confirmed = await base()
      .andWhere('g.status = :s', { s: 'confirmed' })
      .select('COALESCE(SUM(g.amountVnd), 0)', 'total')
      .addSelect('COUNT(*)', 'cnt')
      .addSelect('COUNT(DISTINCT LOWER(TRIM(g.guestName)))', 'guests')
      .getRawOne();
    const pending = await base()
      .andWhere('g.status = :s', { s: 'pending_review' })
      .select('COALESCE(SUM(g.amountVnd), 0)', 'total')
      .addSelect('COUNT(*)', 'cnt')
      .getRawOne();
    const rel = await base()
      .andWhere('g.status = :s', { s: 'confirmed' })
      .select("COALESCE(NULLIF(TRIM(g.relationshipLabel), ''), '')", 'label')
      .addSelect('COUNT(*)', 'cnt')
      .addSelect('COALESCE(SUM(g.amountVnd), 0)', 'total')
      .groupBy("COALESCE(NULLIF(TRIM(g.relationshipLabel), ''), '')")
      .orderBy('total', 'DESC')
      .getRawMany();

    const sides = await base()
      .andWhere('g.status = :s', { s: 'confirmed' })
      .select('g.side', 'side')
      .addSelect('COUNT(*)', 'cnt')
      .addSelect('COALESCE(SUM(g.amountVnd), 0)', 'total')
      .groupBy('g.side')
      .getRawMany();

    return {
      event_id: eventId,
      confirmed: { total_vnd: n(confirmed.total), count: n(confirmed.cnt), guests: n(confirmed.guests) },
      pending: { total_vnd: n(pending.total), count: n(pending.cnt) },
      by_side: sides.map((r) => ({ side: r.side, count: n(r.cnt), total_vnd: n(r.total) })),
      by_relationship: rel.map((r) => ({ label: r.label || null, count: n(r.cnt), total_vnd: n(r.total) })),
    };
  }
}
