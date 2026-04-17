# NMOS Simple RDS Studio

**A single `.exe` that runs a full AMWA IS-04 Registration & Discovery System on your Windows PC.**

No server setup. No configuration files. No installation.  
Download, double-click, and your NMOS network has an RDS.

---

## What is this?

NMOS Simple RDS Studio bundles [sony/nmos-cpp](https://github.com/sony/nmos-cpp) — a production-grade IS-04 registry — together with a graphical interface into one portable executable. It is designed for engineers who need an RDS running quickly, without the overhead of deploying and managing a server.

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

- **Overview** — Node count, sender/receiver/flow totals, heartbeat status, recent activity
- **Nodes** — Node → device → sender/receiver hierarchy with live heartbeat indicators
- **Senders** — SDP display, transport details, direct REST API access
- **Receivers** — Connection status, linked sender navigation
- **Flows / Sources** — Format summaries and source relationships
- **Log** — Live log stream from the running RDS process
- **Settings** — Adjust network interface, ports, priority, and logging level

### 🔗 Connect to Existing RDS (Monitor mode)
Already have an RDS on your network? Connect to it as a read-only monitor without starting a new registry.

### 🌐 Open in Browser
Each resource has an **Open in browser** button that opens the raw Query API response directly in your default browser.

---

## Download

Get the latest portable `.exe` from the [Releases](../../releases) page.

> Windows x64 · No installation required · Just run

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

NMOS Simple RDS Studioは、[sony/nmos-cpp](https://github.com/sony/nmos-cpp)（プロダクション品質のIS-04レジストリ）とGUIを1つのポータブルexeにまとめたアプリケーションです。サーバーの構築・管理コストをかけずに、すぐRDSを使いたいエンジニアのために作られています。

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

- **Overview** — ノード数・センダー/レシーバー/フロー数、ハートビート一覧、最近のアクティビティ
- **Nodes** — ノード → デバイス → センダー/レシーバーの階層表示、ライブハートビートインジケーター
- **Senders** — SDP表示、トランスポート詳細、REST APIへの直接アクセス
- **Receivers** — 接続状態、接続先センダーへのナビゲーション
- **Flows / Sources** — フォーマットサマリー、ソース関係
- **Log** — 実行中のRDSプロセスからのライブログストリーム
- **Settings** — ネットワークインターフェース、ポート、プライオリティ、ログレベルの調整

### 🔗 既存RDSへの接続（Monitorモード）
ネットワーク上に既存のRDSがある場合、新しいレジストリを起動せずに読み取り専用で接続・監視できます。

### 🌐 ブラウザで開く
各リソースに **Open in browser** ボタンがあり、Query APIのレスポンスをブラウザで直接確認できます。

---

## ダウンロード

[Releases](../../releases) ページから最新のポータブル `.exe` をダウンロードしてください。

> Windows x64 対応 · インストール不要 · そのまま実行

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
