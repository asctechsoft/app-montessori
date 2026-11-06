import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../../database/entities';

/** Chỉ các trường kỹ thuật được lưu - KHÔNG lưu tên khách/transcript (giới hạn PII). */
const SAFE_KEYS = ['status', 'amount_vnd', 'event_id', 'source', 'deleted'];

export function redact(obj?: Record<string, unknown> | null): string | null {
  if (!obj) return null;
  const out: Record<string, unknown> = {};
  for (const k of SAFE_KEYS) if (k in obj) out[k] = obj[k];
  return JSON.stringify(out);
}

@Injectable()
export class AuditService {
  private readonly log = new Logger('Audit');
  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  async record(
    actorId: string,
    entityType: 'event' | 'gift' | 'voice' | 'export',
    entityId: string,
    action: string,
    before?: Record<string, unknown> | null,
    after?: Record<string, unknown> | null,
  ): Promise<void> {
    try {
      await this.repo.insert({
        actorId,
        entityType,
        entityId,
        action,
        beforeJson: redact(before),
        afterJson: redact(after),
      });
    } catch (e) {
      // Audit lỗi không được làm hỏng nghiệp vụ chính.
      this.log.warn(`audit failed: ${(e as Error).message}`);
    }
  }
}
