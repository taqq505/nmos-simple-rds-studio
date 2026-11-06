# Changelog

All notable changes to this project will be documented in this file.

## [0.2.2] - 2026-11-06

### Added
- Portable `.exe` now shows a splash image while it self-extracts on launch, so the app no longer
  appears unresponsive during startup

### Changed
- Node endpoint addresses are now shown as `host:port` everywhere (IP column, endpoint chips),
  since NMOS Node APIs commonly run on non-standard ports
- Nodes detail view lists every endpoint as a clickable chip that opens it in the browser

### Fixed
- Pagination fix from 0.2.1 now works against registries (observed on Cerebrum) that only return
  a valid `X-Paging-Since` when `paging.limit` is explicit: the first page is re-requested with an
  explicit limit before paging through results, so resources beyond the first page are no longer dropped
- Node IP no longer blindly uses the first entry of `api.endpoints` (IS-04 defines no ordering);
  the endpoint matching the node's `href` host is preferred, and nodes with multiple endpoints show
  a `+N` badge with a tooltip listing all of them
- Multi-endpoint tooltip follows the light/dark theme and no longer clips at the window edge

## [0.2.1] - 2026-08-31

### Fixed
- Query API list fetches (Nodes/Devices/Senders/Receivers/Flows/Sources) now paginate in both
  directions using `X-Paging-*` headers, so resources beyond the registry's default page limit
  are no longer silently dropped from every dashboard view
- Nodes, Senders, Receivers, Flows/Sources, and Connection Map now sort resources by label in
  natural/numeric order instead of raw registry return order

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
