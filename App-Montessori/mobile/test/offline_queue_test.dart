import 'package:app_montessori/models/ui_models/app_tone.dart';
import 'package:app_montessori/services/network/app_exception.dart';
import 'package:app_montessori/services/storage/pref_store.dart';
import 'package:app_montessori/services/sync/offline_queue.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  late List<String> sent;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await PrefStore.init();
    sent = [];
  });

  Future<OfflineQueue> queue(QueueSender sender) async {
    final q = OfflineQueue(sender: sender);
    await q.bindUser('u1');
    return q;
  }

  Future<void> add(OfflineQueue q, String action, {String? opId}) => q.enqueue(
    action: action,
    orgId: 'o1',
    campusId: 'cg',
    payload: {'x': 1},
    opId: opId,
  );

  test('only receive, punch and attendance can be queued', () async {
    final q = await queue((_) async {});
    for (final ok in ['handover.receive', 'punch.record', 'attendance.mark']) {
      await add(q, ok);
    }
    expect(q.items, hasLength(3));
    for (final bad in [
      'payment.record',
      'payment.submitProof',
      'handover.pickup',
      'refund.approve',
      'approval.decide',
      'leave.submit',
    ]) {
      expect(
        () => add(q, bad),
        throwsA(isA<QueueNotAllowedException>()),
        reason: bad,
      );
    }
    expect(q.items, hasLength(3));
  });

  test('same opId is stored once (double tap)', () async {
    final q = await queue((_) async {});
    await add(q, 'punch.record', opId: 'op-1');
    await add(q, 'punch.record', opId: 'op-1');
    expect(q.items, hasLength(1));
  });

  test('flush sends in order, with opId, and removes confirmed ops', () async {
    final q = await queue((op) async => sent.add('${op.action}:${op.opId}'));
    await add(q, 'handover.receive', opId: 'a');
    await add(q, 'punch.record', opId: 'b');
    await q.flush();
    expect(sent, ['handover.receive:a', 'punch.record:b']);
    expect(q.items, isEmpty);
    expect(q.lastSyncedAt.value, isNotNull);
  });

  test('network error keeps ops pending and stops; nothing is lost', () async {
    var online = false;
    final q = await queue((op) async {
      if (!online) throw const AppException(AppException.network, '');
      sent.add(op.opId);
    });
    await add(q, 'punch.record', opId: 'a');
    await add(q, 'punch.record', opId: 'b');
    await q.flush();
    expect(q.items.map((o) => o.state), [SyncState.pending, SyncState.pending]);
    expect(q.items.first.attempts, 0);
    expect(sent, isEmpty);
    online = true;
    await q.flush();
    expect(sent, ['a', 'b']);
    expect(q.items, isEmpty);
  });

  test('business rejection marks the op failed, others still go', () async {
    final q = await queue((op) async {
      if (op.opId == 'bad') {
        throw const AppException(AppException.precondition, 'Trẻ chưa được nhận');
      }
      sent.add(op.opId);
    });
    await add(q, 'handover.receive', opId: 'bad');
    await add(q, 'handover.receive', opId: 'good');
    await q.flush();
    expect(sent, ['good']);
    expect(q.items, hasLength(1));
    expect(q.items.single.state, SyncState.failed);
    expect(q.items.single.lastError, 'Trẻ chưa được nhận');
    expect(q.stateOf('bad'), SyncState.failed);
    expect(q.stateOf('good'), SyncState.synced);

    await q.discard('bad');
    expect(q.items, isEmpty);
  });

  test('queue survives a restart (per user)', () async {
    final q = await queue((_) async {});
    await add(q, 'punch.record', opId: 'keep');
    final q2 = OfflineQueue(sender: (_) async {});
    await q2.bindUser('u1');
    expect(q2.items.map((o) => o.opId), ['keep']);
    await q2.bindUser('u2');
    expect(q2.items, isEmpty);
    await q2.bindUser(null);
    expect(() => add(q2, 'punch.record'), throwsStateError);
  });

  test('failed op can be retried', () async {
    var fail = true;
    final q = await queue((op) async {
      if (fail) throw const AppException(AppException.validation, 'sai');
      sent.add(op.opId);
    });
    await add(q, 'attendance.mark', opId: 'a');
    await q.flush();
    expect(q.items.single.state, SyncState.failed);
    fail = false;
    await q.retry('a');
    expect(sent, ['a']);
    expect(q.items, isEmpty);
  });
}
