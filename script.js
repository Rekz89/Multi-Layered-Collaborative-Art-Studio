const socket = io('http://localhost:3000');
const canvases = {};
let currentUser = null;
let layers = ['base'];
let activeLayer = 'base';
let drawing = false;
let layerHistory = {};
let color = '#000000';
let brushSize = 5;
let isEraser = false;
let brushType = 'round';
let blendMode = 'source-over';
let lastPoint = null;
let drawBuffer = [];
let lastSend = Date.now();

// UI Elements
const canvasContainer = document.getElementById('canvases');
const tools = document.getElementById('tools');
const layerControls = document.getElementById('layer-controls');
const usersList = document.getElementById('users-list');
const marketplaceList = document.getElementById('marketplace-list');
const currencyDisplay = document.getElementById('currency');
const authForm = document.getElementById('auth-form');
const guestForm = document.getElementById('guest-form');
const mainApp = document.getElementById('main-app');

// Initialize canvases
function initializeCanvas(layerId) {
  if (document.getElementById(layerId)) return;
  
  const canvas = document.createElement('canvas');
  canvas.id = layerId;
  canvas.width = 800;
  canvas.height = 500;
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.zIndex = layers.indexOf(layerId);
  canvasContainer.appendChild(canvas);
  
  canvases[layerId] = {
    element: canvas,
    context: canvas.getContext('2d'),
    visible: true,
    opacity: 1.0
  };
  
  canvases[layerId].context.lineCap = brushType;
  canvases[layerId].context.lineJoin = 'round';
  canvases[layerId].context.globalCompositeOperation = blendMode;
  
  if (!layerHistory[layerId]) {
    layerHistory[layerId] = { undo: [], redo: [] };
  }
  
  renderLayers();
}

// Initialize with base layer
initializeCanvas('base');

// Authentication
document.getElementById('login-btn').addEventListener('click', (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  
  if (username && password) {
    socket.emit('authenticate', { username, password });
  }
});

document.getElementById('register-btn').addEventListener('click', (e) => {
  e.preventDefault();
  const username = document.getElementById('reg-username').value;
  const password = document.getElementById('reg-password').value;
  
  if (username && password) {
    socket.emit('register', { username, password });
  }
});

document.getElementById('guest-btn').addEventListener('click', (e) => {
  e.preventDefault();
  const username = document.getElementById('guest-name').value;
  
  if (username) {
    socket.emit('joinAsGuest', username);
  }
});

socket.on('authenticated', (user) => {
  currentUser = user;
  authForm.classList.add('hidden');
  guestForm.classList.add('hidden');
  mainApp.classList.remove('hidden');
  currencyDisplay.textContent = user.currency;
  
  // Load marketplace items
  fetch('/marketplace')
    .then(res => res.json())
    .then(items => renderMarketplace(items));
});

socket.on('registered', (user) => {
  currentUser = user;
  authForm.classList.add('hidden');
  guestForm.classList.add('hidden');
  mainApp.classList.remove('hidden');
  currencyDisplay.textContent = user.currency;
});

socket.on('guestJoined', (user) => {
  currentUser = user;
  authForm.classList.add('hidden');
  guestForm.classList.add('hidden');
  mainApp.classList.remove('hidden');
});

socket.on('authError', (message) => {
  alert(`Authentication error: ${message}`);
});

socket.on('registerError', (message) => {
  alert(`Registration error: ${message}`);
});

// Drawing functions
function startDrawing(x, y) {
  if (!currentUser || currentUser.role !== 'artist' || !canvases[activeLayer]) return;
  
  drawing = true;
  lastPoint = { x, y };
  
  canvases[activeLayer].context.beginPath();
  canvases[activeLayer].context.moveTo(x, y);
  
  socket.emit('drawStart', {
    x, 
    y,
    layer: activeLayer,
    color: isEraser ? '#FFFFFF' : color,
    brushSize,
    brushType,
    blendMode
  });
}

function draw(x, y) {
  if (!drawing || !currentUser || !canvases[activeLayer]) return;
  
  const context = canvases[activeLayer].context;
  const drawColor = isEraser ? '#FFFFFF' : color;
  
  context.lineWidth = brushSize;
  context.strokeStyle = drawColor;
  context.globalCompositeOperation = blendMode;
  
  // Draw locally
  context.beginPath();
  context.moveTo(lastPoint.x, lastPoint.y);
  context.lineTo(x, y);
  context.stroke();
  
  // Add to buffer
  drawBuffer.push({
    x, 
    y,
    prevX: lastPoint.x,
    prevY: lastPoint.y,
    color: drawColor,
    brushSize,
    brushType,
    blendMode
  });
  
  lastPoint = { x, y };
  
  // Send batches every 50ms for performance
  if (Date.now() - lastSend > 50) {
    flushDrawBuffer();
  }
}

