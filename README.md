# NMOS Simple RDS Studio

**A single `.exe` that runs a full AMWA IS-04 Registration & Discovery System on your Windows PC.**

No server setup. No configuration files. No installation.  
Download, double-click, and your NMOS network has an RDS.

---

## What is this?

NMOS Simple RDS Studio bundles [sony/nmos-cpp](https://github.com/sony/nmos-cpp) — a production-grade IS-04 registry — together with a graphical interface into one portable executable. Built on [Electron](https://www.electronjs.org/), it packages the nmos-cpp-registry binary and a web-based UI into a single self-contained `.exe`. It is designed for engineers who need an RDS running quickly, without the overhead of deploying and managing a server.

### This is an RDS, not just a viewer.

When you launch the app, it starts a real nmos-cpp-registry on your machine. NMOS nodes on your network can register with it immediately. The interface lets you see what's registered, inspect resources, and troubleshoot in real time.

---

## Features

### 📦 One File — No Setup
Everything is packed into a single portable `.exe`. The nmos-cpp-registry binary is embedded. Just run it.

### 🖥️ Built-in RDS (Launch mode)
Start an IS-04 compliant registry directly from the app. Configure network interface, ports, domain, and priority through a simple wizard — no JSON editing required.

### 🔍 Real-time Visualization
See everything registered in your NMOS network at a glance:

- **Overview** — Node count, sender/receiver/flow totals, receiver connection rate gauge, format distribution chart, live timeline, node REG/UNREG activity feed, sparkline history per metric
- **Map** — Connection map showing sender/receiver links with hover highlighting
- **Nodes** — Node → device → sender/receiver hierarchy; IS-05/07/08 API badges where advertised
- **Senders** — SDP display, transport details, direct REST API access
- **Receivers** — Connection status, linked sender navigation
- **Flows / Sources** — Format summaries and source relationships (ANC correctly detected)
- **Log** — Live log stream from the running RDS process (local mode only)
- **RDS Settings** — Network interface, ports, domain, priority, logging level
- **App Settings** — Update mode (WebSocket or interval), poll interval, timeline window

### ⚡ WebSocket Updates
By default the dashboard subscribes to the IS-04 Query API WebSocket feed and refreshes automatically when resources change. Falls back to interval polling if the RDS does not support WebSocket subscriptions. Both modes are configurable in App Settings.

### 🔔 Node Notifications
When a node registers (REG) or deregisters (UNREG), a toast notification appears and the event is logged in the Overview activity feed and live timeline.

### 🔎 Global Search
Press `Ctrl+K` to open the search bar. Search by node name, hostname, IP address, sender/receiver label, flow format, or resource ID. Click a result to navigate directly to that resource.

### 🔗 Connect to Existing RDS (Monitor mode)
Already have an RDS on your network? Connect to it as a read-only monitor without starting a new registry. The splash screen automatically discovers RDS instances on the local network via mDNS and lists them for one-click connection.

### 🌐 Open in Browser
Each resource has an **Open in browser** button that opens the raw Query API response directly in your default browser.

### 📡 mDNS / Bonjour
nmos-cpp uses Apple Bonjour for mDNS service advertisement on Windows. If Bonjour is not installed, the app detects this at startup and shows a warning with an install link. Without Bonjour, NMOS nodes must be pointed to this RDS by IP address directly — all other functionality is unaffected.

---

## Download

Get the latest portable `.exe` from the [Releases](../../releases) page.

> Windows x64 · No installation required · Just run

**Windows ARM64 (Surface Pro X, Snapdragon PCs):**  
The x64 binary runs on ARM64 Windows via the built-in x64 emulation layer — no separate download needed.  
A native ARM64 build is planned; it is currently on hold pending ARM64 support for `cpprestsdk` in Conan Center.

## Windows Firewall

When you launch the RDS for the first time, Windows will show a firewall dialog asking whether to allow `nmos-cpp-registry.exe` to communicate on the network.

- Check **both Private and Public networks** to allow access from devices on other subnets (L3).
- If you only allowed Private networks and remote devices cannot connect, delete the existing rules and relaunch:

```powershell
# Run as Administrator
netsh advfirewall firewall delete rule name="nmos-cpp-registry.exe"
```

The firewall rule is tied to the executable, not to specific ports — so changing the RDS port in Settings does not require any additional firewall configuration.

---

## Screenshots

_Coming soon_

---

## Development

```bash
git clone https://github.com/taqq505/nmos-simple-rds-studio.git
cd nmos-simple-rds-studio
npm install
npm start
```

### Build

```bash
npm run build:win
```

Output: `dist/NMOS Simple RDS Studio*.exe`

---

## License

Apache 2.0 — see [LICENSE](LICENSE)

nmos-cpp is copyright Sony Corporation, licensed under Apache 2.0.

---

---

# NMOS Simple RDS Studio（日本語）

**Windows PC上でAMWA IS-04 Registration & Discovery Systemをすぐに動かせる、1つの `.exe` ファイル。**

サーバー構築不要。設定ファイル不要。インストール不要。  
ダウンロードしてダブルクリックするだけで、NMOSネットワークにRDSが立ち上がります。

---

## これは何？

NMOS Simple RDS Studioは、[sony/nmos-cpp](https://github.com/sony/nmos-cpp)（プロダクション品質のIS-04レジストリ）とGUIを1つのポータブルexeにまとめたアプリケーションです。[Electron](https://www.electronjs.org/)をベースに、nmos-cpp-registryバイナリとWebベースのUIを1つの `.exe` にパッケージしています。サーバーの構築・管理コストをかけずに、すぐRDSを使いたいエンジニアのために作られています。

### これはビューアではなく、RDSです。

アプリを起動すると、PC上でnmos-cpp-registryが実際に動作します。ネットワーク上のNMOSノードはすぐにこのRDSに登録できます。インターフェースから、登録されているリソースの確認・詳細閲覧・トラブルシュートがリアルタイムで行えます。

---

## 特長

### 📦 1ファイル、セットアップ不要
nmos-cpp-registryバイナリを同梱した1つのポータブル `.exe` にすべてが入っています。

### 🖥️ RDSの起動（Launchモード）
アプリ内のウィザードからIS-04準拠のレジストリを直接起動できます。ネットワークインターフェース・ポート・ドメイン・プライオリティを画面上で設定するだけで、JSONファイルの編集は不要です。

### 🔍 リアルタイム可視化
NMOSネットワークの登録状況を一画面で把握できます：

- **Overview** — ノード数・センダー/レシーバー/フロー数、最近のアクティビティ
- **Map** — センダー/レシーバーの接続マップ（ホバーでハイライト）
- **Nodes** — ノード → デバイス → センダー/レシーバーの階層表示、IS-05/07/08 APIバッジ表示
- **Senders** — SDP表示、トランスポート詳細、REST APIへの直接アクセス
- **Receivers** — 接続状態、接続先センダーへのナビゲーション
- **Flows / Sources** — フォーマットサマリー、ソース関係（ANC: video/smpte291 を正確に識別）
- **Log** — 実行中のRDSプロセスからのライブログストリーム（ローカルモードのみ）
- **RDS Settings** — ネットワークインターフェース、ポート、ドメイン、プライオリティ、ログレベル
- **App Settings** — 更新モード（WebSocket / インターバル）、ポーリング間隔、タイムライン表示幅

### ⚡ WebSocket更新
デフォルトでIS-04 Query APIのWebSocketフィードを購読し、リソースの変更を即時反映します。RDSがWebSocketサブスクリプションに対応していない場合は、インターバルポーリングに自動フォールバックします。どちらもApp Settingsで設定可能です。

### 🔔 ノード登録通知
ノードの登録（REG）・登録解除（UNREG）をリアルタイムでトースト通知します。OverviewのNode Eventsフィードとライブタイムラインにも記録されます。

### 🔎 グローバル検索
`Ctrl+K` で検索バーを開き、ノード名・ホスト名・IPアドレス・センダー/レシーバー名・フォーマット・IDで横断検索できます。結果をクリックすると該当ページに直接遷移します。

### 🔗 既存RDSへの接続（Monitorモード）
ネットワーク上に既存のRDSがある場合、新しいレジストリを起動せずに読み取り専用で接続・監視できます。スプラッシュ画面でmDNSによりネットワーク上のRDSを自動検出し、ワンクリックで接続できます。

### 🌐 ブラウザで開く
各リソースに **Open in browser** ボタンがあり、Query APIのレスポンスをブラウザで直接確認できます。

### 📡 mDNS / Bonjour
nmos-cppはWindows上でのmDNSサービス広告にApple Bonjourを使用します。Bonjourがインストールされていない場合、起動時に警告とインストールリンクが表示されます。Bonjourなしでも他の機能はすべて正常に動作します。その場合はNMOSノード側でこのRDSのIPアドレスを直接設定してください。

---

## ダウンロード

[Releases](../../releases) ページから最新のポータブル `.exe` をダウンロードしてください。

> Windows x64 対応 · インストール不要 · そのまま実行

**Windows ARM64（Surface Pro X、Snapdragon PC など）：**  
x64版バイナリはWindows ARM64のx64エミュレーション機能でそのまま動作します。別途ダウンロードは不要です。  
ネイティブARM64ビルドは計画中ですが、Conan Center における `cpprestsdk` のARM64対応待ちのため現在保留中です。

## Windows ファイアウォールについて

初回起動時、Windows が `nmos-cpp-registry.exe` の通信を許可するかどうかダイアログを表示します。

- **プライベートネットワーク・パブリックネットワークの両方にチェック**を入れて許可してください。L3越えのサブネットからアクセスする場合はパブリックの許可が必要です。
- プライベートのみ許可してしまい、リモートデバイスから接続できない場合は、既存のルールを削除して再起動してください：

```powershell
# 管理者として実行
netsh advfirewall firewall delete rule name="nmos-cpp-registry.exe"
```

ファイアウォールルールはポートではなく exe に紐づいているため、設定画面でポートを変更しても追加の設定は不要です。

---

## 開発

```bash
git clone https://github.com/taqq505/nmos-simple-rds-studio.git
cd nmos-simple-rds-studio
npm install
npm start
```

### ビルド

```bash
npm run build:win
```

出力先：`dist/NMOS Simple RDS Studio*.exe`

---

## ライセンス

Apache 2.0 — [LICENSE](LICENSE) 参照

nmos-cpp は Sony Corporation の著作物で、Apache 2.0 ライセンスで提供されています。
