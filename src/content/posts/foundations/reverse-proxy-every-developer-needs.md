---
title: "What Is a Reverse Proxy and Why Does Every Developer Need One?"
description: "A reverse proxy sits between the internet and your servers. I use Caddy to route traffic to 5+ services on a single VPS — here's how it works."
publishDate: 2026-03-15
author: j-martin
tier: foundations
postType: explainer
difficulty: beginner
estimatedMinutes: 10
prerequisites: []
category: networking
tags: ["caddy", "reverse-proxy", "https", "tls", "web-server", "nginx"]
certTracks: ["comptia-network-plus"]
featured: false
heroImage: "/images/posts/reverse-proxy-every-developer-needs.webp"
draft: false
---

## Why Should You Care?

I run five separate web services on a single VPS. A blog, an AI chat interface, an admin panel, a marketing site, and an API. All of them live on the same IP address: `203.0.113.50`.

So how does `blog.southernsky.cloud` go to the blog, but `chat.southernsky.cloud` goes to the AI interface — and both are HTTPS with valid certificates?

That's a reverse proxy. Once you understand it, you'll stop wondering how sites work and start building your own.

## The Analogy: A Restaurant Host

Imagine a restaurant with five kitchens specializing in different cuisines. There's one front door and one host. Customers walk in and say what they want. The host checks the reservation system and walks each customer to the right kitchen.

The host is your reverse proxy. The kitchens are your backend services. The customers never interact with the kitchens directly — they only talk to the host.

In networking terms:

- **The front door** = port 443 (HTTPS) on your server's public IP
- **The host** = reverse proxy software (Caddy, nginx, Traefik)
- **The kitchens** = backend services running on internal ports (3000, 4001, 4006, etc.)
- **The reservation system** = the proxy's routing rules, usually based on the domain name in the request

## Why You Can't Just Use Raw Ports

The naive approach: run your blog on port 4006, your chat interface on port 3000, your API on port 8300. Tell users to add the port to the URL.

Problems with this:

1. **Ugly URLs** — `https://203.0.113.50:4006` instead of `https://blog.southernsky.cloud`
2. **No HTTPS** — Browsers will warn users about insecure connections. TLS certificates bind to port 443.
3. **Port juggling** — You'd need to tell every user which port does what
4. **No central logging or rate limiting** — Each service manages itself

A reverse proxy solves all four with a single config file.

## Meet Caddy: The Modern Nginx

Nginx is the classic reverse proxy — powerful, fast, but its configuration is verbose and HTTPS setup is a manual process involving Certbot and cron jobs.

Caddy does the same thing with dramatically less configuration. Its killer feature: **automatic HTTPS**. Caddy talks to Let's Encrypt on your behalf, gets a certificate, renews it before it expires, and does this all without any extra tooling. You don't think about TLS — it just works.

Here's the Caddyfile I run in production routing all five SouthernSky services:

```
blog.southernsky.cloud {
    reverse_proxy localhost:4006
}

chat.southernsky.cloud {
    reverse_proxy localhost:3000
}

admin.southernsky.cloud {
    reverse_proxy localhost:3840
}

southernsky.cloud {
    reverse_proxy localhost:4002
}

skymaxx.southernsky.cloud {
    reverse_proxy localhost:4000
}
```

That's it. Five domains, five services, automatic HTTPS, all in 15 lines. Caddy reads this file, requests certificates from Let's Encrypt for each domain, and starts proxying traffic.

Compare that to a minimal nginx equivalent — just for one site with manual HTTPS:

```nginx
server {
    listen 80;
    server_name blog.southernsky.cloud;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name blog.southernsky.cloud;

    ssl_certificate /etc/letsencrypt/live/blog.southernsky.cloud/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/blog.southernsky.cloud/privkey.pem;

    location / {
        proxy_pass http://localhost:4006;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

And you'd still need to run `certbot` separately and set up a cron job for renewal. Multiply that by five services.

## How TLS/HTTPS Actually Works Here

When a browser connects to `blog.southernsky.cloud`:

1. Browser connects to port 443 on `203.0.113.50`
2. Caddy presents its TLS certificate for `blog.southernsky.cloud`
3. Browser verifies the certificate was signed by a trusted CA (Let's Encrypt)
4. An encrypted tunnel is established
5. Inside the tunnel, the browser sends `GET / HTTP/2` with header `Host: blog.southernsky.cloud`
6. Caddy reads the `Host` header, matches it to `blog.southernsky.cloud`, forwards to port 4006
7. The blog container responds, Caddy forwards the response back

The backend service on port 4006 never needs to know about TLS. It just speaks plain HTTP internally. TLS is terminated at the proxy.

## Installing and Running Caddy

On Ubuntu/Debian:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

Write your Caddyfile to `/etc/caddy/Caddyfile`, then:

```bash
sudo systemctl reload caddy
```

Check it's running and certificates are active:

```bash
$ sudo systemctl status caddy
● caddy.service - Caddy
     Loaded: loaded (/lib/systemd/system/caddy.service; enabled)
     Active: active (running) since Tue 2026-03-10 14:22:11 UTC; 5 days ago
   Main PID: 1847 (caddy)
      Tasks: 10 (limit: 4915)
     Memory: 31.4M

$ curl -I https://blog.southernsky.cloud
HTTP/2 200
server: Caddy
content-type: text/html; charset=utf-8
```

## A Subtlety: Docker and Container Networking

When your backend services run in Docker or Podman containers, they're on a virtual network inside the server. `localhost` inside the Caddy process might not see the containers.

Fix this by using the Docker bridge gateway IP instead of `localhost`:

```bash
# Find the gateway IP
docker inspect <container_name> | grep Gateway

# Result
"Gateway": "172.17.0.1"
```

Then your Caddyfile uses that IP:

```
blog.southernsky.cloud {
    reverse_proxy 172.17.0.1:4006
}
```

This tripped me up the first time I deployed. Caddy was running, DNS was resolving, but I kept getting `502 Bad Gateway`. The proxy couldn't reach the container because it was looking at the wrong network interface.

## What You Learned

- A reverse proxy sits in front of multiple backend services and routes requests based on the domain name in the HTTP `Host` header
- One server with one IP can host dozens of separate services on distinct domains
- Caddy handles TLS automatically — it requests, stores, and renews certificates from Let's Encrypt
- TLS terminates at the proxy; backends speak plain HTTP internally
- When backends run in containers, use the Docker bridge gateway IP, not `localhost`
