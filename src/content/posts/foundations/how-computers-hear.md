---
title: "How Computers Hear: The Science of Audio Classification"
description: "Your phone can name a song in seconds. Here's the science behind audio classification — from sound waves to neural networks — explained without equations."
publishDate: 2026-05-01
author: j-martin
tier: foundations
postType: explainer
difficulty: beginner
estimatedMinutes: 9
prerequisites: []
category: ai-ml
tags: ["audio", "machine-learning", "spectrograms", "classification"]
heroImage: "/images/posts/how-computers-hear.webp"
featured: false
draft: false
---

## The Question That Should Bother You

You're at a restaurant. A song is playing that you can't quite place. You pull out your phone, open Shazam, hold it up, and within three seconds you have the title, artist, and album art. You tap "Open in Spotify" and move on with your meal.

Three seconds. For a song out of the hundreds of millions that exist. How?

Or this: you say "Hey Siri, what's that bird?" and your phone listens to the chirping outside your window and tells you it's a Carolina Wren. Your phone just *listened to a bird* and *knew what kind it was*. That is genuinely wild when you stop and think about it.

These features feel like magic, but they run on real science — science that has been largely open-sourced and that anyone with a laptop can experiment with. This post walks through the entire pipeline, from physical vibrations in air to a label on your screen, without a single equation. Just intuition.

---

## Step 1: Sound Is Movement

Before we talk about computers, we need to talk about what sound actually is.

Sound is air molecules bumping into each other. When a guitar string vibrates, it pushes the air around it, which pushes the air around *that*, and the disturbance propagates outward like ripples in a pond. When those ripples hit your eardrum, your brain interprets the vibrations as sound.

Different sounds make different vibration patterns. A bass note makes slow, wide waves. A cymbal crash makes fast, tight ones. A human voice makes a complicated mixture of both, constantly changing shape. The *pattern* of the vibration is what makes a piano sound different from a trumpet, even when they play the same note.

Here's the key insight: **all sound is just a pattern of pressure changes over time.** And patterns are something computers are extremely good at recognizing.

---

## Step 2: Turning Air Into Numbers

Your phone's microphone is a small diaphragm that moves when air pressure hits it. An electrical circuit measures how far the diaphragm moves, and a chip converts that measurement into a number. It does this thousands of times per second.

The standard rate is 44,100 times per second — that's what CD-quality audio uses. Each measurement is called a **sample**. A one-second clip of CD-quality audio is 44,100 numbers in a row. A three-minute song is about 7.9 million numbers.

That's all a digital audio file is: a very long list of numbers that describe how air pressure changed over time. A WAV file is essentially a spreadsheet with millions of rows and one column.

If you've ever zoomed way in on a waveform in GarageBand, Audacity, or any audio editor, you've seen these numbers plotted out — that jagged line going up and down is the computer's version of what your ear hears. Zoom in far enough and you can see the individual samples as dots.

---

## Step 3: The Spectrogram — Sound You Can See

Here's where it gets interesting. Computers *could* try to classify audio by looking at that raw list of numbers, but it would be like trying to identify a painting by reading the RGB value of every pixel, one at a time, left to right. You'd have all the information, but none of the structure.

What we need is a way to see *which frequencies are present at each moment in time*. That's what a **spectrogram** is.

Imagine taking your audio recording and slicing it into tiny windows — maybe 25 milliseconds each, overlapping slightly. For each window, you ask: "What frequencies are present right now, and how loud is each one?" You line up all those answers next to each other, and you get a spectrogram.

A spectrogram is a picture. It looks like a heat map, and it reads like this:

- **The horizontal axis is time** — left to right, like reading a sentence
- **The vertical axis is frequency** — low notes at the bottom, high notes at the top
- **The brightness (or color) is volume** — brighter spots are louder frequencies

A single piano note looks like a bright horizontal line at the note's frequency, plus fainter lines above it at regular intervals (those are harmonics — they're what make a piano sound like a piano instead of a pure tone). A drum hit looks like a bright vertical splash across many frequencies at once — lots of energy, briefly, everywhere. Bird song looks like intricate curving swoops in the upper frequencies, almost like someone painting calligraphy. Human speech looks like stacked, shifting bands in the mid-range, constantly reshaping as vowels and consonants change.

Once you see a few spectrograms, you start to realize something: **different sounds have different visual signatures**. A dog bark looks nothing like a rainstorm. A car horn looks nothing like a violin. The spectrogram makes these differences visible.

