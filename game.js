class GameClient {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.worldImage = null;
        this.worldWidth = 2048;
        this.worldHeight = 2048;
        
        // WebSocket and game state
        this.socket = null;
        this.playerId = null;
        this.myPlayer = null;
        this.players = {}; // All players including myself
        this.avatars = {};
        this.avatarImages = new Map(); // Cache for loaded avatar images
        
        // Camera system
        this.cameraX = 0;
        this.cameraY = 0;
        
        // Animation
        this.animationId = null;
        
        // Input handling
        this.pressedKeys = new Set();
        this.lastDirection = null;
        this.isMoving = false;
        this.movementInterval = null;
        
        // UI
        this.playerHealth = 100; // Default health
        
        // Items system
        this.items = [];
        this.inventory = {
            bananas: 0,
            apples: 0,
            blueberries: 0
        };
        this.itemSize = 20; // Size of collectible items
        
        // Snakes system
        this.snakes = [];
        this.snakeWidth = 15; // Width of snakes
        this.snakeHeight = 35; // Height of snakes
        this.lastSnakeDamage = 0; // Prevent rapid damage
        
        // Floating text system
        this.floatingTexts = [];
        
        // Audio system
        this.audioContext = null;
        this.footstepSound = null;
        this.lastFootstepTime = 0;
        this.footstepInterval = 300; // milliseconds between footsteps
        
        this.init();
    }
    
    init() {
        this.setupCanvas();
        this.setupInputHandling();
        this.setupAudio();
        this.loadWorldMap();
        this.connectToServer();
        this.spawnItems();
        this.spawnSnakes();
    }
    
    setupCanvas() {
        // Set canvas size to fill the browser window
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        
        // Handle window resize
        window.addEventListener('resize', () => {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
            this.updateCamera();
        });
    }
    
    setupInputHandling() {
        // Track key presses
        document.addEventListener('keydown', (event) => {
            this.pressedKeys.add(event.code);
            this.handleMovement();
        });
        
        document.addEventListener('keyup', (event) => {
            this.pressedKeys.delete(event.code);
            this.handleMovement();
        });
        
        // Prevent arrow keys from scrolling the page
        document.addEventListener('keydown', (event) => {
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
                event.preventDefault();
            }
        });
    }
    
    setupAudio() {
        try {
            // Create audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.createFootstepSound();
        } catch (error) {
            console.log('Audio not supported:', error);
        }
    }
    
    createFootstepSound() {
        if (!this.audioContext) return;
        
        // Create a simple footstep sound using oscillator
        const sampleRate = this.audioContext.sampleRate;
        const duration = 0.1; // 100ms
        const length = sampleRate * duration;
        const buffer = this.audioContext.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);
        
        // Generate footstep-like sound (short burst of noise)
        for (let i = 0; i < length; i++) {
            // Create a short burst of filtered noise
            const noise = (Math.random() * 2 - 1) * 0.3;
            const envelope = Math.exp(-i / (length * 0.3)); // Quick decay
            data[i] = noise * envelope;
        }
        
        this.footstepSound = buffer;
    }
    
    playFootstep() {
        if (!this.audioContext || !this.footstepSound) return;
        
        const currentTime = Date.now();
        if (currentTime - this.lastFootstepTime < this.footstepInterval) return;
        
        try {
            const source = this.audioContext.createBufferSource();
            source.buffer = this.footstepSound;
            
            // Add some variation to the sound
            const gainNode = this.audioContext.createGain();
            gainNode.gain.value = 0.1 + Math.random() * 0.1; // Random volume
            
            source.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            source.start();
            this.lastFootstepTime = currentTime;
        } catch (error) {
            console.log('Error playing footstep:', error);
        }
    }
    
    handleMovement() {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        
        // Determine current movement direction
        let currentDirection = null;
        
        if (this.pressedKeys.has('ArrowUp')) {
            currentDirection = 'up';
        } else if (this.pressedKeys.has('ArrowDown')) {
            currentDirection = 'down';
        } else if (this.pressedKeys.has('ArrowLeft')) {
            currentDirection = 'left';
        } else if (this.pressedKeys.has('ArrowRight')) {
            currentDirection = 'right';
        }
        
        // Clear existing movement interval
        if (this.movementInterval) {
            clearInterval(this.movementInterval);
            this.movementInterval = null;
        }
        
        if (currentDirection) {
            // Start continuous movement
            this.lastDirection = currentDirection;
            this.isMoving = true;
            this.startContinuousMovement(currentDirection);
            
            // Play footstep sound
            this.playFootstep();
        } else {
            // Stop movement
            this.lastDirection = null;
            this.isMoving = false;
            this.sendStopCommand();
        }
    }
    
    startContinuousMovement(direction) {
        // Send initial move command
        this.sendMoveCommand(direction);
        
        // Set up continuous movement (send command every ~100ms)
        this.movementInterval = setInterval(() => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN && this.isMoving) {
                this.sendMoveCommand(direction);
                // Play footstep sound during continuous movement
                this.playFootstep();
            }
        }, 100);
    }
    
    sendMoveCommand(direction) {
        const moveMessage = {
            action: 'move',
            direction: direction
        };
        this.socket.send(JSON.stringify(moveMessage));
    }
    
    sendStopCommand() {
        const stopMessage = {
            action: 'stop'
        };
        this.socket.send(JSON.stringify(stopMessage));
    }
    
    spawnItems() {
        const itemTypes = ['banana', 'apple', 'blueberry'];
        const itemCount = 50; // Number of items to spawn
        
        for (let i = 0; i < itemCount; i++) {
            const item = {
                id: i,
                type: itemTypes[Math.floor(Math.random() * itemTypes.length)],
                x: Math.random() * (this.worldWidth - this.itemSize),
                y: Math.random() * (this.worldHeight - this.itemSize),
                collected: false
            };
            this.items.push(item);
        }
    }
    
    checkItemCollisions() {
        if (!this.myPlayer) return;
        
        this.items.forEach(item => {
            if (item.collected) return;
            
            // Check if player overlaps with 10% of the item
            const playerRadius = 15; // Approximate player radius
            const itemRadius = this.itemSize / 2;
            
            // Calculate distance between centers
            const distance = Math.sqrt(
                Math.pow(this.myPlayer.x - (item.x + itemRadius), 2) + 
                Math.pow(this.myPlayer.y - (item.y + itemRadius), 2)
            );
            
            // Check if circles overlap by at least 10% of item radius
            const overlapThreshold = itemRadius * 0.1; // 10% of item radius
            const totalRadius = playerRadius + itemRadius;
            
            if (distance < totalRadius - overlapThreshold) {
                this.collectItem(item);
            }
        });
    }
    
    collectItem(item) {
        item.collected = true;
        
        // Map singular item types to plural inventory keys
        const itemTypeMap = {
            'banana': 'bananas',
            'apple': 'apples', 
            'blueberry': 'blueberries'
        };
        
        const inventoryKey = itemTypeMap[item.type];
        this.inventory[inventoryKey]++;
        
        // Gain 5 health when collecting fruits (capped at 100)
        this.playerHealth = Math.min(100, this.playerHealth + 5);
        
        console.log(`Collected ${item.type}! Total: ${this.inventory[inventoryKey]}, Health: ${this.playerHealth}/100`);
        
        // Add floating healing text
        this.addFloatingText(this.myPlayer.x, this.myPlayer.y - 30, '+5', '#00FF00');
    }
    
    spawnSnakes() {
        const snakeCount = 15; // Number of snakes to spawn
        
        for (let i = 0; i < snakeCount; i++) {
            const snake = {
                id: i,
                x: Math.random() * (this.worldWidth - this.snakeWidth),
                y: Math.random() * (this.worldHeight - this.snakeHeight)
            };
            this.snakes.push(snake);
        }
    }
    
    checkSnakeCollisions() {
        if (!this.myPlayer) return;
        
        const currentTime = Date.now();
        // Prevent rapid damage (cooldown of 1 second)
        if (currentTime - this.lastSnakeDamage < 1000) return;
        
        this.snakes.forEach(snake => {
            // Calculate distance between player and snake center
            const snakeCenterX = snake.x + this.snakeWidth / 2;
            const snakeCenterY = snake.y + this.snakeHeight / 2;
            const distance = Math.sqrt(
                Math.pow(this.myPlayer.x - snakeCenterX, 2) + 
                Math.pow(this.myPlayer.y - snakeCenterY, 2)
            );
            
            // Check if player is touching the snake
            const playerRadius = 15;
            const snakeRadius = Math.max(this.snakeWidth, this.snakeHeight) / 2;
            const totalRadius = playerRadius + snakeRadius;
            
            if (distance < totalRadius) {
                this.takeSnakeDamage();
                this.lastSnakeDamage = currentTime;
            }
        });
    }
    
    takeSnakeDamage() {
        this.playerHealth = Math.max(0, this.playerHealth - 5);
        console.log(`Snake bite! Health: ${this.playerHealth}/100`);
        
        // Add floating damage text
        this.addFloatingText(this.myPlayer.x, this.myPlayer.y - 30, '-5', '#FF0000');
    }
    
    addFloatingText(x, y, text, color) {
        const floatingText = {
            x: x,
            y: y,
            text: text,
            color: color,
            life: 60, // frames to live (1 second at 60fps)
            maxLife: 60,
            velocityY: -2 // moves up
        };
        this.floatingTexts.push(floatingText);
    }
    
    updateFloatingTexts() {
        this.floatingTexts = this.floatingTexts.filter(text => {
            text.life--;
            text.y += text.velocityY;
            return text.life > 0;
        });
    }
    
    drawFloatingTexts() {
        this.floatingTexts.forEach(text => {
            this.drawFloatingText(text);
        });
    }
    
    drawFloatingText(text) {
        this.ctx.save();
        
        // Calculate alpha based on remaining life
        const alpha = text.life / text.maxLife;
        
        // Set text style
        this.ctx.font = 'bold 16px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        
        // Set color with alpha
        const color = text.color + Math.floor(alpha * 255).toString(16).padStart(2, '0');
        this.ctx.fillStyle = color;
        
        // Draw text
        this.ctx.fillText(text.text, text.x - this.cameraX, text.y - this.cameraY);
        
        this.ctx.restore();
    }
    
    loadWorldMap() {
        this.worldImage = new Image();
        this.worldImage.onload = () => {
            this.startRenderLoop();
        };
        this.worldImage.onerror = () => {
            console.error('Failed to load world map image');
        };
        this.worldImage.src = 'world.jpg';
    }
    
    connectToServer() {
        this.socket = new WebSocket('wss://codepath-mmorg.onrender.com');
        
        this.socket.onopen = () => {
            console.log('Connected to game server');
            this.joinGame();
        };
        
        this.socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleServerMessage(message);
            } catch (error) {
                console.error('Failed to parse server message:', error);
            }
        };
        
        this.socket.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
        
        this.socket.onclose = () => {
            console.log('Disconnected from game server');
        };
    }
    
    joinGame() {
        const joinMessage = {
            action: 'join_game',
            username: 'Tim'
        };
        this.socket.send(JSON.stringify(joinMessage));
    }
    
    handleServerMessage(message) {
        switch (message.action) {
            case 'join_game':
                if (message.success) {
                    this.playerId = message.playerId;
                    this.players = message.players; // Store all players
                    this.myPlayer = this.players[this.playerId]; // Reference to my player
                    this.avatars = message.avatars;
                    this.loadAllAvatarImages();
                    this.updateCamera();
                    console.log('Joined game successfully:', this.myPlayer);
                } else {
                    console.error('Failed to join game:', message.error);
                }
                break;
            case 'player_joined':
                // Add new player
                this.players[message.player.playerId] = message.player;
                this.avatars[message.avatar.name] = message.avatar;
                this.loadAvatarImagesForPlayer(message.player);
                console.log('Player joined:', message.player.username);
                break;
            case 'players_moved':
                // Update all player positions
                Object.keys(message.players).forEach(playerId => {
                    if (this.players[playerId]) {
                        this.players[playerId] = { ...this.players[playerId], ...message.players[playerId] };
                        // Update myPlayer reference if it's me
                        if (playerId === this.playerId) {
                            this.myPlayer = this.players[playerId];
                            this.updateCamera();
                        }
                    }
                });
                break;
            case 'player_left':
                // Remove player
                delete this.players[message.playerId];
                console.log('Player left:', message.playerId);
                break;
            default:
                console.log('Unhandled message:', message);
        }
    }
    
    async loadAllAvatarImages() {
        // Load avatars for all players
        Object.values(this.players).forEach(player => {
            this.loadAvatarImagesForPlayer(player);
        });
    }
    
    async loadAvatarImagesForPlayer(player) {
        if (!this.avatars[player.avatar]) return;
        
        const avatarData = this.avatars[player.avatar];
        const directions = ['north', 'south', 'east'];
        
        for (const direction of directions) {
            const frames = avatarData.frames[direction];
            for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
                const cacheKey = `${avatarData.name}_${direction}_${frameIndex}`;
                
                if (!this.avatarImages.has(cacheKey)) {
                    try {
                        const img = new Image();
                        img.src = frames[frameIndex];
                        await new Promise((resolve, reject) => {
                            img.onload = resolve;
                            img.onerror = reject;
                        });
                        this.avatarImages.set(cacheKey, img);
                    } catch (error) {
                        console.error(`Failed to load avatar frame ${cacheKey}:`, error);
                    }
                }
            }
        }
    }
    
    updateCamera() {
        if (!this.myPlayer) return;
        
        // Center camera on player - this ensures the player is always in the center of the browser window
        this.cameraX = this.myPlayer.x - this.canvas.width / 2;
        this.cameraY = this.myPlayer.y - this.canvas.height / 2;
        
        // Clamp to world bounds - but only if the canvas is smaller than the world
        // If canvas is larger than world, we want to show the world centered
        if (this.canvas.width < this.worldWidth) {
            this.cameraX = Math.max(0, Math.min(this.cameraX, this.worldWidth - this.canvas.width));
        } else {
            // Canvas is wider than world - center the world horizontally
            this.cameraX = (this.worldWidth - this.canvas.width) / 2;
        }
        
        if (this.canvas.height < this.worldHeight) {
            this.cameraY = Math.max(0, Math.min(this.cameraY, this.worldHeight - this.canvas.height));
        } else {
            // Canvas is taller than world - center the world vertically
            this.cameraY = (this.worldHeight - this.canvas.height) / 2;
        }
    }
    
    startRenderLoop() {
        const render = () => {
            this.render();
            this.animationId = requestAnimationFrame(render);
        };
        render();
    }
    
    render() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw world map
        this.drawWorld();
        
        // Draw items
        this.drawItems();
        
        // Draw snakes
        this.drawSnakes();
        
        // Draw all players
        this.drawAllPlayers();
        
        // Check for item collisions
        this.checkItemCollisions();
        
        // Check for snake collisions
        this.checkSnakeCollisions();
        
        // Update floating texts
        this.updateFloatingTexts();
        
        // Draw floating texts
        this.drawFloatingTexts();
        
        // Draw UI overlay
        this.drawUI();
    }
    
    drawWorld() {
        if (!this.worldImage) return;
        
        // Draw the visible portion of the world based on clamped camera.
        const sourceX = this.cameraX;
        const sourceY = this.cameraY;
        const sourceWidth = Math.min(this.canvas.width, this.worldWidth - sourceX);
        const sourceHeight = Math.min(this.canvas.height, this.worldHeight - sourceY);
        
        this.ctx.drawImage(
            this.worldImage,
            sourceX, sourceY, sourceWidth, sourceHeight,
            0, 0, sourceWidth, sourceHeight
        );
    }
    
    drawItems() {
        this.items.forEach(item => {
            if (item.collected) return;
            
            // Calculate screen position
            const screenX = item.x - this.cameraX;
            const screenY = item.y - this.cameraY;
            
            // Only draw if item is visible on screen
            if (screenX > -this.itemSize && screenX < this.canvas.width + this.itemSize &&
                screenY > -this.itemSize && screenY < this.canvas.height + this.itemSize) {
                
                this.drawItem(item, screenX, screenY);
            }
        });
    }
    
    drawItem(item, x, y) {
        this.ctx.save();
        
        // Set item color based on type
        switch (item.type) {
            case 'banana':
                this.ctx.fillStyle = '#FFD700'; // Gold/yellow
                break;
            case 'apple':
                this.ctx.fillStyle = '#FF0000'; // Red
                break;
            case 'blueberry':
                this.ctx.fillStyle = '#4169E1'; // Royal blue
                break;
        }
        
        // Draw item as a circle
        this.ctx.beginPath();
        this.ctx.arc(x + this.itemSize/2, y + this.itemSize/2, this.itemSize/2, 0, Math.PI * 2);
        this.ctx.fill();
        
        // Add a subtle border
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        
        this.ctx.restore();
    }
    
    drawSnakes() {
        this.snakes.forEach(snake => {
            // Calculate screen position
            const screenX = snake.x - this.cameraX;
            const screenY = snake.y - this.cameraY;
            
            // Only draw if snake is visible on screen
            if (screenX > -this.snakeWidth && screenX < this.canvas.width + this.snakeWidth &&
                screenY > -this.snakeHeight && screenY < this.canvas.height + this.snakeHeight) {
                
                this.drawSnake(snake, screenX, screenY);
            }
        });
    }
    
    drawSnake(snake, x, y) {
        this.ctx.save();
        
        // Draw snake body (dark green rectangle - longer and thinner)
        this.ctx.fillStyle = '#2D5016'; // Dark green
        this.ctx.fillRect(x, y, this.snakeWidth, this.snakeHeight);
        
        // Draw snake pattern (lighter green stripes)
        this.ctx.fillStyle = '#4A7C59'; // Lighter green
        this.ctx.fillRect(x + 2, y + 2, this.snakeWidth - 4, this.snakeHeight - 4);
        
        // Add a subtle border
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(x, y, this.snakeWidth, this.snakeHeight);
        
        // Draw letter "S" on the snake
        this.ctx.fillStyle = '#FFFFFF'; // White text
        this.ctx.font = 'bold 12px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText('S', x + this.snakeWidth / 2, y + this.snakeHeight / 2);
        
        this.ctx.restore();
    }
    
    drawAllPlayers() {
        Object.values(this.players).forEach(player => {
            this.drawPlayer(player);
        });
    }
    
    drawPlayer(player) {
        if (!this.avatars[player.avatar]) return;
        
        const avatarData = this.avatars[player.avatar];
        const facing = player.facing || 'south';
        const animationFrame = player.animationFrame || 0;
        
        // Get the appropriate frame (west uses flipped east frames)
        let direction = facing;
        let flipHorizontal = false;
        if (facing === 'west') {
            direction = 'east';
            flipHorizontal = true;
        }
        
        const cacheKey = `${avatarData.name}_${direction}_${animationFrame}`;
        const avatarImg = this.avatarImages.get(cacheKey);
        
        if (!avatarImg) return;
        
        // Draw the avatar at its position relative to the camera
        const screenX = player.x - this.cameraX;
        const screenY = player.y - this.cameraY;
        
        // Draw avatar centered on position
        this.ctx.save();
        
        if (flipHorizontal) {
            this.ctx.scale(-1, 1);
            this.ctx.drawImage(avatarImg, -screenX - avatarImg.width / 2, screenY - avatarImg.height / 2);
        } else {
            this.ctx.drawImage(avatarImg, screenX - avatarImg.width / 2, screenY - avatarImg.height / 2);
        }
        
        this.ctx.restore();
        
        // Draw green circle outline around the player if it's me
        if (player.id === this.playerId) {
            this.drawPlayerOutline(screenX, screenY);
        }
        
        // Draw username label
        this.drawUsernameLabel(screenX, screenY - avatarImg.height / 2 - 10, player.username);
    }
    
    drawPlayerOutline(x, y) {
        this.ctx.save();
        
        // Draw green circle outline
        this.ctx.strokeStyle = '#00FF00'; // Bright green
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.arc(x, y, 30, 0, Math.PI * 2); // 30px radius circle (increased from 20px)
        this.ctx.stroke();
        
        this.ctx.restore();
    }
    
    drawUsernameLabel(x, y, username) {
        this.ctx.save();
        
        // Set text style
        this.ctx.font = '14px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'bottom';
        
        // Draw text stroke (outline)
        this.ctx.strokeStyle = 'black';
        this.ctx.lineWidth = 3;
        this.ctx.strokeText(username, x, y);
        
        // Draw text fill
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(username, x, y);
        
        this.ctx.restore();
    }
    
    drawUI() {
        if (!this.myPlayer) return;
        
        this.ctx.save();
        
        // Set up UI styling
        this.ctx.font = '14px Arial';
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 1;
        
        // Position info
        const positionText = `Position: (${Math.floor(this.myPlayer.x)}, ${Math.floor(this.myPlayer.y)})`;
        const playerCountText = `Players: ${Object.keys(this.players).length}`;
        
        // Draw background
        const padding = 10;
        const lineHeight = 20;
        const textWidth = Math.max(
            this.ctx.measureText(positionText).width,
            this.ctx.measureText(playerCountText).width
        );
        const uiWidth = textWidth + padding * 2;
        const uiHeight = lineHeight * 2 + padding * 2;
        
        this.ctx.fillRect(10, 10, uiWidth, uiHeight);
        this.ctx.strokeRect(10, 10, uiWidth, uiHeight);
        
        // Draw text
        this.ctx.fillStyle = 'white';
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'top';
        this.ctx.fillText(positionText, 10 + padding, 10 + padding);
        this.ctx.fillText(playerCountText, 10 + padding, 10 + padding + lineHeight);
        
        // Draw health bar
        this.drawHealthBar(10, 10 + uiHeight + 10);
        
        // Draw inventory
        this.drawInventory(10, 10 + uiHeight + 10 + 30);
        
        this.ctx.restore();
    }
    
    drawHealthBar(x, y) {
        const barWidth = 200;
        const barHeight = 20;
        const healthPercent = this.playerHealth / 100;
        
        // Background
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(x, y, barWidth, barHeight);
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(x, y, barWidth, barHeight);
        
        // Health fill with updated color thresholds
        const healthWidth = barWidth * healthPercent;
        if (this.playerHealth >= 50) {
            this.ctx.fillStyle = '#4CAF50'; // Green (50+ health)
        } else if (this.playerHealth >= 20) {
            this.ctx.fillStyle = '#FFC107'; // Yellow (20-49 health)
        } else {
            this.ctx.fillStyle = '#F44336'; // Red (below 20 health)
        }
        this.ctx.fillRect(x, y, healthWidth, barHeight);
        
        // Health text
        this.ctx.fillStyle = 'white';
        this.ctx.font = '12px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(`${this.playerHealth}/100`, x + barWidth / 2, y + barHeight / 2);
    }
    
    drawInventory(x, y) {
        const itemSize = 15;
        const lineHeight = 20;
        const inventoryHeight = lineHeight * 3 + 10; // 3 lines + padding
        
        // Draw inventory background
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(x, y, 200, inventoryHeight);
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(x, y, 200, inventoryHeight);
        
        // Set up text styling
        this.ctx.font = '12px Arial';
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'middle';
        
        // Draw bananas
        this.ctx.fillStyle = '#FFD700';
        this.ctx.beginPath();
        this.ctx.arc(x + 15, y + 15, itemSize/2, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(`Bananas: ${this.inventory.bananas}`, x + 35, y + 15);
        
        // Draw apples
        this.ctx.fillStyle = '#FF0000';
        this.ctx.beginPath();
        this.ctx.arc(x + 15, y + 35, itemSize/2, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(`Apples: ${this.inventory.apples}`, x + 35, y + 35);
        
        // Draw blueberries
        this.ctx.fillStyle = '#4169E1';
        this.ctx.beginPath();
        this.ctx.arc(x + 15, y + 55, itemSize/2, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(`Blueberries: ${this.inventory.blueberries}`, x + 35, y + 55);
    }
}

// Initialize the game when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new GameClient();
});
