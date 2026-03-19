# Changelog

## dev

### Added
- Live session feed for adverts, messages, sync activity, probes, acknowledgements, and connection state.
- Runtime diagnostics surfaced in Settings, including sync timing, queue pull counts, archived message counts, and serial port probe results.
- A dedicated `Live` navigation view for packet and session activity.
- Branch CI workflow for validation on `main` and pull requests without using the release pipeline.

### Changed
- Trimmed packaged app contents locally to reduce release size by excluding source maps, docs, tests, and other non-runtime dependency files.
- Map view now keeps separate live and archived node filters in the UI.
- Known nodes in the map sidebar can now be clicked to focus and zoom the map to that node.
- Contact last-seen timestamps are clamped so nodes with bad clocks no longer appear to be seen in the future.
- Message composer footer spacing was adjusted so the send control and remaining-character counter no longer clip the bottom edge.

### Notes
- These changes are intended for the `dev` branch workflow and local iteration.
- Release publishing remains driven by tags and the existing release workflow.