And if *you* can see the difference, an image recognition neural network can learn to see it too.

---

## Step 4: Treating Sound as an Image Problem

This is the clever trick at the heart of modern audio classification: **turn sound into a picture, then use the same AI that classifies photos to classify sounds.**

The same type of neural network that looks at a photo and says "this is a cat" can look at a spectrogram and say "this is a dog barking." The architecture is called a **convolutional neural network** (CNN), and it works by scanning across an image looking for patterns — edges, curves, textures, shapes — and combining them into higher-level features.

In a photo classifier, a CNN might learn that:
- Certain edge patterns = whiskers
- Whiskers + pointed shapes + specific arrangement = cat face
- Cat face + body shape + tail = "cat"

In an audio classifier, the CNN learns equivalent patterns:
- Certain frequency bands + specific time patterns = bark formant
- Bark formant + energy envelope + repetition pattern = "dog barking"

The CNN doesn't know it's looking at a spectrogram instead of a photo. It just sees a 2D grid of values and finds patterns. That's the beauty of it — decades of computer vision research transfer directly to audio.

---

## Step 5: Training — How the Network Learns

A neural network doesn't come pre-loaded with the knowledge that a certain spectrogram pattern means "bird song." It learns this the same way you did: by hearing thousands of examples.

The training process works like this:

1. **Start with a huge labeled dataset.** Someone has already collected millions of audio clips and tagged each one: "this 10-second clip contains bird song," "this one contains a car engine," "this one contains rain."

2. **Convert each clip to a spectrogram.** Now you have millions of labeled pictures.

3. **Show the network a spectrogram and ask it to guess.** At first, it guesses randomly. It might look at a bird song spectrogram and say "chainsaw" with high confidence. It's wrong.

4. **Tell it how wrong it was.** The network adjusts its internal weights — millions of numbers that control how it processes the image — to be slightly less wrong next time.

5. **Repeat millions of times.** Gradually, the network's guesses get better. The internal weights settle into configurations that correctly map spectrogram patterns to labels. The network has *learned* what a bird sounds like, visually.

The largest dataset used for general audio classification is called **AudioSet**, created by Google. It contains over 2 million 10-second clips from YouTube, labeled across 527 categories — everything from "Speech" to "Thunder" to "Typewriter" to "Chicken, rooster" to "Skateboard." If you can think of a sound, AudioSet probably has a category for it.

Training a large CNN on AudioSet takes days of GPU time. But here's the good news: once someone trains it, they can share the trained weights as a file that anyone can download. You don't need to repeat the training. You just download the model, feed it a spectrogram, and get labels back.

---

## Step 6: Classification — Labels Come Out

Once the model is trained, using it is fast. The whole pipeline runs in under a second on modern hardware:

1. Load audio file
2. Resample to the frequency the model expects (usually 32kHz)
3. Generate a spectrogram
4. Pass the spectrogram through the neural network
5. Get back a list of 527 confidence scores — one for each AudioSet category

Each score is a probability between 0 and 1. A score of 0.85 for "Bird" means the model is 85% confident that bird sounds are present. A score of 0.02 for "Gunshot" means it's almost certain there's no gunshot.

You typically filter to the top 10 or so categories above some confidence threshold (say, 0.1) and throw away the rest. What you're left with is a concise description of the acoustic content: "This recording contains birds (85%), wind (42%), rustling leaves (39%), and insects (29%)."

That's classification. Audio in, labels out.

---

## Shazam Does Something Different (But Related)

Shazam isn't doing classification in the sense I just described. It's doing **fingerprinting** — a related but distinct technique. When Shazam listens to a song, it's not asking "what kind of sound is this?" It's asking "which *specific* recording is this?"

Shazam works by:

1. Generating a spectrogram of the audio you're recording
2. Finding the loudest frequency points at each moment in time — these are "peaks"
3. Creating pairs of peaks and hashing them into a compact fingerprint
4. Searching a massive database for a matching fingerprint

It's more like reverse image search than image classification. The spectrogram is still the key intermediate representation — Shazam just uses it differently. Instead of running it through a neural network that was trained on categories, it extracts distinctive landmarks and matches them against a database of known songs.

The reason I bring this up is that spectrograms are the lingua franca of audio AI. Whether you're identifying songs, classifying ambient sounds, transcribing speech, detecting whale calls, or separating instruments in a mix, the first step is almost always the same: turn the audio into a spectrogram.

