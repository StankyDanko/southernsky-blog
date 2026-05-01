---
title: "Making a Game in the Browser with Just HTML and JavaScript"
description: "You don't need a game engine to make a game. Here's how to build one from scratch with just HTML, JavaScript, and a browser."
publishDate: 2026-05-01
author: j-martin
tier: foundations
postType: tutorial
difficulty: beginner
estimatedMinutes: 12
prerequisites: []
category: javascript-typescript
tags: ["javascript", "canvas", "game-dev", "beginner"]
heroImage: "/images/posts/browser-game.webp"
featured: false
draft: false
---

You don't need Unity or Unreal to make a game. You just need a browser.

That might sound like I'm overselling it, but think about what a browser already gives you. It has a built-in drawing surface (the `<canvas>` element). It has a built-in clock for animation (`requestAnimationFrame`). It has keyboard and mouse input wired up and ready to go. It can run JavaScript at 60 frames per second without breaking a sweat.

That's a game engine. It's just not branded as one.

In this post, we're going to build a complete game from scratch. No frameworks, no libraries, no npm install. One HTML file. By the end, you'll have a playable game running in your browser, and you'll understand the core loop that drives every game from Pong to Elden Ring.

## What We're Building

We're making a game called **Star Catcher**. Glowing stars fall from the top of the screen. You move a basket left and right to catch them. Every star you catch earns a point. Miss three, and the game ends. Stars fall faster as your score climbs.

It's simple enough to build in one sitting, but complex enough to teach you real game development patterns: a game loop, player input, spawning objects, collision detection, difficulty scaling, and game state management.

Let's start with the drawing surface.

## The Canvas Element

HTML has an element called `<canvas>`. It doesn't display anything on its own. It's a blank rectangle where JavaScript can draw shapes, images, and text pixel by pixel. Every browser-based 2D game starts here.

Create a file called `starcatcher.html` and add this:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Star Catcher</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0f172a;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      overflow: hidden;
    }
    canvas {
      border: 2px solid #334155;
      border-radius: 8px;
    }
  </style>
</head>
<body>
  <canvas id="game" width="480" height="640"></canvas>
  <script>
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');

    // Draw a test rectangle
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(200, 300, 80, 20);
  </script>
</body>
</html>
```

Open that file in your browser. You should see a dark screen with a blue rectangle sitting in the middle.

That rectangle is your future basket. The `ctx` object is the **rendering context** — it's the paintbrush. Every shape, every piece of text, every frame of the game gets drawn through `ctx`. The two methods you just used, `fillStyle` and `fillRect`, set the color and draw a filled rectangle at position (x=200, y=300) with a width of 80 and height of 20.

One thing that trips people up: canvas coordinates start at the **top-left corner**. X increases to the right, Y increases **downward**. So y=0 is the top of the screen and y=640 is the bottom. Keep that in your head — it matters when things fall.

## The Game Loop

Right now, our rectangle just sits there. Games aren't static paintings — they need to update and redraw dozens of times per second. This is the **game loop**, and it's the heartbeat of every game ever made.

The pattern is always the same:

1. **Update** — move objects, check collisions, change state
2. **Draw** — clear the screen, redraw everything in its new position
3. **Repeat** — do it again, roughly 60 times per second

JavaScript has a function called `requestAnimationFrame` that handles step 3 for you. It calls your function right before the browser paints the next frame, which usually happens 60 times per second. It's smooth, efficient, and battery-friendly because the browser optimizes it automatically.

Replace the script section in your HTML with this:

```javascript
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let x = 200;

function update() {
  x += 1; // Move right every frame
}

function draw() {
  // Clear the entire canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw the rectangle at its new position
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(x, 300, 80, 20);
}

function gameLoop() {
  update();
  draw();
  requestAnimationFrame(gameLoop);
}

// Start the loop
gameLoop();
```

Refresh your browser. The rectangle slides across the screen and disappears off the right edge. That's your first animation. The loop calls `update` (which moves `x` one pixel to the right), then `draw` (which clears the canvas and redraws the rectangle at its new position), then schedules itself to run again on the next frame.

Clear, update, draw, repeat. That's the entire architecture. Everything else is just adding more stuff to the update and draw steps.

## Player Input

A sliding rectangle isn't a game. The player needs control. Let's make the basket follow keyboard input — left and right arrow keys, plus A and D for WASD players.

The approach: listen for `keydown` and `keyup` events, track which keys are currently held, and check those keys during the update step. This is better than moving the basket directly inside the event handler, because it keeps all movement logic in one place (the update function) and handles the case where a player holds a key down.

```javascript
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Track which keys are currently pressed
const keys = {};
window.addEventListener('keydown', e => keys[e.key] = true);
window.addEventListener('keyup', e => keys[e.key] = false);

