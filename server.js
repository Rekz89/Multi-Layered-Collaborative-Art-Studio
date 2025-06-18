const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors'); // Added CORS support

const app = express();
app.use(cors()); // Enable CORS
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*", // Allow all origins
    methods: ["GET", "POST"]
  }
});

app.use(express.static(__dirname));

let collaborators = {};

io.on('connection', (socket) => {
  let user = null;

  socket.on('join', (data) => {
    // Prevent duplicate usernames
    if (collaborators[data.name]) {
      socket.emit('nameTaken');
      return;
    }
    
    user = data.name;
    collaborators[user] = { 
      role: data.role, 
      currency: 100, // Track currency on server
      socketId: socket.id 
    };
    
    // Notify all clients
    io.emit('updateUsers', Object.keys(collaborators).map(name => ({ 
      name, 
      role: collaborators[name].role,
      currency: collaborators[name].currency 
    })));
    
    socket.emit('collaboratorUpdate', Object.keys(collaborators).length);
    socket.broadcast.emit('collaboratorUpdate', Object.keys(collaborators).length);
  });

  // [Keep all other socket event handlers as in original]

  // NEW: Handle marketplace purchases
  socket.on('buyTool', (data) => {
    const userData = collaborators[data.user];
    if (!userData) return;
    
    let success = false;
    switch(data.tool) {
      case 'brush':
        if (userData.currency >= 50) {
          userData.currency -= 50;
          success = true;
        }
        break;
      case 'eraser':
        if (userData.currency >= 30) {
          userData.currency -= 30;
          success = true;
        }
        break;
      case 'powerup':
        if (userData.currency >= 20) {
          userData.currency -= 20;
          success = true;
        }
        break;
    }
    
    if (success) {
      // Update all clients
      io.emit('updateUsers', Object.keys(collaborators).map(name => ({ 
        name, 
        role: collaborators[name].role,
        currency: collaborators[name].currency 
      })));
      
      socket.emit('purchaseSuccess', data.tool);
    } else {
      socket.emit('purchaseFailed');
    }
  });

  socket.on('disconnect', () => {
    if (user && collaborators[user]) {
      delete collaborators[user];
      io.emit('updateUsers', Object.keys(collaborators).map(name => ({ 
        name, 
        role: collaborators[name].role,
        currency: collaborators[name].currency 
      })));
      io.emit('collaboratorUpdate', Object.keys(collaborators).length);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
