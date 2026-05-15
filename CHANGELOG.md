# Changelog

## [1.2.0]

- Fixed port to `7654` so Simple Browser tabs survive Cursor restarts
- Each HTML file now gets its own URL (`/filename.html`) with independent live reload
- Fixed live reload not triggering on auto-save (now detects every edit, not just Cmd+S)
- Fixed first-open bug where Simple Browser wouldn't open on the very first HTML file

## [1.1.0]

- Added live reload via WebSocket — browser updates automatically as you edit
- Switched from file:// to HTTP server so reload and scripting work correctly

## [1.0.0]

- Initial release
- Auto-opens Simple Browser when an HTML file is opened
- Closes the raw editor tab by default (`gossamer-preview.openEditor` to keep it open)
