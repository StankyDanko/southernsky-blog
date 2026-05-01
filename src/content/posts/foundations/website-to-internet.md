---
title: "How a Website Gets from Your Computer to the Internet"
description: "This blog went from code on my laptop to a live website in 60 seconds. Here's every step of that journey — from build to deploy."
publishDate: 2026-05-01
author: j-martin
tier: foundations
postType: explainer
difficulty: beginner
estimatedMinutes: 9
prerequisites: []
category: devops
tags: ["deployment", "hosting", "dns", "containers"]
heroImage: "/images/posts/website-to-internet.webp"
featured: false
draft: false
---

## Why Should You Care?

You built something. Maybe it's a personal site, a portfolio, a small app. It looks great on your laptop. Your browser says `localhost:3000` and everything works.

Now what?

This is the moment most tutorials skip. They show you how to write code, how to style it, maybe even how to add a database. But the question "how does this actually get on the internet so other people can see it?" gets waved away with a vague mention of "deploy to the cloud." As if your code just floats upward and lands somewhere.

It doesn't float. There's a real path from your computer to the internet, and every step has a purpose. I know this because I walk that path regularly. This very blog — the page you're reading right now — went from code on my workstation to a live website at `blog.southernsky.cloud` through a sequence I can show you in full. No magic, no hand-waving.

Let's trace the entire journey.

## Step 1: Writing the Code

Every website starts as files on someone's computer. HTML, CSS, JavaScript, images, config files. In my case, this blog is built with a tool called Astro, which lets me write posts in Markdown (like a text file with simple formatting) and generates a static website from them.

The word "static" just means the output is a set of ready-to-go HTML files. There's no database query happening when you load a page. The server doesn't run any code on demand — it just hands you a pre-built file. That makes static sites fast and simple to host.

Here's the thing to remember at this stage: right now, the website only exists on my machine. If I turned off my computer, it would disappear. Nobody else can see it. The URL `localhost:3000` literally means "this computer, port 3000." It's a conversation my laptop is having with itself.

## Step 2: Building the Site

Before the code can go anywhere, it needs to be compiled. "Compiled" just means transformed from the format I write in to the format a web browser expects.

I write in Astro components and Markdown. Browsers don't speak those languages. So I run a build command:

```bash
npm run build
```

This reads all my source files, processes them, and outputs a folder called `dist/` full of plain HTML, CSS, and JavaScript. That `dist/` folder is the finished product — the version that's ready for the real world.

Think of it like this: you write a book as a manuscript with notes, cross-references, and editor comments. The build step is the printing press. It takes your messy creative work and produces clean, finished pages that a reader can pick up and read.

If you looked inside my `dist/` folder after building, you'd see files like `index.html`, `blog/index.html`, folders full of optimized CSS, and compressed JavaScript. No Markdown. No Astro. Just the web-standard files that every browser on earth already knows how to render.

## Step 3: Packing It in a Container

Now I have a folder of files. I could upload them directly to a server and configure a web server to serve them. But that introduces a problem: the server needs to have the right software installed, configured the right way, in the right directories. If I ever set up a second server, I'd have to do it all again. And if the server already has other software running, things might conflict.

Instead, I pack everything into a **container**. If you've read my post on containers, you know the analogy: it's a sealed box that includes the app and everything it needs to run. No dependencies on what the server already has installed.

Here's the actual Dockerfile for this blog — this is the real one, not a simplified example:

```dockerfile
FROM nginx:alpine
COPY dist/ /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
```

Five lines. Let me walk through them:

- **`FROM nginx:alpine`** — Start with a minimal Linux system that already has a web server called nginx installed.
- **`COPY dist/`** — Take my built website files and put them where nginx expects to find them.
- **`COPY nginx.conf`** — Add my custom configuration (things like "listen on port 3000" and "handle missing pages gracefully").
- **`EXPOSE 3000`** — Document that this container listens on port 3000.
- **`CMD`** — When the container starts, run nginx.

