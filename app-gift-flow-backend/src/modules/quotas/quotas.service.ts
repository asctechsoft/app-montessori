import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppError } from '../../common/app-error';
import { AppConfig, CONFIG } from '../../config/config';
import { UsageQuota } from '../../database/entities';

export const currentPeriod = (d = new Date()) => d.toISOString().slice(0, 7);

/** Quota AI theo tháng, kiểm soát hoàn toàn ở server (BR12): trừ nguyên tử. */
@Injectable()
export class QuotasService {
  constructor(
    @InjectRepository(UsageQuota) private readonly repo: Repository<UsageQuota>,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  private async ensureRow(ownerId: string, period: string): Promise<void> {
    const exists = await this.repo.exist({ where: { ownerId, period } });
    if (exists) return;
    try {
      await this.repo.insert({ ownerId, period, quotaLimit: this.cfg.quotaLimit, used: 0 });
    } catch {
      /* đã có request khác tạo - bỏ qua */
    }
  }

  async snapshot(ownerId: string) {
    const period = currentPeriod();
    await this.ensureRow(ownerId, period);
    const row = await this.repo.findOneOrFail({ where: { ownerId, period } });
    return { period, limit: row.quotaLimit, used: row.used };
  }

  /** Giữ chỗ 1 lượt AI: UPDATE ... WHERE used < limit (nguyên tử, không race). */
  async reserve(ownerId: string): Promise<void> {
    const period = currentPeriod();
    await this.ensureRow(ownerId, period);
    const res = await this.repo
      .createQueryBuilder()
      .update(UsageQuota)
      .set({ used: () => 'used + 1' })
      .where('owner_id = :ownerId AND period = :period AND used < quota_limit', { ownerId, period })
      .execute();
    if (!res.affected) {
      throw new AppError(429, 'quota_exceeded', 'Bạn đã dùng hết lượt AI trong kỳ này');
    }
  }

  /** Trả lại lượt khi nhà cung cấp AI lỗi (không phát sinh chi phí). */
  async release(ownerId: string): Promise<void> {
    const period = currentPeriod();
    await this.repo
      .createQueryBuilder()
      .update(UsageQuota)
      .set({ used: () => 'used - 1' })
      .where('owner_id = :ownerId AND period = :period AND used > 0', { ownerId, period })
      .execute();
  }
}
