import 'package:app_montessori/services/network/api_service.dart';
import 'package:app_montessori/services/network/app_exception.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  ApiService service(ApiTransport t) =>
      ApiService(transport: t, sleep: (_) async {});

  test('unwraps {ok, data} into a typed map', () async {
    Map<String, dynamic>? seen;
    final api = service((req) async {
      seen = Map<String, dynamic>.from(req);
      return {
        'ok': true,
        'data': {
          'orgs': [
            {'orgId': 'o1'},
          ],
        },
      };
    });
    final data = await api.call(
      'org.listMine',
      orgId: 'o1',
      payload: {'a': 1},
      opId: 'op-1',
    );
    expect((data['orgs'] as List).single, {'orgId': 'o1'});
    expect(seen!['action'], 'org.listMine');
    expect(seen!['orgId'], 'o1');
    expect(seen!.containsKey('campusId'), isFalse);
    expect(seen!['opId'], 'op-1');
  });

  test('a write without opId is never retried', () async {
    var calls = 0;
    final api = service((_) async {
      calls++;
      throw const AppException(AppException.network, '');
    });
    await expectLater(
      api.call('leave.submit'),
      throwsA(isA<AppException>().having((e) => e.code, 'code', AppException.network)),
    );
    expect(calls, 1);
  });

  test('a call with opId (or a read) retries transient errors', () async {
    var calls = 0;
    final api = service((_) async {
      calls++;
      if (calls < 3) throw const AppException(AppException.network, '');
      return {'ok': true, 'data': {'done': true}};
    });
    final data = await api.call('payment.record', opId: 'op-9');
    expect(data['done'], true);
    expect(calls, 3);
  });

  test('business errors are not retried even with opId', () async {
    var calls = 0;
    final api = service((_) async {
      calls++;
      throw const AppException(AppException.validation, 'Sai', fieldErrors: {'f': 'x'});
    });
    await expectLater(
      api.call('child.save', opId: 'op'),
      throwsA(isA<AppException>().having((e) => e.fieldErrors['f'], 'field', 'x')),
    );
    expect(calls, 1);
  });

  test('unauthenticated triggers the sign-out hook', () async {
    var hooked = false;
    final api = service((_) async => throw const AppException(AppException.unauthenticated, ''))
      ..onUnauthenticated = () => hooked = true;
    await expectLater(api.call('org.listMine'), throwsA(isA<AppException>()));
    expect(hooked, isTrue);
  });

  test('opIds are unique UUIDs', () {
    final a = ApiService.newOpId();
    final b = ApiService.newOpId();
    expect(a, isNot(b));
    expect(a.length, 36);
  });

  test('retryable codes', () {
    expect(const AppException(AppException.network, '').isRetryable, isTrue);
    expect(const AppException(AppException.timeout, '').isRetryable, isTrue);
    expect(const AppException(AppException.permissionDenied, '').isRetryable, isFalse);
    expect(const AppException(AppException.versionConflict, '').isRetryable, isFalse);
  });
}