Now I build the container image:

```bash
podman build -t southernsky-blog:latest .
```

This produces a container image — a frozen snapshot of my blog plus the web server, sealed together. I can run this image on any machine that has a container runtime, and it will behave identically. My blog is no longer tied to my laptop.

## Step 4: Shipping It to the Server

Here's where things get physical. I have a container image on my workstation in Georgia. I need it on a server — a real computer in a data center — that's connected to the internet 24/7.

The process is surprisingly low-tech. I export the container image to a compressed file, then copy that file to the server over the network:

```bash
# Export the image to a compressed file
podman save southernsky-blog:latest | gzip > /tmp/southernsky-blog.tar.gz

# Copy it to the server
scp /tmp/southernsky-blog.tar.gz deploy@203.0.113.50:/tmp/
```

That `scp` command is "secure copy." It works like dragging a file to a remote computer, encrypted the whole way. The IP address `203.0.113.50` is my server's address — its permanent location on the internet.

The compressed image is usually between 20-50MB. It takes a few seconds to transfer. Once it arrives on the server, the image file is sitting in the server's `/tmp/` directory, waiting to be unpacked and launched.

## Step 5: Loading and Launching

Now I'm on the server side. The image file arrived. Time to unpack it and start the container:

```bash
# Load the image into Docker
gunzip -c /tmp/southernsky-blog.tar.gz | docker load

# Stop and remove the old version (if one is running)
docker stop southernsky-blog
docker rm southernsky-blog

# Launch the new version
docker run -d --name southernsky-blog --restart unless-stopped -p 4006:3000 southernsky-blog:latest
```

That last line is the moment the website comes alive. Let me break it down:

- **`docker run -d`** — Run the container in the background (detached).
- **`--name southernsky-blog`** — Give it a human-readable name so I can manage it later.
- **`--restart unless-stopped`** — If the server reboots, automatically restart this container. The blog stays up without babysitting.
- **`-p 4006:3000`** — Map port 4006 on the server to port 3000 inside the container. The container thinks it's listening on 3000, but the outside world reaches it through 4006.

Why port 4006 and not port 3000? Because I run multiple websites on this same server. Each one gets its own port. My company landing page might use 4001, my e-commerce site 4000, my AI chat platform has its own port. They're all separate containers, each sealed off from the others, sharing one physical machine.

At this point, if you typed `http://203.0.113.50:4006` into a browser, you'd see this blog. It's live. But that's an ugly URL. Nobody wants to memorize an IP address and a port number. That's where DNS comes in.

## Step 6: DNS — How People Actually Find It

DNS stands for Domain Name System. It's the phone book of the internet.

When you type `blog.southernsky.cloud` into your browser, your computer doesn't know where that is. It asks a DNS server: "What IP address does `blog.southernsky.cloud` point to?" The DNS server responds: `203.0.113.50`. Your browser connects to that IP address.

Setting up DNS means creating a record that says "when someone asks for `blog.southernsky.cloud`, send them to `203.0.113.50`." I do this through the company that manages my domain name. It's like adding an entry to a global phone book: "SouthernSky Blog — call this number."

But there's one more piece. My server runs a **reverse proxy** called Caddy that sits in front of all my containers. When a request comes in for `blog.southernsky.cloud`, Caddy looks at the hostname and routes it to port 4006 — where the blog container is listening. A request for `southernsky.cloud` gets routed to a different port, a different container, a different website. One server, many sites, one IP address.

Caddy also handles HTTPS — the padlock icon you see in your browser's address bar. It automatically gets a security certificate so the connection between your browser and the server is encrypted. No extra setup on my part.

```
You type: blog.southernsky.cloud
    → DNS resolves to 203.0.113.50
        → Caddy receives the request, sees the hostname
            → Routes to port 4006
                → nginx inside the container serves the page
                    → You see the blog
```

