# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-04-29

### Overview
- Registered nodes table (left 2/3) and Node Events feed (right 1/3) now side by side
- Click any node row in Overview to navigate directly to its detail page in the Nodes tab
- Live Timeline: receiver connection events (CON/DIS) shown in amber; node events (REG/UNREG) in green/red
- Node Events feed: correctly shows CON/DIS labels for receiver connect/disconnect (was incorrectly showing UNREG)
- Removed broken "Recent activity" log panel (was fetching a non-existent endpoint)

### Dark Mode
- Dark mode toggle added to App Settings → Appearance
- Applies instantly without page reload; persists in `config.json` across restarts
- Splash screen respects the saved theme on launch

### Splash Screen
- All hardcoded colors replaced with CSS variables — hover states and text now correctly adapt to dark mode
- "Resume last session" description now shows mode: `Launch RDS · Port…` or `Connect · URL…`
- Fixed bug where Resume always launched a local RDS even if the last session was a remote connect

## [0.1.0] - 2026-04-28

### Initial Release

#### Core
- Single portable `.exe` — no installation required
- Bundles [sony/nmos-cpp](https://github.com/sony/nmos-cpp) IS-04 registry
- Built on [Electron](https://www.electronjs.org/)
- MSVC runtime DLLs bundled (no Visual C++ Redistributable required)

#### Launch Mode
- Start an IS-04 compliant RDS from the app
- Configure NIC, ports, domain, priority via wizard
- mDNS service advertisement via Bonjour (Windows)
- Bonjour installation check at startup with warning and install link

#### Connect Mode (Monitor)
- Connect to an existing RDS as read-only monitor
- mDNS auto-discovery of RDS instances on the local network
- Manual IP / port entry

#### Dashboard
- **Overview** — Node count, sender/receiver/flow totals, receiver connection rate gauge, format distribution chart (Video/Audio/ANC), live timeline, node event activity feed, per-metric sparkline history (10-minute window)
- **Map** — Sender/receiver connection map with hover highlighting
- **Nodes** — Node → device → sender/receiver hierarchy; IS-05/07/08 API badges
- **Senders** — SDP display, transport details
- **Receivers** — Connection status, linked sender navigation
- **Flows / Sources** — Format summary; ANC (video/smpte291) correctly identified
- **Log** — Live log stream from nmos-cpp (local mode only)

#### Updates
- WebSocket subscription to IS-04 Query API (default); falls back to interval polling
- Configurable poll interval and timeline window in App Settings

#### Notifications
- REG / UNREG toast notifications on node registration changes
- Node Events activity feed in Overview

#### Search
- Global search (`Ctrl+K`) across nodes, senders, receivers, flows by name, hostname, IP, ID

#### Settings
- **RDS Settings** — Network, ports, domain, priority, logging level (with confirmation dialog)
- **App Settings** — Update mode, poll interval, timeline window

#### Other
- Resource version timestamp (TAI → human-readable) on all resource detail views
- macOS-style thin scrollbars
- Open any resource directly in browser via Query API URL
