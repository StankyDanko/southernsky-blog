---
title: "What Is Encryption and Why Should You Care?"
description: "Every password, every purchase, every private message depends on encryption. Here's how it works — explained with lockboxes, not math textbooks."
publishDate: 2026-05-01
author: j-martin
tier: foundations
postType: explainer
difficulty: beginner
estimatedMinutes: 9
prerequisites: []
category: cybersecurity
tags: ["encryption", "security", "hashing", "https"]
heroImage: "/images/posts/what-is-encryption.webp"
featured: false
draft: false
---

## You Already Depend on It

You send messages, buy things online, log into apps. Every single one of those actions depends on encryption — but what IS it?

Most people hear "encryption" and picture hackers in dark rooms or government surveillance. The reality is much more mundane and much more important. Encryption is the reason your credit card number doesn't get stolen every time you buy something on Amazon. It's the reason your texts aren't readable by everyone between you and the person you're texting. It's the reason you can log into your bank account without someone else doing it first.

Encryption is the invisible lock on nearly everything you do online. And understanding how it works — even at a high level — makes you a more capable, more confident user of technology.

Let's break it down. No math textbooks. Just lockboxes.

## The Lockbox Analogy

Imagine you need to send a secret message to a friend across the country. You can't hand it to them directly. It has to travel through the postal system, where anyone could theoretically open the envelope and read it.

So instead of an envelope, you put the message in a **lockbox**. A metal box with a padlock. Even if someone intercepts the box, they can't read the message without the key.

That's encryption. You take readable information (the message), transform it into something unreadable (the locked box), and only someone with the right key can transform it back.

The readable version is called **plaintext**. The scrambled version is called **ciphertext**. The process of locking is **encryption**. The process of unlocking is **decryption**. And the thing that controls both is the **key**.

Everything else in this post is just variations on that idea.

## Symmetric Encryption: One Key for Both Sides

The simplest version: you and your friend both have a copy of the same key. You lock the box with your key. They unlock it with their identical key.

This is **symmetric encryption**. Same key locks and unlocks.

It's fast and efficient. When you encrypt a file on your computer with a password, that's symmetric encryption. The password generates a key. That key encrypts the file. Later, the same password regenerates the same key and decrypts the file.

The most common symmetric algorithm today is **AES** (Advanced Encryption Standard). Your phone uses it. Your laptop uses it. When you connect to your bank's website, AES is doing the heavy lifting for the actual data transfer.

Here's the catch: you and the other person both need the same key. If you're standing in the same room, you can hand it over. But what if you're on opposite sides of the internet? How do you send someone a key without someone else intercepting it?

Sending the key over the same channel you're trying to protect is like mailing the lockbox key in the same envelope as the lockbox. If someone intercepts the package, they get both.

This is called the **key distribution problem**, and it's the reason symmetric encryption alone isn't enough for the internet.

## Asymmetric Encryption: A Lock Anyone Can Close

Here's where it gets clever.

Imagine a different kind of lockbox. This one has a special padlock with two keys:
- A **public key** that can only **lock** the box (but not unlock it)
- A **private key** that can only **unlock** the box (but not lock it)

You give copies of the public key to everyone. Post it on a billboard. Email it to the world. It doesn't matter — all it can do is lock boxes. Only you have the private key that opens them.

