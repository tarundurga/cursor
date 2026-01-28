// Game constants - internal coordinate system (fixed size for consistent physics)
const GAME_W = 360;
const GAME_H = 640;

const BALL_SPEED_X = 180;    // px/sec baseline horizontal speed (used at serve)
const BALL_SPEED_Y = 260;    // px/sec upward speed at serve
const MAX_DT = 1/30;         // cap dt to avoid giant jumps
const PADDLE_SMOOTHING = 20; // higher = snappier smoothing

// Canvas and context
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Device pixel ratio for crisp rendering on high-DPI screens
let dpr = window.devicePixelRatio || 1;
let lastTime = 0;

// Game state
let state = 'menu'; // menu | playing | paused | win | lose
let score = 0;
let lives = 3;

// Game objects
let paddle = { x: GAME_W / 2 - 30, y: GAME_H - 40, w: 60, h: 10, targetX: GAME_W / 2 - 30 };
let ball = { x: GAME_W / 2, y: GAME_H - 60, vx: 160, vy: -240, r: 6 }; // vx, vy in px/sec
let bricks = [];

// Input handling - pointer events for mobile touch
let input = {
    pointerActive: false,
    pointerX: 0,
    grabOffset: 0 // Offset from paddle center when dragging starts
};

// Initialize canvas size and scaling
function resizeCanvas() {
    dpr = window.devicePixelRatio || 1;
    
    // Calculate display size (fit to viewport width, maintain aspect ratio)
    const maxDisplayWidth = Math.min(window.innerWidth, GAME_W);
    const displayHeight = (maxDisplayWidth / GAME_W) * GAME_H;
    
    // Set CSS size (what the browser displays)
    canvas.style.width = maxDisplayWidth + 'px';
    canvas.style.height = displayHeight + 'px';
    
    // Set actual canvas size (internal resolution for high-DPI)
    canvas.width = GAME_W * dpr;
    canvas.height = GAME_H * dpr;
    
    // Scale context to map internal coordinates to high-DPI canvas
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Helper: clamp value between lo and hi
function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

// Start a new game (menu/win/lose → playing)
function startNewGame() {
    score = 0;
    lives = 3;
    state = 'playing';
    initGame();
}

// Place ball on paddle after losing a life
function resetBallOnPaddle() {
    ball.x = paddle.x + paddle.w / 2;
    ball.y = paddle.y - ball.r - 1;
    
    const dir = Math.random() > 0.5 ? 1 : -1;
    ball.vx = BALL_SPEED_X * dir;
    ball.vy = -BALL_SPEED_Y;
}

// Initialize game - create brick grid (does NOT reset score/lives)
function initGame() {
    bricks = [];
    const rows = 5;
    const cols = 8;
    const brickW = (GAME_W - 20) / cols - 4;
    const brickH = 20;
    const startY = 80;
    const startX = 10;
    
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            bricks.push({
                x: startX + col * (brickW + 4),
                y: startY + row * (brickH + 4),
                w: brickW,
                h: brickH,
                active: true
            });
        }
    }
    
    // Reset paddle position
    paddle.x = GAME_W / 2 - paddle.w / 2;
    paddle.targetX = paddle.x;
    
    // Reset ball using helper
    resetBallOnPaddle();
}

// Convert screen coordinates to game coordinates
// Maps pointer position on screen to internal game coordinate system
function screenToGame(x, y) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = GAME_W / rect.width;
    const scaleY = GAME_H / rect.height;
    return {
        x: (x - rect.left) * scaleX,
        y: (y - rect.top) * scaleY
    };
}

// Pointer event handlers for touch/mouse control
canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    
    if (state === 'menu' || state === 'win' || state === 'lose') {
        startNewGame();
        return;
    }
    
    if (state === 'playing') {
        // Start dragging paddle
        const gamePos = screenToGame(e.clientX, e.clientY);
        input.pointerActive = true;
        input.pointerX = gamePos.x;
        // Calculate offset from paddle center when grab starts
        input.grabOffset = gamePos.x - (paddle.x + paddle.w / 2);
    }
});