function stopDrawing() {
  if (!drawing) return;
  
  drawing = false;
  flushDrawBuffer();
  lastPoint = null;
  
  canvases[activeLayer].context.beginPath();
  socket.emit('drawEnd', { layer: activeLayer });
}

function flushDrawBuffer() {
  if (drawBuffer.length === 0) return;
  
  socket.emit('draw', {
    layer: activeLayer,
    draws: [...drawBuffer]
  });
  
  drawBuffer = [];
  lastSend = Date.now();
}

// Remote drawing handlers
socket.on('remoteDrawStart', (data) => {
  if (!canvases[data.layer] || data.userId === currentUser.id) return;
  
  const context = canvases[data.layer].context;
  context.beginPath();
  context.moveTo(data.x, data.y);
  
  // Draw a cursor indicator
  drawCursorIndicator(data.userId, data.x, data.y);
});

socket.on('remoteDraw', (data) => {
  if (!canvases[data.layer] || data.userId === currentUser.id) return;
  
  const context = canvases[data.layer].context;
  
  data.draws.forEach(draw => {
    context.lineWidth = draw.brushSize;
    context.strokeStyle = draw.color;
    context.lineCap = draw.brushType;
    context.globalCompositeOperation = draw.blendMode;
    
    context.beginPath();
    context.moveTo(draw.prevX, draw.prevY);
    context.lineTo(draw.x, draw.y);
    context.stroke();
    
    // Update cursor position
    drawCursorIndicator(data.userId, draw.x, draw.y);
  });
});

socket.on('remoteDrawEnd', (data) => {
  if (!canvases[data.layer] || data.userId === currentUser.id) return;
  
  const context = canvases[data.layer].context;
  context.beginPath();
});

// Layer management
document.getElementById('add-layer').addEventListener('click', () => {
  if (!currentUser || currentUser.role !== 'artist') return;
  
  const newLayer = `layer_${Date.now()}`;
  layers.push(newLayer);
  initializeCanvas(newLayer);
  socket.emit('addLayer', newLayer);
});

document.getElementById('delete-layer').addEventListener('click', () => {
  if (!currentUser || currentUser.role !== 'artist' || layers.length <= 1 || activeLayer === 'base') return;
  
  const index = layers.indexOf(activeLayer);
  layers.splice(index, 1);
  
  const canvasEl = document.getElementById(activeLayer);
  if (canvasEl) {
    canvasContainer.removeChild(canvasEl);
  }
  
  delete canvases[activeLayer];
  delete layerHistory[activeLayer];
  
  activeLayer = layers[layers.length - 1];
  renderLayers();
  
  socket.emit('deleteLayer', activeLayer);
});

function renderLayers() {
  const layerManager = document.getElementById('layer-manager');
  layerManager.innerHTML = '';
  
  layers.forEach((layerId, index) => {
    const isActive = layerId === activeLayer;
    const layer = canvases[layerId];
    
    const layerDiv = document.createElement('div');
    layerDiv.className = `layer-item flex items-center p-2 mb-2 rounded ${isActive ? 'bg-blue-100' : 'bg-gray-50'}`;
    layerDiv.innerHTML = `
      <div class="flex items-center w-full">
        <span class="mr-2">${index + 1}.</span>
        <input type="text" value="${layerId}" class="layer-name flex-grow border p-1 rounded mr-2">
        <input type="checkbox" class="layer-visibility mr-2" ${layer.visible ? 'checked' : ''}>
        <input type="range" min="0" max="100" value="${layer.opacity * 100}" class="layer-opacity w-16 mr-2">
        <button class="switch-layer bg-blue-500 text-white p-1 rounded text-xs" data-layer="${layerId}">${isActive ? 'Active' : 'Switch'}</button>
      </div>
    `;
    
    layerManager.appendChild(layerDiv);
    
    // Layer name change
    const nameInput = layerDiv.querySelector('.layer-name');
    nameInput.addEventListener('change', (e) => {
      const newName = e.target.value.trim() || layerId;
      
      // Update local state
      const oldName = layerId;
      layers[index] = newName;
      
      // Update canvas
      const canvas = document.getElementById(oldName);
      canvas.id = newName;
      
      canvases[newName] = canvases[oldName];
      delete canvases[oldName];
      
      layerHistory[newName] = layerHistory[oldName];
      delete layerHistory[oldName];
      
      if (activeLayer === oldName) activeLayer = newName;
      
      renderLayers();
    });
    
    // Visibility toggle
    const visibilityInput = layerDiv.querySelector('.layer-visibility');
    visibilityInput.addEventListener('change', (e) => {
      canvases[layerId].visible = e.target.checked;
      canvasContainer.querySelector(`#${layerId}`).style.display = e.target.checked ? 'block' : 'none';
      
      // Update server
      socket.emit('updateLayerState', {
        layerId,
        state: {
          visible: e.target.checked,
          opacity: canvases[layerId].opacity
        }
      });
    });
    
    // Opacity change
    const opacityInput = layerDiv.querySelector('.layer-opacity');
    opacityInput.addEventListener('input', (e) => {
      const opacity = parseInt(e.target.value) / 100;
      canvases[layerId].opacity = opacity;
      canvases[layerId].context.globalAlpha = opacity;
      
      // Update server
      socket.emit('updateLayerState', {
        layerId,
        state: {
          visible: canvases[layerId].visible,
          opacity
        }
      });
    });
    
    // Switch layer
    const switchBtn = layerDiv.querySelector('.switch-layer');
    switchBtn.addEventListener('click', (e) => {
      activeLayer = layerId;
      renderLayers();
      socket.emit('switchLayer', activeLayer);
    });
  });
}

