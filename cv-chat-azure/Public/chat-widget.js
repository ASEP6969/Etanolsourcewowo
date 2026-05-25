(async function () {
  // Dapatkan atau buat session ID
  let sessionId = sessionStorage.getItem('chatSessionId');
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem('chatSessionId', sessionId);
  }

  // Hubungkan ke SignalR
  const negotiateRes = await fetch('/api/negotiate');
  const { url } = await negotiateRes.json();

  const connection = new signalR.HubConnectionBuilder()
    .withUrl(url)
    .configureLogging(signalR.LogLevel.Information)
    .build();

  // Join group
  connection.on('connected', async () => {
    await connection.invoke('JoinGroup', sessionId);  // kalau perlu, tapi di server kita langsung kirim ke group tanpa join eksplisit
  });

  // Terima pesan baru
  connection.on('newMessage', (msg) => {
    if (msg.sessionId === sessionId) {
      addMessageToChat(msg.sender, msg.message);
    }
  });

  await connection.start();
  // Join group via REST? Tidak perlu, kita publish langsung dari server

  // Load history
  const historyRes = await fetch(`/api/chat/history/${sessionId}`);
  const history = await historyRes.json();
  history.forEach(msg => addMessageToChat(msg.sender, msg.message));

  // UI Toggle
  const toggleBtn = document.getElementById('chat-toggle');
  const chatBox = document.getElementById('chat-box');
  toggleBtn.addEventListener('click', () => {
    chatBox.classList.toggle('hidden');
  });

  // Kirim pesan
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');
  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  async function sendMessage() {
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message })
    });
  }

  function addMessageToChat(sender, text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `flex ${sender === 'admin' ? 'justify-start' : 'justify-end'}`;
    msgDiv.innerHTML = `<div class="max-w-[80%] px-3 py-1 rounded-lg text-sm ${
      sender === 'admin' ? 'bg-gray-200 text-gray-800' : 'bg-blue-500 text-white'
    }">${text}</div>`;
    document.getElementById('chat-messages').appendChild(msgDiv);
    msgDiv.scrollIntoView({ behavior: 'smooth' });
  }
})();
