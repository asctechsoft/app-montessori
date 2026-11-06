import { MigrationInterface, QueryRunner } from 'typeorm';

/** Nhóm khách: mine (khách của mình) | parents (khách của bố mẹ). */
export class AddGiftSide1730000000001 implements MigrationInterface {
  name = 'AddGiftSide1730000000001';

  public async up(q: QueryRunner): Promise<void> {
    await q.query("ALTER TABLE gifts ADD COLUMN side varchar(10) NOT NULL DEFAULT 'mine'");
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE gifts DROP COLUMN side');
  }
}