// Remote layer updates
socket.on('remoteLayerAdded', (data) => {
  if (data.userId === currentUser.id) return;
  
  if (!layers.includes(data.layerId)) {
    layers.push(data.layerId);
    initializeCanvas(data.layerId);
  }
});

socket.on('remoteLayerDeleted', (data) => {
  if (data.userId === currentUser.id) return;
  
  if (layers.includes(data.layerId) && data.layerId !== 'base') {
    const index = layers.indexOf(data.layerId);
    layers.splice(index, 1);
    
    const canvasEl = document.getElementById(data.layerId);
    if (canvasEl) {
      canvasContainer.removeChild(canvasEl);
    }
    
    delete canvases[data.layerId];
    delete layerHistory[data.layerId];
    
    if (activeLayer === data.layerId) {
      activeLayer = layers[layers.length - 1];
    }
    
    renderLayers();
  }
});

socket.on('remoteLayerSwitched', (data) => {
  if (data.userId === currentUser.id) return;
  
  if (layers.includes(data.layer)) {
    activeLayer = data.layer;
    renderLayers();
  }
});

socket.on('remoteLayerStateUpdated', (data) => {
  if (data.userId === currentUser.id || !canvases[data.layerId]) return;
  
  canvases[data.layerId].visible = data.state.visible;
  canvases[data.layerId].opacity = data.state.opacity;
  
  const canvasEl = document.getElementById(data.layerId);
  if (canvasEl) {
    canvasEl.style.display = data.state.visible ? 'block' : 'none';
    canvases[data.layerId].context.globalAlpha = data.state.opacity;
  }
  
  renderLayers();
});

// User list
socket.on('userListUpdate', (users) => {
  usersList.innerHTML = '';
  
  users.forEach(user => {
    const userDiv = document.createElement('div');
    userDiv.className = 'user-item flex justify-between items-center p-2 mb-2 bg-gray-50 rounded';
    userDiv.innerHTML = `
      <div>
        <span class="font-medium">${user.name}</span>
        <span class="text-xs ml-2 px-2 py-1 rounded ${user.role === 'artist' ? 'bg-green-200' : 'bg-blue-200'}">
          ${user.role}
        </span>
      </div>
      <div class="flex items-center">
        <span class="mr-2">$${user.currency}</span>
        <span class="text-xs px-2 py-1 bg-purple-200 rounded">${user.activeLayer}</span>
      </div>
    `;
    
    usersList.appendChild(userDiv);
  });
});

// Marketplace
function renderMarketplace(items) {
  marketplaceList.innerHTML = '';
  
  items.forEach(item => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'market-item bg-white p-4 rounded-lg shadow mb-4';
    itemDiv.innerHTML = `
      <h3 class="font-bold text-lg mb-2">${item.item_name}</h3>
      <p class="text-gray-600 mb-2">${item.effect}</p>
      <div class="flex justify-between items-center">
        <span class="text-xl font-bold">$${item.price}</span>
        <button 
          class="purchase-btn bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded disabled:bg-gray-300"
          data-id="${item.id}"
          ${currentUser.currency < item.price ? 'disabled' : ''}
        >
          Buy
        </button>
      </div>
    `;
    
    const purchaseBtn = itemDiv.querySelector('.purchase-btn');
    purchaseBtn.addEventListener('click', () => {
      socket.emit('purchaseItem', item.id);
    });
    
    marketplaceList.appendChild(itemDiv);
  });
}