canvas.addEventListener('pointermove', (e) => {
    e.preventDefault();
    
    if (state === 'playing' && input.pointerActive) {
        const gamePos = screenToGame(e.clientX, e.clientY);
        input.pointerX = gamePos.x;
        
        // Set paddle target position (clamped to game bounds)
        paddle.targetX = input.pointerX - input.grabOffset - paddle.w / 2;
        paddle.targetX = clamp(paddle.targetX, 0, GAME_W - paddle.w);
    }
});

canvas.addEventListener('pointerup', (e) => {
    e.preventDefault();
    input.pointerActive = false;
});

canvas.addEventListener('pointercancel', (e) => {
    e.preventDefault();
    input.pointerActive = false;
});

// Optional keyboard fallback (not required for mobile)
document.addEventListener('keydown', (e) => {
    if (state === 'menu' || state === 'win' || state === 'lose') {
        if (e.key === ' ' || e.key === 'Enter') {
            startNewGame();
        }
    } else if (state === 'playing') {
        if (e.key === 'ArrowLeft') paddle.targetX = clamp(paddle.targetX - 10, 0, GAME_W - paddle.w);
        if (e.key === 'ArrowRight') paddle.targetX = clamp(paddle.targetX + 10, 0, GAME_W - paddle.w);
    }
});

// Circle-rect collision: closest point on rect to ball, then penetration axis
function reflectBallFromRect(rect) {
    // Closest point on rect to ball center
    const closestX = clamp(ball.x, rect.x, rect.x + rect.w);
    const closestY = clamp(ball.y, rect.y, rect.y + rect.h);
    
    const dx = ball.x - closestX;
    const dy = ball.y - closestY;
    
    const dist2 = dx * dx + dy * dy;
    if (dist2 > ball.r * ball.r) return false;
    
    // Determine axis to reflect based on penetration
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    
    // If ball center is inside rect, dx/dy could be 0; handle by using distances to edges
    let overlapX, overlapY;
    if (absDx === 0 && absDy === 0) {
        // choose minimal push direction based on nearest edge
        const left = Math.abs(ball.x - rect.x);
        const right = Math.abs(rect.x + rect.w - ball.x);
        const top = Math.abs(ball.y - rect.y);
        const bottom = Math.abs(rect.y + rect.h - ball.y);
        const minEdge = Math.min(left, right, top, bottom);
        if (minEdge === left) {
            ball.x = rect.x - ball.r - 0.5;
            ball.vx = -Math.abs(ball.vx);
        } else if (minEdge === right) {
            ball.x = rect.x + rect.w + ball.r + 0.5;
            ball.vx = Math.abs(ball.vx);
        } else if (minEdge === top) {
            ball.y = rect.y - ball.r - 0.5;
            ball.vy = -Math.abs(ball.vy);
        } else {
            ball.y = rect.y + rect.h + ball.r + 0.5;
            ball.vy = Math.abs(ball.vy);
        }
        return true;
    }
    
    overlapX = ball.r - absDx;
    overlapY = ball.r - absDy;
    
    if (overlapX < overlapY) {
        // reflect X
        if (dx > 0) ball.x += overlapX + 0.5;
        else ball.x -= overlapX + 0.5;
        ball.vx = -ball.vx;
    } else {
        // reflect Y
        if (dy > 0) ball.y += overlapY + 0.5;
        else ball.y -= overlapY + 0.5;
        ball.vy = -ball.vy;
    }
    return true;
}

