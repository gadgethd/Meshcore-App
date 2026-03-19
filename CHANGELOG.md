# Changelog

## dev (0.0.3-alpha)

### Notes
- `dev` now tracks the next prerelease cycle after `0.0.2-alpha`.

## 0.0.2-alpha

### Added
- Live session feed for adverts, messages, sync activity, probes, acknowledgements, and connection state.
- Runtime diagnostics surfaced in Settings, including sync timing, queue pull counts, archived message counts, and serial port probe results.
- A dedicated `Live` navigation view for packet and session activity.
- Branch CI workflow for validation on `main` and pull requests without using the release pipeline.
- In-app update controls in Settings for checking, downloading, and restarting into a new release.

### Changed
- Trimmed packaged app contents locally to reduce release size by excluding source maps, docs, tests, and other non-runtime dependency files.
- Map view now keeps separate live and archived node filters in the UI.
- Known nodes in the map sidebar can now be clicked to focus and zoom the map to that node.
- Contact last-seen timestamps are clamped so nodes with bad clocks no longer appear to be seen in the future.
- Message composer footer layout was reworked so the send control and remaining-character counter stay fully inside the composer card.
- Release packaging now generates and uploads updater metadata files needed by `electron-updater`.

### Notes
- In-app updates require releases published with the new updater metadata (`latest*.yml`, blockmaps, and macOS zip artifacts).