---

## This Isn't Locked Up in Big Tech Labs

Here's what surprises most people: the models behind audio classification are open source. You can download them right now and run them on your own machine.

**PANNs** (Pretrained Audio Neural Networks) is a family of models from the University of Surrey, trained on the full AudioSet dataset. The research paper, the code, and the trained weights are all publicly available. The Cnn14 variant — a 14-layer convolutional network — is a 309MB download that classifies any audio into 527 categories. It runs on a consumer GPU in milliseconds, or on a CPU in under a second.

**YAMNet** is Google's equivalent, built on the MobileNet architecture for efficiency. It's smaller and faster than PANNs but covers a similar category set. It runs in TensorFlow and is available as a TF Hub module.

**BEATs** (from Microsoft) and **AST** (Audio Spectrogram Transformer, from MIT) are newer architectures that use transformers instead of CNNs — the same architecture behind GPT and other large language models, adapted for spectrograms.

The barrier to entry isn't access. The tools exist. The barrier is packaging — wrapping the raw model into something a regular person can use without writing a PyTorch data loader from scratch.

---

## What I Built With This

I found that gap frustrating enough to fill it. I built a tool called **Cairn** — a command-line sound classifier that takes an audio file and tells you what's in it. Bird song, traffic noise, rain, speech, wind, insects. A 13-minute field recording tags in about 5 seconds.

Under the hood, Cairn uses PANNs Cnn14 — the same open-source model I described above. The pipeline is exactly the steps from this post: load audio, generate spectrogram, pass through neural network, filter labels by confidence, write results to a JSON file.

The name comes from a walk in the woods where I found a turtle shell in the grass and balanced a stone on it without knowing the word for what I'd just done. A cairn is a stack of stones left as a trail marker. Cairn marks your audio files so you can find your way through hours of recordings without listening to all of them.

If you want the full technical walkthrough — the model architecture, the CLI interface, real JSON output from field recordings, batch processing patterns — there's a companion post in the Applied tier: [Audio Fingerprinting at Scale: Building a 5-Second Ambient Sound Classifier](/blog/cairn-ambient-sound-classifier).

---

## Why This Matters Beyond Music Apps

Audio classification is one of those technologies that sounds niche until you see the applications:

**Conservation biology.** Researchers place recorders in rainforests, coral reefs, and Arctic tundra. Audio classifiers monitor biodiversity by counting species calls over time without anyone having to sit and listen to months of recordings.

**Accessibility.** Apps like Google's Sound Notifications alert deaf and hard-of-hearing users when they detect doorbells, smoke alarms, baby crying, or knocking. That's an audio classifier running in real time on a phone.

**Medical diagnostics.** Researchers are training classifiers on cough recordings to screen for respiratory conditions. The spectrogram of a COVID-19 cough looks different from a healthy cough, and a model can learn that pattern.

**Smart homes.** Glass break detectors in security systems use audio classification to distinguish between a window shattering and a dish dropping. Same technique: spectrogram in, label out.

**Documentary production.** This is my use case. When you have 200 field recordings from a shoot and you need to find the ones with clean nature ambience versus urban noise, a classifier saves you days of manual listening.

The underlying science is the same across all of these: sound waves become digital samples become spectrograms become patterns a neural network can recognize. The only thing that changes is what you train the network to look for.

---

## What You Learned

Let's trace the full pipeline one more time:

1. **Sound is vibration** — pressure waves traveling through air
2. **Microphones convert vibration to electrical signals**, which get sampled into numbers (44,100 times per second for CD quality)
3. **Spectrograms reorganize those numbers** into a visual representation: time on one axis, frequency on the other, brightness for volume
4. **Convolutional neural networks** — the same architecture that classifies photos — can classify spectrograms by learning visual patterns that correspond to specific sounds
5. **Training on large datasets** (like AudioSet's 2 million clips across 527 categories) teaches the network what different sounds look like as spectrograms
6. **Inference is fast** — a trained model classifies audio in milliseconds, outputting confidence scores for every category it knows
7. **The models are open source** — PANNs, YAMNet, BEATs, and others are freely available for anyone to use

The next time your phone identifies a song or a bird call, you'll know what's happening under the hood: it's turning sound into a picture and asking a neural network what it sees.

That's how computers hear.
