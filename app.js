// app.js - Solo live to viewers + match messages + fixed connection
document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM ready – starting app");
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
  let lastChatKeys = new Set();
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
  function addMessage(user, text, isSystem = false) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message');
    if (isSystem) msgDiv.classList.add('system'), msgDiv.textContent = text;
    else {
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      msgDiv.innerHTML = `<span class="msg-username">${user}:</span><span class="msg-text">${text}</span><span class="msg-time">${time}</span>`;
    }
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
  function enterSoloPreviewMode() {
    document.querySelector('.video-grid').classList.add('solo-preview');
    p1Video.srcObject = localStream;
    p1Video.muted = true;
    p1Video.play().catch(() => {});
    p1Username.innerText = currentUser || "WAITING FOR OPPONENT";
    p1Streak.innerText = "0";
    p1Stats.classList.remove('hidden');
    addMessage('System', 'Waiting for opponent... Your preview is live!', true);
  }
  function exitSoloPreviewMode() {
    document.querySelector('.video-grid').classList.remove('solo-preview');
  }
  async function enterApp() {
    const username = usernameInput.value.trim();
    if (!username) return alert("Enter username");
    try {
      currentUser = username;
      const credential = await firebaseSignInAnonymously(firebaseAuth);
      currentUserId = credential.user.uid;
      await firebaseSet(firebaseRef(firebaseDb, `players/${currentUserId}/username`), currentUser);
      overlay.classList.add('hidden');
      appContainer.classList.remove('hidden');
      addMessage('System', `${currentUser} joined the chat.`, true);
      firebaseOnValue(firebaseRef(firebaseDb, 'currentBattleId'), (snap) => {
        const battleId = snap.val();
        if (battleId && !currentBattleId) joinBattle(battleId, 'viewer');
      });
      syncChat();
    } catch (error) {
      console.error("Join error:", error);
      alert("Error: " + error.message);
    }
  }
  function syncChat() {
    const chatRef = firebaseRef(firebaseDb, 'chat/global');
    chatMessages.innerHTML = '';
    lastChatKeys.clear();
    firebaseOnValue(chatRef, (snap) => {
      const messages = snap.val() || {};
      Object.entries(messages).forEach(([key, msg]) => {
        if (!lastChatKeys.has(key)) {
          addMessage(msg.user || 'Anonymous', msg.text || '[empty]', msg.isSystem || false);
          lastChatKeys.add(key);
        }
      });
    });
    chatInput.addEventListener('keypress', async (e) => {
      if (e.key === 'Enter') {
        const text = chatInput.value.trim();
        if (text && currentUser) {
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
  queueBtn.addEventListener('click', async () => {
    if (!currentUserId) return alert("Enter username first");

    if (!inQueue) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        console.log("Camera started");

        inQueue = true;
        queueBtn.innerText = "WAITING IN QUEUE...";
        queueBtn.style.backgroundColor = "#555";

        // Check if a battle exists (someone already queued)
        const currentBattleSnap = await firebaseGet(firebaseRef(firebaseDb, 'currentBattleId'));
        currentBattleId = currentBattleSnap.val();

        if (currentBattleId) {
          // Battle exists – join as p2
          myRole = 'p2';
          await firebaseSet(firebaseRef(firebaseDb, `battles/${currentBattleId}/p2`), currentUserId);
          await firebaseSet(firebaseRef(firebaseDb, `battles/${currentBattleId}/participants/${currentUserId}`), 'p2');

          p2Video.srcObject = localStream;
          addMessage('System', 'Joined as challenger (P2) — battle starting!', true);
          exitSoloPreviewMode(); // Switch to split

          // Connect to p1
          firebaseOnValue(firebaseRef(firebaseDb, `battles/${currentBattleId}`), (snap) => {
            p1UserId = snap.val().p1;
            if (p1UserId && !peerConnections[p1UserId]) createPeerConnection(p1UserId, currentBattleId);
          });
        } else {
          // No battle – create solo battle, you as p1
          currentBattleId = 'battle-' + Date.now();
          await firebaseSet(firebaseRef(firebaseDb, 'currentBattleId'), currentBattleId);

          await firebaseSet(firebaseRef(firebaseDb, `battles/${currentBattleId}`), {
            p1: currentUserId,
            p2: null,
            startTime: firebaseServerTimestamp(),
            endTime: Date.now() + 120000,
            votesP1: 0,
            votesP2: 0
          });

          await firebaseSet(firebaseRef(firebaseDb, `battles/${currentBattleId}/participants/${currentUserId}`), 'p1');

          enterSoloPreviewMode(); // Big preview
          addMessage('System', 'You are now live alone on the site! Waiting for a challenger...', true);
        }

      } catch (err) {
        alert("Camera error: " + err.message);
      }
    } else {
      inQueue = false;
      queueBtn.innerText = "JOIN BATTLE CHAT QUEUE";
      queueBtn.style.backgroundColor = "#8b0000";

      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
      }

      exitSoloPreviewMode();

      if (currentBattleId && myRole === 'p1') {
        await firebaseRemove(firebaseRef(firebaseDb, 'currentBattleId'));
      }

      addMessage('System', 'Left queue.', true);
    }
  });

  // Attach JOIN
  joinBtn.addEventListener('click', enterApp);
  usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') enterApp();
  });

  console.log("App ready");
});
</DOCUMENT>

