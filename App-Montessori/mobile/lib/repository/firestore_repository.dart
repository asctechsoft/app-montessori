// ignore_for_file: prefer_initializing_formals
import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../controller/session_controller.dart';
import '../services/network/app_exception.dart';

/// Result of one Firestore read, with the metadata the UI needs for the
/// offline/stale banner (DESIGN_SYSTEM §12).
class DataSnapshot<T> {
  const DataSnapshot(
    this.items, {
    this.fromCache = false,
    this.hasPendingWrites = false,
    required this.receivedAt,
  });

  final List<T> items;

  /// True when served from the local Firestore cache (offline / not yet
  /// confirmed by the server): show "Dữ liệu lưu lúc ..." not "live".
  final bool fromCache;
  final bool hasPendingWrites;
  final DateTime receivedAt;
}

/// Base for repositories that READ Firestore directly (CONTRACT §5: clients
/// read, only the `api` callable writes).
///
/// Every path is built from the ACTIVE scope (`orgs/{orgId}/...`), so a query
/// can never cross organisations. Streams drop events that arrive after the
/// scope changed. Rules still enforce membership on the server; parents must
/// filter by `childId` (their `childIds`) and teachers by campus/class, or the
/// query is rejected by rules.
///
/// ```dart
/// class ClassRepository extends FirestoreRepository {
///   Stream<DataSnapshot<ClassModel>> watchClasses() => watchCollection(
///     'classes',
///     fromMap: (id, m) => ClassModel.fromMap(id, m),
///     // campus filter is applied by default (campusScoped: true)
///   );
/// }
/// ```
abstract class FirestoreRepository {
  FirestoreRepository({FirebaseFirestore? db, SessionController? session})
    : _db = db,
      _session = session;

  final FirebaseFirestore? _db;
  final SessionController? _session;

  FirebaseFirestore get db => _db ?? FirebaseFirestore.instance;
  SessionController get session => _session ?? SessionController.to;

  String get orgId {
    final id = session.orgId;
    if (id == null) {
      throw const AppException(AppException.permissionDenied, '');
    }
    return id;
  }

  String get campusId {
    final id = session.campusId;
    if (id == null) {
      throw const AppException(AppException.permissionDenied, '');
    }
    return id;
  }

  /// `orgs/{orgId}/{name}`
  CollectionReference<Map<String, dynamic>> orgCollection(String name) =>
      db.collection('orgs/$orgId/$name');

  /// `orgs/{orgId}/{name}/{id}`
  DocumentReference<Map<String, dynamic>> orgDoc(String name, String id) =>
      db.doc('orgs/$orgId/$name/$id');

  /// Watches a collection of the active org. With [campusScoped] (default) the
  /// query is limited to `campusId == active campus`. Use [build] to add
  /// `where`/`orderBy` (e.g. `q.where('childId', isEqualTo: childId)`).
  Stream<DataSnapshot<T>> watchCollection<T>(
    String name, {
    required T Function(String id, Map<String, dynamic> data) fromMap,
    Query<Map<String, dynamic>> Function(Query<Map<String, dynamic>> q)? build,
    bool campusScoped = true,
    int? limit,
  }) {
    final epoch = session.scopeEpoch.value;
    Query<Map<String, dynamic>> q = orgCollection(name);
    if (campusScoped) q = q.where('campusId', isEqualTo: campusId);
    if (build != null) q = build(q);
    if (limit != null) q = q.limit(limit);
    return q
        .snapshots(includeMetadataChanges: true)
        .where((_) => session.scopeEpoch.value == epoch)
        .map(
          (s) => DataSnapshot<T>(
            s.docs.map((d) => fromMap(d.id, d.data())).toList(),
            fromCache: s.metadata.isFromCache,
            hasPendingWrites: s.metadata.hasPendingWrites,
            receivedAt: DateTime.now(),
          ),
        )
        .transform(_errorMapper<DataSnapshot<T>>());
  }

  /// Watches one document; items is empty when it does not exist.
  Stream<DataSnapshot<T>> watchDoc<T>(
    String name,
    String id, {
    required T Function(String id, Map<String, dynamic> data) fromMap,
  }) {
    final epoch = session.scopeEpoch.value;
    return orgDoc(name, id)
        .snapshots(includeMetadataChanges: true)
        .where((_) => session.scopeEpoch.value == epoch)
        .map(
          (s) => DataSnapshot<T>(
            s.exists && s.data() != null ? [fromMap(s.id, s.data()!)] : <T>[],
            fromCache: s.metadata.isFromCache,
            hasPendingWrites: s.metadata.hasPendingWrites,
            receivedAt: DateTime.now(),
          ),
        )
        .transform(_errorMapper<DataSnapshot<T>>());
  }

  /// One-shot read (server first; falls back to cache offline).
  Future<DataSnapshot<T>> getCollection<T>(
    String name, {
    required T Function(String id, Map<String, dynamic> data) fromMap,
    Query<Map<String, dynamic>> Function(Query<Map<String, dynamic>> q)? build,
    bool campusScoped = true,
    int? limit,
  }) async {
    try {
      Query<Map<String, dynamic>> q = orgCollection(name);
      if (campusScoped) q = q.where('campusId', isEqualTo: campusId);
      if (build != null) q = build(q);
      if (limit != null) q = q.limit(limit);
      final s = await q.get();
      return DataSnapshot<T>(
        s.docs.map((d) => fromMap(d.id, d.data())).toList(),
        fromCache: s.metadata.isFromCache,
        receivedAt: DateTime.now(),
      );
    } catch (e) {
      throw mapError(e);
    }
  }

  static StreamTransformer<S, S> _errorMapper<S>() =>
      StreamTransformer<S, S>.fromHandlers(
        handleError: (e, st, sink) => sink.addError(mapError(e), st),
      );

  /// Firestore error -> [AppException].
  static AppException mapError(Object e) {
    if (e is AppException) return e;
    if (e is FirebaseException) {
      switch (e.code) {
        case 'permission-denied':
          return const AppException(AppException.permissionDenied, '');
        case 'unauthenticated':
          return const AppException(AppException.unauthenticated, '');
        case 'unavailable':
          return const AppException(AppException.network, '');
        case 'deadline-exceeded':
          return const AppException(AppException.timeout, '');
        case 'not-found':
          return const AppException(AppException.notFound, '');
      }
    }
    return AppException(AppException.unknown, e.toString());
  }
}