socket.on('purchaseSuccess', (data) => {
  currencyDisplay.textContent = data.newCurrency;
  currentUser.currency = data.newCurrency;
  
  // Refresh marketplace
  fetch('/marketplace')
    .then(res => res.json())
    .then(items => renderMarketplace(items));
});

socket.on('purchaseFailed', (message) => {
  alert(`Purchase failed: ${message}`);
});

// Tool updates
socket.on('toolUpdate', (data) => {
  if (data.tool === 'brush') {
    brushSize = data.size;
    document.getElementById('brush-size').value = data.size;
  } else if (data.tool === 'eraser') {
    isEraser = true;
    document.getElementById('eraser').checked = true;
  }
});

socket.on('powerUp', (data) => {
  if (data.type === 'golden') {
    // Apply golden effect for 5 seconds
    canvases[activeLayer].context.globalCompositeOperation = 'multiply';
    canvases[activeLayer].context.fillStyle = 'rgba(255, 215, 0, 0.3)';
    canvases[activeLayer].context.fillRect(0, 0, 800, 500);
    
    setTimeout(() => {
      canvases[activeLayer].context.globalCompositeOperation = blendMode;
    }, 5000);
  }
});

socket.on('remotePowerUp', (data) => {
  if (data.userId === currentUser.id || !canvases[data.layer]) return;
  
  if (data.type === 'golden') {
    const context = canvases[data.layer].context;
    const prevComposite = context.globalCompositeOperation;
    
    context.globalCompositeOperation = 'multiply';
    context.fillStyle = 'rgba(255, 215, 0, 0.3)';
    context.fillRect(0, 0, 800, 500);
    
    setTimeout(() => {
      context.globalCompositeOperation = prevComposite;
    }, 5000);
  }
});

socket.on('remoteClear', (data) => {
  if (data.userId === currentUser.id || !canvases[data.layer]) return;
  
  canvases[data.layer].context.clearRect(0, 0, 800, 500);
});

// UI Event Listeners
document.getElementById('color-picker').addEventListener('change', (e) => {
  color = e.target.value;
});

document.getElementById('brush-size').addEventListener('change', (e) => {
  brushSize = parseInt(e.target.value);
});

document.getElementById('eraser').addEventListener('change', (e) => {
  isEraser = e.target.checked;
});

document.getElementById('brush-type').addEventListener('change', (e) => {
  brushType = e.target.value;
  Object.values(canvases).forEach(canvas => {
    canvas.context.lineCap = brushType;
  });
});

document.getElementById('blend-mode').addEventListener('change', (e) => {
  blendMode = e.target.value;
  Object.values(canvases).forEach(canvas => {
    canvas.context.globalCompositeOperation = blendMode;
  });
});

// Drawing event listeners
canvasContainer.addEventListener('mousedown', (e) => {
  const rect = canvasContainer.getBoundingClientRect();
  startDrawing(e.clientX - rect.left, e.clientY - rect.top);
});

canvasContainer.addEventListener('mousemove', (e) => {
  const rect = canvasContainer.getBoundingClientRect();
  draw(e.clientX - rect.left, e.clientY - rect.top);
});

window.addEventListener('mouseup', stopDrawing);

canvasContainer.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const touch = e.touches[0];
  const rect = canvasContainer.getBoundingClientRect();
  startDrawing(touch.clientX - rect.left, touch.clientY - rect.top);
}, { passive: false });

canvasContainer.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const touch = e.touches[0];
  const rect = canvasContainer.getBoundingClientRect();
  draw(touch.clientX - rect.left, touch.clientY - rect.top);
}, { passive: false });

window.addEventListener('touchend', stopDrawing);

// Cursor indicators
function drawCursorIndicator(userId, x, y) {
  // In a real implementation, we'd show other users' cursors
  // This is a placeholder for that functionality
}

// Save drawing
document.getElementById('save-drawing').addEventListener('click', () => {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = 800;
  tempCanvas.height = 500;
  const tempCtx = tempCanvas.getContext('2d');
  
  // Draw all visible layers
  layers.forEach(layerId => {
    if (canvases[layerId] && canvases[layerId].visible) {
      tempCtx.drawImage(canvases[layerId].element, 0, 0);
    }
  });
  
  // Create download link
  const link = document.createElement('a');
  link.download = 'collaborative-art.png';
  link.href = tempCanvas.toDataURL('image/png');
  link.click();
});

// Leave
document.getElementById('leave').addEventListener('click', () => {
  mainApp.classList.add('hidden');
  authForm.classList.remove('hidden');
  guestForm.classList.remove('hidden');
  currentUser = null;
  
  // Reset canvas
  layers = ['base'];
  activeLayer = 'base';
  canvasContainer.innerHTML = '';
  initializeCanvas('base');
});