<DOCUMENT filename="style.css">
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    background-color: #0f0f0f;
    color: #ffffff;
    font-family: 'Roboto', sans-serif;
    overflow: hidden;
}

/* Typography */
h2,
.username,
.label,
.value,
button {
    font-family: 'Anton', sans-serif;
    text-transform: uppercase;
}

/* Overlay (username entry) */
.overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: #000000;
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
}

.overlay.hidden {
    display: none;
}

.bubble {
    background-color: #1a1a1a;
    padding: 40px;
    border-radius: 20px;
    text-align: center;
    box-shadow: 0 0 20px rgba(255, 0, 0, 0.2);
    border: 1px solid #333;
}

.bubble h2 {
    font-size: 2rem;
    margin-bottom: 20px;
    letter-spacing: 2px;
}

#username-input {
    padding: 15px;
    font-size: 1.2rem;
    font-family: 'Roboto', sans-serif;
    width: 80%;
    margin-bottom: 20px;
    background: #000;
    color: #fff;
    border: 1px solid #444;
    border-radius: 5px;
    outline: none;
}

#username-input:focus {
    border-color: #d11111;
}

#join-btn {
    padding: 15px 40px;
    font-size: 1.5rem;
    background-color: #d11111;
    color: white;
    border: none;
    cursor: pointer;
    border-radius: 5px;
    transition: background 0.3s;
}

#join-btn:hover {
    background-color: #ff1e1e;
}

/* Main layout */
#app-container {
    display: flex;
    width: 100vw;
    height: 100vh;
}

#app-container.hidden {
    display: none;
}

/* Video grid */
.video-grid {
    flex: 1;
    display: flex;
    padding: 10px;
    gap: 10px;
    position: relative;
    background-color: #050505;
}

.video-container {
    flex: 1;
    background-color: #111;
    position: relative;
    border-radius: 10px;
    overflow: hidden;
    border: 2px solid #222;
    display: flex;
    flex-direction: column;
}

/* Stream info overlay */
.stream-info {
    position: absolute;
    top: 20px;
    left: 20px;
    display: flex;
    align-items: flex-start;
    gap: 20px;
    z-index: 10;
}

.stream-info .username {
    font-size: 3rem;
    letter-spacing: 1px;
    text-shadow: 2px 2px 4px #000;
}

.stream-info .stats {
    display: flex;
    flex-direction: column;
    align-items: center;
}

.stats .label {
    color: #d11111;
    font-size: 1.2rem;
    letter-spacing: 1px;
}

.stats .value {
    color: #d11111;
    font-size: 2.5rem;
    line-height: 1;
}

