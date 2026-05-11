# ScottiBYTE Incus Dashboard

A modern web-based monitoring dashboard for Incus container environments that provides centralized visibility into containers across multiple Incus servers.

The ScottiBYTE Incus Dashboard allows administrators to monitor Incus infrastructure from a single lightweight web interface using the native Incus client and remote trust relationships.

---

# Dashboard Overview

![Incus Dashboard](https://raw.githubusercontent.com/ScottiBYTE/incus-dashboard/main/screenshots/incus-dashboard-main.png)

---

# Features

- Multi-server Incus monitoring
- Real-time container visibility
- Unified dashboard across Incus hosts
- Lightweight Docker deployment
- Native Incus client integration
- Secure trust-token authentication
- Read-only infrastructure visibility
- Simple Docker Compose deployment
- Centralized container management visibility
- No database required

---

# 1. Install the Incus Client

Run this on the system where Docker will run:

```bash
sudo apt update
sudo apt install incus-client -y
