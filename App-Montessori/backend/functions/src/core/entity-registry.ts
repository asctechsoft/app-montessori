import type { Schema } from './validate';
import type { Ctx } from './types';

/**
 * Registry cho action generic `entity.save` / `entity.archive` (modules/entity.ts do BE-1 hiện thực).
 * Mỗi module đăng ký collection của mình lúc import: registerEntity('shifts', {...}).
 */
export interface EntityConfig {
  /** Quyền để tạo/sửa/lưu trữ (kiểm tra tại campusId của doc nếu campusScoped). */
  writePerm: string;
  /** true: doc phải có campusId hợp lệ của org và quyền kiểm tra tại cơ sở đó. false: cấp org. */
  campusScoped: boolean;
  /** Schema các field cho phép ghi (field ngoài schema bị loại). */
  schema: Schema;
  /** Field cần duy nhất trong phạm vi org/campus (vd 'code') → báo trùng mã. */
  uniqueBy?: string[];
  /** Tiền tố id (tuỳ chọn) khi tự sinh. */
  idPrefix?: string;
  /** Kiểm tra nghiệp vụ thêm (khoảng ngày, sĩ số...). Ném lỗi bằng fail()/invalid(). */
  beforeSave?(ctx: Ctx, data: Record<string, any>, existing: Record<string, any> | null): Promise<Record<string, any> | void>;
  /** Cho phép sửa khi doc đã ở các trạng thái này (mặc định: mọi trạng thái trừ archived). */
  editableStatuses?: string[];
}

const registry = new Map<string, EntityConfig>();
export function registerEntity(collection: string, cfg: EntityConfig): void {
  registry.set(collection, cfg);
}
export function getEntity(collection: string): EntityConfig | undefined {
  return registry.get(collection);
}
export function listEntities(): string[] {
  return [...registry.keys()];
}
