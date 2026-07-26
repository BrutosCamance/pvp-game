const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let defaultSettings = {
  startingSun: 100,
  startingBrains: 100,
  generationInterval: 1000,
  generationAmount: 10,
  killReward: 15
};

let gameState = {
  status: 'menu', // 'menu', 'lobby', 'playing', 'paused', 'gameover'
  winner: null,
  settings: { ...defaultSettings },
  p1: { name: 'Player 1', ready: false },
  p2: { name: 'Player 2', ready: false },
  sun: 100,
  brains: 100,
  board: [],
  projectiles: [],
  floatingTexts: [],
  startTime: 0
};

function getUnitStats(unitName) {
  const units = {
    // Plants
    'peashooter': { cost: 25, hp: 3, sprite: '🌱', type: 'plant' },
    'wallnut':    { cost: 50, hp: 12, sprite: '🥔', type: 'plant' },
    'sunflower':  { cost: 25, hp: 2, sprite: '🌻', type: 'plant', special: 'sun' },
    'chili':      { cost: 75, hp: 1, sprite: '🌶️', type: 'plant', special: 'bomb' },
    
    // Zombies
    'zombie':     { cost: 25, hp: 4, sprite: '🧟', type: 'zombie' },
    'tank':       { cost: 50, hp: 10, sprite: '👹', type: 'zombie' },
    'runner':     { cost: 30, hp: 3, sprite: '🏃', type: 'zombie', special: 'speed' },
    'miner':      { cost: 60, hp: 5, sprite: '⛏️', type: 'zombie', special: 'jump' }
  };
  return units[unitName];
}

io.on('connection', (socket) => {
  socket.emit('stateUpdate', gameState);

  socket.on('updateSettings', (newSettings) => {
    if (gameState.status === 'menu') {
      gameState.settings = { ...newSettings };
      gameState.sun = gameState.settings.startingSun;
      gameState.brains = gameState.settings.startingBrains;
      io.emit('stateUpdate', gameState);
    }
  });

  socket.on('goToLobby', () => {
    gameState.status = 'lobby';
    gameState.sun = gameState.settings.startingSun;
    gameState.brains = gameState.settings.startingBrains;
    io.emit('stateUpdate', gameState);
  });

  socket.on('join', (role) => {
    if (role === 'Plants' && !gameState.p1.ready) gameState.p1.name = 'Plants Player';
    if (role === 'Zombies' && !gameState.p2.ready) gameState.p2.name = 'Zombies Player';
    io.emit('stateUpdate', gameState);
  });

  socket.on('ready', (role) => {
    if (role === 'Plants') gameState.p1.ready = true;
    if (role === 'Zombies') gameState.p2.ready = true;

    if (gameState.p1.ready && gameState.p2.ready) {
      gameState.status = 'playing';
      gameState.startTime = Date.now();
    }
    io.emit('stateUpdate', gameState);
  });

  socket.on('pauseGame', () => {
    if (gameState.status === 'playing') gameState.status = 'paused';
    else if (gameState.status === 'paused') gameState.status = 'playing';
    io.emit('stateUpdate', gameState);
  });

  socket.on('exitGame', () => {
    gameState = {
      status: 'menu',
      winner: null,
      settings: { ...defaultSettings },
      p1: { name: 'Player 1', ready: false },
      p2: { name: 'Player 2', ready: false },
      sun: defaultSettings.startingSun,
      brains: defaultSettings.startingBrains,
      board: [],
      projectiles: [],
      floatingTexts: [],
      startTime: 0
    };
    io.emit('stateUpdate', gameState);
  });

  socket.on('spawn', (data) => {
    if (gameState.status !== 'playing') return;
    let stats = getUnitStats(data.unitType);
    if (!stats) return;

    let occupied = gameState.board.find(u => u.x === data.x && u.y === data.y);
    if (occupied) return;

    let newUnit = { 
      id: Date.now() + Math.random(), 
      x: data.x, 
      y: data.y, 
      hp: stats.hp, 
      maxHp: stats.hp,
      sprite: stats.sprite, 
      name: data.unitType,
      type: stats.type,
      special: stats.special || null,
      cooldown: 0
    };

    if (data.role === 'Plants' && gameState.sun >= stats.cost && data.x < 4) {
      gameState.sun -= stats.cost;
      
      // Chili bomb instant effect
      if (newUnit.special === 'bomb') {
        let targets = gameState.board.filter(z => z.type === 'zombie' && z.y === newUnit.y && z.x >= newUnit.x && z.x <= newUnit.x + 1);
        targets.forEach(t => {
          t.hp -= 10;
          if (t.hp <= 0) {
            gameState.sun += gameState.settings.killReward;
            gameState.floatingTexts.push({ id: Date.now() + Math.random(), x: t.x, y: t.y, text: `+${gameState.settings.killReward} Sun`, color: '#f1c40f' });
          }
        });
        return; // Chili is consumed instantly
      }

      gameState.board.push(newUnit);
    } else if (data.role === 'Zombies' && gameState.brains >= stats.cost && data.x > 3) {
      gameState.brains -= stats.cost;
      gameState.board.push(newUnit);
    }
    io.emit('stateUpdate', gameState);
  });

  socket.on('reset', () => {
    gameState.status = 'lobby';
    gameState.winner = null;
    gameState.p1.ready = false;
    gameState.p2.ready = false;
    gameState.sun = gameState.settings.startingSun;
    gameState.brains = gameState.settings.startingBrains;
    gameState.board = [];
    gameState.projectiles = [];
    gameState.floatingTexts = [];
    io.emit('stateUpdate', gameState);
  });
});

