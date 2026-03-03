// app.js - Global chat working + fixed function order

document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM ready – starting app");

  // ────────────────────────────────────────────────
  // VARIABLES
  // ────────────────────────────────────────────────
  let currentUser = null;
  let currentUserId = null;
  let localStream = null;
  let inQueue = false;
  let currentBattleId = null;
  let myRole = null;
  let peerConnections = {};
  let p1UserId = null;
  let p2UserId = null;
  let streak = { p1: 0, p2: 0 };
  let lastChatKeys = new Set(); // to avoid duplicate messages

  // DOM elements
  const overlay = document.getElementById('username-overlay');
  const appContainer = document.getElementById('app-container');
  const usernameInput = document.getElementById('username-input');
  const joinBtn = document.getElementById('join-btn');
  const queueBtn = document.getElementById('queue-btn');
  const chatInput = document.getElementById('chat-input');
  const chatMessages = document.getElementById('chat-messages');
  const p1Video = document.getElementById('p1Video');
  const p2Video = document.getElementById('p2Video');
  const p1Username = document.getElementById('p1-username');
  const p2Username = document.getElementById('p2-username');
  const p1Streak = document.getElementById('p1-streak');
  const p2Streak = document.getElementById('p2-streak');
  const p1Stats = document.getElementById('p1-stats');
  const p2Stats = document.getElementById('p2-stats');
  const battleStatus = document.getElementById('battle-status');
  const timerEl = document.getElementById('timer');
  const voteP1Btn = document.getElementById('vote-p1');
  const voteP2Btn = document.getElementById('vote-p2');

  const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  // ────────────────────────────────────────────────
  // HELPER: addMessage (must be defined early)
  // ────────────────────────────────────────────────
  function addMessage(user, text, isSystem = false) {
    console.log("Adding message →", user, ":", text);
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message');
    if (isSystem) {
      msgDiv.classList.add('system');
      msgDiv.textContent = text;
    } else {
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      msgDiv.innerHTML = `
        <span class="msg-username">${user}:</span>
        <span class="msg-text">${text}</span>
        <span class="msg-time">${time}</span>
      `;
    }
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // ────────────────────────────────────────────────
  // JOIN (username → enter site)
  // ────────────────────────────────────────────────
  async function enterApp() {
    console.log("JOIN button pressed");
    const username = usernameInput.value.trim();
    if (!username) {
      alert("Please enter a username");
      return;
    }

    try {
      currentUser = username;
      const credential = await firebaseSignInAnonymously(firebaseAuth);
      currentUserId = credential.user.uid;
      console.log("Signed in as:", currentUserId);

      await firebaseSet(firebaseRef(firebaseDb, `players/${currentUserId}/username`), currentUser);

      overlay.classList.add('hidden');
      appContainer.classList.remove('hidden');

      addMessage('System', `${currentUser} joined the chat.`, true);

      // Listen for battle (if any exist)
      firebaseOnValue(firebaseRef(firebaseDb, 'currentBattleId'), (snap) => {
        const battleId = snap.val();
        if (battleId && !currentBattleId) {
          joinBattle(battleId, 'viewer');
        }
      });

      // Start global chat
      syncChat();

    } catch (error) {
      console.error("Join failed:", error);
      alert("Could not join: " + error.message);
    }
  }

  // ────────────────────────────────────────────────
  // GLOBAL CHAT – everyone sees everything
  // ────────────────────────────────────────────────
  function syncChat() {
    console.log("Starting global chat listener");
    const chatRef = firebaseRef(firebaseDb, 'chat/global');

    // Reset chat area when starting fresh
    chatMessages.innerHTML = '';
    lastChatKeys.clear();

    firebaseOnValue(chatRef, (snap) => {
      const messages = snap.val() || {};
      console.log("Received chat snapshot with", Object.keys(messages).length, "messages");

      Object.entries(messages).forEach(([key, msg]) => {
        if (!lastChatKeys.has(key)) {
          addMessage(msg.user || 'Anonymous', msg.text || '[empty]', msg.isSystem || false);
          lastChatKeys.add(key);
        }
      });
    });

    // Send message on Enter
    chatInput.addEventListener('keypress', async (e) => {
      if (e.key === 'Enter') {
        const text = chatInput.value.trim();
        if (text && currentUser) {
          console.log("Sending message:", text);
          await firebasePush(chatRef, {
            user: currentUser,
            text: text,
            isSystem: false,
            time: firebaseServerTimestamp()
          });
          chatInput.value = '';
        }
      }
    });
  }

  // ────────────────────────────────────────────────
  // QUEUE BUTTON (camera only here)
  // ────────────────────────────────────────────────
  queueBtn.addEventListener('click', async () => {
    console.log("Queue button clicked");
    if (!currentUserId) {
      alert("Enter username first");
      return;
    }

    if (!inQueue) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        console.log("Camera started successfully");
        addMessage('System', 'Camera & mic turned on. You are now in queue.', true);
      } catch (err) {
        console.error("Camera/mic error:", err.name, err.message);
        alert("Cannot start camera/mic: " + err.message + "\n\nTry:\n1. Refresh page\n2. Allow in browser settings\n3. Use incognito");
        return;
      }

      inQueue = true;
      queueBtn.innerText = "WAITING IN QUEUE...";
      queueBtn.style.backgroundColor = "#555";

      await firebaseSet(firebaseRef(firebaseDb, `queue/${currentUserId}`), {
        username: currentUser,
        joinedAt: firebaseServerTimestamp()
      });

    } else {
      inQueue = false;
      queueBtn.innerText = "JOIN BATTLE CHAT QUEUE";
      queueBtn.style.backgroundColor = "#8b0000";

      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
      }

      await firebaseRemove(firebaseRef(firebaseDb, `queue/${currentUserId}`));
      addMessage('System', 'Left queue. Camera off.', true);
    }
  });

  // ────────────────────────────────────────────────
  // Attach JOIN listeners
  // ────────────────────────────────────────────────
  joinBtn.addEventListener('click', enterApp);
  usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') enterApp();
  });

  console.log("App ready – type username and press JOIN");
});
