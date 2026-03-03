// app.js
// Basic Frontend Logic for UI Mockup

let currentUser = null;
let localStream = null;
let inQueue = false;

// DOM Elements
const overlay = document.getElementById('username-overlay');
const appContainer = document.getElementById('app-container');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const queueBtn = document.getElementById('queue-btn');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');

const localVideo = document.getElementById('localVideo');
const p1Username = document.getElementById('p1-username');
const p1Stats = document.getElementById('p1-stats');

// Init
joinBtn.addEventListener('click', enterApp);
usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') enterApp();
});

function enterApp() {
    const username = usernameInput.value.trim();
    if (username.length > 0) {
        currentUser = username;
        // Hide overlay, show app
        overlay.classList.add('hidden');
        appContainer.classList.remove('hidden');

        // Add system message
        addMessage('System', `${currentUser} joined the server.`, true);

        // Start camera
        startLocalVideo();
    } else {
        alert("Please enter a username.");
    }
}

async function startLocalVideo() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;

        // Setup local player info visually
        p1Username.innerText = currentUser;
        p1Stats.classList.remove('hidden');

    } catch (err) {
        console.error("Error accessing media devices.", err);
        addMessage('System', 'Camera/Mic access denied or unavailable.', true);
    }
}

// Queue Button
queueBtn.addEventListener('click', () => {
    if (!inQueue) {
        inQueue = true;
        queueBtn.innerText = "WAITING IN QUEUE...";
        queueBtn.style.backgroundColor = "#555";
        addMessage('System', 'You joined the battle queue.', true);

        // TODO: Send queue request to signaling server via WebSockets
    } else {
        inQueue = false;
        queueBtn.innerText = "JOIN BATTLE CHAT QUEUE";
        queueBtn.style.backgroundColor = "#8b0000";
        addMessage('System', 'You left the battle queue.', true);

        // TODO: Send leave queue request to signaling server
    }
});

// Chat Logic
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const msg = chatInput.value.trim();
        if (msg) {
            addMessage(currentUser, msg, false);
            chatInput.value = '';
            // TODO: Send chat message via WebSockets
        }
    }
});

function addMessage(user, text, isSystem) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message');
    if (isSystem) {
        msgDiv.classList.add('system');
        msgDiv.innerText = text;
    } else {
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        msgDiv.innerHTML = `<span class="msg-username">${user}:</span><span class="msg-text">${text}</span><span class="msg-time">${time}</span>`;
    }
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight; // Auto-scroll
}

// --- WebRTC signaling placeholders ---
// Needs Socket.io or PeerJS to coordinate offers/answers between roasters.
// Functionality to implement:
// 1. connectToServer()
// 2. handleMatchFound(peerId)
// 3. createPeerConnection()
// 4. startBattleTimer()
// 5. handleViewerVotes()
