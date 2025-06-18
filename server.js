const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Create database directory if not exists
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir);
}

// Initialize database
const db = new sqlite3.Database(path.join(dbDir, 'artstudio.db'));
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      currency INTEGER DEFAULT 100,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS drawings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      title TEXT,
      data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS marketplace (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name TEXT,
      item_type TEXT,
      price INTEGER,
      effect TEXT
    )
  `);
  
  // Initialize marketplace items
  db.run(`INSERT OR IGNORE INTO marketplace (item_name, item_type, price, effect) VALUES 
    ('Premium Brush', 'tool', 50, 'brush_size:15'),
    ('Super Eraser', 'tool', 30, 'clear_layer'),
    ('Golden Power', 'powerup', 20, 'golden_effect'),
    ('Rainbow Effect', 'effect', 40, 'rainbow_colors'),
    ('Layer Unlocker', 'upgrade', 60, 'add_layer')
  `);
});

app.use(express.static(__dirname));
app.use(express.json());

// API endpoint to get marketplace items
app.get('/marketplace', (req, res) => {
  db.all('SELECT * FROM marketplace', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// API endpoint to save drawing
app.post('/save-drawing', (req, res) => {
  const { userId, title, data } = req.body;
  db.run(
    'INSERT INTO drawings (user_id, title, data) VALUES (?, ?, ?)',
    [userId, title, data],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID });
    }
  );
});

let collaborators = {};
let canvasStates = {};
let layerStates = {};

io.on('connection', (socket) => {
  let user = null;
  
  socket.on('authenticate', (data) => {
    const { username, password } = data;
    
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
      if (err) {
        socket.emit('authError', 'Database error');
        return;
      }
      
      if (row && row.password === password) {
        user = {
          id: row.id,
          name: username,
          role: 'artist',
          currency: row.currency
        };
        
        collaborators[user.id] = {
          ...user,
          socketId: socket.id,
          layers: ['base'],
          activeLayer: 'base'
        };
        
        socket.emit('authenticated', user);
        updateUserList();
        
        // Send initial canvas state if available
        if (canvasStates[user.id]) {
          socket.emit('initialState', {
            canvasState: canvasStates[user.id],
            layerState: layerStates[user.id]
          });
        }
      } else {
        socket.emit('authError', 'Invalid credentials');
      }
    });
  });
  
  socket.on('register', (data) => {
    const { username, password } = data;
    
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
      if (err) {
        socket.emit('registerError', 'Database error');
        return;
      }
      
      if (row) {
        socket.emit('registerError', 'Username already exists');
      } else {
        db.run(
          'INSERT INTO users (username, password) VALUES (?, ?)',
          [username, password],
          function(err) {
            if (err) {
              socket.emit('registerError', 'Registration failed');
              return;
            }
            
            user = {
              id: this.lastID,
              name: username,
              role: 'artist',
              currency: 100
            };
            
            collaborators[user.id] = {
              ...user,
              socketId: socket.id,
              layers: ['base'],
              activeLayer: 'base'
            };
            
            socket.emit('registered', user);
            updateUserList();
          }
        );
      }
    });
  });
  
  socket.on('joinAsGuest', (username) => {
    user = {
      id: `guest_${Date.now()}`,
      name: username,
      role: 'viewer',
      currency: 0
    };
    
    collaborators[user.id] = {
      ...user,
      socketId: socket.id,
      layers: ['base'],
      activeLayer: 'base'
    };
    
    socket.emit('guestJoined', user);
    updateUserList();
  });
  
  socket.on('drawStart', (data) => {
    if (!user) return;
    
    const { layer, ...drawData } = data;
    socket.broadcast.emit('remoteDrawStart', {
      ...drawData,
      layer,
      userId: user.id
    });
  });
  
  socket.on('draw', (data) => {
    if (!user) return;
    
    const { layer, ...drawData } = data;
    socket.broadcast.emit('remoteDraw', {
      ...drawData,
      layer,
      userId: user.id
    });
    
    // Update canvas state in memory
    if (!canvasStates[user.id]) {
      canvasStates[user.id] = {};
    }
    if (!canvasStates[user.id][layer]) {
      canvasStates[user.id][layer] = [];
    }
    canvasStates[user.id][layer].push(data);
  });
  
  socket.on('drawEnd', (data) => {
    if (!user) return;
    
    const { layer } = data;
    socket.broadcast.emit('remoteDrawEnd', {
      layer,
      userId: user.id
    });
    
    // Save state to history
    saveCanvasState(user.id, layer);
  });
  
  socket.on('addLayer', (layerId) => {
    if (!user) return;
    
    if (!collaborators[user.id].layers.includes(layerId)) {
      collaborators[user.id].layers.push(layerId);
      layerStates[user.id] = layerStates[user.id] || {};
      layerStates[user.id][layerId] = { visible: true, opacity: 1.0 };
      
      socket.emit('layerAdded', layerId);
      socket.broadcast.emit('remoteLayerAdded', {
        layerId,
        userId: user.id
      });
    }
  });
  
  socket.on('deleteLayer', (layerId) => {
    if (!user) return;
    
    const userLayers = collaborators[user.id].layers;
    if (userLayers.includes(layerId) && layerId !== 'base') {
      const index = userLayers.indexOf(layerId);
      userLayers.splice(index, 1);
      
      if (collaborators[user.id].activeLayer === layerId) {
        collaborators[user.id].activeLayer = userLayers[userLayers.length - 1];
      }
      
      delete layerStates[user.id][layerId];
      
      socket.emit('layerDeleted', layerId);
      socket.broadcast.emit('remoteLayerDeleted', {
        layerId,
        userId: user.id
      });
    }
  });
  
  socket.on('switchLayer', (layer) => {
    if (!user) return;
    
    if (collaborators[user.id].layers.includes(layer)) {
      collaborators[user.id].activeLayer = layer;
      socket.broadcast.emit('remoteLayerSwitched', {
        layer,
        userId: user.id
      });
    }
  });
  
  socket.on('updateLayerState', (data) => {
    if (!user) return;
    
    const { layerId, state } = data;
    layerStates[user.id] = layerStates[user.id] || {};
    layerStates[user.id][layerId] = state;
    
    socket.broadcast.emit('remoteLayerStateUpdated', {
      layerId,
      state,
      userId: user.id
    });
  });
  
  socket.on('purchaseItem', (itemId) => {
    if (!user || user.role === 'viewer') return;
    
    db.get('SELECT * FROM marketplace WHERE id = ?', [itemId], (err, item) => {
      if (err || !item) {
        socket.emit('purchaseFailed', 'Item not found');
        return;
      }
      
      if (user.currency < item.price) {
        socket.emit('purchaseFailed', 'Not enough currency');
        return;
      }
      
      // Deduct currency
      const newCurrency = user.currency - item.price;
      db.run(
        'UPDATE users SET currency = ? WHERE id = ?',
        [newCurrency, user.id],
        (err) => {
          if (err) {
            socket.emit('purchaseFailed', 'Transaction failed');
            return;
          }
          
          // Update user object
          user.currency = newCurrency;
          collaborators[user.id].currency = newCurrency;
          
          // Apply item effect
          applyItemEffect(user.id, item);
          
          // Notify user and others
          socket.emit('purchaseSuccess', {
            itemId: item.id,
            newCurrency
          });
          
          updateUserList();
        }
      );
    });
  });
  
  socket.on('disconnect', () => {
    if (user) {
      delete collaborators[user.id];
      updateUserList();
    }
  });
  
  function applyItemEffect(userId, item) {
    const effect = item.effect;
    const user = collaborators[userId];
    
    if (effect === 'brush_size:15') {
      io.to(user.socketId).emit('toolUpdate', { tool: 'brush', size: 15 });
    } 
    else if (effect === 'clear_layer') {
      io.to(user.socketId).emit('toolUpdate', { tool: 'eraser' });
      socket.broadcast.emit('remoteClear', { 
        layer: user.activeLayer,
        userId
      });
    }
    else if (effect === 'golden_effect') {
      io.to(user.socketId).emit('powerUp', { type: 'golden' });
      socket.broadcast.emit('remotePowerUp', { 
        userId,
        type: 'golden',
        layer: user.activeLayer
      });
    }
    else if (effect === 'add_layer') {
      const newLayer = `layer_${Date.now()}`;
      io.to(user.socketId).emit('layerAdded', newLayer);
      socket.broadcast.emit('remoteLayerAdded', {
        layerId: newLayer,
        userId
      });
    }
  }
  
  function saveCanvasState(userId, layer) {
    // In a real app, we'd save this to the database
    // For now, we'll just keep in memory
    if (!canvasStates[userId]) canvasStates[userId] = {};
    if (!canvasStates[userId][layer]) canvasStates[userId][layer] = [];
    
    // Keep only the last 50 drawing actions per layer
    if (canvasStates[userId][layer].length > 50) {
      canvasStates[userId][layer] = canvasStates[userId][layer].slice(-50);
    }
  }
  
  function updateUserList() {
    const users = Object.values(collaborators).map(u => ({
      id: u.id,
      name: u.name,
      role: u.role,
      currency: u.currency,
      activeLayer: u.activeLayer
    }));
    
    io.emit('userListUpdate', users);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
