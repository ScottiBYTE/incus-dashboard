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
## 1. Install the Incus Client

Run this on the system where Docker will run:

```bash
sudo apt update
sudo apt install incus-client -y
```

Verify the Incus client is installed:

```bash
incus remote list
```

## 2. Add Remote Incus Servers

Repeat this process for every Incus server you want the dashboard to monitor.

In this example, the Incus server is named `vmsmist`.

First, create a trust token from the Docker host:

```bash
ssh vmsmist "incus config trust add Incus-Dashboard"
```

Copy the token that is returned.

Now add the remote Incus server:

```bash
incus remote add vmsmist https://vmsmist:8443 --accept-certificate
```

Paste the trust token when prompted.

Verify that the remote works:

```bash
incus list vmsmist:
```

Repeat the same process for each additional Incus server:

```bash
ssh vmsstorm "incus config trust add Incus-Dashboard"
incus remote add vmsstorm https://vmsstorm:8443 --accept-certificate
incus list vmsstorm:

ssh vmsrain "incus config trust add Incus-Dashboard"
incus remote add vmsrain https://vmsrain:8443 --accept-certificate
incus list vmsrain:

ssh mondo-2 "incus config trust add Incus-Dashboard"
incus remote add mondo-2 https://mondo-2:8443 --accept-certificate
incus list mondo-2:
```

## 3. Deploy the Dashboard

Create a directory for the dashboard:

```bash
mkdir incus-dashboard
cd incus-dashboard
```

Create the Docker Compose file:

```bash
nano docker-compose.yml
```

Paste this into `docker-compose.yml`:

```yaml
services:
  incus-dashboard:
    image: scottibyte/incus-dashboard:latest
    container_name: incus-dashboard
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      - /home/YOUR_USER/.config/incus:/root/.config/incus:ro
```

Replace `YOUR_USER` with your Linux username.

Example:

```yaml
services:
  incus-dashboard:
    image: scottibyte/incus-dashboard:latest
    container_name: incus-dashboard
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      - /home/scott/.config/incus:/root/.config/incus:ro
```

Start the dashboard:

```bash
docker compose up -d
```

Verify it is running:

```bash
docker ps
docker compose logs
```

You should see:

```text
Dashboard running on port 80
```

## 4. Open the Dashboard

Open a browser and go to:

```text
http://YOUR-SERVER-IP
```

## 5. Update the Dashboard

From the `incus-dashboard` directory:

```bash
docker compose pull
docker compose up -d
```

## 6. Troubleshooting

If the dashboard opens but no containers are shown, test the Incus remotes from the Docker host:

```bash
incus remote list
incus list vmsmist:
```

If `incus list remote-name:` does not return containers, fix the Incus remote connection before troubleshooting Docker.

If port 80 is already in use, check what is using it:

```bash
sudo ss -ltnp | grep ':80'
```

If you change the left side of the port mapping, for example:

```yaml
ports:
  - "8080:80"
```

then open:

```text
http://YOUR-SERVER-IP:8080
```
