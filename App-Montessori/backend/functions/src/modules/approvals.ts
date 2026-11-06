import type { ActionMap } from '../core/types';
import { asObj, requireId, s } from './util';
import { serialize } from '../core/store';
import { invalid } from '../core/errors';
import { decideApprovalCore, cancelApprovalCore } from './approval-core';

// Handler cho các type của BE-1 đăng ký ngay trong module sở hữu nghiệp vụ:
//   attendance_correction → attendance.ts, transfer + enrollment_exception → children.ts, notification → comms.ts.
// (BE-2 đăng ký các type tài chính/công/kho từ module của họ.) approval.decide tra handler theo type.

const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

export const actions: ActionMap = {
  /**
   * Danh sách phê duyệt đã lọc theo quyền phía máy chủ (rules không thể chứng minh requiredPerm cho truy vấn list).
   * Thấy yêu cầu khi: là người lập, hoặc platformAdmin, hoặc có approvals.read VÀ requiredPerm của yêu cầu tại campus đó.
   */
  'approval.list': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const status = s(b.status) || 'pending';
      if (status !== 'all' && !STATUSES.includes(status)) invalid({ status: 'Trạng thái không hợp lệ.' });
      const type = s(b.type);
      const campusId = s(b.campusId);
      const limit = Math.min(Math.max(Math.trunc(Number(b.limit)) || 100, 1), 200);
      const out: Record<string, unknown>[] = [];
      let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
      for (let page = 0; page < 10 && out.length < limit; page++) {
        let q: FirebaseFirestore.Query = ctx.col('approvals');
        if (status !== 'all') q = q.where('status', '==', status);
        if (type) q = q.where('type', '==', type);
        q = q.orderBy('createdAt', 'desc').limit(100);
        if (last) q = q.startAfter(last);
        const snap = await q.get();
        for (const d of snap.docs) {
          const a = d.data();
          const cid: string | null = a.campusId ?? null;
          if (campusId && cid !== campusId) continue;
          const visible = ctx.platformAdmin || a.requestedBy === ctx.uid
            || (ctx.can('approvals.read', cid) && ctx.can(String(a.requiredPerm ?? ''), cid));
          if (!visible) continue;
          const { lock, ...rest } = a;
          void lock;
          out.push(serialize({ id: d.id, ...rest }));
          if (out.length >= limit) break;
        }
        if (snap.size < 100) break;
        last = snap.docs[snap.docs.length - 1];
      }
      return { items: out, truncated: out.length >= limit };
    },
  },
  'approval.decide': {
    scope: 'org',
    idempotent: false,
    handler: async (ctx, p) => {
      const b = asObj(p);
      return decideApprovalCore(ctx, requireId(b.id, 'id'), s(b.decision), s(b.note));
    },
  },
  'approval.cancel': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      return cancelApprovalCore(ctx, requireId(b.id, 'id'), s(b.reason ?? b.note));
    },
  },
};
