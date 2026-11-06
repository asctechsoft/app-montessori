/// Semantic tone of a badge, banner or toast. Colour only supports the label
/// and icon; never the sole signal (DESIGN_SYSTEM §1).
enum AppTone { neutral, success, warning, error, info }

/// Request lifecycle of a form/action (component-contracts `RequestState`).
enum RequestState { idle, loading, success, error }

/// Sync state of a record written on this device (`SyncState`).
enum SyncState { synced, pending, failed }

/// What a list/detail screen is showing (DESIGN_SYSTEM §12).
enum ViewState {
  loading,
  ready,
  empty,
  noResults,
  error,

  /// Offline with a cached copy: show data + "data saved at ..." banner.
  offlineStale,

  /// Offline and nothing cached: explain, never show zeros.
  offlineEmpty,
  forbidden,
}