That's the full chain. Six hops from your keyboard to this page.

## The Whole Pipeline in 60 Seconds

Here's what actually happens when I deploy a new version of this blog. All of this is automated in a single script called `deploy.mjs`:

```
Step 1: npm run build
        Compiles Astro + Markdown → HTML/CSS/JS in dist/

Step 2: podman build
        Packs dist/ + nginx into a container image

Step 3: podman save | gzip
        Exports the image to a compressed file

Step 4: scp
        Copies the file to the server over the network

Step 5: docker load + docker run
        Unpacks and launches the container on the server
```

I type `node deploy.mjs`, walk to the kitchen, and by the time I come back, the new version is live. The deploy script runs each step in sequence, prints progress, and does a health check at the end to confirm the site is responding.

This post you're reading? It went through that exact pipeline. I wrote it in Markdown, ran the deploy script, and it traveled from my workstation to the server to your screen. The process this post describes is the process that delivered this post to you. That's not a metaphor — it's literally what happened.

## Why Not Just Use a Hosting Platform?

You might be wondering: why go through all this when services like Netlify, Vercel, or GitHub Pages exist? Those platforms handle building, hosting, DNS, and HTTPS for you. You push code and it appears on the internet.

Those services are great, especially when you're starting out. I recommend them. But here's what you gain by understanding the manual process:

**You understand what those platforms are doing for you.** Netlify isn't magic. Behind the scenes, it's running a build command, putting the output in a container (or something like one), and serving it from a server with DNS and HTTPS. When something breaks, understanding these layers helps you diagnose it.

**You can run anything.** Hosting platforms support popular frameworks. But what if you need a custom server, a database, a websocket connection, an AI model? When you control the server, you control everything.

**You learn infrastructure.** Deploying your own site teaches you networking, Linux, security, DNS, containers — skills that apply to every engineering job. The person who understands how the plumbing works will always have an advantage over the person who only knows how to turn the faucet.

## A Mental Model to Take With You

Here's how to think about the journey from code to the internet:

```
Your Computer                The Internet
┌───────────────┐            ┌───────────────┐
│  Source Code   │            │   DNS Server   │
│  (Markdown,   │            │  "blog.south-  │
│   HTML, JS)   │            │  ernsky.cloud   │
│       │       │            │  = 203.0.113..."│
│       ▼       │            └───────┬───────┘
│   Build Step  │                    │
│  (npm run     │            ┌───────▼───────┐
│   build)      │            │    Server      │
│       │       │            │  (VPS in a     │
│       ▼       │            │   data center) │
│  Container    │ ──ship──▶  │       │        │
│  Image        │            │  ┌────▼─────┐  │
│  (sealed box) │            │  │ Container │  │
└───────────────┘            │  │ (your app │  │
                             │  │  running) │  │
                             │  └──────────┘  │
                             └───────────────┘
```

**Build** transforms your code into something deployable. **Container** packages it so it runs the same everywhere. **Ship** moves it to a server. **DNS** makes it findable by name. **HTTPS** makes it secure.

That's it. Every website on the internet, from a personal blog to a billion-dollar platform, follows some version of this pattern. The tools change, the scale changes, but the shape is always the same: code on a computer, built, packaged, shipped to a server, and made findable by a name.

## What You Learned

- A website starts as files on your computer that only you can see
- Building compiles source code into browser-ready HTML, CSS, and JavaScript
- Containers package your app with its server so it runs identically anywhere
- Shipping means copying the container image to a server that's always online
- DNS translates human-readable names (like `blog.southernsky.cloud`) to IP addresses
- A reverse proxy like Caddy routes requests to the right container and handles HTTPS
- The entire deploy pipeline can run in a single script in under 60 seconds

The next time you visit a website, you'll know what happened behind the scenes. Someone wrote code, built it, packed it, shipped it to a server, and pointed a name at it. The internet isn't a cloud. It's a series of very deliberate steps, and now you know every one of them.
