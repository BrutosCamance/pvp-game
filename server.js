const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let gameState = {
  status: 'lobby',
  winner: null,
  p1: { name: 'Player 1', ready: false },
  p2: { name: 'Player 2', ready: false },
  sun: 100,
  brains: 100,
  board: [],
  startTime: 0
};

function getUnitStats(unitName) {
  const units = {
    'peashooter': { cost: 25, hp: 3, sprite: '🌱' },
    'wallnut':    { cost: 50, hp: 10, sprite: '🥔' },
    'zombie':     { cost: 25, hp: 4, sprite: '🧟' },
    'tank':       { cost: 50, hp: 8, sprite: '👹' }
  };
  return units[unitName];
}

io.on('connection', (socket) => {
  socket.emit('stateUpdate', gameState);

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

  socket.on('spawn', (data) => {
    if (gameState.status !== 'playing') return;
    let stats = getUnitStats(data.unitType);
    if (!stats) return;

    let occupied = gameState.board.find(u => u.x === data.x && u.y === data.y);
    if (occupied) return;

    let newUnit = { id: Date.now() + Math.random(), x: data.x, y: data.y, hp: stats.hp, sprite: stats.sprite, name: data.unitType };

    if (data.role === 'Plants' && gameState.sun >= stats.cost && data.x < 4) {
      gameState.sun -= stats.cost;
      newUnit.type = 'plant';
      gameState.board.push(newUnit);
    } else if (data.role === 'Zombies' && gameState.brains >= stats.cost && data.x > 3) {
      gameState.brains -= stats.cost;
      newUnit.type = 'zombie';
      gameState.board.push(newUnit);
    }
    io.emit('stateUpdate', gameState);
  });

  socket.on('reset', () => {
    gameState = {
      status: 'lobby', winner: null,
      p1: { name: 'Player 1', ready: false },
      p2: { name: 'Player 2', ready: false },
      sun: 100, brains: 100, board: [], startTime: 0
    };
    io.emit('stateUpdate', gameState);
  });
});

setInterval(() => {
  if (gameState.status !== 'playing') return;

  if (Date.now() - gameState.startTime > 120000) {
    gameState.status = 'gameover';
    gameState.winner = 'Plants (Survived!)';
    io.emit('stateUpdate', gameState);
    return;
  }

  gameState.sun += 10;
  gameState.brains += 10;

  let plants = gameState.board.filter(u => u.type === 'plant');
  let zombies = gameState.board.filter(u => u.type === 'zombie');

  plants.forEach(p => {
    if (p.name === 'peashooter') {
      let target = zombies.find(z => z.y === p.y && z.x > p.x);
      if (target) {
        target.hp -= 1;
        if (target.hp <= 0) gameState.sun += 15;
      }
    }
  });

  zombies.forEach(z => {
    let obstacle = plants.find(p => p.y === z.y && p.x === z.x - 1);
    if (obstacle) {
      obstacle.hp -= 2;
      if (obstacle.hp <= 0) gameState.brains += 15;
    } else {
      z.x -= 1;
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
