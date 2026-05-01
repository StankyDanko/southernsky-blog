---
title: "What Is the Internet, Really? A Tour of the Cables Under Your Feet"
description: "The internet isn't a cloud — it's undersea cables, copper wires, and routers in your neighbor's yard. Here's what actually happens when you load a webpage."
publishDate: 2026-02-25
author: j-martin
tier: foundations
postType: explainer
difficulty: beginner
estimatedMinutes: 8
prerequisites: []
category: networking
tags: ["networking", "dns", "tcp-ip", "infrastructure", "how-the-internet-works"]
certTracks: ["comptia-a-plus", "comptia-network-plus"]
featured: false
heroImage: "/images/posts/what-is-the-internet-really.webp"
draft: false
---

## Why Should You Care?

Everyone uses the internet. Almost no one knows what it is.

My father runs a rural ISP. Growing up, I literally watched fiber get trenched into the ground and climbed telephone poles with him to run copper. I knew what "the internet" looked like before I knew what a web browser was. It's not a cloud. It's not magic. It's wires, boxes, and a surprisingly simple set of rules called protocols.

Once you see the physical reality, you'll debug network problems faster, understand why some websites are slower than others, and stop accepting "I don't know, the internet is down" as an explanation.

## The Physical Layer: It's Actually Cables

When you load a webpage, data travels over physical infrastructure. Most of it is fiber optic — glass strands that carry light pulses at close to the speed of light.

The hierarchy looks like this:

```
Your laptop (Wi-Fi)
    → Your router (ethernet)
        → Your ISP's equipment in a cabinet down the street
            → Regional network hub
                → Tier 1 backbone provider
                    → Undersea cables (if crossing oceans)
                        → Another Tier 1 backbone
                            → The server
```

Those undersea cables are real. There are hundreds of them crossing every ocean floor, carrying the majority of international internet traffic. You can explore the interactive map at submarinecablemap.com — it's one of the more humbling things you can look at.

Closer to home, my dad's ISP owns the last mile: the fiber or copper that runs from the regional network to your house. That's the part most people never think about, but it's where most outages actually happen — a backhoe cuts a line, a router fails, a splice gets wet.

## How Data Moves: TCP/IP in Plain English

The internet runs on a protocol stack called TCP/IP. Two layers matter most at this level:

**IP (Internet Protocol)** — Every device gets an address. Your laptop is something like `192.168.1.5` on your local network. The web server you're connecting to might be `203.0.113.50`. IP handles routing: getting packets from one address to another across many hops.

**TCP (Transmission Control Protocol)** — TCP ensures reliable delivery. It breaks your request into numbered packets, sends them, and requires the other side to confirm receipt. If a packet gets lost, TCP resends it. This is why a big file download doesn't silently corrupt — TCP catches the missing pieces.

A quick mental model: IP is the postal system (addresses and routing), TCP is a delivery confirmation service (sign here, resend if lost).

## DNS: The Phone Book Nobody Talks About

You type `google.com`. Your computer doesn't know where that is. It asks a DNS server.

DNS (Domain Name System) translates human-readable names into IP addresses. Without it, you'd have to memorize `142.250.80.46` to visit Google.

Here's what actually happens in under 100 milliseconds:

1. Your browser checks its local cache — has it looked up `google.com` recently?
2. Your OS checks its cache
3. If not cached, your router's DNS resolver gets asked
4. That resolver asks a Root nameserver — the top of the hierarchy
5. The Root says "for `.com`, go ask this server"
6. That server says "for `google.com`, go ask Google's nameserver"
7. Google's nameserver returns the IP address
8. The answer gets cached everywhere along the way

You can watch this happen live:

```bash
$ dig google.com +trace

; <<>> DiG 9.18.28 <<>> google.com +trace
;; QUESTION SECTION:
;google.com.			IN	A

.			86400	IN	NS	a.root-servers.net.
.			86400	IN	NS	b.root-servers.net.
;; Received 1097 bytes from 127.0.0.53#53(127.0.0.53) in 0 ms

com.			172800	IN	NS	a.gtld-servers.net.
;; Received 1169 bytes from 198.41.0.4#53(a.root-servers.net) in 11 ms

google.com.		172800	IN	NS	ns1.google.com.
;; Received 772 bytes from 192.5.6.30#53(a.gtld-servers.net) in 15 ms

google.com.		300	IN	A	142.250.80.46
;; Received 55 bytes from 216.239.32.10#53(ns1.google.com) in 12 ms
```

Read that output bottom-up: it traced the entire chain from root servers down to Google's own nameserver before returning the final IP.

## Traceroute: Seeing Every Hop

When a webpage is slow, the problem is somewhere between you and the server. `traceroute` shows you every router your packets pass through and how long each hop takes.

```bash
$ traceroute blog.southernsky.cloud

traceroute to example-blog.cloud (203.0.113.50), 30 hops max, 60 byte packets
 1  192.168.1.1 (192.168.1.1)            1.2 ms   1.1 ms   1.0 ms
 2  10.0.0.1 (10.0.0.1)                  8.4 ms   8.1 ms   8.3 ms
 3  isp-regional.example (198.51.100.1)  12.1 ms  11.9 ms  12.2 ms
 4  core-router-01.example (198.51.100.5)      15.3 ms  15.1 ms  15.4 ms
 5  exchange-southeast.example (198.51.100.12) 22.7 ms  22.5 ms  22.6 ms
 6  datacenter-gw.example (198.51.100.20)      24.1 ms  23.9 ms  24.0 ms
 7  203.0.113.50 (203.0.113.50)            24.8 ms  24.6 ms  24.7 ms
```

Seven hops. Hop 1 is my router. Hop 2 is my ISP's first device. Hops 3-6 are the backbone — regional routers, internet exchanges, datacenter gateways. Hop 7 is the destination. Total latency: 24ms.

If hop 4 suddenly showed 300ms, I'd know the problem is in the backbone — not on my end, not on the server's end.

## What "The Cloud" Actually Is

Hosting companies like AWS, DigitalOcean, and Vultr own enormous data centers — warehouses filled with servers connected to massive network pipes. When you pay for a VPS (Virtual Private Server), you're renting a slice of one of those physical machines.

The server running this blog is a VPS at `203.0.113.50`. It's a real machine in a data center. When you load this page:

1. Your browser looks up `blog.southernsky.cloud` via DNS → gets `203.0.113.50`
2. TCP connection opens between your IP and `203.0.113.50` on port 443 (HTTPS)
3. TLS handshake encrypts the connection
4. Your browser sends an HTTP GET request for the page
5. The server sends back HTML, CSS, JavaScript
6. Your browser renders it

The whole round trip is typically 20-50ms within the same country.

## What You Learned

- The internet is physical infrastructure: fiber, copper, undersea cables, and routers in cabinets
- TCP/IP is two layers: IP handles addressing and routing, TCP handles reliable delivery
- DNS translates domain names to IP addresses through a hierarchical chain of servers
- `traceroute` shows every network hop between you and a server, with latency at each step
- "The cloud" is real hardware — servers in data centers you can ping and trace routes to