.hidden {
    display: none !important;
}

video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    background-color: #000;
}

/* Vote buttons */
.vote-btn {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background-color: rgba(209, 17, 17, 0.8);
    color: white;
    padding: 15px 30px;
    font-size: 1.5rem;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    z-index: 10;
    transition: transform 0.2s, background 0.2s;
}

.vote-btn:hover {
    background-color: rgba(255, 30, 30, 1);
    transform: translateX(-50%) scale(1.05);
}

.vote-btn:active {
    transform: translateX(-50%) scale(0.95);
}

/* Timer / status */
.battle-status {
    position: absolute;
    top: 4px;
    left: 50%;
    transform: translateX(-50%);
    background-color: rgba(0, 0, 0, 0.7);
    padding: 10px 20px;
    border-radius: 10px;
    border: 2px solid #d11111;
    z-index: 20;
}

.timer {
    font-family: 'Anton', sans-serif;
    font-size: 2.5rem;
    color: #fff;
    letter-spacing: 2px;
}

/* Sidebar */
.sidebar {
    width: 350px;
    background-color: #111;
    border-left: 2px solid #222;
    display: flex;
    flex-direction: column;
    padding: 10px;
}

.action-btn {
    background-color: #8b0000;
    color: white;
    font-size: 1.5rem;
    padding: 15px;
    width: 100%;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    margin-bottom: 20px;
    transition: background 0.3s;
    text-align: center;
}

.action-btn:hover {
    background-color: #a80000;
}

.chat-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    background-color: #0a0a0a;
    border-radius: 5px;
    border: 1px solid #333;
    overflow: hidden;
}

.chat-messages {
    flex: 1;
    padding: 15px;
    overflow-y: auto;
    font-size: 0.95rem;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.chat-messages .message {
    word-break: break-word;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    padding-bottom: 5px;
}

.chat-messages .system {
    color: #888;
    font-style: italic;
    text-align: center;
    border-bottom: none;
}

.msg-username {
    font-family: 'Anton', sans-serif;
    color: #aaa;
    margin-right: 5px;
    letter-spacing: 1px;
}

.msg-text {
    color: #fff;
}

.msg-time {
    font-size: 0.7rem;
    color: #666;
    margin-left: 5px;
}

.chat-input-area {
    padding: 10px;
    background-color: #111;
    border-top: 1px solid #333;
}

#chat-input {
    width: 100%;
    padding: 10px;
    background-color: #000;
    color: #fff;
    border: 1px solid #444;
    border-radius: 5px;
    outline: none;
    font-family: 'Roboto', sans-serif;
}

#chat-input:focus {
    border-color: #d11111;
}

/* Scrollbar */
.chat-messages::-webkit-scrollbar {
    width: 6px;
}

.chat-messages::-webkit-scrollbar-track {
    background: #0a0a0a;
}

.chat-messages::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 3px;
}

.chat-messages::-webkit-scrollbar-thumb:hover {
    background: #555;
}

/* ────────────────────────────────────────────────
   SOLO PREVIEW MODE – big centered camera when alone
   ──────────────────────────────────────────────── */
.video-grid.solo-preview {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px;
    background: #000;
}

.video-grid.solo-preview .video-container {
    flex: none;
    width: 90vw;
    max-width: 1400px;
    aspect-ratio: 16 / 9;
    margin: 0 auto;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 0 40px rgba(209, 17, 17, 0.6);
}

.video-grid.solo-preview #player2-container,
.video-grid.solo-preview #p2Video,
.video-grid.solo-preview #p2-username,
.video-grid.solo-preview #p2-stats,
.video-grid.solo-preview #vote-p2 {
    display: none !important;
}

.video-grid.solo-preview .stream-info {
    top: 40px;
    left: 40px;
    font-size: 2.5rem;
}

.video-grid.solo-preview .battle-status {
    font-size: 5rem;
    padding: 30px 60px;
}

</DOCUMENT>
