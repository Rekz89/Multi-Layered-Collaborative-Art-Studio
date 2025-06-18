const express = require('express');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(__dirname));

let collaborators = {};

io.on('connection', (socket) => {
    let user = null;

    socket.on('join', (data) => {
        user = data.name;
        collaborators[user] = { role: data.role };
        io.emit('updateUsers', Object.keys(collaborators).map(name => ({ name, role: collaborators[name].role })));
        socket.emit('collaboratorUpdate', Object.keys(collaborators).length);
        socket.broadcast.emit('collaboratorUpdate', Object.keys(collaborators).length);
    });

    socket.on('drawStart', (data) => {
        socket.broadcast.emit('drawStart', data);
    });

    socket.on('draw', (data) => {
        socket.broadcast.emit('draw', data);
    });

    socket.on('drawEnd', (data) => {
        socket.broadcast.emit('drawEnd', data);
    });

    socket.on('addLayer', (layerId) => {
        socket.broadcast.emit('addLayer', layerId);
    });

    socket.on('deleteLayer', (layerId) => {
        socket.broadcast.emit('deleteLayer', layerId);
    });

    socket.on('switchLayer', (layer) => {
        socket.broadcast.emit('switchLayer', layer);
    });

    socket.on('stateUpdate', (data) => {
        socket.broadcast.emit('stateUpdate', data);
    });

    socket.on('requestState', (layer) => {
        socket.emit('stateUpdate', { layer, state: null }); // Placeholder, expand for state sharing if needed
    });

    socket.on('powerUp', (data) => {
        socket.broadcast.emit('powerUp', data);
    });

    socket.on('clear', (data) => {
        socket.broadcast.emit('clear', data);
    });

    socket.on('toolUpdate', (data) => {
        socket.broadcast.emit('toolUpdate', data);
    });

    socket.on('chatMessage', (msg) => {
        io.emit('chatMessage', msg);
    });

    socket.on('leave', (username) => {
        if (collaborators[username]) {
            delete collaborators[username];
            io.emit('updateUsers', Object.keys(collaborators).map(name => ({ name, role: collaborators[name].role })));
            io.emit('collaboratorUpdate', Object.keys(collaborators).length);
        }
    });

    socket.on('resetState', () => {
        io.emit('resetState');
    });

    socket.on('disconnect', () => {
        if (user && collaborators[user]) {
            delete collaborators[user];
            io.emit('updateUsers', Object.keys(collaborators).map(name => ({ name, role: collaborators[name].role })));
            io.emit('collaboratorUpdate', Object.keys(collaborators).length);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});