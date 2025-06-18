const socket = io('http://localhost:3000');
const canvases = {};
let currentUser = null;
let currentRole = 'viewer';
let layers = ['base'];
let activeLayer = 'base';
let drawing = false;
let layerHistory = {};
let currency = 100;
let powerUpActive = false;
let lastDrawTime = 0;
let drawBuffer = [];
let color = '#000000';
let brushSize = 2;
let isEraser = false;

const canvasContainer = document.getElementById('canvases');
const tools = document.getElementById('tools');
const layerControls = document.getElementById('layer-controls');
const usersList = document.getElementById('users-list');
const marketplace = document.getElementById('marketplace');
const currencyDisplay = document.getElementById('currency');

function initializeCanvas(layerId) {
    const canvas = document.createElement('canvas');
    canvas.id = layerId;
    canvas.width = 800;
    canvas.height = 500;
    canvas.style.zIndex = layers.indexOf(layerId);
    canvasContainer.appendChild(canvas);
    canvases[layerId] = canvas.getContext('2d');
    canvases[layerId].lineCap = 'round';
    if (!layerHistory[layerId]) layerHistory[layerId] = { undo: [], redo: [] };
    renderLayers();
}

document.getElementById('join').addEventListener('click', () => {
    const username = document.getElementById('username').value;
    currentRole = document.getElementById('role').value;
    if (username && currentRole) {
        currentUser = { name: username, role: currentRole };
        document.getElementById('auth').classList.add('hidden');
        document.getElementById('canvas-container').classList.remove('hidden');
        socket.emit('join', { name: username, role: currentRole });
        initializeCanvas('base');
        socket.emit('requestState', activeLayer);
    }
});

document.getElementById('add-layer').addEventListener('click', () => {
    if (currentRole === 'artist') {
        const newLayer = `layer${Date.now()}`;
        layers.push(newLayer);
        initializeCanvas(newLayer);
        socket.emit('addLayer', newLayer);
        saveState(activeLayer);
    }
});

document.getElementById('delete-layer').addEventListener('click', () => {
    if (currentRole === 'artist' && layers.length > 1 && activeLayer !== 'base') {
        const index = layers.indexOf(activeLayer);
        layers.splice(index, 1);
        canvasContainer.removeChild(document.getElementById(activeLayer));
        delete canvases[activeLayer];
        delete layerHistory[activeLayer];
        activeLayer = layers[layers.length - 1];
        renderLayers();
        socket.emit('deleteLayer', activeLayer);
        saveState(activeLayer);
    }
});

function renderLayers() {
    const layerManager = document.getElementById('layer-manager');
    layerManager.innerHTML = '';
    layers.forEach((layerId, index) => {
        const layerDiv = document.createElement('div');
        layerDiv.className = 'layer-item flex items-center space-x-2 mb-2';
        layerDiv.innerHTML = `
            <input type="text" value="${layerId}" class="layer-name border p-1 rounded">
            <input type="checkbox" class="layer-visibility" ${canvases[layerId].canvas.style.display !== 'none' ? 'checked' : ''}>
            <button class="switch-layer bg-blue-500 text-white p-1 rounded" data-layer="${index}">Layer ${index + 1}</button>
        `;
        layerManager.appendChild(layerDiv);
    });

    document.querySelectorAll('.layer-name').forEach((input, index) => {
        input.addEventListener('change', (e) => {
            const oldId = layers[index];
            const newId = e.target.value;
            layers[index] = newId;
            canvases[oldId].canvas.id = newId;
            canvases[newId] = canvases[oldId];
            delete canvases[oldId];
            layerHistory[newId] = layerHistory[oldId];
            delete layerHistory[oldId];
            if (activeLayer === oldId) activeLayer = newId;
            renderLayers();
        });
    });

    document.querySelectorAll('.layer-visibility').forEach((checkbox, index) => {
        checkbox.addEventListener('change', (e) => {
            canvases[layers[index]].canvas.style.display = e.target.checked ? 'block' : 'none';
        });
    });

    document.querySelectorAll('.switch-layer').forEach((button) => {
        button.addEventListener('click', (e) => {
            activeLayer = layers[parseInt(e.target.dataset.layer)];
            document.querySelectorAll('.switch-layer').forEach(btn => btn.classList.remove('bg-blue-700'));
            e.target.classList.add('bg-blue-700');
            socket.emit('switchLayer', activeLayer);
        });
    });
}

function startDrawing(x, y) {
    if (currentRole === 'artist' && !powerUpActive) {
        drawing = true;
        canvases[activeLayer].beginPath();
        canvases[activeLayer].moveTo(x, y);
        socket.emit('drawStart', { x, y, layer: activeLayer, color: isEraser ? '#ffffff' : color, brushSize });
    }
}