// Collision detection
function checkCollisions() {
    // Ball-wall collisions (push ball out and ensure correct velocity direction)
    if (ball.x - ball.r <= 0) {
        ball.x = ball.r;
        ball.vx = Math.abs(ball.vx);
    }
    if (ball.x + ball.r >= GAME_W) {
        ball.x = GAME_W - ball.r;
        ball.vx = -Math.abs(ball.vx);
    }
    if (ball.y - ball.r <= 0) {
        ball.y = ball.r;
        ball.vy = Math.abs(ball.vy);
    }
    
    // Ball-paddle collision (angle-based bounce)
    if (reflectBallFromRect(paddle)) {
        // force upward
        ball.vy = -Math.abs(ball.vy);
        
        // add angle control based on hit position
        const hit = ((ball.x - paddle.x) / paddle.w) - 0.5;   // -0.5..+0.5
        const hitClamped = clamp(hit, -0.5, 0.5);
        ball.vx = hitClamped * 420; // tweakable
    }
    
    // Ball-brick collisions
    for (let brick of bricks) {
        if (brick.active && reflectBallFromRect(brick)) {
            brick.active = false;
            score += 10;
            break;
        }
    }
    
    // Ball out of bounds
    if (ball.y - ball.r > GAME_H) {
        lives--;
        if (lives <= 0) {
            state = 'lose';
        } else {
            resetBallOnPaddle();
        }
    }
    
    // Check win condition
    if (bricks.every(b => !b.active)) {
        state = 'win';
    }
}

// Update game logic (dt in seconds, movement is frame-rate independent)
function update(dt) {
    if (state !== 'playing') return;
    
    // Smooth paddle movement toward target
    paddle.x += (paddle.targetX - paddle.x) * Math.min(1, dt * PADDLE_SMOOTHING);
    
    // Move ball using dt
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    
    // Check collisions
    checkCollisions();
}

// Draw functions
function drawRect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
}

function drawCircle(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
}

function drawText(text, x, y, size, color, align = 'center') {
    ctx.fillStyle = color;
    ctx.font = `bold ${size}px sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
}

function draw() {
    // Clear canvas
    ctx.fillStyle = '#0f0f1e';
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    
    if (state === 'menu') {
        drawText('BRICK BREAKER', GAME_W / 2, GAME_H / 2 - 40, 32, '#fff');
        drawText('Tap to Start', GAME_W / 2, GAME_H / 2 + 20, 24, '#aaa');
        return;
    }
    
    if (state === 'win') {
        drawText('YOU WIN!', GAME_W / 2, GAME_H / 2 - 40, 36, '#4ade80');
        drawText(`Score: ${score}`, GAME_W / 2, GAME_H / 2 + 20, 24, '#fff');
        drawText('Tap to Play Again', GAME_W / 2, GAME_H / 2 + 60, 20, '#aaa');
        return;
    }
    
    if (state === 'lose') {
        drawText('GAME OVER', GAME_W / 2, GAME_H / 2 - 40, 36, '#f87171');
        drawText(`Score: ${score}`, GAME_W / 2, GAME_H / 2 + 20, 24, '#fff');
        drawText('Tap to Restart', GAME_W / 2, GAME_H / 2 + 60, 20, '#aaa');
        return;
    }
    
    // Draw UI - score and lives at top (mobile-friendly size)
    drawText(`Score: ${score}`, 10, 20, 20, '#fff', 'left');
    drawText(`Lives: ${lives}`, GAME_W - 10, 20, 20, '#fff', 'right');
    
    // Draw bricks
    for (let brick of bricks) {
        if (brick.active) {
            drawRect(brick.x, brick.y, brick.w, brick.h, '#3b82f6');
        }
    }
    
    // Draw paddle
    drawRect(paddle.x, paddle.y, paddle.w, paddle.h, '#fff');
    
    // Draw ball
    drawCircle(ball.x, ball.y, ball.r, '#fff');
}

// Game loop (delta-time for frame-rate independent movement)
function gameLoop(ts) {
    if (!lastTime) lastTime = ts;
    let dt = (ts - lastTime) / 1000;
    lastTime = ts;
    
    if (dt > MAX_DT) dt = MAX_DT;
    
    update(dt);
    draw();
    requestAnimationFrame(gameLoop);
}

// Initialize
resizeCanvas();
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => {
    setTimeout(resizeCanvas, 100); // Delay to ensure orientation change completes
});

gameLoop();