If someone wants to send you a secret message, they grab your public key (it's right there on the billboard), lock the box, and send it. Even if every postal worker along the route has a copy of your public key, none of them can open the box. Only your private key can do that.

This is **asymmetric encryption**. Two different keys, each with a different job.

The most common asymmetric algorithm is **RSA**, though newer systems use **elliptic curve cryptography** (ECC), which achieves the same security with smaller keys. You don't need to remember those names right now. The concept is what matters: public key locks, private key unlocks.

Asymmetric encryption solves the key distribution problem. You never have to send your private key anywhere. It never leaves your machine. The public key can travel in the open because knowing it doesn't help an attacker open anything.

## How They Work Together

In practice, most secure communication uses both.

Asymmetric encryption is slower than symmetric. It's great for exchanging small pieces of information, but you wouldn't want to encrypt an entire video call with it. So real-world systems do something smart:

1. Use asymmetric encryption to safely exchange a symmetric key
2. Use that symmetric key for the actual data transfer

When you connect to a website over HTTPS (we'll get to that in a moment), your browser and the server do a quick asymmetric handshake to agree on a shared symmetric key. Then all the actual data — the web pages, the images, your login credentials — flows back and forth encrypted with that fast symmetric key.

Best of both worlds. The security of asymmetric key exchange. The speed of symmetric data encryption.

## Hashing: The One-Way Fingerprint

Hashing isn't encryption, but it shows up in so many of the same conversations that it belongs here.

Encryption is a two-way process. You encrypt data, then decrypt it to get the original back. Hashing is **one-way**. You put data in, you get a fixed-size fingerprint out, and there's no way to reverse it back to the original data.

Think of it like a blender. You put in a banana, some strawberries, and yogurt. You get a smoothie. You can look at the smoothie, but you can't un-blend it back into a banana, strawberries, and yogurt. The smoothie is a unique result of those specific inputs — change one ingredient and you get a different smoothie.

A hash function works the same way. Give it any input — a password, a file, an entire novel — and it produces a fixed-length string of characters. The same input always produces the same output. But even a tiny change to the input produces a completely different output.

Here's a real example. SHA-256 is a common hash function. If you hash the word "hello":

```
"hello" → 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
```

Change one letter to "Hello" (capital H):

```
"Hello" → 185f8db32271fe25f561a6fc938b2e264306ec304eda518007d1764826381969
```

Completely different output. No pattern. No way to predict one from the other. And no way to work backward from the hash to figure out the original word.

## Where Hashing Shows Up

**Password storage.** When you create an account on a well-built website, they don't store your actual password. They store a hash of your password. When you log in, they hash what you typed and compare it to the stored hash. If they match, you're in. If someone steals the database, they get hashes — not passwords. They can't reverse them.

**File integrity.** If you download a piece of software, the developer might publish a hash alongside it. You download the file, hash it yourself, and compare. If the hashes match, the file hasn't been tampered with. If they don't match, something changed in transit.

**Deduplication.** This is one I use in my own projects. I work with a media management system that handles thousands of photos and videos. When a new file comes in, the system computes its hash using an algorithm called BLAKE3. If that hash already exists in the database, the file is a duplicate — skip it. If it's new, store it. The hash becomes the file's unique fingerprint, and BLAKE3 is fast enough to hash multi-gigabyte video files in seconds. No need to compare files byte by byte.

Modern hash algorithms you'll encounter: **SHA-256** (widely used, the workhorse), **BLAKE3** (extremely fast, great for file processing), and **bcrypt/Argon2** (specifically designed for password hashing — intentionally slow, which makes brute-force attacks harder).

## Try It Yourself

You don't need special software to experiment with encryption and hashing. If you have a Mac or Linux terminal (or Windows with WSL), you already have the tools.

**Hash a string with SHA-256:**

```bash
echo -n "hello" | sha256sum
```

The `-n` tells `echo` not to add a newline at the end (which would change the hash). You'll get:

```
2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
```

Try it with "Hello" (capital H) and watch the entire hash change.

**Encrypt and decrypt a message with AES:**

```bash
# Encrypt — it will ask you for a password
echo "this is my secret message" | openssl enc -aes-256-cbc -pbkdf2 -base64

# Decrypt — enter the same password
echo "U2FsdGVkX1..." | openssl enc -aes-256-cbc -pbkdf2 -base64 -d
```

Replace `U2FsdGVkX1...` with the actual output from the first command. Use the same password for both. You'll get your original message back. If you use the wrong password, you'll get garbage — which is exactly the point.

**Generate an asymmetric key pair:**

```bash
# Generate a private key
openssl genpkey -algorithm RSA -out private.pem -pkeyopt rsa_keygen_bits:2048

# Extract the public key from it
openssl rsa -pubout -in private.pem -out public.pem
```

Now you have two files: `private.pem` (keep secret) and `public.pem` (share freely). This is the same concept your SSH keys use, the same concept HTTPS certificates use. Real cryptographic keys, generated in two commands.

## HTTPS: The Lock Icon in Your Browser

That padlock icon in your browser's address bar? That's encryption in action.

When you visit a website that starts with `https://`, your browser and the server go through a process called a **TLS handshake** (Transport Layer Security). Here's what happens in simplified terms:

1. Your browser says "I want to connect securely" and sends a list of encryption methods it supports
2. The server responds with its **certificate** — a document that includes the server's public key and is signed by a trusted authority (a Certificate Authority, or CA)
3. Your browser verifies the certificate is legitimate
4. They use asymmetric encryption to agree on a shared symmetric key
5. All data flows encrypted with that symmetric key

Every web page you load, every form you submit, every image that appears — it's all encrypted in transit. Anyone watching the network traffic sees scrambled data. They know you're communicating with a server, but they can't read what's being said.

This is why you should pay attention to that lock icon. If a site is still on plain `http://` (no 's'), everything between you and the server travels in the open.

## SSH Keys: Logging In Without a Password

If you've ever connected to a remote server, you might have used SSH (Secure Shell). SSH supports password login, but the better approach is **key-based authentication** — and now you know the concept behind it.

You generate an asymmetric key pair on your local machine. Your public key gets copied to the server. When you connect, the server uses your public key to create a challenge that only your private key can answer. If the response checks out, you're in. No password transmitted over the network. No password to be guessed or stolen.

I use SSH keys to connect to every server I manage. The private key never leaves my workstation. The public key sits on each server, waiting. It's the same billboard-and-lockbox principle from earlier, applied to authentication instead of message passing.

## How I Use This Every Day

This isn't abstract for me. Encryption and hashing are part of my daily workflow:

**Encrypted key files.** I work with several AI APIs — services that require secret keys to authenticate. Those keys live in an encrypted file on my workstation, not in plaintext scattered across project directories. One file, locked down with strict permissions. My scripts read from it; the keys never end up in version control, chat logs, or anywhere they don't belong.

I'm actually building a tool called **pman** that takes this further — an encrypted vault where AI coding agents can use credentials without ever seeing the actual secret values. The agent knows the name of the key, like `GROK_API_KEY`, but the actual key is decrypted inside a separate process. The agent never touches the plaintext. It's the lockbox principle applied to software development.

**File deduplication with BLAKE3.** I mentioned this earlier — my media management system hashes every incoming file to detect duplicates. BLAKE3 processes multi-gigabyte files at multi-gigabyte-per-second speeds, making it practical to hash everything as it arrives. The hash becomes each file's identity. Same hash, same file, skip the duplicate.

**SSH keys for server access.** Every deployment I do — pushing this blog to its server, managing AI services, transferring files — happens over SSH with key-based authentication. No passwords flying across the network.

**HTTPS everywhere.** Every web application I deploy sits behind HTTPS. The certificates get managed automatically, but the principle is the same TLS handshake described above.

## What Encryption Doesn't Do

It's worth being clear about limits.

Encryption protects data **in transit** (while it's moving across a network) and **at rest** (while it's sitting on a disk). It doesn't protect data while it's being used. When you decrypt a file to read it, the decrypted version exists in your computer's memory. When a server processes your credit card number, it's briefly in plaintext inside the server's application.

Encryption also doesn't verify identity by itself. Just because a message is encrypted doesn't mean it came from who you think. That's where digital signatures and certificates come in — topics for another post.

And encryption is only as strong as the key management. The most sophisticated encryption in the world doesn't help if the key is written on a sticky note attached to your monitor. Or stored in a plaintext file called `passwords.txt`. The math is solid. The weak link is almost always human.

## What You Learned

- **Encryption** transforms readable data into unreadable data using a key, and back again with the right key
- **Symmetric encryption** uses one key for both locking and unlocking — fast, but requires a secure way to share the key
- **Asymmetric encryption** uses a public key (locks) and private key (unlocks) — solves the key distribution problem
- **Real-world systems** combine both: asymmetric for key exchange, symmetric for data transfer
- **Hashing** is one-way — it creates a fingerprint of data that can't be reversed, used for passwords, file integrity, and deduplication
- **HTTPS** uses TLS to encrypt your web traffic, combining certificates, asymmetric handshakes, and symmetric data encryption
- **SSH keys** apply asymmetric cryptography to server authentication — no passwords over the network

Encryption isn't something that exists in some other world of cybersecurity professionals and three-letter agencies. It's running right now, in your browser, on your phone, inside every app you use. Now you know what it's doing.