function draw(x, y) {
    if (drawing && currentRole === 'artist') {
        const drawColor = isEraser ? '#ffffff' : color;
        drawBuffer.push({ x, y, color: drawColor, brushSize });
        lastDrawTime = Date.now();

        canvases[activeLayer].lineWidth = brushSize;
        canvases[activeLayer].strokeStyle = drawColor;
        canvases[activeLayer].lineTo(x, y);
        canv - canvases[activeLayer].stroke();
        canvases[activeLayer].beginPath();
        canvases[activeLayer].moveTo(x, y);
    }
}

function stopDrawing() {
    if (drawing) {
        drawing = false;
        canvases[activeLayer].beginPath();
        flushDrawBuffer();
        saveState(activeLayer);
        socket.emit('drawEnd', { layer: activeLayer });
    }
}

canvasContainer.addEventListener('mousedown', (e) => {
    const rect = canvasContainer.getBoundingClientRect();
    startDrawing(e.clientX - rect.left, e.clientY - rect.top);
});
canvasContainer.addEventListener('mousemove', (e) => {
    const rect = canvasContainer.getBoundingClientRect();
    draw(e.clientX - rect.left, e.clientY - rect.top);
});
canvasContainer.addEventListener('mouseup', stopDrawing);
canvasContainer.addEventListener('mouseout', stopDrawing);

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
canvasContainer.addEventListener('touchend', (e) => {
    e.preventDefault();
    stopDrawing();
}, { passive: false });

setInterval(flushDrawBuffer, 100);

function flushDrawBuffer() {
    if (drawBuffer.length > 0) {
        socket.emit('draw', { layer: activeLayer, draws: drawBuffer, user: currentUser.name });
        drawBuffer = [];
    }
}

socket.on('drawStart', (data) => {
    if (data.user !== currentUser.name) {
        canvases[data.layer].beginPath();
        canvases[data.layer].moveTo(data.x, data.y);
    }
});

socket.on('draw', (data) => {
    if (data.user !== currentUser.name) {
        data.draws.forEach(draw => {
            canvases[data.layer].lineWidth = draw.brushSize;
            canvases[data.layer].strokeStyle = draw.color;
            canvases[data.layer].lineTo(draw.x, draw.y);
            canvases[data.layer].stroke();
            canvases[data.layer].beginPath();
            canvases[data.layer].moveTo(draw.x, draw.y);
        });
    }
});

socket.on('drawEnd', (data) => {
    if (data.user !== currentUser.name) {
        canvases[data.layer].beginPath();
    }
});

socket.on('addLayer', (layerId) => {
    if (!layers.includes(layerId)) {
        layers.push(layerId);
        initializeCanvas(layerId);
    }
});

socket.on('deleteLayer', (layerId) => {
    if (layers.includes(layerId) && layerId !== 'base') {
        const index = layers.indexOf(layerId);
        layers.splice(index, 1);
        canvasContainer.removeChild(document.getElementById(layerId));
        delete canvases[layerId];
        delete layerHistory[layerId];
        activeLayer = layers[layers.length - 1];
        renderLayers();
    }
});

socket.on('switchLayer', (layer) => {
    activeLayer = layer;
    renderLayers();
});

function saveState(layerId) {
    const state = canvases[layerId].canvas.toDataURL();
    if (layerHistory[layerId].undo.length >= 20) layerHistory[layerId].undo.shift();
    layerHistory[layerId].undo.push(state);
    layerHistory[layerId].redo = [];
    document.getElementById('undo').disabled = false;
    document.getElementById('redo').disabled = true;
}

document.getElementById('undo').addEventListener('click', () => {
    if (layerHistory[activeLayer] && layerHistory[activeLayer].undo.length > 1) {
        const prevState = layerHistory[activeLayer].undo.pop();
        layerHistory[activeLayer].redo.push(prevState);
        const stateToRestore = layerHistory[activeLayer].undo[layerHistory[activeLayer].undo.length - 1];
        const img = new Image();
        img.onload = () => {
            canvases[activeLayer].clearRect(0, 0, 800, 500);
            canvases[activeLayer].drawImage(img, 0, 0);
            socket.emit('stateUpdate', { layer: activeLayer, state: stateToRestore });
        };
        img.src = stateToRestore;
        document.getElementById('redo').disabled = false;
        if (layerHistory[activeLayer].undo.length === 1) document.getElementById('undo').disabled = true;
    }
});