// Game loop timer based on customized settings
let gameInterval;
function restartGameLoop() {
  if (gameInterval) clearInterval(gameInterval);
  
  gameInterval = setInterval(() => {
    if (gameState.status !== 'playing') return;
    gameState.projectiles = [];
    gameState.floatingTexts = [];

    if (Date.now() - gameState.startTime > 180000) {
      gameState.status = 'gameover';
      gameState.winner = 'Plants (Survived!)';
      io.emit('stateUpdate', gameState);
      return;
    }

    gameState.sun += gameState.settings.generationAmount;
    gameState.brains += gameState.settings.generationAmount;

    let plants = gameState.board.filter(u => u.type === 'plant');
    let zombies = gameState.board.filter(u => u.type === 'zombie');

    // Plant Actions
    plants.forEach(p => {
      // Sunflower ability
      if (p.special === 'sun') {
        gameState.sun += 5;
      }
      // Peashooter attack
      if (p.name === 'peashooter') {
        let targets = zombies.filter(z => z.y === p.y && z.x > p.x).sort((a, b) => a.x - b.x);
        if (targets.length > 0) {
          targets[0].hp -= 1;
          gameState.projectiles.push({ x: p.x, y: p.y, targetX: targets[0].x });
          if (targets[0].hp <= 0) {
            gameState.sun += gameState.settings.killReward;
            gameState.floatingTexts.push({ id: Date.now() + Math.random(), x: targets[0].x, y: targets[0].y, text: `+${gameState.settings.killReward} Sun`, color: '#f1c40f' });
          }
        }
      }
    });

    // Zombie Actions
    zombies.forEach(z => {
      // Miner ability: jump over first plant obstacle
      let obstacleIndex = z.special === 'jump' && z.cooldown === 0 ? 2 : 1;
      let obstacle = plants.find(p => p.y === z.y && p.x === z.x - obstacleIndex);

      if (obstacle) {
        if (z.special === 'jump' && z.cooldown === 0) {
          z.x -= 2; // Jump over
          z.cooldown = 1;
        } else {
          obstacle.hp -= 2;
          if (obstacle.hp <= 0) {
            gameState.brains += gameState.settings.killReward;
            gameState.floatingTexts.push({ id: Date.now() + Math.random(), x: obstacle.x, y: obstacle.y, text: `+${gameState.settings.killReward} Brains`, color: '#e74c3c' });
          }
        }
      } else {
        let moveSpeed = z.special === 'speed' ? 2 : 1;
        z.x -= moveSpeed;
        if (z.x < 0) {
          gameState.status = 'gameover';
          gameState.winner = 'Zombies (Breached!)';
        }
      }
    });

    gameState.board = gameState.board.filter(u => u.hp > 0);
    io.emit('stateUpdate', gameState);
  }, 1000);
}
restartGameLoop();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
