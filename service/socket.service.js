const { io } = require("../app");
const actions = require("../events");
const tag = require("../constants/event.constants");
const Notification = require('./notification.service');
const dbService = require("./db.service");

const socketRooms = new Map();
const sessions = new Map();
// const chatcicle = {};
const questions = [
  'What is your name?',
  'How old are you?'
];

io.on(tag.CONNECTION, async (socket) => {
  const { type } = socket.handshake.query;
  console.log(`Socket connected on ${socket.id} | type: ${type}`);

  if (type === 'admin') {
    actions.GetAllPendingSessions();
  }

  // actions.GetSessions(socket);

  socket.on('joinRoom', (room) => {
    socket.join(room);
    console.log(`User joined room: ${room}`);
  });

  socket.on('sendMessage', (room, message) => {
    io.to(room).emit('message', message);
  });

  function askQuestion(index) {
    if (index >= questions.length) {
      // All questions have been asked
      const session = sessions.get(socket.id);
      if (session) {
        const responses = questions.map((question, i) => ({
          question,
          answer: session.answers[i].answer
        }));
        io.to(socket.id).emit('questions completed', responses);
        // Close the session and remove session data
        socket.disconnect(true);
        sessions.delete(socket.id);
      }
      return;
    }

    const question = questions[index];
    io.to(socket.id).emit('ask question', question);
  }

  // Start asking questions when the client is ready
  socket.on('ready', () => {
    // Initialize session data for the client
    sessions.set(socket.id, { answers: [], currentIndex: 0 });

    askQuestion(0);
  });

  socket.on('get_my_sessions', (payload) => {
    actions.GetMySessions(payload);
  });
  socket.on(tag.GET_ONLINE_EXPERTS, (payload) => {
    // console.log('GetCatWiseOnlineList socket is ', payload);
    actions.GetCatWiseOnlineList(payload);
  });

  // Handle client's answers
  socket.on('answer', (answer) => {
    const session = sessions.get(socket.id);
    if (session) {
      session.answers.push(answer);
      const nextIndex = session.currentIndex + 1;
      session.currentIndex = nextIndex;

      if (nextIndex >= questions.length) {
        // All questions have been answered
        askQuestion(nextIndex); // This will emit "questions completed" event
      } else {
        // Ask the next question
        askQuestion(nextIndex);
      }
    }
  });

  // Join a room
  socket.on('join room', (room) => {
    socket.join(room);
    socketRooms.set(socket, room);
    console.log(`User joined room: ${room}`);
  });


  socket.on(tag.ONLINE, (payload) => {
    socket.user_id = payload.user_id;
    socket.account_type = payload.account_type;
    payload.socket_id = socket.id;
    socket.userData = payload;

    actions.Online(payload);

    io.emit(tag.USER_JOINED, payload);

    const onlinePayload = {
      user_id: payload.user_id,
      last_seen: Date.now(),
      account_type: payload.account_type,
      user_type: payload?.user_type,
      online_status: "active",
    };

    io.emit(tag.USER_ONLINE, onlinePayload);
  });

  socket.on(tag.GET_NEAREST_USERS, async (payload) => {
    const users = await actions.GetNearestUsers(payload);

    io.to(socket.id).emit(tag.NEAREST_USER_LIST, users);
  });

  socket.on(tag.ACTIVITY_CREATED, async (payload) => {
    console.log('activity created payload ', payload);

    const notificationService = new Notification();

    const notificationPayload = {
      title: payload.title,
      body: payload.description,
      topic: payload.topic,
      activity_id: payload?.activity_id,
      type: "asking_zone",
    };

    console.log('notification payload', notificationPayload);

    notificationService.sendTopicNotificaion(notificationPayload);

    // io.emit(tag.NOTIFY_ACTIVITY, payload);
    actions.GetCatWiseSessionsList(payload);
    actions.GetAllPendingSessions();
  });

  socket.on(tag.REFRESH_SESSIONS, async (payload) => {
    console.log('refresh calling with ', payload);
    // actions.GetSessions(payload);
  });

  socket.on(tag.ACTIVITY_JOINED, (payload) => {
    console.log('activity joined payload ', payload);
    socket.join(payload.activity_id);
    socketRooms.set(socket, payload.activity_id);
    dbService.table('conversations').where('id', payload.activity_id).first().then((res) => {
      console.log('join res is ', res);
      if (res !== undefined) {
        actions.ActivityJoined(payload);
        console.log('before calling get my sessions');
        actions.GetAllPendingSessions();
        console.log('after calling get my sessions');
        // if (payload.user_type === 'customer') {
        //   if (payload.user_id == res.customer_id || res.customer_id == null) {
        //     error("Already joined a customer");
        //   } else {
        //     actions.ActivityJoined(payload);
        //   }
        // } else if (payload.user_type === 'expert') {
        //   if (payload.user_id == res.expert_id || res.expert_id == null) {
        //     actions.ActivityJoined(payload);
        //   } else {
        //     error("Already joined an expert");
        //   }
        // }
      }
    });
  });


  socket.on(tag.MESSAGE_SENT_GP, (payload) => {
    console.log('MESSAGE_SENT_GP', payload);
    actions.MessageSentGp(payload);
  });

  socket.on('activity_closed_by_expert', async (payload) => {
    console.log('activity_closed_by_expert', payload);
    const receiver_socket = await dbService.select('socket_id').from('jp_user_online').where('user_id', payload.receiver_id).first();
    console.log('activity_closed_by_expert receiver socket ', receiver_socket);
    io.to(receiver_socket.socket_id).emit('activity_closed_by_expert', payload);
  });


  socket.on(tag.SET_VIEW_MESSAGE_GP, (payload) => {
    console.log(`SET_VIEW_MESSAGE_GP`);
    //   // console.log(payload);
    actions.MessageViewedGp(payload);
    io.emit(tag.GET_VIEW_MESSAGE_GP, payload);
  });

  socket.on(tag.FORCE_DISCONNECT, () => {
    // console.log("\n\n", "inside force disconnect", "\n\n");
    // console.log(socket.userData);
    // console.log(socket.user_id);
    // console.log(socket.account_type);
  });

  socket.on(tag.DISCONNECT, () => {
    console.log("\nUser disconnected--- user_id:", socket.user_id, " socket_id:", socket.id, "\n");
    actions.Disconnect({ user_id: socket.user_id, account_type: 'personal' });
    io.emit(tag.USER_LEFT, socket.userData);
    io.emit(tag.USER_OFFLINE, {
      user_id: socket.user_id,
      account_type: socket.account_type,
      last_seen: Date.now(),
      online_status: "inactive",
    });
  });
});