document.getElementById('redo').addEventListener('click', () => {
    if (layerHistory[activeLayer] && layerHistory[activeLayer].redo.length > 0) {
        const nextState = layerHistory[activeLayer].redo.pop();
        layerHistory[activeLayer].undo.push(nextState);
        const img = new Image();
        img.onload = () => {
            canvases[activeLayer].clearRect(0, 0, 800, 500);
            canvases[activeLayer].drawImage(img, 0, 0);
            socket.emit('stateUpdate', { layer: activeLayer, state: nextState });
        };
        img.src = nextState;
        document.getElementById('undo').disabled = false;
        if (layerHistory[activeLayer].redo.length === 0) document.getElementById('redo').disabled = true;
    }
});

socket.on('stateUpdate', (data) => {
    const img = new Image();
    img.onload = () => {
        canvases[data.layer].clearRect(0, 0, 800, 500);
        canvases[data.layer].drawImage(img, 0, 0);
    };
    img.src = data.state;
});

document.getElementById('color-picker').addEventListener('change', (e) => {
    color = e.target.value;
});

document.getElementById('brush-size').addEventListener('change', (e) => {
    brushSize = parseInt(e.target.value);
});

document.getElementById('eraser').addEventListener('change', (e) => {
    isEraser = e.target.checked;
});

document.getElementById('send-chat').addEventListener('click', () => {
    const message = document.getElementById('chat-input').value;
    if (message) {
        socket.emit('chatMessage', `${currentUser.name}: ${message}`);
        document.getElementById('chat-input').value = '';
    }
});

socket.on('chatMessage', (msg) => {
    const chatMessages = document.getElementById('chat-messages');
    chatMessages.innerHTML += `<p class="text-sm">${msg}</p>`;
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

document.getElementById('save-drawing').addEventListener('click', () => {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 800;
    tempCanvas.height = 500;
    const tempCtx = tempCanvas.getContext('2d');
    layers.forEach(layerId => {
        if (canvases[layerId].canvas.style.display !== 'none') {
            tempCtx.drawImage(canvases[layerId].canvas, 0, 0);
        }
    });
    const link = document.createElement('a');
    link.download = 'drawing.png';
    link.href = tempCanvas.toDataURL();
    link.click();
});

document.getElementById('power-up').addEventListener('click', () => {
    if (currency >= 20 && !powerUpActive) {
        powerUpActive = true;
        document.getElementById('power-up').classList.add('active');
        currency -= 20;
        currencyDisplay.textContent = currency;
        socket.emit('powerUp', { user: currentUser.name, layer: activeLayer });
        setTimeout(() => {
            powerUpActive = false;
            document.getElementById('power-up').classList.remove('active');
        }, 5000);
    }
});

socket.on('powerUp', (data) => {
    if (data.user !== currentUser.name) {
        canvases[data.layer].fillStyle = 'rgba(255, 255, 0, 0.3)';
        canvases[data.layer].fillRect(0, 0, 800, 500);
    }
});

document.getElementById('buy-brush').addEventListener('click', () => {
    if (currency >= 50) {
        currency -= 50;
        currencyDisplay.textContent = currency;
        brushSize = 15;
        document.getElementById('brush-size').value = '15';
        document.getElementById('buy-brush').disabled = true;
        socket.emit('toolUpdate', { user: currentUser.name, tool: 'brush' });
    }
});

document.getElementById('buy-eraser').addEventListener('click', () => {
    if (currency >= 30) {
        currency -= 30;
        currencyDisplay.textContent = currency;
        canvases[activeLayer].clearRect(0, 0, 800, 500);
        socket.emit('clear', { layer: activeLayer });
        document.getElementById('buy-eraser').disabled = true;
        socket.emit('toolUpdate', { user: currentUser.name, tool: 'eraser' });
    }
});

document.getElementById('leave').addEventListener('click', () => {
    socket.emit('leave', currentUser.name);
    document.getElementById('canvas-container').classList.add('hidden');
    document.getElementById('auth').classList.remove('hidden');
    layers = ['base'];
    canvasContainer.innerHTML = '';
    layerHistory = {};
    initializeCanvas('base');
    currency = 100;
    currencyDisplay.textContent = currency;
    socket.emit('resetState');
});

socket.on('updateUsers', (users) => {
    usersList.innerHTML = '';
    users.forEach(user => {
        const div = document.createElement('div');
        div.textContent = `${user.name} (${user.role})`;
        usersList.appendChild(div);
    });
});

socket.on('clear', (data) => {
    if (data.layer !== activeLayer) {
        canvases[data.layer].clearRect(0, 0, 800, 500);
    }
});

socket.on('toolUpdate', (data) => {
    if (data.user !== currentUser.name) {
        console.log(`${data.user} used ${data.tool}`);
    }
});

socket.on('resetState', () => {
    layers.forEach(layer => canvases[layer].clearRect(0, 0, 800, 500));
    layerHistory = { [activeLayer]: { undo: [], redo: [] } };
    document.getElementById('undo').disabled = true;
    document.getElementById('redo').disabled = true;
});