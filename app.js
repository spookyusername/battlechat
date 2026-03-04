// app.js - working global chat

let currentUser = null;
let currentUserId = null;
let localStream = null;
let inQueue = false;
let currentBattleId = null;
let myRole = null;

const overlay       = document.getElementById('username-overlay');
const appContainer  = document.getElementById('app-container');
const usernameInput = document.getElementById('username-input');
const joinBtn       = document.getElementById('join-btn');
const queueBtn      = document.getElementById('queue-btn');
const chatMessages  = document.getElementById('chat-messages');
const chatInput     = document.getElementById('chat-input');

// Enter app
joinBtn.addEventListener('click', enterApp);
usernameInput.addEventListener('keypress', e => { if (e.key === 'Enter') enterApp(); });

async function enterApp() {
  const username = usernameInput.value.trim();
  if (!username) return alert("Enter username");

  try {
    currentUser = username;
    const cred = await firebaseSignInAnonymously(firebaseAuth);
    currentUserId = cred.user.uid;

    await firebaseSet(firebaseRef(firebaseDb, `players/${currentUserId}/username`), currentUser);

    overlay.classList.add('hidden');
    appContainer.classList.remove('hidden');

    addMessage('System', `${currentUser} joined.`, true);
    listenToChat();
  } catch (err) {
    alert("Error: " + err.message);
  }
}

// Send message on Enter
chatInput.addEventListener('keypress', async e => {
  if (e.key === 'Enter' && chatInput.value.trim()) {
    e.preventDefault();
    const text = chatInput.value.trim();
    chatInput.value = '';

    if (!currentUserId) return;

    await firebasePush(firebaseRef(firebaseDb, 'chat'), {
      userId: currentUserId,
      username: currentUser,
      text,
      timestamp: firebaseServerTimestamp()
    });
  }
});

// Listen to global chat
function listenToChat() {
  firebaseOnValue(firebaseRef(firebaseDb, 'chat'), snap => {
    chatMessages.innerHTML = ''; // clear (or limit later)
    const messages = snap.val() || {};
    Object.values(messages).forEach(msg => {
      addMessage(msg.username, msg.text);
    });
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

function addMessage(sender, text, isSystem = false) {
  const div = document.createElement('div');
  div.className = `message ${isSystem ? 'system' : ''}`;
  if (isSystem) {
    div.textContent = text;
  } else {
    div.innerHTML = `<span class="msg-username">${sender}</span><span class="msg-text">${text}</span>`;
  }
  chatMessages.appendChild(div);
}

// Queue (unchanged for now)
queueBtn.addEventListener('click', async () => {
  if (!currentUserId) return alert("Join first");
  // ... your existing queue logic ...
});
