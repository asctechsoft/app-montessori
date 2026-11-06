import 'dart:async';

import 'package:asc_common/asc_common.dart';
import 'package:get/get.dart';

/// Online/offline state (asc_common [AscConnectivity]). `isOnline` is a hint,
/// not proof the server is reachable: ApiService still decides by real errors.
class ConnectivityService extends GetxService {
  static ConnectivityService get to => Get.find<ConnectivityService>();

  final RxBool isOnline = true.obs;

  /// When the connection came back (null until it went down once).
  final Rxn<DateTime> lastReconnectedAt = Rxn<DateTime>();

  StreamSubscription<dynamic>? _sub;

  Future<ConnectivityService> start() async {
    isOnline.value = await AscConnectivity.isOnline();
    _sub = AscConnectivity.onChanged.listen((result) {
      final online = AscConnectivity.isOnlineFrom(result);
      if (online && !isOnline.value) lastReconnectedAt.value = DateTime.now();
      isOnline.value = online;
    });
    return this;
  }

  @override
  void onClose() {
    _sub?.cancel();
    super.onClose();
  }
}
