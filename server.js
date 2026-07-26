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
  killReward: 15,
  matchDuration: 180,
  icons: {
    peashooter: '🌱',
    wallnut: '🥔',
    sunflower: '🌻',
    chili: '🌶️',
    zombie: '🧟',
    tank: '👹',
    runner: '🏃',
    miner: '⛏️'
  }
};

let gameState = {
  status: 'menu', 
  winner: null,
  settings: { ...defaultSettings },
  p1: { name: 'Player 1', ready: false },
  p2: { name: 'Player 2', ready: false },
  sun: 100,
  brains: 100,
  board: [],
  projectiles: [],
  floatingTexts: [],
  explosions: [],
  chatMessages: [],
  startTime: 0
};

function getUnitStats(unitName, icons) {
  const units = {
    'peashooter': { cost: 25, hp: 3, sprite: icons.peashooter || '🌱', type: 'plant' },
    'wallnut':    { cost: 50, hp: 12, sprite: icons.wallnut || '🥔', type: 'plant' },
    'sunflower':  { cost: 25, hp: 2, sprite: icons.sunflower || '🌻', type: 'plant', special: 'sun' },
    'chili':      { cost: 75, hp: 1, sprite: icons.chili || '🌶️', type: 'plant', special: 'bomb', fuse: 2 },
    
    'zombie':     { cost: 25, hp: 4, sprite: icons.zombie || '🧟', type: 'zombie' },
    'tank':       { cost: 50, hp: 10, sprite: icons.tank || '👹', type: 'zombie' },
    'runner':     { cost: 30, hp: 3, sprite: icons.runner || '🏃', type: 'zombie', special: 'speed' },
    'miner':      { cost: 60, hp: 5, sprite: icons.miner || '⛏️', type: 'zombie', special: 'jump' }
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

  socket.on('updateNames', (data) => {
    if (data.role === 'Plants') gameState.p1.name = data.name || 'Player 1';
    if (data.role === 'Zombies') gameState.p2.name = data.name || 'Player 2';
    io.emit('stateUpdate', gameState);
  });

  socket.on('goToLobby', () => {
    gameState.status = 'lobby';
    gameState.sun = gameState.settings.startingSun;
    gameState.brains = gameState.settings.startingBrains;
    io.emit('stateUpdate', gameState);
  });

  socket.on('join', (data) => {
    if (data.role === 'Plants') gameState.p1.name = data.name || 'Plants Player';
    if (data.role === 'Zombies') gameState.p2.name = data.name || 'Zombies Player';
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

  socket.on('sendChat', (data) => {
    let senderName = data.role === 'Plants' ? gameState.p1.name : gameState.p2.name;
    gameState.chatMessages.push({
      id: Date.now() + Math.random(),
      sender: senderName || data.role,
      role: data.role,
      text: data.text
    });
    if (gameState.chatMessages.length > 30) gameState.chatMessages.shift();
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
      explosions: [],
      chatMessages: [],
      startTime: 0
    };
    io.emit('stateUpdate', gameState);
  });

  socket.on('spawn', (data) => {
    if (gameState.status !== 'playing') return;
    let stats = getUnitStats(data.unitType, gameState.settings.icons);
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
      fuse: stats.fuse || 0,
      cooldown: 0
    };

    if (data.role === 'Plants' && gameState.sun >= stats.cost && data.x < 4) {
      gameState.sun -= stats.cost;
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
    gameState.explosions = [];
    gameState.chatMessages = [];
    io.emit('stateUpdate', gameState);
  });
});

setInterval(() => {
  if (gameState.status !== 'playing') return;
  gameState.projectiles = [];
  gameState.floatingTexts = [];
  gameState.explosions = [];

  let matchDurationMs = (gameState.settings.matchDuration || 180) * 1000;
  if (Date.now() - gameState.startTime > matchDurationMs) {
    gameState.status = 'gameover';
    gameState.winner = 'Plants (Survived!)';
    io.emit('stateUpdate', gameState);
    return;
  }

  gameState.sun += gameState.settings.generationAmount;
  gameState.brains += gameState.settings.generationAmount;

  let plants = gameState.board.filter(u => u.type === 'plant');
  let zombies = gameState.board.filter(u => u.type === 'zombie');

  plants.forEach(p => {
    if (p.special === 'sun') {
      gameState.sun += 10;
      gameState.floatingTexts.push({ id: Date.now() + Math.random(), x: p.x, y: p.y, text: `+10 Sun 🌻`, color: '#f1c40f' });
    }
    
    if (p.special === 'bomb') {
      if (p.fuse > 0) {
        p.fuse--;
        gameState.floatingTexts.push({ id: Date.now() + Math.random(), x: p.x, y: p.y, text: `Fuse: ${p.fuse+1}`, color: '#e67e22' });
      } else {
        gameState.explosions.push({ id: Date.now() + Math.random(), x: p.x, y: p.y });
        let targets = zombies.filter(z => z.y === p.y && z.x >= p.x && z.x <= p.x + 1);
        targets.forEach(t => {
          t.hp -= 15;
          if (t.hp <= 0) {
            gameState.sun += gameState.settings.killReward;
            gameState.floatingTexts.push({ id: Date.now() + Math.random(), x: t.x, y: t.y, text: `+${gameState.settings.killReward} Sun`, color: '#f1c40f' });
          }
        });
        p.hp = 0;
      }
    }

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

  zombies.forEach(z => {
    let obstacleIndex = z.special === 'jump' && z.cooldown === 0 ? 2 : 1;
    let obstacle = plants.find(p => p.y === z.y && p.x === z.x - obstacleIndex);

    if (obstacle) {
      if (z.special === 'jump' && z.cooldown === 0) {
        z.x -= 2; 
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