// Player basket
const player = {
  x: 200,
  y: 600,
  width: 80,
  height: 16,
  speed: 6
};

function update() {
  // Move left
  if (keys['ArrowLeft'] || keys['a']) {
    player.x -= player.speed;
  }
  // Move right
  if (keys['ArrowRight'] || keys['d']) {
    player.x += player.speed;
  }
  // Keep inside canvas bounds
  if (player.x < 0) player.x = 0;
  if (player.x + player.width > canvas.width) {
    player.x = canvas.width - player.width;
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw the basket
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(player.x, player.y, player.width, player.height);
}

function gameLoop() {
  update();
  draw();
  requestAnimationFrame(gameLoop);
}

gameLoop();
```

Refresh, and press the arrow keys. The basket slides back and forth along the bottom of the screen. The `keys` object is a simple trick — it's a dictionary that records `true` when a key is pressed down and `false` when it's released. During each update, we check if movement keys are active and adjust the position accordingly.

The clamping at the end (`if player.x < 0`) prevents the basket from leaving the screen. Boundary checking like this is easy to forget, and forgetting it is how you get objects flying off into invisible space. Always clamp.

## Falling Stars

Now we need things to catch. Stars will spawn at random positions along the top of the canvas and fall downward. Each star is an object with an x, y, and a size. We'll store them in an array and add a new one every so often.

Add this to your code, above the `update` function:

```javascript
// Stars
const stars = [];
let spawnTimer = 0;
let spawnInterval = 60; // frames between spawns (starts at 1 per second)

function spawnStar() {
  stars.push({
    x: Math.random() * (canvas.width - 16) + 8,
    y: -16,
    size: 16,
    speed: 2 + Math.random() * 1.5
  });
}
```

Then update the `update` and `draw` functions:

```javascript
function update() {
  // Player movement (same as before)
  if (keys['ArrowLeft'] || keys['a']) player.x -= player.speed;
  if (keys['ArrowRight'] || keys['d']) player.x += player.speed;
  if (player.x < 0) player.x = 0;
  if (player.x + player.width > canvas.width) {
    player.x = canvas.width - player.width;
  }

  // Spawn stars on a timer
  spawnTimer++;
  if (spawnTimer >= spawnInterval) {
    spawnStar();
    spawnTimer = 0;
  }

  // Move stars downward
  for (let i = stars.length - 1; i >= 0; i--) {
    stars[i].y += stars[i].speed;

    // Remove stars that fall off screen
    if (stars[i].y > canvas.height + 20) {
      stars.splice(i, 1);
    }
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw stars
  ctx.fillStyle = '#facc15';
  for (const star of stars) {
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.size / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw the basket
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(player.x, player.y, player.width, player.height);
}
```

Refresh. Yellow circles rain down from the sky and the basket slides beneath them. We're drawing stars as circles using `ctx.arc`, which takes a center point, a radius, and an angle range (0 to 2*PI for a full circle). The backward `for` loop in the update step (`for (let i = stars.length - 1; i >= 0; i--)`) is important — when you remove items from an array while iterating, you need to go backwards or you'll skip elements.

## Collision Detection

Stars are falling, the basket is moving, but nothing happens when they meet. We need collision detection — and for rectangle-based games like this, the algorithm is surprisingly simple.

Two rectangles overlap when all four of these conditions are true:

- Rectangle A's left edge is to the left of Rectangle B's right edge
- Rectangle A's right edge is to the right of Rectangle B's left edge
- Rectangle A's top edge is above Rectangle B's bottom edge
- Rectangle A's bottom edge is below Rectangle B's top edge

If any one of those conditions is false, the rectangles don't overlap. Here's that logic as a function:

```javascript
function collides(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
```

Since our stars are circles, we'll treat them as squares for collision purposes (using the star's size as both width and height). This is called an **axis-aligned bounding box** — AABB for short. It's not pixel-perfect, but it's fast, simple, and good enough for the vast majority of 2D games.

Now update the star movement section inside `update` to check for catches:

```javascript
// Game state
let score = 0;
let misses = 0;
const maxMisses = 3;
let gameOver = false;
```

And replace the star loop in `update` with:

```javascript
// Move stars and check collisions
for (let i = stars.length - 1; i >= 0; i--) {
  stars[i].y += stars[i].speed;

  // Create a bounding box for the star (circle → square)
  const starBox = {
    x: stars[i].x - stars[i].size / 2,
    y: stars[i].y - stars[i].size / 2,
    width: stars[i].size,
    height: stars[i].size
  };

  // Check if the star hits the basket
  if (collides(starBox, player)) {
    score++;
    stars.splice(i, 1);
    continue;
  }

  // Star fell off the bottom
  if (stars[i].y > canvas.height + 20) {
    misses++;
    stars.splice(i, 1);
    if (misses >= maxMisses) {
      gameOver = true;
    }
  }
}
```

## Drawing the Score and Game Over

The game is tracking score and misses now, but the player can't see them. Let's add a HUD (heads-up display) and a game-over screen.

Update the `draw` function:

```javascript
function draw() {
  // Background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (gameOver) {
    // Game over screen
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 30);

    ctx.font = '20px sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Score: ' + score, canvas.width / 2, canvas.height / 2 + 10);
    ctx.fillText('Press R to restart', canvas.width / 2, canvas.height / 2 + 50);
    return;
  }

  // Draw stars
  ctx.fillStyle = '#facc15';
  for (const star of stars) {
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.size / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw the basket
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(player.x, player.y, player.width, player.height);

  // Draw HUD
  ctx.fillStyle = '#f8fafc';
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Score: ' + score, 16, 30);

  ctx.textAlign = 'right';
  ctx.fillStyle = misses >= 2 ? '#ef4444' : '#94a3b8';
  ctx.fillText('Misses: ' + misses + ' / ' + maxMisses, canvas.width - 16, 30);
}
```

And wrap the update step so it stops when the game ends:

```javascript
function update() {
  if (gameOver) return;

  // ... rest of update logic
}
```

## Restart and Difficulty Scaling

Two more things and we have a real game. First, restarting — add an event listener for the R key:

```javascript
window.addEventListener('keydown', e => {
  keys[e.key] = true;
  if (e.key === 'r' && gameOver) {
    restartGame();
  }
});

function restartGame() {
  score = 0;
  misses = 0;
  gameOver = false;
  stars.length = 0;
  spawnTimer = 0;
  spawnInterval = 60;
  player.x = 200;
}
```

Second, difficulty scaling. The game should get harder as you score more points. A simple approach: decrease the spawn interval so stars appear more frequently.

Add this to the end of the `update` function:

```javascript
// Increase difficulty as score rises
spawnInterval = Math.max(20, 60 - score * 2);
```

At score 0, a new star spawns every 60 frames (once per second). At score 10, it's every 40 frames. It floors at 20 frames — three stars per second — so the game doesn't become literally impossible.

## The Complete Game

Here's the whole thing in one file. Copy it, save it as `starcatcher.html`, and open it in your browser.

```html
<!DOCTYPE html>
<html>
<head>
  <title>Star Catcher</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0f172a;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      overflow: hidden;
      font-family: sans-serif;
    }
    canvas {
      border: 2px solid #334155;
      border-radius: 8px;
    }
  </style>
</head>
<body>
  <canvas id="game" width="480" height="640"></canvas>
  <script>
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');

    // --- Input ---
    const keys = {};
    window.addEventListener('keydown', e => {
      keys[e.key] = true;
      if (e.key === 'r' && gameOver) restartGame();
    });
    window.addEventListener('keyup', e => keys[e.key] = false);

    // --- Player ---
    const player = {
      x: 200,
      y: 600,
      width: 80,
      height: 16,
      speed: 6
    };

    // --- Stars ---
    const stars = [];
    let spawnTimer = 0;
    let spawnInterval = 60;

    function spawnStar() {
      stars.push({
        x: Math.random() * (canvas.width - 16) + 8,
        y: -16,
        size: 16,
        speed: 2 + Math.random() * 1.5
      });
    }

    // --- Game State ---
    let score = 0;
    let misses = 0;
    const maxMisses = 3;
    let gameOver = false;

    // --- Collision ---
    function collides(a, b) {
      return (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
      );
    }

    // --- Restart ---
    function restartGame() {
      score = 0;
      misses = 0;
      gameOver = false;
      stars.length = 0;
      spawnTimer = 0;
      spawnInterval = 60;
      player.x = 200;
    }

    // --- Update ---
    function update() {
      if (gameOver) return;

      // Player movement
      if (keys['ArrowLeft'] || keys['a']) player.x -= player.speed;
      if (keys['ArrowRight'] || keys['d']) player.x += player.speed;
      if (player.x < 0) player.x = 0;
      if (player.x + player.width > canvas.width) {
        player.x = canvas.width - player.width;
      }

      // Spawn stars
      spawnTimer++;
      if (spawnTimer >= spawnInterval) {
        spawnStar();
        spawnTimer = 0;
      }

      // Move stars and check collisions
      for (let i = stars.length - 1; i >= 0; i--) {
        stars[i].y += stars[i].speed;

        const starBox = {
          x: stars[i].x - stars[i].size / 2,
          y: stars[i].y - stars[i].size / 2,
          width: stars[i].size,
          height: stars[i].size
        };

        if (collides(starBox, player)) {
          score++;
          stars.splice(i, 1);
          continue;
        }

        if (stars[i].y > canvas.height + 20) {
          misses++;
          stars.splice(i, 1);
          if (misses >= maxMisses) gameOver = true;
        }
      }

      // Difficulty scaling
      spawnInterval = Math.max(20, 60 - score * 2);
    }

    // --- Draw ---
    function draw() {
      // Background
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (gameOver) {
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 30);

        ctx.font = '20px sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('Score: ' + score, canvas.width / 2, canvas.height / 2 + 10);
        ctx.fillText('Press R to restart', canvas.width / 2, canvas.height / 2 + 50);
        return;
      }

      // Stars (golden circles)
      ctx.fillStyle = '#facc15';
      for (const star of stars) {
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Basket
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(player.x, player.y, player.width, player.height);

      // HUD - Score
      ctx.fillStyle = '#f8fafc';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Score: ' + score, 16, 30);

      // HUD - Misses
      ctx.textAlign = 'right';
      ctx.fillStyle = misses >= 2 ? '#ef4444' : '#94a3b8';
      ctx.fillText('Misses: ' + misses + ' / ' + maxMisses, canvas.width - 16, 30);
    }

    // --- Game Loop ---
    function gameLoop() {
      update();
      draw();
      requestAnimationFrame(gameLoop);
    }

    gameLoop();
  </script>
</body>
</html>
```

That's 140 lines. No build tools. No dependencies. Open the file in a browser and you're playing a game.

## What's Actually Happening Under the Hood

Step back and look at what you just built. The entire game follows one pattern:

```
gameLoop()
  → update()     // change numbers (positions, scores, states)
  → draw()       // paint those numbers onto the canvas
  → schedule next frame
```

Everything in the update function is math. Move the player 6 pixels left. Move each star down by its speed. Check if two rectangles overlap. Increment a counter. Compare it to a threshold. That's it. Games are math being drawn fast enough to look like motion.

Everything in the draw function is painting. Clear the old frame, draw shapes at their current positions, render text. The canvas doesn't remember what you drew last frame — you erase everything and redraw from scratch every single time. That's not wasteful, it's the standard approach. At 60 frames per second, the human eye sees smooth motion.

The collision detection is literally four comparisons. Is the left edge of A past the right edge of B? Are they overlapping vertically? Four boolean checks. That's one of the most commonly used algorithms in all of game development, and it's four lines of code.

## Where to Go From Here

You've got a working game. Here are real modifications you can make right now, each one teaching you a new concept:

**Add a start screen.** Before the game loop begins running the gameplay, show a "Press Enter to Start" screen. This teaches you about game state machines — the game can be in states like `menu`, `playing`, and `gameover`, and your update and draw functions behave differently depending on the current state.

**Add particle effects when catching a star.** When a star hits the basket, spawn 8 tiny circles that fly outward and fade. This teaches you about ephemeral objects — things that spawn, animate, and remove themselves.

**Make it work on mobile.** Add touch controls: tapping the left or right half of the screen moves the basket. One `touchstart` event listener and you've got mobile support. That's how most browser games handle it.

**Add sound.** The Web Audio API can generate tones without any audio files. A short rising note on catch, a low buzz on miss. It's a few lines of code and it transforms the feel of the game entirely.

I built a more complex browser game called [Beekeemon](https://github.com/StankyDanko/beekeemon) — a strategic apiary simulation with grid-based exploration, queen genetics across different bee breeds, and seasonal systems that change the map. It uses React and Tailwind instead of raw canvas, but underneath all that framework code, the core is exactly the same loop: update state, draw the result, repeat. Every browser game, no matter how sophisticated, is this loop with more stuff in it.

## What You Learned

Here's what just happened. You built a playable game from a blank file. Along the way you picked up:

- **`<canvas>`** gives you a pixel-level drawing surface in any browser
- **`requestAnimationFrame`** runs your game loop at a smooth 60 FPS
- **The game loop pattern** — update, draw, repeat — drives every real-time game
- **Input handling** with a key-state dictionary keeps movement logic clean
- **AABB collision detection** is four comparisons and handles most 2D games
- **Difficulty scaling** is just one line of math tied to the score
- **Game state** (score, misses, gameOver) controls what the game does and shows

You didn't install anything. You didn't configure a bundler. You opened a text editor, wrote some JavaScript, and made something interactive. That's the best thing about building games in the browser — the distance between "I have an idea" and "I'm playing it" is one file and a refresh.

Go change something. Make the stars bigger, the basket faster, the miss limit harsher. Break it and fix it. That's how you learn what each piece does. The game is yours now.
