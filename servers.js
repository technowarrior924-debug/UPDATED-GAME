const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const players = {};
let matchTimeLeft = 600; // 10 minutes in seconds

// Match Timer Interval
setInterval(() => {
    matchTimeLeft--;
    if (matchTimeLeft < 0) {
        matchTimeLeft = 600;
    }
    io.emit('timerUpdate', matchTimeLeft);
}, 1000);

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    players[socket.id] = {
        name: 'Player',
        x: 0,
        y: 1.62,
        z: 0,
        yaw: 0,
        pitch: 0,
        isMoving: false,
        isCrouching: false,
        health: 100,
        isDead: false,
        kills: 0,
        deaths: 0
    };

    socket.emit('currentPlayers', players);
    socket.emit('timerUpdate', matchTimeLeft);

    socket.on('setPlayerName', (playerName) => {
        if (players[socket.id]) {
            players[socket.id].name = playerName || 'Player';
            socket.broadcast.emit('newPlayer', { id: socket.id, player: players[socket.id] });
            
            // 🌟 Screenshot ke mutabiq join notification (Green color text ke liye identifier)
            io.emit('playerJoinedNotif', players[socket.id].name);
        }
    });

    // 🌟 Chat Message Handler - SIRF EK BAAR (doosra duplicate wala block DELETE karo)
    socket.on('sendChatMessage', (data) => {
        // Naya client object bhejta hai {id, message}, purana client sirf string
        const text = (typeof data === 'string' ? data : (data && data.message)) || '';
        const msgId = (data && data.id) ? data.id : (socket.id + '-' + Date.now());
        if (players[socket.id] && typeof text === 'string' && text.trim() !== '') {
            // broadcast, io.emit nahi. Sender apna message khud dikha deta hai.
            socket.broadcast.emit('chatMessage', {
                id: msgId,
                name: players[socket.id].name,
                message: text.trim()
            });
        }
    });

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id] && !players[socket.id].isDead) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].z = movementData.z;
            players[socket.id].yaw = movementData.yaw;
            players[socket.id].pitch = movementData.pitch;
            players[socket.id].isMoving = movementData.isMoving;
            players[socket.id].isCrouching = movementData.isCrouching;

            socket.broadcast.emit('playerMoved', { id: socket.id, player: players[socket.id] });
        }
    });

    socket.on('playerHit', (data) => {
        const attackerId = socket.id;
        const target = players[data.targetId];

        if (target && !target.isDead) {
            target.health -= data.damage;
            io.emit('spawnBlood', { x: data.x, y: data.y, z: data.z });

            if (target.health <= 0) {
                target.health = 0;
                target.isDead = true;
                target.deaths++;

                if (players[attackerId] && attackerId !== data.targetId) {
                    players[attackerId].kills++;
                }

                io.emit('playerStatsUpdate', { 
                    targetId: data.targetId, 
                    targetDeaths: target.deaths, 
                    attackerId: attackerId, 
                    attackerKills: players[attackerId] ? players[attackerId].kills : 0 
                });

                io.emit('playerDied', { id: data.targetId });

                setTimeout(() => {
                    if (players[data.targetId]) {
                        target.health = 100;
                        target.isDead = false;
                        target.x = (Math.random() - 0.5) * 20;
                        target.z = (Math.random() - 0.5) * 20;
                        target.y = 1.62;
                        io.emit('playerRespawned', { id: data.targetId, player: target });
                    }
                }, 3000);
            } else {
                io.emit('playerHealthUpdate', { id: data.targetId, health: target.health });
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        const playerName = players[socket.id] ? players[socket.id].name : 'Player';
        delete players[socket.id];
        
        // 🌟 Screenshot ke mutabiq left notification (Red color text ke liye)
        io.emit('playerLeftNotif', playerName);
        io.emit('playerDisconnect', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});